import { createElement, useState, type ReactNode } from "react"

type Surface = "onboarding" | "inventory"

interface NavigationProps {
  activeSurface: Surface
  onNavigate: (surface: Surface) => void
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

function PrimaryNavigation({ activeSurface, onNavigate }: NavigationProps) {
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

function OnboardingPlaceholder() {
  return createElement(
    "section",
    { className: "content-surface", "aria-labelledby": "onboarding-title" },
    createElement(
      "div",
      { className: "page-heading" },
      createElement("p", { className: "eyebrow" }, "Primer uso"),
      createElement("h1", { id: "onboarding-title" }, "Configura tus fuentes"),
      createElement(
        "p",
        { className: "page-description" },
        "Forge te pedirá aprobación antes de observar cualquier carpeta. Esta superficie conectará con la gestión de raíces aprobadas.",
      ),
    ),
    createElement(
      "ol",
      { className: "onboarding-steps" },
      ...[
        [
          "Revisa las ubicaciones",
          "Verás qué harness propone cada carpeta y si Forge puede leerla o escribir en ella.",
        ],
        [
          "Aprueba el alcance",
          "Solo las ubicaciones aprobadas formarán parte del inventario y de futuras instalaciones.",
        ],
        [
          "Inicia el inventario",
          "El primer escaneo comenzará después de guardar tu selección, nunca antes.",
        ],
      ].map(([title, description], index) =>
        createElement(
          "li",
          { key: title },
          createElement("span", { className: "step-number", "aria-hidden": "true" }, String(index + 1)),
          createElement(
            "div",
            null,
            createElement("h2", null, title),
            createElement("p", null, description),
          ),
        ),
      ),
    ),
    createElement(
      "p",
      { className: "surface-note", role: "status" },
      "Gestión de carpetas pendiente de conectar.",
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

function PageContent({ activeSurface }: { activeSurface: Surface }): ReactNode {
  return activeSurface === "onboarding"
    ? createElement(OnboardingPlaceholder)
    : createElement(InventoryPlaceholder)
}

export function App() {
  const [activeSurface, setActiveSurface] = useState<Surface>("inventory")
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)

  const navigate = (surface: Surface) => {
    setActiveSurface(surface)
    setMobileNavigationOpen(false)
  }

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
          createElement(PrimaryNavigation, { activeSurface, onNavigate: navigate }),
        )
      : null,
    createElement(
      "div",
      { className: "app-body" },
      createElement(
        "aside",
        { className: "sidebar" },
        createElement(PrimaryNavigation, { activeSurface, onNavigate: navigate }),
        createElement(
          "p",
          { className: "sidebar-footnote" },
          "Forge observa contenido local. El harness conserva el control de activación.",
        ),
      ),
      createElement(
        "main",
        { className: "main-content", id: "main-content", tabIndex: -1 },
        createElement(PageContent, { activeSurface }),
      ),
      createElement(InspectorPlaceholder),
    ),
  )
}
