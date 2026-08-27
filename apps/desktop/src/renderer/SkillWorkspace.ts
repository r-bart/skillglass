import type {
  ForgeBridge,
  InstallationDetailDto,
  InventoryItemDto,
  OperationPlanDto,
  OperationResultDto,
} from "@forge/contracts"
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from "react"

import { AccessibleDialog } from "./AccessibleDialog.js"
import { CodeEditor } from "./CodeEditor.js"
import { createElement, getActiveLocale } from "./i18n.js"
import { OperationPlanDetails } from "./OperationPlanDetails.js"
import { SafeMarkdown } from "./SafeMarkdown.js"
import { createTextDiffModel, TextDiff } from "./TextDiff.js"
import {
  DangerAction,
  QuietAction,
  SkillTile,
  StatusPill,
  type StatusTone,
} from "./VisualPrimitives.js"

export type WorkspaceMode = "preview" | "code" | "changes"

export interface SkillEditSession {
  readonly detail: InstallationDetailDto
  readonly baseContent: string
  readonly baseSnapshotId: string
  readonly draft: string
  readonly mode: WorkspaceMode
  readonly plan?: OperationPlanDto | undefined
  readonly plannedDraft?: string | undefined
  readonly error?: string | undefined
  readonly planning?: boolean
  readonly applying?: boolean
  readonly reloading?: boolean
  readonly failureStatus?: OperationResultDto["status"] | undefined
}

export interface SkillWorkspaceProps {
  readonly installationId: string
  readonly inventoryBridge: ForgeBridge["inventory"]
  readonly operationBridge: ForgeBridge["operations"]
  readonly initialMode?: Exclude<WorkspaceMode, "changes">
  readonly onBack?: () => void
  readonly onCommitted?: (detail: InstallationDetailDto) => void
  readonly onStatus?: (message: string) => void
}

type WorkspaceLoadState =
  | { readonly status: "loading" }
  | { readonly status: "not-found" }
  | { readonly status: "inspect-error"; readonly message: string }
  | { readonly status: "read-only"; readonly detail: InstallationDetailDto }
  | { readonly status: "ready"; readonly session: SkillEditSession }

const updateLabels: Record<InventoryItemDto["status"]["update"], string> = {
  current: "Actualizada",
  available: "Actualización disponible",
  diverged: "Cambios locales",
  unavailable: "No disponible",
  unknown: "No observado",
}

const managerLabels: Record<InstallationDetailDto["provenance"]["managedBy"], string> = {
  forge: "Skillglass",
  external: "Herramienta externa",
  runtime: "Runtime",
  user: "Usuario",
  unknown: "Gestor desconocido",
}

function adapterLabel(adapterId: string): string {
  if (adapterId === "codex") return "Codex"
  if (adapterId === "folder") return "Carpetas Agent Skills"
  return adapterId
}

function scopeLabel(scope: InventoryItemDto["scope"]): string {
  switch (scope.kind) {
    case "global": return "Global"
    case "managed": return "Gestionada"
    case "system": return "Sistema"
    case "project": return `Proyecto · ${scope.projectId}`
  }
}

function entryPath(detail: InstallationDetailDto): string {
  const usesWindowsSeparators = detail.locationLabel.includes("\\") &&
    !detail.locationLabel.includes("/")
  const separator = usesWindowsSeparators ? "\\" : "/"
  const location = detail.locationLabel.replace(/[\\/]+$/u, "")
  return `${location}${separator}${detail.entryFile.replaceAll("/", separator)}`
}

function updateTone(update: InventoryItemDto["status"]["update"]): StatusTone {
  switch (update) {
    case "current": return "ok"
    case "available":
    case "diverged": return "attention"
    case "unavailable":
    case "unknown": return "idle"
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : "No se pudo inspeccionar la instalación"
}

function isNotFound(reason: unknown): boolean {
  if (typeof reason === "object" && reason !== null && "code" in reason) {
    const code = String(reason.code).toLowerCase()
    if (code === "not_found" || code === "installation_not_found") return true
  }
  return /(?:installation not found|instalación no encontrada)/iu.test(errorMessage(reason))
}

function skillName(detail: InstallationDetailDto): string {
  return detail.installation.name.state === "known"
    ? detail.installation.name.value
    : detail.installation.key
}

function isReadOnly(detail: InstallationDetailDto): boolean {
  const source = detail.installation.status.source
  return !detail.capabilities.canEditEntry || source === "read-only" || source === "managed"
}

function planCanApply(plan: OperationPlanDto | undefined, now = Date.now()): plan is OperationPlanDto {
  return plan?.kind === "update-entry-content" &&
    plan.status === "planned" &&
    plan.conflicts.length === 0 &&
    Date.parse(plan.expiresAt) > now
}

function invalidPlanMessage(plan: OperationPlanDto): string {
  if (plan.status === "expired" || Date.parse(plan.expiresAt) <= Date.now()) {
    return "El plan ha caducado. Revisa los cambios de nuevo antes de actualizar."
  }
  if (plan.conflicts.length > 0) {
    return plan.conflicts.map(({ message }) => message).join(" ")
  }
  return "Skillglass no puede preparar esta actualización con el estado observado."
}

function operationFailureMessage(result: OperationResultDto): string {
  const issues = result.issues.map(({ message }) => message).filter((message) => message !== result.message)
  return [result.message, ...issues].join(" ")
}

function isWideWorkspace(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1280px)").matches
}

function workspaceState(
  className: string,
  title: string,
  message: string,
  role: "alert" | "status",
) {
  const titleId = `skill-workspace-${className}-title`
  return createElement(
    "section",
    {
      "aria-labelledby": titleId,
      className: `skill-workspace skill-workspace--${className}`,
    },
    createElement("h2", { id: titleId }, title),
    createElement("p", { "aria-live": role === "status" ? "polite" : undefined, role }, message),
  )
}

/** Owns the immutable baseline and editable draft for one skill-editing visit. */
export function SkillWorkspace(props: SkillWorkspaceProps) {
  const { installationId, inventoryBridge } = props
  const inventoryBridgeRef = useRef(inventoryBridge)
  const initialModeRef = useRef(props.initialMode ?? "code")
  const reviewButtonRef = useRef<HTMLButtonElement>(null)
  const applyButtonRef = useRef<HTMLButtonElement>(null)
  const workspaceTitleRef = useRef<HTMLHeadingElement>(null)
  const previewTabRef = useRef<HTMLButtonElement>(null)
  const codeTabRef = useRef<HTMLButtonElement>(null)
  const changesTabRef = useRef<HTMLButtonElement>(null)
  const previewScrollerRef = useRef<HTMLElement>(null)
  const diffScrollerRef = useRef<HTMLDivElement>(null)
  const planScrollerRef = useRef<HTMLElement>(null)
  const restoreReviewFocusRef = useRef(false)
  const exitTriggerRef = useRef<HTMLElement>(null)
  const reloadTriggerRef = useRef<HTMLElement>(null)
  const asyncActionRef = useRef(0)
  const sessionIdentityRef = useRef<{
    installationId: string
    planId: string | undefined
  } | undefined>(undefined)
  const [loadState, setLoadState] = useState<WorkspaceLoadState>({ status: "loading" })
  const [planClock, setPlanClock] = useState(() => Date.now())
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
  const [reloadDialogOpen, setReloadDialogOpen] = useState(false)
  const [wideWorkspace, setWideWorkspace] = useState(isWideWorkspace)
  const [contextDisclosureOpen, setContextDisclosureOpen] = useState(isWideWorkspace)
  const [planDisclosureOpen, setPlanDisclosureOpen] = useState(isWideWorkspace)
  inventoryBridgeRef.current = inventoryBridge
  sessionIdentityRef.current = loadState.status === "ready"
    ? {
        installationId: loadState.session.detail.installation.installationId,
        planId: loadState.session.plan?.planId,
      }
    : undefined

  const readyMode = loadState.status === "ready" ? loadState.session.mode : undefined
  const readyPlanId = loadState.status === "ready" && loadState.session.mode === "changes"
    ? loadState.session.plan?.planId
    : undefined
  const readyPlanExpiry = loadState.status === "ready" && loadState.session.mode === "changes"
    ? loadState.session.plan?.expiresAt
    : undefined
  const readyBaseContent = loadState.status === "ready" ? loadState.session.baseContent : ""
  const readyDraft = loadState.status === "ready" ? loadState.session.draft : ""
  const deferredDraft = useDeferredValue(readyDraft)
  const diffDraft = readyMode === "changes" ? readyDraft : deferredDraft
  const diff = useMemo(
    () => createTextDiffModel(readyBaseContent, diffDraft),
    [diffDraft, readyBaseContent],
  )

  useEffect(() => {
    if (readyPlanId !== undefined) applyButtonRef.current?.focus()
  }, [readyPlanId])

  useEffect(() => {
    if (loadState.status !== "ready") return
    workspaceTitleRef.current?.focus()
  }, [installationId, loadState.status])

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(min-width: 1280px)")
    const update = ({ matches }: Pick<MediaQueryListEvent, "matches">): void => {
      setWideWorkspace(matches)
      setContextDisclosureOpen(matches)
      setPlanDisclosureOpen(matches)
    }
    update(query)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (readyMode !== "code" || !restoreReviewFocusRef.current) return
    restoreReviewFocusRef.current = false
    reviewButtonRef.current?.focus()
  }, [readyMode])

  useEffect(() => {
    if (readyMode === "preview") {
      const preview = previewScrollerRef.current
      if (preview !== null) {
        preview.scrollTop = 0
        preview.scrollLeft = 0
      }
      return
    }
    if (readyMode !== "changes") return
    for (const scroller of [diffScrollerRef.current, planScrollerRef.current]) {
      if (scroller === null) continue
      scroller.scrollTop = 0
      scroller.scrollLeft = 0
    }
  }, [readyMode])

  useEffect(() => {
    if (readyPlanExpiry === undefined) return
    const delay = Date.parse(readyPlanExpiry) - Date.now()
    if (delay <= 0) {
      setPlanClock(Date.now())
      return
    }
    const timer = window.setTimeout(() => setPlanClock(Date.now()), Math.min(delay + 1, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [readyPlanExpiry])

  useEffect(() => () => {
    asyncActionRef.current += 1
  }, [])

  useEffect(() => {
    let current = true
    setLoadState({ status: "loading" })

    inventoryBridgeRef.current.inspect({ installationId }).then((detail) => {
      if (!current) return
      if (isReadOnly(detail)) {
        setLoadState({ status: "read-only", detail })
        return
      }
      setLoadState({
        status: "ready",
        session: {
          detail,
          baseContent: detail.rawEntryContent,
          baseSnapshotId: detail.snapshotId,
          draft: detail.rawEntryContent,
          mode: initialModeRef.current,
        },
      })
    }).catch((reason: unknown) => {
      if (!current) return
      setLoadState(isNotFound(reason)
        ? { status: "not-found" }
        : { status: "inspect-error", message: errorMessage(reason) })
    })

    return () => { current = false }
  }, [installationId])

  if (loadState.status === "loading") {
    return workspaceState("loading", "Editar skill", "Cargando skill…", "status")
  }
  if (loadState.status === "not-found") {
    return workspaceState(
      "not-found",
      "Skill no encontrada",
      "La instalación ya no está disponible en el inventario.",
      "status",
    )
  }
  if (loadState.status === "inspect-error") {
    return workspaceState(
      "error",
      "No se pudo abrir la skill",
      loadState.message,
      "alert",
    )
  }
  if (loadState.status === "read-only") {
    const reasons = loadState.detail.capabilities.unavailableReasons.join(" ")
    return workspaceState(
      "read-only",
      skillName(loadState.detail),
      reasons.length > 0
        ? `Esta skill es de solo lectura. ${reasons}`
        : "Esta skill está gestionada externamente y solo se puede inspeccionar.",
      "status",
    )
  }

  const { session } = loadState
  const { detail } = session
  const dirty = session.draft !== session.baseContent
  const busy = session.planning === true || session.applying === true || session.reloading === true
  const changeCount = diff.added + diff.removed
  const update = detail.installation.status.update
  const path = entryPath(detail)
  const name = skillName(detail)

  const updateSession = (change: (current: SkillEditSession) => SkillEditSession): void => {
    setLoadState((currentState) => currentState.status === "ready"
      ? { ...currentState, session: change(currentState.session) }
      : currentState)
  }

  const review = async (): Promise<void> => {
    if (!dirty || busy) return
    if (
      planCanApply(session.plan) &&
      session.plan.installationIds.includes(installationId) &&
      session.plannedDraft === session.draft
    ) {
      updateSession((current) => ({ ...current, mode: "changes" }))
      return
    }
    const requestedInstallationId = installationId
    const requestedDraft = session.draft
    const requestedSnapshotId = session.baseSnapshotId
    updateSession((current) => ({
      ...current,
      error: undefined,
      failureStatus: undefined,
      plan: undefined,
      plannedDraft: undefined,
      planning: true,
    }))

    try {
      const plan = await props.operationBridge.plan({
        kind: "update-entry-content",
        installationId,
        expectedSnapshotId: requestedSnapshotId,
        content: requestedDraft,
      })
      setLoadState((currentState) => {
        if (currentState.status !== "ready") return currentState
        const current = currentState.session
        if (
          current.detail.installation.installationId !== requestedInstallationId ||
          current.baseSnapshotId !== requestedSnapshotId ||
          current.draft !== requestedDraft
        ) {
          return {
            ...currentState,
            session: {
              ...current,
              error: "El contenido cambió mientras se preparaba la revisión. Vuelve a revisar el draft actual.",
              plan: undefined,
              plannedDraft: undefined,
              planning: false,
            },
          }
        }
        const valid = planCanApply(plan) && plan.installationIds.includes(requestedInstallationId)
        return {
          ...currentState,
          session: {
            ...current,
            error: valid ? undefined : invalidPlanMessage(plan),
            failureStatus: valid
              ? undefined
              : plan.conflicts.length > 0
              ? "conflict"
              : plan.status === "expired"
              ? "stale"
              : "failed",
            mode: valid ? "changes" : "code",
            plan,
            plannedDraft: valid ? requestedDraft : undefined,
            planning: false,
          },
        }
      })
    } catch (reason) {
      setLoadState((currentState) => currentState.status === "ready" &&
        currentState.session.detail.installation.installationId === requestedInstallationId
        ? {
            ...currentState,
            session: {
              ...currentState.session,
              error: errorMessage(reason) || "No se pudo preparar la actualización",
              failureStatus: "failed",
              plan: undefined,
              plannedDraft: undefined,
              planning: false,
            },
          }
        : currentState)
    }
  }

  const returnToCode = (): void => {
    restoreReviewFocusRef.current = true
    updateSession((current) => ({
      ...current,
      error: undefined,
      failureStatus: undefined,
      mode: "code",
      plan: undefined,
      plannedDraft: undefined,
    }))
  }

  const requestExit = (trigger: HTMLElement | null): void => {
    if (busy || props.onBack === undefined) return
    if (!dirty) {
      props.onBack()
      return
    }
    exitTriggerRef.current = trigger
    setDiscardDialogOpen(true)
  }

  const discardChanges = (): void => {
    if (busy || !dirty) return
    updateSession((current) => ({
      detail: current.detail,
      baseContent: current.baseContent,
      baseSnapshotId: current.baseSnapshotId,
      draft: current.baseContent,
      mode: "code",
    }))
  }

  const confirmDiscard = (): void => {
    if (busy || props.onBack === undefined) return
    updateSession((current) => ({
      detail: current.detail,
      baseContent: current.baseContent,
      baseSnapshotId: current.baseSnapshotId,
      draft: current.baseContent,
      mode: "code",
    }))
    setDiscardDialogOpen(false)
    props.onBack()
  }

  const planAvailable = planCanApply(session.plan, planClock) &&
    session.plan.installationIds.includes(installationId) &&
    session.plannedDraft === session.draft
  const changesDisabled = busy || !dirty
  const confirmable = session.mode === "changes" &&
    planAvailable &&
    !busy
  const visiblePlanError = session.error ?? (
    session.mode === "changes" && session.plan !== undefined && !planAvailable
      ? invalidPlanMessage(session.plan)
      : undefined
  )

  const confirm = async (): Promise<void> => {
    const activePlan = session.plan
    if (!confirmable || activePlan === undefined) return
    const activePlanId = activePlan.planId
    const activeInstallationId = detail.installation.installationId
    const action = ++asyncActionRef.current
    updateSession((current) => current.plan?.planId === activePlanId
      ? { ...current, applying: true, error: undefined }
      : current)

    try {
      const result = await props.operationBridge.confirm({ planId: activePlanId })
      const identity = sessionIdentityRef.current
      if (
        asyncActionRef.current !== action ||
        identity?.installationId !== activeInstallationId ||
        identity.planId !== activePlanId
      ) return

      if (result.planId !== undefined && result.planId !== activePlanId) {
        setLoadState((currentState) => currentState.status === "ready" &&
          currentState.session.plan?.planId === activePlanId
          ? {
              ...currentState,
              session: {
                ...currentState.session,
                applying: false,
                error: "La operación respondió con un plan diferente. No se ha actualizado la skill.",
                failureStatus: "failed",
                mode: "changes",
                plan: undefined,
                plannedDraft: undefined,
              },
            }
          : currentState)
        return
      }

      if (result.status !== "committed") {
        setLoadState((currentState) => currentState.status === "ready" &&
          currentState.session.plan?.planId === activePlanId
          ? {
              ...currentState,
              session: {
                ...currentState.session,
                applying: false,
                error: operationFailureMessage(result),
                failureStatus: result.status,
                mode: "changes",
                plan: undefined,
                plannedDraft: undefined,
              },
            }
          : currentState)
        return
      }

      props.onStatus?.(result.message)
      try {
        const nextDetail = await inventoryBridgeRef.current.inspect({
          installationId: activeInstallationId,
        })
        if (
          asyncActionRef.current !== action ||
          sessionIdentityRef.current?.installationId !== activeInstallationId
        ) return
        setLoadState({
          status: "ready",
          session: {
            detail: nextDetail,
            baseContent: nextDetail.rawEntryContent,
            baseSnapshotId: nextDetail.snapshotId,
            draft: nextDetail.rawEntryContent,
            mode: "preview",
          },
        })
        props.onCommitted?.(nextDetail)
      } catch (reason) {
        if (asyncActionRef.current !== action) return
        setLoadState((currentState) => currentState.status === "ready" &&
          currentState.session.detail.installation.installationId === activeInstallationId
          ? {
              ...currentState,
              session: {
                ...currentState.session,
                applying: false,
                error: `La actualización se completó, pero no se pudo recargar la skill. ${errorMessage(reason)}`,
                failureStatus: "failed",
                mode: "changes",
                plan: undefined,
                plannedDraft: undefined,
              },
            }
          : currentState)
      }
    } catch (reason) {
      if (asyncActionRef.current !== action) return
      setLoadState((currentState) => currentState.status === "ready" &&
        currentState.session.plan?.planId === activePlanId
        ? {
            ...currentState,
            session: {
              ...currentState.session,
              applying: false,
              error: errorMessage(reason),
              failureStatus: "failed",
              mode: "changes",
              plan: undefined,
              plannedDraft: undefined,
            },
          }
        : currentState)
    }
  }

  const requestReload = (trigger: HTMLElement): void => {
    if (busy) return
    reloadTriggerRef.current = trigger
    setReloadDialogOpen(true)
  }

  const reloadFromDisk = async (): Promise<void> => {
    if (busy) return
    const activeInstallationId = detail.installation.installationId
    const action = ++asyncActionRef.current
    setReloadDialogOpen(false)
    updateSession((current) => ({
      ...current,
      error: undefined,
      plan: undefined,
      plannedDraft: undefined,
      reloading: true,
    }))

    try {
      const nextDetail = await inventoryBridgeRef.current.inspect({
        installationId: activeInstallationId,
      })
      if (
        asyncActionRef.current !== action ||
        sessionIdentityRef.current?.installationId !== activeInstallationId
      ) return
      setLoadState(isReadOnly(nextDetail)
        ? { status: "read-only", detail: nextDetail }
        : {
            status: "ready",
            session: {
              detail: nextDetail,
              baseContent: nextDetail.rawEntryContent,
              baseSnapshotId: nextDetail.snapshotId,
              draft: nextDetail.rawEntryContent,
              mode: "code",
            },
          })
    } catch (reason) {
      if (asyncActionRef.current !== action) return
      setLoadState((currentState) => currentState.status === "ready" &&
        currentState.session.detail.installation.installationId === activeInstallationId
        ? {
            ...currentState,
            session: {
              ...currentState.session,
              error: `No se pudo recargar la skill. ${errorMessage(reason)}`,
              failureStatus: "failed",
              reloading: false,
            },
          }
        : currentState)
    }
  }

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    const tabs = [
      { disabled: busy, mode: "preview" as const, ref: previewTabRef },
      { disabled: busy, mode: "code" as const, ref: codeTabRef },
      { disabled: changesDisabled, mode: "changes" as const, ref: changesTabRef },
    ].filter(({ disabled, ref }) => !disabled && ref.current !== null)
    if (tabs.length === 0) return

    const currentIndex = tabs.findIndex(({ ref }) => ref.current === event.currentTarget)
    if (currentIndex < 0) return
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
      ? tabs.length - 1
      : event.key === "ArrowRight"
      ? (currentIndex + 1) % tabs.length
      : (currentIndex - 1 + tabs.length) % tabs.length
    const next = tabs[nextIndex]
    if (next === undefined || next.ref.current === null) return
    event.preventDefault()
    next.ref.current.focus()
    if (next.mode === "changes") void review()
    else updateSession((current) => ({ ...current, mode: next.mode }))
  }

  const operationAnnouncement = session.applying === true
    ? "Actualizando la skill. La escritura atómica no se puede cancelar."
    : session.reloading === true
    ? "Recargando la observación desde disco."
    : session.planning === true
    ? "Preparando una revisión segura de los cambios."
    : undefined
  const localStatus = operationAnnouncement ?? (dirty
    ? "Cambios locales · todavía no se han escrito en disco"
    : "Edición local · se revisará un diff antes de escribir")

  return createElement(
    "section",
    {
      "aria-busy": busy,
      "aria-labelledby": "skill-workspace-title",
      className: `skill-workspace skill-workspace--ready skill-workspace--${session.mode}`,
      onKeyDownCapture: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key !== "Escape" || busy || discardDialogOpen || reloadDialogOpen) return
        event.preventDefault()
        event.stopPropagation()
        if (session.mode === "changes") {
          returnToCode()
          return
        }
        requestExit(document.activeElement instanceof HTMLElement ? document.activeElement : null)
      },
    },
    createElement(
      "header",
      { className: "workspace-bar" },
      createElement(QuietAction, {
        "aria-label": "Volver al inventario",
        className: "workspace-back",
        disabled: props.onBack === undefined || busy,
        onClick: (event: ReactMouseEvent<HTMLButtonElement>) => requestExit(event.currentTarget),
      }, createElement("span", { "aria-hidden": "true" }, "←")),
      createElement(
        "div",
        { className: "workspace-identity" },
        createElement(SkillTile, {
          adapterId: detail.installation.adapterId,
          className: "workspace-identity__tile",
          skillKey: detail.installation.key,
        }),
        createElement(
          "div",
          { className: "workspace-identity__copy" },
          createElement("h1", { id: "skill-workspace-title", ref: workspaceTitleRef, tabIndex: -1 }, name),
          createElement(
            "p",
            null,
            `${adapterLabel(detail.installation.adapterId)} · ${scopeLabel(detail.installation.scope)}`,
          ),
        ),
      ),
      createElement(StatusPill, {
        ariaLabel: `Actualización observada: ${updateLabels[update]}`,
        className: "workspace-update-status",
        tone: updateTone(update),
      }, updateLabels[update]),
      createElement(QuietAction, {
        className: "workspace-discard",
        disabled: !dirty || busy,
        onClick: discardChanges,
      }, "Descartar"),
      createElement("button", {
        className: "workspace-review",
        disabled: !dirty || busy,
        onClick: () => { void review() },
        ref: reviewButtonRef,
        type: "button",
      }, session.planning === true ? "Preparando…" : "Revisar cambios"),
    ),
    createElement(
      "nav",
      { "aria-label": "Vista de la skill", className: "workspace-tabs" },
      createElement(
        "div",
        { "aria-orientation": "horizontal", role: "tablist" },
        createElement("button", {
          "aria-controls": "skill-workspace-preview-panel",
          "aria-selected": session.mode === "preview",
          disabled: busy,
          id: "skill-workspace-preview-tab",
          onKeyDown: handleTabKeyDown,
          onClick: () => updateSession((current) => ({ ...current, mode: "preview" })),
          ref: previewTabRef,
          role: "tab",
          tabIndex: session.mode === "preview" ? 0 : -1,
          type: "button",
        }, "Vista previa"),
        createElement("button", {
          "aria-controls": "skill-workspace-code-panel",
          "aria-selected": session.mode === "code",
          disabled: busy,
          id: "skill-workspace-code-tab",
          onKeyDown: handleTabKeyDown,
          onClick: () => updateSession((current) => ({ ...current, mode: "code" })),
          ref: codeTabRef,
          role: "tab",
          tabIndex: session.mode === "code" ? 0 : -1,
          type: "button",
        }, "Código"),
        createElement(
          "button",
          {
            "aria-controls": "skill-workspace-changes-panel",
            "aria-selected": session.mode === "changes",
            disabled: changesDisabled,
            id: "skill-workspace-changes-tab",
            onKeyDown: handleTabKeyDown,
            onClick: () => { void review() },
            ref: changesTabRef,
            role: "tab",
            tabIndex: session.mode === "changes" ? 0 : -1,
            type: "button",
          },
          "Cambios ",
          createElement("span", { className: "workspace-tabs__count" }, changeCount),
        ),
      ),
    ),
    createElement(
      "div",
      { className: "workspace-body" },
      createElement(
        "main",
        { className: "workspace-editor" },
        createElement(
          "section",
          {
            "aria-labelledby": "skill-workspace-preview-tab",
            className: "skill-preview",
            hidden: session.mode !== "preview",
            id: "skill-workspace-preview-panel",
            role: "tabpanel",
            tabIndex: 0,
          },
          createElement(
            "header",
            { className: "skill-preview__header" },
            createElement("p", { className: "section-label" }, "Skill instalada"),
            createElement("h2", null, name),
            createElement(
              "p",
              null,
              detail.installation.description.state === "known"
                ? detail.installation.description.value
                : "Descripción no observada",
            ),
          ),
          createElement("article", { className: "skill-preview__content", ref: previewScrollerRef },
            session.mode === "preview"
              ? createElement(SafeMarkdown, { headingOffset: 1, source: session.draft })
              : null),
        ),
        createElement(
          "section",
          {
            "aria-labelledby": "skill-workspace-code-tab",
            className: "code-workbench",
            hidden: session.mode !== "code",
            id: "skill-workspace-code-panel",
            role: "tabpanel",
            tabIndex: 0,
          },
          createElement(
            "header",
            { className: "workspace-editor__meta" },
            createElement(
              "div",
              null,
              createElement("p", { className: "section-label" }, "Archivo"),
              createElement("strong", null, detail.entryFile),
            ),
            createElement(
              "span",
              { className: `workspace-change-state workspace-change-state--${dirty ? "dirty" : "clean"}` },
              dirty ? "Cambios sin guardar" : "Sin cambios",
            ),
          ),
          createElement(
            "div",
            {
              "aria-disabled": busy,
              className: "workspace-editor__field",
              inert: busy,
            },
            createElement(CodeEditor, {
              ariaLabel: "Contenido de SKILL.md",
              busy,
              dirty,
              onChange: (draft: string) => {
                if (!busy) {
                  updateSession((current) => ({
                    ...current,
                    draft,
                    error: undefined,
                    failureStatus: undefined,
                    plan: undefined,
                    plannedDraft: undefined,
                  }))
                }
              },
              onReview: () => { void review() },
              value: session.draft,
            }),
          ),
        ),
        createElement(
          "section",
          {
            "aria-labelledby": "skill-workspace-changes-tab",
            className: "diff-workbench",
            hidden: session.mode !== "changes",
            id: "skill-workspace-changes-panel",
            role: "tabpanel",
            tabIndex: 0,
          },
          createElement(
            "div",
            {
              "aria-describedby": "skill-workspace-confirm-description",
              "aria-labelledby": "skill-workspace-confirm-title",
              className: "workspace-confirmation",
              role: "dialog",
              tabIndex: -1,
            },
            createElement(
              "header",
              { className: "diff-workbench__header" },
              createElement(
                "div",
                null,
                createElement("p", { className: "section-label" }, "Revisión antes de guardar"),
                createElement("h2", { id: "skill-workspace-confirm-title" }, "Confirmar actualización"),
              ),
              createElement(
                "p",
                { id: "skill-workspace-confirm-description" },
                `${diff.added} añadidas · ${diff.removed} eliminadas`,
              ),
            ),
            createElement(
              "div",
              { className: "workspace-confirmation__body" },
              createElement(
                "div",
                { className: "inline-diff", ref: diffScrollerRef },
                session.mode === "changes"
                  ? createElement(TextDiff, { after: session.draft, before: session.baseContent })
                  : null,
              ),
              createElement(
                "aside",
                {
                  "aria-label": "Detalles de la actualización",
                  className: "workspace-plan",
                  ref: planScrollerRef,
                },
                createElement("p", { className: "inspector-path" }, path),
                createElement(
                  "details",
                  {
                    className: "workspace-plan__disclosure",
                    onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
                      if (!wideWorkspace) setPlanDisclosureOpen(event.currentTarget.open)
                    },
                    open: wideWorkspace || planDisclosureOpen,
                  },
                  createElement(
                    "summary",
                    { className: "workspace-disclosure-summary" },
                    createElement("span", null, "Detalles de la actualización"),
                    createElement("span", { "aria-hidden": "true", className: "workspace-disclosure-summary__marker" }),
                  ),
                  createElement(
                    "div",
                    { className: "workspace-plan__disclosure-body" },
                    session.plan === undefined
                      ? null
                      : createElement(
                          "div",
                          null,
                          createElement(OperationPlanDetails, { plan: session.plan }),
                          createElement(
                            "dl",
                            { className: "operation-facts workspace-plan__expiry" },
                            createElement(
                              "div",
                              null,
                              createElement("dt", null, "Caducidad"),
                              createElement("dd", null, new Date(session.plan.expiresAt).toLocaleString(getActiveLocale() === "es" ? "es-ES" : "en-US")),
                            ),
                          ),
                        ),
                    visiblePlanError === undefined
                      ? null
                      : createElement("p", { className: "form-error", role: "alert" }, visiblePlanError),
                  ),
                ),
              ),
            ),
            createElement(
              "footer",
              { className: "diff-actions" },
              createElement("p", null, "El archivo original permanece intacto hasta confirmar."),
              createElement(QuietAction, {
                disabled: busy,
                onClick: returnToCode,
              }, "Volver a editar"),
              !planAvailable && dirty
                ? createElement(QuietAction, {
                    disabled: busy,
                    onClick: () => { void review() },
                  }, "Reintentar planificación")
                : null,
              session.failureStatus === undefined
                ? null
                : createElement(QuietAction, {
                    disabled: busy,
                    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => requestReload(event.currentTarget),
                  }, "Recargar desde disco"),
              createElement("button", {
                className: "workspace-apply",
                disabled: !confirmable,
                onClick: () => { void confirm() },
                ref: applyButtonRef,
                type: "button",
              }, session.applying === true ? "Actualizando…" : "Actualizar skill"),
            ),
          ),
        ),
        session.error === undefined || session.mode === "changes"
          ? null
          : createElement(
              "div",
              { className: "workspace-error" },
              createElement("p", { className: "form-error", role: "alert" }, session.error),
              session.failureStatus === undefined
                ? null
                : createElement(QuietAction, {
                    disabled: busy,
                    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => requestReload(event.currentTarget),
                  }, "Recargar desde disco"),
            ),
      ),
      createElement(
        "aside",
        { "aria-labelledby": "skill-workspace-context-title", className: "workspace-context" },
        createElement("h2", { className: "section-label", id: "skill-workspace-context-title" }, "Contexto observado"),
        createElement(
          "details",
          {
            className: "workspace-context__disclosure",
            onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
              if (!wideWorkspace) setContextDisclosureOpen(event.currentTarget.open)
            },
            open: wideWorkspace || contextDisclosureOpen,
          },
          createElement(
            "summary",
            { className: "workspace-disclosure-summary" },
            createElement("span", null, "Contexto observado"),
            createElement("span", { "aria-hidden": "true", className: "workspace-disclosure-summary__marker" }),
          ),
          createElement(
            "div",
            { className: "workspace-context__disclosure-body" },
            createElement(
              "dl",
              { className: "workspace-context__facts" },
              createElement("div", null, createElement("dt", null, "Skill"), createElement("dd", null, name)),
              createElement("div", null, createElement("dt", null, "Ubicación"), createElement("dd", null, path)),
              createElement("div", null, createElement("dt", null, "Gestión"), createElement("dd", null, managerLabels[detail.provenance.managedBy])),
              createElement("div", null, createElement("dt", null, "Snapshot"), createElement("dd", null, session.baseSnapshotId)),
            ),
            createElement(
              "p",
              { className: "workspace-context__safety" },
              "Skillglass prepara un diff exacto antes de escribir y conserva una operación reversible cuando el backend lo acredita.",
            ),
          ),
        ),
      ),
    ),
    createElement(
      "footer",
      { className: "workspace-footer" },
      createElement(
        "p",
        {
          "aria-atomic": operationAnnouncement === undefined ? "true" : undefined,
          "aria-hidden": operationAnnouncement === undefined ? undefined : "true",
          "aria-live": operationAnnouncement === undefined ? "polite" : undefined,
          role: operationAnnouncement === undefined && dirty ? "status" : undefined,
        },
        localStatus,
      ),
      operationAnnouncement === undefined
        ? null
        : createElement(
            "span",
            { "aria-atomic": "true", "aria-live": "polite", className: "visually-hidden" },
            operationAnnouncement,
          ),
      createElement("kbd", null, "⌘ ↵"),
      createElement("span", null, "Revisar cambios"),
    ),
    discardDialogOpen
      ? createElement(
          AccessibleDialog,
          {
            describedBy: "discard-workspace-description",
            labelledBy: "discard-workspace-title",
            onDismiss: () => setDiscardDialogOpen(false),
            returnFocus: exitTriggerRef,
          },
          createElement("h2", { id: "discard-workspace-title" }, "Descartar cambios sin guardar"),
          createElement(
            "p",
            { id: "discard-workspace-description" },
            "Los cambios locales de esta sesión se perderán. El archivo instalado no se modificará.",
          ),
          createElement(
            "div",
            { className: "inspector-actions" },
            createElement(QuietAction, {
              disabled: busy,
              onClick: () => setDiscardDialogOpen(false),
            }, "Seguir editando"),
            createElement(DangerAction, {
              disabled: busy,
              onClick: confirmDiscard,
            }, "Descartar y salir"),
          ),
        )
      : null,
    reloadDialogOpen
      ? createElement(
          AccessibleDialog,
          {
            describedBy: "reload-workspace-description",
            labelledBy: "reload-workspace-title",
            onDismiss: () => setReloadDialogOpen(false),
            returnFocus: reloadTriggerRef,
          },
          createElement("h2", { id: "reload-workspace-title" }, "Recargar desde disco"),
          createElement(
            "p",
            { id: "reload-workspace-description" },
            "Se descartará el draft local y se volverá a leer la versión instalada. Esta acción no combina cambios.",
          ),
          createElement(
            "div",
            { className: "inspector-actions" },
            createElement(QuietAction, {
              onClick: () => setReloadDialogOpen(false),
            }, "Cancelar"),
            createElement(DangerAction, {
              onClick: () => { void reloadFromDisk() },
            }, "Descartar y recargar"),
          ),
        )
      : null,
  )
}
