import { createElement, useEffect, useState, type ReactNode } from "react"

import type { ForgeBridge, OnboardingStateDto, RootCandidateDto } from "@forge/contracts"

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
}: {
  activeSurface: Surface
  mobileNavigationOpen: boolean
  onToggleMobileNavigation: () => void
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

function InventoryPlaceholder() {
  return createElement(
    "section",
    { className: "content-surface", "aria-labelledby": "inventory-title" },
    createElement(
      "div",
      { className: "page-heading" },
      createElement("p", { className: "eyebrow" }, "Todas las fuentes"),
      createElement("h1", { id: "inventory-title" }, "Inventario"),
      createElement(
        "p",
        { className: "page-description" },
        "Consulta las skills que Forge observe en las ubicaciones aprobadas, sin alterar su activación en ningún harness.",
      ),
    ),
    createElement(
      "dl",
      { className: "inventory-summary" },
      createElement(
        "div",
        null,
        createElement("dt", null, "Skills observadas"),
        createElement("dd", { className: "numeric-value" }, "Sin datos"),
      ),
      createElement(
        "div",
        null,
        createElement("dt", null, "Último escaneo"),
        createElement("dd", null, "Todavía no ejecutado"),
      ),
      createElement(
        "div",
        null,
        createElement("dt", null, "Acceso"),
        createElement("dd", null, "Pendiente de configurar"),
      ),
    ),
    createElement(
      "div",
      { className: "empty-state" },
      createElement("p", { className: "empty-state-kicker" }, "Inventario preparado"),
      createElement("h2", null, "Tus skills aparecerán aquí"),
      createElement(
        "p",
        null,
        "Cuando existan raíces aprobadas, esta vista mostrará resultados, estados de evidencia y ámbitos disponibles.",
      ),
    ),
  )
}

function InspectorPlaceholder() {
  return createElement(
    "aside",
    { className: "inspector", "aria-labelledby": "inspector-title" },
    createElement(
      "div",
      { className: "inspector-heading" },
      createElement("p", { className: "eyebrow" }, "Detalle"),
      createElement("h2", { id: "inspector-title" }, "Inspector"),
    ),
    createElement(
      "div",
      { className: "inspector-empty" },
      createElement("p", { className: "inspector-empty-title" }, "Ninguna skill seleccionada"),
      createElement(
        "p",
        null,
        "Selecciona una skill del inventario para revisar su origen, ubicación y evidencia disponible.",
      ),
    ),
    createElement(
      "dl",
      { className: "inspector-metadata" },
      createElement("div", null, createElement("dt", null, "Ruta"), createElement("dd", null, "Sin selección")),
      createElement("div", null, createElement("dt", null, "Runtime"), createElement("dd", null, "Sin datos")),
      createElement("div", null, createElement("dt", null, "Ámbito"), createElement("dd", null, "Sin datos")),
    ),
  )
}

function PageContent({ activeSurface, onboarding }: { activeSurface: Surface; onboarding: ReactNode }): ReactNode {
  return activeSurface === "onboarding"
    ? onboarding
    : createElement(InventoryPlaceholder)
}

export function App({ onboardingBridge: suppliedOnboardingBridge }: { onboardingBridge?: ForgeBridge["onboarding"] }) {
  const onboardingBridge = suppliedOnboardingBridge ?? window.forge.onboarding
  const [activeSurface, setActiveSurface] = useState<Surface>("onboarding")
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [onboardingState, setOnboardingState] = useState<OnboardingStateDto | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return createElement(
    "div",
    { className: "app-shell" },
    createElement("a", { className: "skip-link", href: "#main-content" }, "Saltar al contenido"),
    createElement(AppHeader, {
      activeSurface,
      mobileNavigationOpen,
      onToggleMobileNavigation: () => setMobileNavigationOpen((isOpen) => !isOpen),
    }),
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
        createElement(PageContent, { activeSurface, onboarding }),
      ),
      createElement(InspectorPlaceholder),
    ),
  )
}
