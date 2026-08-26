import { createElement, useEffect, useState, type ReactNode } from "react"

import type {
  ForgeBridge,
  LocalSourceSelectionDto,
  OnboardingStateDto,
  OperationPlanDto,
  RootCandidateDto,
} from "@forge/contracts"

import { Inspector, Inventory } from "./inventory/index.js"

type Surface = "onboarding" | "inventory"

interface NavigationProps {
  activeSurface: Surface
  onNavigate: (surface: Surface) => void
  onboardingRequired: boolean
}

const surfaceLabels: Record<Surface, string> = {
  onboarding: "Configuración inicial",
  inventory: "Inventario",
}

function Brand() {
  return createElement(
    "a",
    { className: "brand", href: "/", "aria-label": "Página de inicio de Forge" },
    createElement("span", { className: "brand-mark", "aria-hidden": "true" }, "F"),
    createElement("span", { className: "brand-name" }, "Forge"),
  )
}

function PrimaryNavigation({ activeSurface, onNavigate, onboardingRequired }: NavigationProps) {
  const navigationItems = Object.entries(surfaceLabels) as Array<[Surface, string]>

  return createElement(
    "nav",
    { className: "primary-navigation", "aria-label": "Secciones principales" },
    createElement("p", { className: "navigation-label" }, "Espacio local"),
    createElement(
      "ul",
      { className: "navigation-list", role: "list" },
      navigationItems.map(([surface, label]) =>
        createElement(
          "li",
          { key: surface },
          createElement(
            "button",
            {
              className: "navigation-item",
              type: "button",
              disabled: surface === "inventory" && onboardingRequired,
              "aria-current": activeSurface === surface ? "page" : undefined,
              onClick: () => onNavigate(surface),
            },
            createElement("span", { className: "navigation-dot", "aria-hidden": "true" }),
            createElement("span", { className: "navigation-text" }, label),
          ),
        ),
      ),
    ),
  )
}

function AppHeader({
  activeSurface,
  mobileNavigationOpen,
  onToggleMobileNavigation,
  onOpenHistory,
  operationsVisible,
  operationBusy,
  onInstallDirectory,
  onInstallZip,
  onRefreshUpdates,
}: {
  activeSurface: Surface
  mobileNavigationOpen: boolean
  onToggleMobileNavigation: () => void
  onOpenHistory: () => void
  operationsVisible: boolean
  operationBusy: boolean
  onInstallDirectory: () => void
  onInstallZip: () => void
  onRefreshUpdates: () => void
}) {
  return createElement(
    "header",
    { className: "app-header" },
    createElement(Brand),
    createElement(
      "p",
      { className: "header-context", "aria-live": "polite" },
      surfaceLabels[activeSurface],
    ),
    createElement(
      "div",
      { className: "header-actions" },
      createElement("p", { className: "local-status" }, "Datos locales"),
      operationsVisible
        ? createElement("button", { className: "secondary-action", type: "button", disabled: operationBusy, onClick: onInstallDirectory }, "Instalar desde carpeta")
        : null,
      operationsVisible
        ? createElement("button", { className: "secondary-action", type: "button", disabled: operationBusy, onClick: onInstallZip }, "Instalar desde ZIP")
        : null,
      operationsVisible
        ? createElement("button", { className: "secondary-action", type: "button", disabled: operationBusy, onClick: onRefreshUpdates }, "Buscar actualizaciones")
        : null,
      createElement("button", { className: "secondary-action history-button", type: "button", onClick: onOpenHistory }, "Historial"),
      createElement(
        "button",
        {
          className: "navigation-toggle",
          type: "button",
          "aria-controls": "mobile-navigation",
          "aria-expanded": mobileNavigationOpen,
          "aria-label": mobileNavigationOpen ? "Cerrar navegación" : "Abrir navegación",
          onClick: onToggleMobileNavigation,
        },
        createElement("span", { "aria-hidden": "true" }),
        createElement("span", { "aria-hidden": "true" }),
        createElement("span", { "aria-hidden": "true" }),
      ),
    ),
  )
}

const accessLabels: Record<RootCandidateDto["access"], string> = {
  "read-write": "Lectura y escritura",
  "read-only": "Solo lectura",
  missing: "No disponible",
  denied: "Acceso denegado",
}

function Onboarding({
  state,
  selected,
  busy,
  error,
  onToggle,
  onAdd,
  onApprove,
}: {
  state: OnboardingStateDto | null
  selected: ReadonlySet<string>
  busy: boolean
  error: string | null
  onToggle: (candidateId: string) => void
  onAdd: () => void
  onApprove: () => void
}) {
  return createElement(
    "section",
    { className: "content-surface", "aria-labelledby": "onboarding-title" },
    createElement(
      "div",
      { className: "page-heading" },
      createElement("p", { className: "eyebrow" }, "Primer uso"),
      createElement("h1", { id: "onboarding-title" }, "Carpetas de skills"),
      createElement(
        "p",
        { className: "page-description" },
        "Revisa las ubicaciones propuestas. Forge no iniciará el primer escaneo hasta guardar tu aprobación.",
      ),
    ),
    state === null
      ? createElement("p", { className: "surface-note", role: "status" }, "Detectando ubicaciones compatibles…")
      : createElement(
          "form",
          { className: "root-form", onSubmit: (event) => { event.preventDefault(); onApprove() } },
          createElement(
            "fieldset",
            { className: "root-fieldset", disabled: busy },
            createElement("legend", null, "Ubicaciones que Forge puede observar"),
            createElement(
              "div",
              { className: "root-list" },
              ...state.proposedRoots.map((root) => createElement(
                "label",
                { className: "root-option", key: root.candidateId },
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
                    createElement("span", { className: `access-badge access-${root.access}` }, accessLabels[root.access]),
                    createElement("span", null, root.discovery.kind === "unknown" ? "Evidencia desconocida" : `Evidencia ${root.discovery.kind}`),
                  ),
                ),
              )),
            ),
          ),
          createElement(
            "div",
            { className: "root-actions" },
            createElement("button", { className: "secondary-action", type: "button", disabled: busy, onClick: onAdd }, "Añadir carpeta…"),
            createElement("button", { className: "primary-action", type: "submit", disabled: busy || selected.size === 0 }, busy ? "Escaneando…" : state.status === "complete" ? "Guardar cambios" : "Escanear carpetas aprobadas"),
          ),
          createElement("p", { className: "root-safety-note" }, "La carpeta se elige mediante el diálogo del sistema. Forge nunca solicita privilegios de administrador."),
        ),
    error === null ? null : createElement("p", { className: "form-error", role: "alert" }, error),
    createElement(
      "p",
      { className: "surface-note", role: "status" },
      state?.status === "complete" ? "La aprobación está guardada en este dispositivo." : "El inventario permanece bloqueado hasta guardar al menos una ubicación.",
    ),
  )
}

function PageContent({ activeSurface, onboarding, inventory }: { activeSurface: Surface; onboarding: ReactNode; inventory: ReactNode }): ReactNode {
  return activeSurface === "onboarding"
    ? onboarding
    : inventory
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
  const [activeSurface, setActiveSurface] = useState<Surface>("onboarding")
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [onboardingState, setOnboardingState] = useState<OnboardingStateDto | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedInstallationId, setSelectedInstallationId] = useState<string>()
  const [operationStatus, setOperationStatus] = useState<string>()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<Awaited<ReturnType<ForgeBridge["operations"]["history"]>>>()
  const [historyError, setHistoryError] = useState<string>()
  const [operationError, setOperationError] = useState<string>()
  const [operationBusy, setOperationBusy] = useState(false)
  const [installPlan, setInstallPlan] = useState<OperationPlanDto>()

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
      const target = onboardingState?.approvedRoots.find((root) =>
        root.access === "read-write" && root.kind === "global") ??
        onboardingState?.approvedRoots.find((root) => root.access === "read-write")
      if (target === undefined) throw new Error("No hay una carpeta aprobada con escritura para instalar")
      setInstallPlan(await operationBridge.plan({
        kind: "install-local",
        source: sourceClaim(selection),
        targetRootId: target.rootId,
      }))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo leer la fuente local"
      setOperationError(kind === "zip"
        ? `La fuente ZIP contiene una ruta no segura. ${message}`
        : message)
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
    const stopProgress = eventBridge.onOperationProgress((event) => {
      setOperationStatus(event.message)
    })
    const stopCompleted = eventBridge.onOperationCompleted((event) => {
      setOperationStatus(event.message)
    })
    return () => {
      stopProgress()
      stopCompleted()
    }
  }, [eventBridge])

  const onboardingRequired = onboardingState?.status !== "complete"

  const navigate = (surface: Surface) => {
    if (surface === "inventory" && onboardingRequired) return
    setActiveSurface(surface)
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

  const approve = async () => {
    setBusy(true)
    setError(null)
    try {
      const approvedRoots = await onboardingBridge.approveRoots({ candidateIds: [...selected] })
      setOnboardingState((state) => state === null ? state : { ...state, status: "complete", selectedCandidateIds: [...selected], approvedRoots })
      setActiveSurface("inventory")
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
    onApprove: () => { void approve() },
  })
  const inventory = createElement(Inventory, {
    inventoryBridge,
    eventBridge,
    onSelectionChange: setSelectedInstallationId,
  })

  return createElement(
    "div",
    { className: "app-shell" },
    createElement("a", { className: "skip-link", href: "#main-content" }, "Saltar al contenido"),
    createElement(AppHeader, {
      activeSurface,
      mobileNavigationOpen,
      onToggleMobileNavigation: () => setMobileNavigationOpen((isOpen) => !isOpen),
      onOpenHistory: () => { void openHistory() },
      operationsVisible: activeSurface === "inventory" && !onboardingRequired,
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
      : createElement("p", { className: "operation-status", role: "status" }, operationStatus),
    historyOpen
      ? createElement(
          "div",
          { className: "modal-backdrop" },
          createElement(
            "div",
            { role: "dialog", "aria-modal": "true", "aria-labelledby": "history-dialog-title", className: "operation-dialog" },
            createElement("h2", { id: "history-dialog-title" }, "Historial"),
            historyError === undefined ? null : createElement("p", { role: "alert", className: "form-error" }, historyError),
            history === undefined
              ? createElement("p", null, "Cargando historial…")
              : history.items.filter(({ undoAvailable }) => undoAvailable).length === 0
                ? createElement("p", null, "No hay operaciones que se puedan deshacer.")
                : createElement(
                    "ul",
                    { className: "history-list" },
                    ...history.items.filter(({ undoAvailable }) => undoAvailable).map((item) => createElement(
                      "li",
                      { key: item.journalId },
                      createElement("span", null, item.kind === "install-local"
                        ? "Instalación local"
                        : item.kind === "update-entry-content"
                          ? "Actualización de contenido"
                          : "Actualización de origen"),
                      createElement("button", {
                        type: "button",
                        className: "primary-action",
                        onClick: () => { void undo(item.journalId) },
                      }, item.kind === "install-local"
                        ? "Deshacer instalación"
                        : item.kind === "update-entry-content"
                          ? "Deshacer actualización"
                          : "Deshacer actualización de origen"),
                    )),
                  ),
            createElement("button", { type: "button", className: "secondary-action", onClick: () => setHistoryOpen(false) }, "Cerrar"),
          ),
        )
      : null,
    installPlan === undefined
      ? null
      : createElement(
          "div",
          { className: "modal-backdrop" },
          createElement(
            "div",
            { role: "dialog", "aria-modal": "true", "aria-labelledby": "install-dialog-title", className: "operation-dialog" },
            createElement("h2", { id: "install-dialog-title" }, "Confirmar instalación"),
            installPlan.destinationLabel === undefined
              ? null
              : createElement("p", { className: "inspector-path" }, installPlan.destinationLabel),
            createElement("p", null, "Cambios exactos:"),
            createElement(
              "ul",
              { className: "operation-diff" },
              ...installPlan.affectedEntries.map((entry) => createElement(
                "li",
                { key: `${entry.action}:${entry.relativePath}` },
                createElement("span", { className: `diff-action diff-${entry.action}` }, entry.action === "create" ? "Crear" : entry.action === "delete" ? "Eliminar" : "Modificar"),
                createElement("code", null, entry.relativePath),
              )),
            ),
            createElement(
              "div",
              { className: "inspector-actions" },
              createElement("button", { type: "button", className: "primary-action", disabled: operationBusy, onClick: () => { void confirmInstall() } }, operationBusy ? "Instalando…" : "Instalar skill"),
              createElement("button", { type: "button", className: "secondary-action", disabled: operationBusy, onClick: () => setInstallPlan(undefined) }, "Cancelar"),
            ),
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
      createElement(
        "aside",
        { className: "sidebar" },
        createElement(PrimaryNavigation, { activeSurface, onNavigate: navigate, onboardingRequired }),
        createElement(
          "p",
          { className: "sidebar-footnote" },
          "Forge observa contenido local. El harness conserva el control de activación.",
        ),
      ),
      createElement(
        "main",
        { className: "main-content", id: "main-content", tabIndex: -1 },
        createElement(PageContent, { activeSurface, onboarding, inventory }),
      ),
      createElement(Inspector, {
        inventoryBridge,
        operationBridge,
        onStatus: setOperationStatus,
        ...(activeSurface === "inventory" && selectedInstallationId !== undefined
          ? { installationId: selectedInstallationId }
          : {}),
      }),
    ),
  )
}
