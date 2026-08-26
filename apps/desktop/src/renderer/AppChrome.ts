import { createElement, type ReactNode } from "react"

import { QuietAction, SectionLabel } from "./VisualPrimitives.js"

export type Surface = "onboarding" | "inventory" | "pending"

export const surfaceLabels: Record<Surface, string> = {
  onboarding: "Configuración inicial",
  inventory: "Inventario",
  pending: "Pendientes",
}

interface NavigationProps {
  readonly activeSurface: Surface
  readonly onboardingRequired: boolean
  readonly onNavigate: (surface: Surface) => void
  readonly inventoryScopeTarget?: boolean
}

interface TopbarProps extends NavigationProps {
  readonly mobileNavigationOpen: boolean
  readonly onInstallDirectory: () => void
  readonly onInstallZip: () => void
  readonly onOpenHistory: () => void
  readonly onRefreshUpdates: () => void
  readonly onToggleMobileNavigation: () => void
  readonly operationBusy: boolean
  readonly operationsVisible: boolean
}

function Brand({ activeSurface }: { readonly activeSurface: Surface }): ReactNode {
  return createElement(
    "div",
    { className: "app-brand", "aria-label": "Forge" },
    createElement("span", { className: "app-brand__wordmark" }, "Forge"),
    createElement("span", { "aria-hidden": "true", className: "app-brand__separator" }),
    createElement("span", { className: "app-brand__context" }, surfaceLabels[activeSurface]),
  )
}

export function AppTopbar({
  activeSurface,
  mobileNavigationOpen,
  onInstallDirectory,
  onInstallZip,
  onNavigate,
  onOpenHistory,
  onRefreshUpdates,
  onToggleMobileNavigation,
  onboardingRequired,
  operationBusy,
  operationsVisible,
}: TopbarProps): ReactNode {
  const inventoryContext = activeSurface === "inventory" && !onboardingRequired

  return createElement(
    "header",
    { className: "app-topbar" },
    createElement("div", { className: "app-topbar__leading" }, createElement(Brand, { activeSurface })),
    createElement(
      "div",
      { className: "app-topbar__center" },
      createElement("div", {
        className: "topbar-search-slot",
        hidden: !inventoryContext,
        id: "inventory-search-slot",
        role: "search",
      }),
      inventoryContext
        ? null
        : createElement(
            "p",
            { className: "app-topbar__context", "aria-live": "polite" },
            surfaceLabels[activeSurface],
          ),
    ),
    createElement(
      "div",
      { className: "app-topbar__actions" },
      operationsVisible
        ? createElement(
            QuietAction,
            {
              "aria-current": activeSurface === "pending" ? "page" : undefined,
              className: "pending-entry",
              onClick: () => onNavigate("pending"),
            },
            createElement("span", { "aria-hidden": "true", className: "pending-entry__dot" }),
            createElement("span", null, "Pendientes"),
          )
        : null,
      operationsVisible
        ? createElement(
            "details",
            { className: "chrome-action-menu" },
            createElement(
              "summary",
              { "aria-label": "Abrir acciones de instalación", className: "visual-action visual-action--metal chrome-action-menu__trigger" },
              "Instalar",
              createElement("span", { "aria-hidden": "true", className: "chrome-action-menu__chevron" }, "▾"),
            ),
            createElement(
              "div",
              { className: "chrome-action-menu__popover" },
              createElement("button", {
                disabled: operationBusy,
                onClick: (event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open")
                  onInstallDirectory()
                },
                type: "button",
              }, "Instalar desde carpeta"),
              createElement("button", {
                disabled: operationBusy,
                onClick: (event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open")
                  onInstallZip()
                },
                type: "button",
              }, "Instalar desde ZIP"),
            ),
          )
        : null,
      operationsVisible
        ? createElement(
            QuietAction,
            {
              "aria-label": "Buscar actualizaciones",
              className: "refresh-button",
              disabled: operationBusy,
              onClick: onRefreshUpdates,
            },
            createElement("span", { "aria-hidden": "true", className: "refresh-button__icon" }, "↻"),
          )
        : null,
      createElement(
        QuietAction,
        { "aria-label": "Historial", className: "history-button", onClick: onOpenHistory },
        createElement("span", { "aria-hidden": "true", className: "history-button__icon" }, "↶"),
        createElement("span", { className: "history-button__label" }, "Historial"),
      ),
      createElement(
        "button",
        {
          "aria-controls": "mobile-navigation",
          "aria-expanded": mobileNavigationOpen,
          "aria-label": mobileNavigationOpen ? "Cerrar navegación" : "Abrir navegación",
          className: "navigation-toggle",
          onClick: onToggleMobileNavigation,
          type: "button",
        },
        createElement("span", { "aria-hidden": "true" }),
        createElement("span", { "aria-hidden": "true" }),
        createElement("span", { "aria-hidden": "true" }),
      ),
    ),
  )
}

export function PrimaryNavigation({
  activeSurface,
  inventoryScopeTarget = false,
  onboardingRequired,
  onNavigate,
}: NavigationProps): ReactNode {
  const views: readonly [Surface, string][] = [
    ["inventory", "Inventario"],
    ["pending", "Pendientes"],
    ["onboarding", "Configuración inicial"],
  ]

  return createElement(
    "nav",
    { "aria-label": "Secciones principales", className: "primary-navigation" },
    createElement(SectionLabel, { as: "h2", className: "navigation-label" }, "Ámbito"),
    inventoryScopeTarget
      ? createElement("div", { className: "scope-navigation-slot", id: "inventory-scope-slot" })
      : createElement(
          "div",
          { className: "scope-navigation-slot" },
          createElement(
            "button",
            {
              "aria-current": activeSurface === "inventory" ? "location" : undefined,
              className: "navigation-item scope-navigation-item",
              disabled: onboardingRequired,
              onClick: () => onNavigate("inventory"),
              type: "button",
            },
            createElement("span", { "aria-hidden": "true", className: "navigation-dot navigation-dot--scope" }),
            createElement("span", { className: "navigation-text" }, "Esta máquina"),
          ),
        ),
    createElement(SectionLabel, { as: "h2", className: "navigation-label navigation-label--views" }, "Vistas"),
    createElement(
      "ul",
      { className: "navigation-list", role: "list" },
      ...views.map(([surface, label]) => createElement(
        "li",
        { key: surface },
        createElement(
          "button",
          {
            "aria-current": activeSurface === surface ? "page" : undefined,
            className: "navigation-item",
            disabled: surface !== "onboarding" && onboardingRequired,
            onClick: () => onNavigate(surface),
            type: "button",
          },
          createElement("span", {
            "aria-hidden": "true",
            className: `navigation-dot navigation-dot--${surface}`,
          }),
          createElement("span", { className: "navigation-text" }, label),
        ),
      )),
    ),
  )
}

export function AppSidebar(props: NavigationProps): ReactNode {
  return createElement(
    "aside",
    { className: "sidebar app-sidebar" },
    createElement(PrimaryNavigation, { ...props, inventoryScopeTarget: true }),
    createElement(
      "div",
      { className: "app-sidebar__footer" },
      createElement("span", { "aria-hidden": "true", className: "app-sidebar__runtime-icon" }),
      createElement(
        "span",
        { className: "app-sidebar__footer-copy" },
        createElement("strong", null, "Datos locales"),
        createElement("small", null, "Forge observa; tu harness activa"),
      ),
    ),
  )
}
