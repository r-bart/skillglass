import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react"

import type { InventoryPageDto, InventoryQuery } from "@forge/contracts"

import desktopPackage from "../../package.json" with { type: "json" }
import { MetalAction, QuietAction, SectionLabel } from "./VisualPrimitives.js"
import { createElement, verbatim, verbatimProps, type Locale } from "./i18n.js"

const SKILLGLASS_GITHUB_URL = "https://github.com/r-bart/skillglass"

export type Surface = "onboarding" | "inventory" | "pending"

export const surfaceLabels: Record<Surface, string> = {
  onboarding: "Carpetas",
  inventory: "Inventario",
  pending: "Por revisar",
}

interface SurfaceNavigationProps {
  readonly activeSurface: Surface
  readonly onboardingRequired: boolean
  readonly onNavigate: (surface: Surface) => void
}

interface NavigationProps extends SurfaceNavigationProps {
  readonly inventoryProjects: NonNullable<InventoryPageDto["projects"]>
  readonly inventoryScope: InventoryQuery["scope"]
  readonly onInventoryScopeChange: (scope: InventoryQuery["scope"]) => void
}

interface TopbarProps extends SurfaceNavigationProps {
  readonly contextLabel?: string
  readonly locale: Locale
  readonly mobileNavigationOpen: boolean
  readonly navigationVisible?: boolean
  readonly onCreateSkill: (trigger: HTMLElement) => void
  readonly onInstallDirectory: () => void
  readonly onInstallZip: () => void
  readonly onLocaleChange: (locale: Locale) => void
  readonly onOpenHistory: () => void
  readonly onRefreshUpdates: () => void
  readonly onToggleMobileNavigation: () => void
  readonly operationBusy: boolean
  readonly operationsVisible: boolean
}

function Brand({ contextLabel }: { readonly contextLabel: string }): ReactNode {
  return createElement(
    "div",
    { className: "app-brand", "aria-label": "Skillglass" },
    createElement("span", { className: "app-brand__wordmark" }, "Skillglass"),
    createElement("span", { "aria-hidden": "true", className: "app-brand__separator" }),
    createElement("span", { className: "app-brand__context" }, contextLabel),
  )
}

export function AppTopbar({
  activeSurface,
  contextLabel,
  locale,
  mobileNavigationOpen,
  navigationVisible = true,
  onInstallDirectory,
  onInstallZip,
  onLocaleChange,
  onCreateSkill,
  onOpenHistory,
  onRefreshUpdates,
  onToggleMobileNavigation,
  onboardingRequired,
  operationBusy,
  operationsVisible,
}: TopbarProps): ReactNode {
  const currentContext = contextLabel ?? surfaceLabels[activeSurface]
  const inventoryContext = contextLabel === undefined && activeSurface === "inventory" && !onboardingRequired

  return createElement(
    "header",
    { className: "app-topbar" },
    createElement("div", { className: "app-topbar__leading" }, createElement(Brand, { contextLabel: currentContext })),
    createElement(
      "div",
      { className: "app-topbar__center" },
      createElement("div", {
        className: "topbar-search-slot",
        hidden: !inventoryContext,
        id: "inventory-search-slot",
        role: "search",
      }),
      inventoryContext || contextLabel !== undefined
        ? null
        : createElement(
            "p",
            { className: "app-topbar__context", "aria-live": "polite" },
            currentContext,
          ),
    ),
    createElement(
      "div",
      { className: "app-topbar__actions" },
      createElement(
        "div",
        { "aria-label": "Idioma de la interfaz", className: "language-switch", role: "group" },
        createElement("button", {
          "aria-label": "Usar español",
          "aria-pressed": locale === "es",
          className: "language-switch__option",
          onClick: () => onLocaleChange("es"),
          type: "button",
        }, "ES"),
        createElement("button", {
          "aria-label": "Usar inglés",
          "aria-pressed": locale === "en",
          className: "language-switch__option",
          onClick: () => onLocaleChange("en"),
          type: "button",
        }, "EN"),
      ),
      operationsVisible
        ? createElement(
            MetalAction,
            {
              "aria-label": "Crear skill",
              className: "create-skill-button",
              disabled: operationBusy,
              onClick: (event: ReactMouseEvent<HTMLButtonElement>) => onCreateSkill(event.currentTarget),
            },
            createElement("span", { "aria-hidden": "true", className: "create-skill-button__icon" }, "+"),
            createElement("span", { className: "create-skill-button__label" }, "Crear skill"),
          )
        : null,
      operationsVisible
        ? createElement(
            "details",
            { className: "chrome-action-menu" },
            createElement(
              "summary",
              { "aria-label": "Abrir acciones de instalación", className: "visual-action visual-action--quiet chrome-action-menu__trigger" },
              createElement("span", { className: "chrome-action-menu__label" }, "Instalar"),
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
              title: "Compara con las carpetas locales de origen",
            },
            createElement("span", { "aria-hidden": "true", className: "refresh-button__icon" }, "↻"),
            createElement("span", { "aria-hidden": "true", className: "refresh-button__label" }, "Comprobar cambios"),
          )
        : null,
      createElement(
        QuietAction,
        { "aria-label": "Historial", className: "history-button", onClick: onOpenHistory },
        createElement("span", { "aria-hidden": "true", className: "history-button__icon" }, "↶"),
        createElement("span", { className: "history-button__label" }, "Historial"),
      ),
      navigationVisible
        ? createElement(
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
          )
        : null,
    ),
  )
}

type NavigationIconName = "library" | "global" | "project" | "review" | "folders"

function NavigationIcon({ name }: { readonly name: NavigationIconName }): ReactNode {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.35,
  }

  const drawing = name === "library"
    ? [
        createElement("rect", { ...common, height: 4.25, key: "a", rx: 1, width: 4.25, x: 2, y: 2 }),
        createElement("rect", { ...common, height: 4.25, key: "b", rx: 1, width: 4.25, x: 9.75, y: 2 }),
        createElement("rect", { ...common, height: 4.25, key: "c", rx: 1, width: 4.25, x: 2, y: 9.75 }),
        createElement("rect", { ...common, height: 4.25, key: "d", rx: 1, width: 4.25, x: 9.75, y: 9.75 }),
      ]
    : name === "global"
      ? [
          createElement("circle", { ...common, cx: 8, cy: 8, key: "circle", r: 6 }),
          createElement("path", { ...common, d: "M2.35 8h11.3M8 2c1.65 1.65 2.45 3.65 2.45 6S9.65 12.35 8 14M8 2C6.35 3.65 5.55 5.65 5.55 8S6.35 12.35 8 14", key: "grid" }),
        ]
      : name === "project"
        ? [createElement("path", { ...common, d: "M1.75 4.6c0-.75.6-1.35 1.35-1.35h3.15l1.25 1.5h5.4c.75 0 1.35.6 1.35 1.35v5.3c0 .75-.6 1.35-1.35 1.35H3.1c-.75 0-1.35-.6-1.35-1.35V4.6Z", key: "folder" })]
        : name === "review"
          ? [
              createElement("path", { ...common, d: "M5.25 4h8M5.25 8h8M5.25 12h5", key: "lines" }),
              createElement("path", { ...common, d: "m1.8 3.85.85.85 1.55-1.65M1.8 7.85l.85.85L4.2 7.05M1.8 11.85l.85.85 1.55-1.65", key: "checks" }),
            ]
          : [
              createElement("path", { ...common, d: "M2 3.25h12M2 8h12M2 12.75h12", key: "lines" }),
              createElement("circle", { ...common, cx: 5, cy: 3.25, key: "a", r: 1.35 }),
              createElement("circle", { ...common, cx: 10.75, cy: 8, key: "b", r: 1.35 }),
              createElement("circle", { ...common, cx: 6.75, cy: 12.75, key: "c", r: 1.35 }),
            ]

  return createElement(
    "span",
    { "aria-hidden": "true", className: `navigation-icon navigation-icon--${name}` },
    createElement("svg", { viewBox: "0 0 16 16" }, ...drawing),
  )
}

function scopeKey(scope: InventoryQuery["scope"]): string {
  if (scope.kind === "project") return `project:${scope.projectId}`
  if (scope.kind === "root") return `root:${scope.rootId}`
  return scope.kind
}

export function PrimaryNavigation({
  activeSurface,
  inventoryProjects,
  inventoryScope,
  onboardingRequired,
  onInventoryScopeChange,
  onNavigate,
}: NavigationProps): ReactNode {
  const inventoryDestination = (
    label: string,
    scope: InventoryQuery["scope"],
    icon: NavigationIconName,
    accessibleLabel = label,
    observed = false,
  ) => createElement(
    "button",
    observed ? verbatimProps({
      "aria-label": accessibleLabel,
      "aria-current": activeSurface === "inventory" && scopeKey(inventoryScope) === scopeKey(scope) ? "page" : undefined,
      className: "navigation-item scope-button",
      disabled: onboardingRequired,
      key: scopeKey(scope),
      onClick: () => onInventoryScopeChange(scope),
      type: "button",
    }) : {
      "aria-label": accessibleLabel,
      "aria-current": activeSurface === "inventory" && scopeKey(inventoryScope) === scopeKey(scope) ? "page" : undefined,
      className: "navigation-item scope-button",
      disabled: onboardingRequired,
      key: scopeKey(scope),
      onClick: () => onInventoryScopeChange(scope),
      type: "button",
    },
    createElement(NavigationIcon, { name: icon }),
    createElement("span", { className: "navigation-text" }, observed ? verbatim(label) : label),
  )

  const management: readonly [Surface, string, NavigationIconName][] = [
    ["pending", "Por revisar", "review"],
    ["onboarding", "Carpetas", "folders"],
  ]

  return createElement(
    "nav",
    { "aria-label": "Secciones principales", className: "primary-navigation" },
    createElement(SectionLabel, { as: "h2", className: "navigation-label" }, "Biblioteca"),
    createElement(
      "div",
      { className: "navigation-list" },
      inventoryDestination("Todas las skills", { kind: "all" }, "library", "Todas las skills · Esta máquina"),
    ),
    createElement(SectionLabel, { as: "h2", className: "navigation-label navigation-label--locations" }, "Ubicaciones"),
    createElement(
      "div",
      { className: "navigation-list" },
      inventoryDestination("Global", { kind: "global" }, "global"),
      ...inventoryProjects.map((project) => inventoryDestination(project.displayName, {
        kind: "project",
        projectId: project.projectId,
      }, "project", project.displayName, true)),
    ),
    createElement(SectionLabel, { as: "h2", className: "navigation-label navigation-label--management" }, "Gestionar"),
    createElement(
      "ul",
      { className: "navigation-list", role: "list" },
      ...management.map(([surface, label, icon]) => createElement(
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
          createElement(NavigationIcon, { name: icon }),
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
    createElement(PrimaryNavigation, props),
    createElement(
      "div",
      { className: "app-sidebar__footer" },
      createElement("span", { "aria-hidden": "true", className: "app-sidebar__runtime-icon" }),
      createElement(
        "span",
        { className: "app-sidebar__footer-copy" },
        createElement("strong", null, `Skillglass v${desktopPackage.version}`),
        createElement(
          "a",
          {
            "aria-label": "Abrir GitHub",
            className: "app-sidebar__repository-link",
            href: SKILLGLASS_GITHUB_URL,
            rel: "noreferrer",
            target: "_blank",
          },
          "GitHub ↗",
        ),
      ),
    ),
  )
}
