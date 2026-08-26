import { createElement, useEffect, useRef, useState, type ReactNode } from "react"

import type {
  ForgeBridge,
  LocalSourceSelectionDto,
  OnboardingStateDto,
  OperationProgressEvent,
  OperationPlanDto,
  RootCandidateDto,
} from "@forge/contracts"

import { AccessibleDialog } from "./AccessibleDialog.js"
import {
  AppSidebar,
  AppTopbar,
  PrimaryNavigation,
  type Surface,
} from "./AppChrome.js"
import { Inspector, Inventory } from "./inventory/index.js"
import { OperationPlanDetails } from "./OperationPlanDetails.js"
import { Pending } from "./Pending.js"
import {
  CompactSurfaceHeader,
  MetalAction,
  QuietAction,
  SectionLabel,
  StatusPill,
} from "./VisualPrimitives.js"

const accessLabels: Record<RootCandidateDto["access"], string> = {
  "read-write": "Lectura y escritura",
  "read-only": "Solo lectura",
  missing: "No disponible",
  denied: "Acceso denegado",
}

function historyKindLabel(kind: "install-local" | "update-entry-content" | "update-from-local"): string {
  switch (kind) {
    case "install-local": return "Instalación local"
    case "update-entry-content": return "Actualización de contenido"
    case "update-from-local": return "Actualización de origen"
  }
}

function historyUndoLabel(kind: "install-local" | "update-entry-content" | "update-from-local"): string {
  switch (kind) {
    case "install-local": return "Deshacer instalación"
    case "update-entry-content": return "Deshacer actualización"
    case "update-from-local": return "Deshacer actualización de origen"
  }
}

function Onboarding({
  state,
  selected,
  busy,
  error,
  onToggle,
  onAdd,
  onAddProject,
  onApprove,
}: {
  state: OnboardingStateDto | null
  selected: ReadonlySet<string>
  busy: boolean
  error: string | null
  onToggle: (candidateId: string) => void
  onAdd: () => void
  onAddProject: () => void
  onApprove: () => void
}) {
  return createElement(
    "section",
    { className: "content-surface onboarding-surface", "aria-labelledby": "onboarding-title", "data-scroll-panel": "onboarding" },
    createElement(CompactSurfaceHeader, {
      className: "onboarding-header",
      description: "Revisa las ubicaciones propuestas. Forge no iniciará el primer escaneo hasta guardar tu aprobación.",
      eyebrow: "Primer uso",
      title: "Carpetas de skills",
      titleId: "onboarding-title",
    }),
    state === null
      ? createElement("p", { className: "surface-note", role: "status" }, "Detectando ubicaciones compatibles…")
      : createElement(
          "form",
          { className: "root-form", onSubmit: (event) => { event.preventDefault(); onApprove() } },
          createElement(
            "div",
            { className: "onboarding-card" },
            createElement(
              "fieldset",
              { className: "root-fieldset", disabled: busy },
              createElement(
                "legend",
                null,
                createElement(SectionLabel, { as: "span" }, "Ubicaciones que Forge puede observar"),
              ),
              createElement(
                "div",
                { className: "root-list" },
                ...state.proposedRoots.map((root) => createElement(
                  "label",
                  { className: "root-option glass-selectable-row", key: root.candidateId },
                  createElement("input", {
                    type: "checkbox",
                    checked: selected.has(root.candidateId),
                    onChange: () => onToggle(root.candidateId),
                  }),
                  createElement(
                    "span",
                    { className: "root-copy" },
                    createElement("span", { className: "root-name" }, root.displayName),
                    createElement("span", { className: "root-path" }, root.displayPath),
                    createElement(
                      "span",
                      { className: "root-meta" },
                      createElement(StatusPill, {
                        tone: root.access === "read-write" ? "ok" : root.access === "denied" ? "danger" : "idle",
                      }, accessLabels[root.access]),
                      createElement("span", { className: "root-evidence" }, root.discovery.kind === "unknown" ? "Evidencia desconocida" : `Evidencia ${root.discovery.kind}`),
                    ),
                  ),
                )),
              ),
            ),
            createElement(
              "div",
              { className: "onboarding-card__footer" },
              createElement(
                "div",
                { className: "root-secondary-actions" },
                createElement(QuietAction, { disabled: busy, onClick: onAdd }, "Añadir carpeta…"),
                createElement(QuietAction, { disabled: busy, onClick: onAddProject }, "Añadir proyecto Codex…"),
              ),
              createElement(MetalAction, {
                disabled: busy || selected.size === 0,
                type: "submit",
              }, busy ? "Escaneando…" : state.status === "complete" ? "Guardar cambios" : "Escanear carpetas aprobadas"),
            ),
          ),
          createElement(
            "p",
            { className: "root-safety-note" },
            createElement("span", { "aria-hidden": "true", className: "root-safety-note__icon" }, "✓"),
            createElement("span", null, "La carpeta se elige mediante el diálogo del sistema. Forge nunca solicita privilegios de administrador."),
          ),
        ),
    error === null ? null : createElement("p", { className: "form-error", role: "alert" }, error),
    createElement(
      "p",
      { className: "surface-note", role: "status" },
      state?.status === "complete" ? "La aprobación está guardada en este dispositivo." : "El inventario permanece bloqueado hasta guardar al menos una ubicación.",
    ),
  )
}

function PageContent({ activeSurface, onboarding, inventory, pending }: { activeSurface: Surface; onboarding: ReactNode; inventory: ReactNode; pending: ReactNode }): ReactNode {
  if (activeSurface === "onboarding") return onboarding
  return activeSurface === "pending" ? pending : inventory
}

export function App({
  onboardingBridge: suppliedOnboardingBridge,
  inventoryBridge: suppliedInventoryBridge,
  eventBridge: suppliedEventBridge,
  operationBridge: suppliedOperationBridge,
}: {
  onboardingBridge?: ForgeBridge["onboarding"]
  inventoryBridge?: ForgeBridge["inventory"]
  eventBridge?: ForgeBridge["events"]
  operationBridge?: ForgeBridge["operations"]
}) {
  const onboardingBridge = suppliedOnboardingBridge ?? window.forge.onboarding
  const inventoryBridge = suppliedInventoryBridge ?? window.forge.inventory
  const eventBridge = suppliedEventBridge ?? window.forge.events
  const operationBridge = suppliedOperationBridge ?? window.forge.operations
  const mainContentRef = useRef<HTMLElement>(null)
  const [activeSurface, setActiveSurface] = useState<Surface>("onboarding")
  const [scrollResetRevision, setScrollResetRevision] = useState(0)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [onboardingState, setOnboardingState] = useState<OnboardingStateDto | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanNotice, setScanNotice] = useState<string>()
  const [inventoryRevision, setInventoryRevision] = useState(0)
  const [selectedInstallationId, setSelectedInstallationId] = useState<string>()
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

  const writableInstallTargets = onboardingState?.approvedRoots.filter((root) => root.access === "read-write") ?? []

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
    onboardingBridge.state().then((state) => {
      if (!current) return
      setOnboardingState(state)
      setSelected(new Set(state.selectedCandidateIds))
      setActiveSurface(state.status === "complete" ? "inventory" : "onboarding")
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : "No se pudo cargar la configuración")
    })
    return () => { current = false }
  }, [onboardingBridge])

  useEffect(() => {
    const stopInventory = eventBridge.onInventoryChanged((event) => {
      setInventoryRevision((current) => current + 1)
      const findings = event.findings ?? []
      if (findings.length === 0) {
        if (event.reason === "watcher" || event.reason === "root-approval") setScanNotice(undefined)
        return
      }
      setScanNotice(findings.map(({ message }) => message).join(" · "))
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
      stopInventory()
      stopProgress()
      stopCompleted()
    }
  }, [eventBridge])

  const onboardingRequired = onboardingState?.status !== "complete"

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

  const navigate = (surface: Surface) => {
    if (surface !== "onboarding" && onboardingRequired) return
    setActiveSurface(surface)
    setScrollResetRevision((current) => current + 1)
    setMobileNavigationOpen(false)
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

  const approve = async () => {
    setBusy(true)
    setError(null)
    try {
      const approvedRoots = await onboardingBridge.approveRoots({ candidateIds: [...selected] })
      setOnboardingState((state) => state === null ? state : { ...state, status: "complete", selectedCandidateIds: [...selected], approvedRoots })
      setActiveSurface("inventory")
      setScrollResetRevision((current) => current + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la aprobación")
    } finally {
      setBusy(false)
    }
  }

  const onboarding = createElement(Onboarding, {
    state: onboardingState,
    selected,
    busy,
    error,
    onToggle: (candidateId: string) => setSelected((current) => {
      const next = new Set(current)
      if (next.has(candidateId)) next.delete(candidateId)
      else next.add(candidateId)
      return next
    }),
    onAdd: () => { void addRoot() },
    onAddProject: () => { void addProject() },
    onApprove: () => { void approve() },
  })
  const inventory = createElement(Inventory, {
    inventoryBridge,
    eventBridge,
    onSelectionChange: setSelectedInstallationId,
  })
  const pending = createElement(Pending, {
    inventoryBridge,
    operationBridge,
    eventBridge,
    onSelectInstallation: (installationId: string) => {
      setSelectedInstallationId(installationId)
      setOperationStatus("Pendiente abierto en el inspector")
    },
    onStatus: setOperationStatus,
  })

  return createElement(
    "div",
    { className: "app-shell" },
    createElement("a", { className: "skip-link", href: "#main-content" }, "Saltar al contenido"),
    createElement(AppTopbar, {
      activeSurface,
      mobileNavigationOpen,
      onboardingRequired,
      onNavigate: navigate,
      onToggleMobileNavigation: () => setMobileNavigationOpen((isOpen) => !isOpen),
      onOpenHistory: () => { void openHistory() },
      operationsVisible: activeSurface !== "onboarding" && !onboardingRequired,
      operationBusy,
      onInstallDirectory: () => { void installFrom("directory") },
      onInstallZip: () => { void installFrom("zip") },
      onRefreshUpdates: () => { void refreshUpdates() },
    }),
    operationError === undefined
      ? null
      : createElement("p", { className: "operation-error", role: "alert" }, operationError),
    operationStatus === undefined
      ? null
      : createElement(
          "div",
          { className: "operation-status", role: "status", "aria-live": "polite" },
          createElement("strong", null, operationProgress === undefined ? "Operación" : `Etapa: ${operationProgress.stage}`),
          createElement("span", null, operationStatus),
          operationProgress === undefined
            ? null
            : createElement("small", null, operationProgress.stage === "rolling-back"
              ? "Recuperación en curso; la operación no se puede cancelar."
              : "No cancelable durante la escritura; si se interrumpe, Forge recuperará el journal al reiniciar."),
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
                "Registro persistente de operaciones locales y de las acciones de deshacer que siguen disponibles.",
              ),
            ),
            createElement(
              "div",
              { className: "history-sheet__body" },
              historyError === undefined ? null : createElement("p", { role: "alert", className: "form-error" }, historyError),
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
                            new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt)),
                          ),
                          createElement("small", { className: "history-entry__id" }, item.journalId),
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
                  ? "Consultando el journal local…"
                  : `${history.items.length} ${history.items.length === 1 ? "operación registrada" : "operaciones registradas"}`,
              ),
              createElement(MetalAction, { onClick: () => setHistoryOpen(false) }, "Cerrar"),
            ),
        )
      : null,
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
                `${root.displayName} · ${root.displayPath}`,
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
    mobileNavigationOpen
      ? createElement(
          "div",
          { className: "mobile-navigation", id: "mobile-navigation" },
          createElement(PrimaryNavigation, { activeSurface, onNavigate: navigate, onboardingRequired }),
        )
      : null,
    createElement(
      "div",
      { className: "app-body" },
      createElement(AppSidebar, { activeSurface, onNavigate: navigate, onboardingRequired }),
      createElement(
        "main",
        { className: "main-content", id: "main-content", ref: mainContentRef, tabIndex: -1 },
        scanNotice === undefined
          ? null
          : createElement("p", { className: "form-error", role: "alert" }, scanNotice),
        createElement(PageContent, { activeSurface, onboarding, inventory, pending }),
      ),
      createElement(Inspector, {
        inventoryBridge,
        operationBridge,
        onStatus: setOperationStatus,
        revision: inventoryRevision,
        ...(activeSurface !== "onboarding" && selectedInstallationId !== undefined
          ? { installationId: selectedInstallationId }
          : {}),
      }),
    ),
  )
}
