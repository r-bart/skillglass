import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import type {
  ForgeBridge,
  InventoryPageDto,
  InventoryQuery,
  LocalSourceSelectionDto,
  MonitoringStateDto,
  OnboardingStateDto,
  OperationProgressEvent,
  OperationPlanDto,
  ScanFindingDto,
} from "@forge/contracts"

import { AccessibleDialog } from "./AccessibleDialog.js"
import { CreateSkillWorkspace } from "./CreateSkillWorkspace.js"
import {
  AppSidebar,
  AppTopbar,
  PrimaryNavigation,
  type Surface,
} from "./AppChrome.js"
import { Inspector, Inventory } from "./inventory/index.js"
import { createElement, formatCount, loadSavedLocale, saveLocale, setActiveLocale, verbatim, type Locale } from "./i18n.js"
import { MonitoringManagerDialog, OnboardingFlow, SourceApprovalStep } from "./onboarding/index.js"
import { OperationPlanDetails } from "./OperationPlanDetails.js"
import { Pending } from "./Pending.js"
import { SkillWorkspace } from "./SkillWorkspace.js"
import { useWorkspaceCloseGuard, type ReportedWorkspaceCloseState } from "./useWorkspaceCloseGuard.js"
import {
  MetalAction,
  QuietAction,
  StatusPill,
} from "./VisualPrimitives.js"

export type SkillWorkspaceRoute =
  | Readonly<{
      kind: "edit"
      installationId: string
      initialMode: "preview" | "code"
      returnFocus: HTMLElement
    }>
  | Readonly<{
      kind: "create"
      returnFocus: HTMLElement
    }>

function canRestoreFocus(element: HTMLElement): boolean {
  if (!element.isConnected) return false
  if (element instanceof HTMLButtonElement && element.disabled) return false
  if (element.closest("[hidden], [inert], [aria-hidden='true']") !== null) return false
  let current: HTMLElement | null = element
  while (current !== null) {
    const style = window.getComputedStyle(current)
    if (style.display === "none" || style.visibility === "hidden") return false
    current = current.parentElement
  }
  return true
}

function historyKindLabel(kind: "create-skill" | "install-local" | "update-entry-content" | "update-from-local"): string {
  switch (kind) {
    case "create-skill": return "Creación"
    case "install-local": return "Instalación local"
    case "update-entry-content": return "Actualización de contenido"
    case "update-from-local": return "Actualización de origen"
  }
}

function historyUndoLabel(kind: "create-skill" | "install-local" | "update-entry-content" | "update-from-local"): string {
  switch (kind) {
    case "create-skill": return "Deshacer creación"
    case "install-local": return "Deshacer instalación"
    case "update-entry-content": return "Deshacer actualización"
    case "update-from-local": return "Deshacer actualización de origen"
  }
}

function PageContent({ activeSurface, onboarding, inventory, pending }: { activeSurface: Surface; onboarding: ReactNode; inventory: ReactNode; pending: ReactNode }): ReactNode {
  if (activeSurface === "onboarding") return onboarding
  return activeSurface === "pending" ? pending : inventory
}

function scanFindingText(finding: ScanFindingDto, locale: Locale): ReactNode {
  const messages: Record<string, readonly [es: string, en: string]> = {
    SYMLINK_OUTSIDE_APPROVED_ROOT: [
      "Este enlace sale de una carpeta aprobada. Añade la carpeta de destino si quieres incluirla.",
      "This link points outside an approved folder. Add the target folder if you want to include it.",
    ],
    SYMLINK_TARGET_INACCESSIBLE: [
      "No se ha podido leer el destino de este enlace.",
      "This link target could not be read.",
    ],
    ROOT_MISSING: [
      "Una carpeta autorizada ya no existe.",
      "An approved folder no longer exists.",
    ],
    ROOT_DENIED: [
      "Skillglass ya no tiene acceso a una carpeta autorizada.",
      "Skillglass can no longer access an approved folder.",
    ],
    ADAPTER_NOT_FOUND: [
      "No se ha encontrado el lector compatible con esta carpeta.",
      "The compatible reader for this folder is unavailable.",
    ],
    ROOT_SCAN_FAILED: [
      "No se ha podido revisar una carpeta autorizada.",
      "An approved folder could not be scanned.",
    ],
    INSTALLATION_SCAN_FAILED: [
      "No se ha podido leer una skill de una carpeta autorizada.",
      "A skill in an approved folder could not be read.",
    ],
    WATCHER_ERROR: [
      "No se pudo observar una carpeta.",
      "A folder could not be watched.",
    ],
  }
  const message = messages[finding.code]
  return message === undefined ? verbatim(finding.message) : message[locale === "es" ? 0 : 1]
}

function ScanNotice({ findings, locale }: { findings: readonly ScanFindingDto[]; locale: Locale }) {
  const summary = locale === "es"
    ? findings.length === 1 ? "Se ha omitido una ubicación durante el escaneo." : `Se han omitido ${findings.length} ubicaciones durante el escaneo.`
    : findings.length === 1 ? "One location was skipped during the scan." : `${findings.length} locations were skipped during the scan.`
  return createElement(
    "div",
    { className: "form-error scan-notice", role: "alert" },
    createElement("p", null, summary),
    createElement(
          "details",
          null,
          createElement("summary", null, locale === "es" ? "Ver detalles" : "View details"),
          createElement(
            "ul",
            null,
            ...findings.map((finding, index) => createElement(
              "li",
              { key: `${finding.code}:${finding.path ?? index}` },
              createElement("span", null, scanFindingText(finding, locale)),
              finding.path === undefined ? null : createElement("code", null, verbatim(finding.path)),
              finding.targetPath === undefined ? null : createElement("code", null, " → ", verbatim(finding.targetPath)),
            )),
          ),
        ),
  )
}

export function App({
  onboardingBridge: suppliedOnboardingBridge,
  inventoryBridge: suppliedInventoryBridge,
  monitoringBridge: suppliedMonitoringBridge,
  eventBridge: suppliedEventBridge,
  lifecycleBridge: suppliedLifecycleBridge,
  operationBridge: suppliedOperationBridge,
}: {
  onboardingBridge?: ForgeBridge["onboarding"]
  inventoryBridge?: ForgeBridge["inventory"]
  monitoringBridge?: ForgeBridge["monitoring"]
  eventBridge?: ForgeBridge["events"]
  lifecycleBridge?: ForgeBridge["lifecycle"]
  operationBridge?: ForgeBridge["operations"]
}) {
  const onboardingBridge = suppliedOnboardingBridge ?? window.forge.onboarding
  const inventoryBridge = suppliedInventoryBridge ?? window.forge.inventory
  const monitoringBridge = suppliedMonitoringBridge ?? window.forge.monitoring
  const eventBridge = suppliedEventBridge ?? window.forge.events
  const lifecycleBridge = suppliedLifecycleBridge ?? (typeof window.forge === "undefined" ? undefined : window.forge.lifecycle)
  const operationBridge = suppliedOperationBridge ?? window.forge.operations
  const [locale, setLocale] = useState<Locale>(loadSavedLocale)
  setActiveLocale(locale)
  const mainContentRef = useRef<HTMLElement>(null)
  const workspaceReturnFocusRef = useRef<HTMLElement | undefined>(undefined)
  const [activeSurface, setActiveSurface] = useState<Surface>("onboarding")
  const [scrollResetRevision, setScrollResetRevision] = useState(0)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [onboardingState, setOnboardingState] = useState<OnboardingStateDto | null>(null)
  const [monitoringState, setMonitoringState] = useState<MonitoringStateDto | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanNotice, setScanNotice] = useState<readonly ScanFindingDto[]>()
  const [inventoryRevision, setInventoryRevision] = useState(0)
  const [focusInventoryTitle, setFocusInventoryTitle] = useState(false)
  const [inventoryProjects, setInventoryProjects] = useState<NonNullable<InventoryPageDto["projects"]>>([])
  const [inventoryScope, setInventoryScope] = useState<InventoryQuery["scope"]>({ kind: "all" })
  const [monitoringManagerTrigger, setMonitoringManagerTrigger] = useState<HTMLElement>()
  const [selectedInstallationId, setSelectedInstallationId] = useState<string>()
  const [skillWorkspaceRoute, setSkillWorkspaceRoute] = useState<SkillWorkspaceRoute>()
  const [operationStatus, setOperationStatus] = useState<string>()
  const [operationProgress, setOperationProgress] = useState<OperationProgressEvent>()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<Awaited<ReturnType<ForgeBridge["operations"]["history"]>>>()
  const [historyError, setHistoryError] = useState<string>()
  const [operationError, setOperationError] = useState<string>()
  const [operationBusy, setOperationBusy] = useState(false)
  const [installPlan, setInstallPlan] = useState<OperationPlanDto>()
  const [pendingInstallSource, setPendingInstallSource] = useState<LocalSourceSelectionDto>()
  const [pendingInstallTargetId, setPendingInstallTargetId] = useState<string>()
  const [workspaceCloseState, setWorkspaceCloseState] = useState<ReportedWorkspaceCloseState>({ state: "clean", revision: 0 })

  useWorkspaceCloseGuard(lifecycleBridge, workspaceCloseState, locale)

  const reportWorkspaceCloseState = useCallback((state: ReportedWorkspaceCloseState["state"]): void => {
    setWorkspaceCloseState((current) => ({ state, revision: current.revision + 1 }))
  }, [])

  const writableInstallTargets = onboardingState?.approvedRoots.filter((root) => root.access === "read-write") ?? []
  const monitoredInstallationIds = useMemo<ReadonlySet<string> | undefined>(
    () => monitoringState?.status === "complete"
      ? new Set(monitoringState.selectedInstallationIds)
      : undefined,
    [monitoringState],
  )
  const monitoringManagerBridge = useMemo(
    () => ({ inventory: inventoryBridge, monitoring: monitoringBridge }),
    [inventoryBridge, monitoringBridge],
  )
  const monitoringRootDisplayPaths = useMemo(
    () => new Map(onboardingState?.approvedRoots.map((root) => [root.rootId, root.displayPath]) ?? []),
    [onboardingState],
  )

  useEffect(() => {
    saveLocale(locale)
  }, [locale])

  const sourceClaim = (selection: LocalSourceSelectionDto) => {
    const suggestedName = selection.kind === "zip"
      ? selection.displayName.replace(/\.zip$/iu, "")
      : selection.displayName
    return selection.kind === "directory"
      ? {
          kind: "directory" as const,
          selectionToken: selection.selectionToken,
          suggestedName,
          treeHash: selection.treeHash,
        }
      : {
          kind: "zip" as const,
          selectionToken: selection.selectionToken,
          suggestedName,
          archiveSha256: selection.archiveSha256,
          treeHash: selection.treeHash,
        }
  }

  const installFrom = async (kind: "directory" | "zip"): Promise<void> => {
    setOperationBusy(true)
    setOperationError(undefined)
    try {
      const selection = await operationBridge.selectLocalSource({ kind })
      if (selection === null) return
      if (writableInstallTargets.length === 0) throw new Error("No hay una carpeta aprobada con escritura para instalar")
      const target = writableInstallTargets[0]
      if (target === undefined) throw new Error("No hay una carpeta aprobada con escritura para instalar")
      if (writableInstallTargets.length > 1) {
        setPendingInstallSource(selection)
        setPendingInstallTargetId(target.rootId)
      } else {
        setInstallPlan(await operationBridge.plan({
          kind: "install-local",
          source: sourceClaim(selection),
          targetRootId: target.rootId,
        }))
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo leer la fuente local"
      setOperationError(kind === "zip"
        ? `La fuente ZIP contiene una ruta no segura. ${message}`
        : message)
    } finally {
      setOperationBusy(false)
    }
  }

  const planPendingInstall = async (): Promise<void> => {
    if (pendingInstallSource === undefined || pendingInstallTargetId === undefined) return
    setOperationBusy(true)
    setOperationError(undefined)
    try {
      setInstallPlan(await operationBridge.plan({
        kind: "install-local",
        source: sourceClaim(pendingInstallSource),
        targetRootId: pendingInstallTargetId,
      }))
      setPendingInstallSource(undefined)
      setPendingInstallTargetId(undefined)
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : "No se pudo preparar la instalación")
    } finally {
      setOperationBusy(false)
    }
  }

  const confirmInstall = async (): Promise<void> => {
    if (installPlan === undefined) return
    setOperationBusy(true)
    setOperationError(undefined)
    try {
      const result = await operationBridge.confirm({ planId: installPlan.planId })
      if (result.status !== "committed") throw new Error(result.message)
      setOperationStatus(result.message)
      setInstallPlan(undefined)
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : "No se pudo instalar la skill")
    } finally {
      setOperationBusy(false)
    }
  }

  const refreshUpdates = async (): Promise<void> => {
    setOperationBusy(true)
    setOperationError(undefined)
    try {
      await operationBridge.refreshUpdates()
      setOperationStatus("Actualizaciones revisadas")
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : "No se pudieron buscar actualizaciones")
    } finally {
      setOperationBusy(false)
    }
  }

  const openHistory = async (): Promise<void> => {
    setHistoryOpen(true)
    setHistoryError(undefined)
    try {
      setHistory(await operationBridge.history())
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "No se pudo cargar el historial")
    }
  }

  const undo = async (journalId: string): Promise<void> => {
    setHistoryError(undefined)
    try {
      const result = await operationBridge.undo({ journalId })
      if (result.status !== "committed") throw new Error(result.message)
      setOperationStatus(result.message)
      setHistory(await operationBridge.history())
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "No se pudo deshacer la actualización")
    }
  }

  useEffect(() => {
    let current = true
    Promise.all([
      onboardingBridge.state(),
      monitoringBridge.state(),
    ]).then(([roots, monitoring]) => {
      if (!current) return
      setOnboardingState(roots)
      setMonitoringState(monitoring)
      setSelected(new Set(roots.selectedCandidateIds))
      setActiveSurface(
        roots.status === "complete" && monitoring.status === "complete"
          ? "inventory"
          : "onboarding",
      )
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : "No se pudo cargar la configuración")
    })
    return () => { current = false }
  }, [monitoringBridge, onboardingBridge])

  useEffect(() => {
    let current = true
    const stopInventory = eventBridge.onInventoryChanged((event) => {
      setInventoryRevision((current) => current + 1)
      void monitoringBridge.state().then((state) => {
        if (current) setMonitoringState(state)
      }).catch((reason: unknown) => {
        if (current) {
          setScanNotice([{
            code: "MONITORING_REFRESH_FAILED",
            severity: "warning",
            message: reason instanceof Error
              ? reason.message
              : "No se pudo actualizar el seguimiento",
          }])
        }
      })
      const findings = event.findings ?? []
      if (findings.length === 0) {
        if (event.reason === "scan" || event.reason === "watcher" || event.reason === "root-approval") setScanNotice(undefined)
        return
      }
      setScanNotice(findings)
    })
    const stopProgress = eventBridge.onOperationProgress((event) => {
      setOperationStatus(event.message)
      setOperationProgress(event)
    })
    const stopCompleted = eventBridge.onOperationCompleted((event) => {
      setOperationStatus(event.message)
      setOperationProgress(undefined)
    })
    return () => {
      current = false
      stopInventory()
      stopProgress()
      stopCompleted()
    }
  }, [eventBridge, monitoringBridge])

  const setupRequired = onboardingState?.status !== "complete"
    || monitoringState?.status !== "complete"
  const workspaceOpen = skillWorkspaceRoute !== undefined
  const inspectorVisible = activeSurface !== "onboarding" && selectedInstallationId !== undefined

  // Task 3.2 will pass `open` to Inspector without changing the route model.
  const workspaceNavigation = {
    open: (route: SkillWorkspaceRoute): void => {
      workspaceReturnFocusRef.current = undefined
      setWorkspaceCloseState((current) => ({ state: "clean", revision: current.revision + 1 }))
      setSkillWorkspaceRoute(route)
      setMobileNavigationOpen(false)
    },
    close: (): void => {
      workspaceReturnFocusRef.current = skillWorkspaceRoute?.returnFocus
      setWorkspaceCloseState((current) => ({ state: "clean", revision: current.revision + 1 }))
      setSkillWorkspaceRoute(undefined)
    },
  }

  useEffect(() => {
    if (workspaceOpen) return
    const returnFocus = workspaceReturnFocusRef.current
    workspaceReturnFocusRef.current = undefined
    if (returnFocus !== undefined && canRestoreFocus(returnFocus)) {
      returnFocus.focus()
      return
    }
    const fallbackSelector = returnFocus?.classList.contains("create-skill-button")
      ? ".create-skill-button"
      : undefined
    if (fallbackSelector !== undefined) {
      const fallback = document.querySelector<HTMLElement>(fallbackSelector)
      if (fallback !== null && canRestoreFocus(fallback)) fallback.focus()
    }
  }, [workspaceOpen])

  useEffect(() => {
    const main = mainContentRef.current
    if (main === null) return
    main.scrollTop = 0
    main.scrollLeft = 0
    for (const panel of main.querySelectorAll<HTMLElement>("[data-scroll-panel], .inventory-table-wrap")) {
      panel.scrollTop = 0
      panel.scrollLeft = 0
    }
  }, [activeSurface, scrollResetRevision])

  useEffect(() => {
    if (!focusInventoryTitle || setupRequired || activeSurface !== "inventory") return
    const title = document.getElementById("inventory-title")
    if (!(title instanceof HTMLElement)) return
    title.tabIndex = -1
    title.focus({ preventScroll: true })
    setFocusInventoryTitle(false)
  }, [activeSurface, focusInventoryTitle, inventoryRevision, setupRequired])

  const navigate = (surface: Surface) => {
    if (surface !== "onboarding" && setupRequired) return
    setActiveSurface(surface)
    setScrollResetRevision((current) => current + 1)
    setMobileNavigationOpen(false)
  }

  const navigateToInventoryScope = (scope: InventoryQuery["scope"]): void => {
    if (setupRequired) return
    setInventoryScope(scope)
    navigate("inventory")
  }

  const addRoot = async () => {
    setBusy(true)
    setError(null)
    try {
      const root = await onboardingBridge.selectAdditionalRoot({ adapterId: "folder" })
      if (root !== null) {
        setOnboardingState((state) => state === null || state.proposedRoots.some(({ candidateId }) => candidateId === root.candidateId)
          ? state
          : { ...state, proposedRoots: [...state.proposedRoots, root], selectedCandidateIds: [...state.selectedCandidateIds, root.candidateId] })
        setSelected((current) => new Set([...current, root.candidateId]))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo añadir la carpeta")
    } finally {
      setBusy(false)
    }
  }

  const addProject = async () => {
    setBusy(true)
    setError(null)
    try {
      const state = await onboardingBridge.selectProject()
      setOnboardingState(state)
      setSelected(new Set(state.selectedCandidateIds))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo añadir el proyecto")
    } finally {
      setBusy(false)
    }
  }

  const approve = async (): Promise<OnboardingStateDto> => {
    setBusy(true)
    setError(null)
    try {
      const approvedRoots = await onboardingBridge.approveRoots({ candidateIds: [...selected] })
      if (onboardingState === null) throw new Error("No se pudo cargar la configuración")
      const nextState: OnboardingStateDto = {
        ...onboardingState,
        status: "complete",
        selectedCandidateIds: [...selected],
        approvedRoots,
      }
      setOnboardingState(nextState)
      setInventoryRevision((current) => current + 1)
      return nextState
    } catch (reason) {
      const nextError = reason instanceof Error ? reason.message : "No se pudo guardar la aprobación"
      setError(nextError)
      throw reason instanceof Error ? reason : new Error(nextError)
    } finally {
      setBusy(false)
    }
  }

  const toggleRoot = (candidateId: string): void => setSelected((current) => {
    const next = new Set(current)
    if (next.has(candidateId)) next.delete(candidateId)
    else next.add(candidateId)
    return next
  })

  const completeSetup = (state: MonitoringStateDto): void => {
    setMonitoringState(state)
    setInventoryScope({ kind: "all" })
    setActiveSurface("inventory")
    setInventoryRevision((current) => current + 1)
    setScrollResetRevision((current) => current + 1)
    setOperationStatus("Tu inventario está listo")
    setFocusInventoryTitle(true)
  }

  if (setupRequired) {
    return createElement(
      "div",
      { className: "app-shell app-shell--onboarding" },
      createElement("a", { className: "skip-link", href: "#main-content" }, "Saltar al contenido"),
      createElement(OnboardingFlow, {
        inventoryBridge,
        monitoring: monitoringState,
        onAddFolder: () => { void addRoot() },
        onAddProject: () => { void addProject() },
        onApproveRoots: approve,
        onComplete: completeSetup,
        onSaveMonitoring: (installationIds) => monitoringBridge.save({ installationIds: [...installationIds] }),
        onToggleRoot: toggleRoot,
        roots: onboardingState,
        selectedCandidateIds: selected,
        sourceBusy: busy,
        sourceError: error,
      }),
    )
  }

  const onboarding = createElement(SourceApprovalStep, {
    busy,
    error,
    mode: "management",
    onAddFolder: () => { void addRoot() },
    onAddProject: () => { void addProject() },
    onApprove: () => {
      void approve().then(() => {
        setOperationStatus("Carpetas actualizadas")
      }).catch(() => undefined)
    },
    onToggle: toggleRoot,
    selectedCandidateIds: selected,
    state: onboardingState,
  })
  const inventory = createElement(Inventory, {
    active: !workspaceOpen,
    externalNavigation: true,
    inventoryBridge,
    eventBridge,
    ...(monitoredInstallationIds === undefined ? {} : { monitoredInstallationIds }),
    onManageMonitoring: setMonitoringManagerTrigger,
    onProjectsChange: setInventoryProjects,
    onSelectionChange: setSelectedInstallationId,
    scope: inventoryScope,
  })
  const pending = createElement(Pending, {
    inventoryBridge,
    operationBridge,
    eventBridge,
    ...(monitoredInstallationIds === undefined ? {} : { monitoredInstallationIds }),
    onSelectInstallation: (installationId: string) => {
      setSelectedInstallationId(installationId)
      setOperationStatus("Pendiente abierto en el inspector")
    },
    onStatus: setOperationStatus,
  })

  return createElement(
    "div",
    { className: workspaceOpen ? "app-shell app-shell--workspace" : "app-shell" },
    createElement("a", { className: "skip-link", href: "#main-content" }, "Saltar al contenido"),
    createElement(AppTopbar, {
      activeSurface,
      locale,
      mobileNavigationOpen,
      ...(workspaceOpen ? {
        contextLabel: skillWorkspaceRoute?.kind === "create" ? "Crear skill" : "Editar skill",
        navigationVisible: false,
      } : {}),
      onboardingRequired: setupRequired,
      onNavigate: navigate,
      onCreateSkill: (trigger) => workspaceNavigation.open({ kind: "create", returnFocus: trigger }),
      onToggleMobileNavigation: () => setMobileNavigationOpen((isOpen) => !isOpen),
      onOpenHistory: () => { void openHistory() },
      operationsVisible: !workspaceOpen && activeSurface !== "onboarding" && !setupRequired,
      operationBusy,
      onInstallDirectory: () => { void installFrom("directory") },
      onInstallZip: () => { void installFrom("zip") },
      onLocaleChange: setLocale,
      onRefreshUpdates: () => { void refreshUpdates() },
    }),
    operationError === undefined
      ? null
      : createElement("p", { className: "operation-error", role: "alert" }, verbatim(operationError)),
    operationStatus === undefined
      ? null
      : createElement(
          "div",
          { className: "operation-status", role: "status", "aria-live": "polite" },
          createElement("strong", null, operationProgress === undefined ? "Operación" : `Etapa: ${operationProgress.stage}`),
          createElement("span", null, verbatim(operationStatus)),
          operationProgress === undefined
            ? null
            : createElement("small", null, operationProgress.stage === "rolling-back"
              ? "Recuperación en curso; la operación no se puede cancelar."
              : "La escritura ya ha empezado y no se puede cancelar. Si se interrumpe, Skillglass la recuperará al volver a abrir."),
        ),
    historyOpen
      ? createElement(
          AccessibleDialog,
          {
            className: "history-sheet",
            describedBy: "history-dialog-description",
            labelledBy: "history-dialog-title",
            onDismiss: () => setHistoryOpen(false),
          },
            createElement(
              "header",
              { className: "sheet-header history-sheet__header" },
              createElement("h2", { id: "history-dialog-title" }, "Historial"),
              createElement(
                "p",
                { id: "history-dialog-description" },
                "Cambios realizados en este dispositivo y acciones de Deshacer que siguen disponibles.",
              ),
            ),
            createElement(
              "div",
              { className: "history-sheet__body" },
              historyError === undefined ? null : createElement("p", { role: "alert", className: "form-error" }, verbatim(historyError)),
              history === undefined
                ? createElement("p", { className: "sheet-state", role: "status" }, "Cargando historial…")
                : history.items.length === 0
                  ? createElement("p", { className: "sheet-state" }, "No hay operaciones registradas.")
                  : createElement(
                      "ul",
                      { className: "history-list" },
                      ...history.items.map((item) => createElement(
                        "li",
                        { key: item.journalId },
                        createElement("span", { "aria-hidden": "true", className: "history-entry__marker" }, "↶"),
                        createElement(
                          "span",
                          { className: "history-entry__content" },
                          createElement("strong", null, historyKindLabel(item.kind)),
                          createElement(
                            "small",
                            null,
                            new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt)),
                          ),
                          createElement(
                            "details",
                            { className: "history-entry__technical" },
                            createElement("summary", null, "Detalles técnicos"),
                            createElement("code", null, verbatim(item.journalId)),
                          ),
                        ),
                        createElement(
                          StatusPill,
                          { tone: item.undoAvailable ? "ok" : "idle" },
                          item.undoAvailable ? "Reversible" : "Solo registro",
                        ),
                        item.undoAvailable
                          ? createElement(QuietAction, {
                              className: "history-entry__action",
                              onClick: () => { void undo(item.journalId) },
                            }, historyUndoLabel(item.kind))
                          : null,
                      )),
                    ),
            ),
            createElement(
              "footer",
              { className: "sheet-footer history-sheet__footer" },
              createElement(
                "p",
                null,
                history === undefined
                  ? "Consultando el historial local…"
                  : formatCount(history.items.length, "operation"),
              ),
              createElement(MetalAction, { onClick: () => setHistoryOpen(false) }, "Cerrar"),
            ),
        )
      : null,
    monitoringManagerTrigger === undefined
      ? null
      : createElement(MonitoringManagerDialog, {
          bridge: monitoringManagerBridge,
          onDismiss: () => setMonitoringManagerTrigger(undefined),
          onSaved: (state) => {
            setMonitoringState(state)
            setMonitoringManagerTrigger(undefined)
            setOperationStatus("Seguimiento actualizado")
          },
          projects: inventoryProjects,
          returnFocus: monitoringManagerTrigger,
          rootDisplayPaths: monitoringRootDisplayPaths,
        }),
    pendingInstallSource === undefined
      ? null
      : createElement(
          AccessibleDialog,
          { labelledBy: "install-target-dialog-title", onDismiss: () => setPendingInstallSource(undefined) },
            createElement("h2", { id: "install-target-dialog-title" }, "Elegir destino de instalación"),
            createElement("label", { htmlFor: "install-target" }, "Carpeta aprobada"),
            createElement(
              "select",
              {
                id: "install-target",
                value: pendingInstallTargetId,
                disabled: operationBusy,
                onChange: (event) => setPendingInstallTargetId((event.currentTarget as HTMLSelectElement).value),
              },
              ...writableInstallTargets.map((root) => createElement(
                "option",
                { key: root.rootId, value: root.rootId },
                verbatim(`${root.displayName} · ${root.displayPath}`),
              )),
            ),
            createElement(
              "div",
              { className: "inspector-actions" },
              createElement("button", { type: "button", className: "primary-action", disabled: operationBusy, onClick: () => { void planPendingInstall() } }, operationBusy ? "Preparando…" : "Continuar"),
              createElement("button", { type: "button", className: "secondary-action", disabled: operationBusy, onClick: () => setPendingInstallSource(undefined) }, "Cancelar"),
            ),
        ),
    installPlan === undefined
      ? null
      : createElement(
          AccessibleDialog,
          {
            labelledBy: "install-dialog-title",
            ...(operationBusy ? {} : { onDismiss: () => setInstallPlan(undefined) }),
          },
            createElement("h2", { id: "install-dialog-title" }, "Confirmar instalación"),
            createElement(OperationPlanDetails, { plan: installPlan }),
            createElement(
              "div",
              { className: "inspector-actions" },
              createElement("button", { type: "button", className: "primary-action", disabled: operationBusy, onClick: () => { void confirmInstall() } }, operationBusy ? "Instalando…" : "Instalar skill"),
              createElement("button", { type: "button", className: "secondary-action", disabled: operationBusy, onClick: () => setInstallPlan(undefined) }, "Cancelar"),
            ),
        ),
    !workspaceOpen && mobileNavigationOpen
      ? createElement(
          "div",
          { className: "mobile-navigation", id: "mobile-navigation" },
          createElement(PrimaryNavigation, {
            activeSurface,
            inventoryProjects,
            inventoryScope,
            onInventoryScopeChange: navigateToInventoryScope,
            onNavigate: navigate,
            onboardingRequired: setupRequired,
          }),
        )
      : null,
    createElement(
      "div",
      {
        className: workspaceOpen
          ? "app-body app-body--workspace"
          : inspectorVisible
            ? "app-body"
            : "app-body app-body--without-inspector",
      },
      createElement(
        "div",
        {
          "aria-hidden": workspaceOpen,
          className: "app-library",
          hidden: workspaceOpen,
          inert: workspaceOpen,
          style: { display: "contents" },
        },
        createElement(AppSidebar, {
          activeSurface,
          inventoryProjects,
          inventoryScope,
          onInventoryScopeChange: navigateToInventoryScope,
          onNavigate: navigate,
          onboardingRequired: setupRequired,
        }),
        createElement(
          "main",
          { className: "main-content", id: workspaceOpen ? undefined : "main-content", ref: mainContentRef, tabIndex: -1 },
          scanNotice === undefined
            ? null
            : createElement(ScanNotice, { findings: scanNotice, locale }),
          createElement(PageContent, { activeSurface, onboarding, inventory, pending }),
        ),
        inspectorVisible
          ? createElement(Inspector, {
              installationId: selectedInstallationId,
              inventoryBridge,
              onEditEntry: (installationId, trigger) => workspaceNavigation.open({
                kind: "edit",
                initialMode: "code",
                installationId,
                returnFocus: trigger,
              }),
              operationBridge,
              onStatus: setOperationStatus,
              revision: inventoryRevision,
            })
          : null,
      ),
      skillWorkspaceRoute === undefined
        ? null
        : createElement(
            "main",
            {
              className: "main-content main-content--workspace",
              id: "main-content",
              tabIndex: -1,
            },
            skillWorkspaceRoute.kind === "create"
              ? createElement(CreateSkillWorkspace, {
                  key: "create-skill",
                  onBack: workspaceNavigation.close,
                  onCreated: (installationId) => {
                    setSelectedInstallationId(installationId)
                    setInventoryRevision((current) => current + 1)
                    setSkillWorkspaceRoute({
                      kind: "edit",
                      installationId,
                      initialMode: "preview",
                      returnFocus: skillWorkspaceRoute.returnFocus,
                    })
                  },
                  onStatus: setOperationStatus,
                  onCloseStateChange: reportWorkspaceCloseState,
                  operationBridge,
                  roots: writableInstallTargets,
                })
              : createElement(SkillWorkspace, {
                  initialMode: skillWorkspaceRoute.initialMode,
                  installationId: skillWorkspaceRoute.installationId,
                  inventoryBridge,
                  key: `${skillWorkspaceRoute.installationId}:${skillWorkspaceRoute.initialMode}`,
                  onBack: workspaceNavigation.close,
                  onCommitted: (detail) => {
                    setSelectedInstallationId(detail.installation.installationId)
                    setInventoryRevision((current) => current + 1)
                  },
                  onStatus: setOperationStatus,
                  onCloseStateChange: reportWorkspaceCloseState,
                  operationBridge,
                }),
          ),
    ),
  )
}
