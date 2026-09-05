import type { InventoryItemDto, InventoryPageDto } from "@forge/contracts"
import {
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { createElement, formatCount, getActiveLocale, verbatim, verbatimProps } from "../i18n.js"
import {
  MetalAction,
  QuietAction,
  SkillTile,
  glassSelectedRowClassName,
} from "../VisualPrimitives.js"
import {
  areAllVisibleSkillsSelected,
  filterSelectableSkills,
  toggleVisibleSkillSelection,
  type SkillSelectionScope,
} from "./selection-model.js"

export type SkillSelectionProject = NonNullable<InventoryPageDto["projects"]>[number]

export interface SkillSelectionListProps {
  readonly items: readonly InventoryItemDto[]
  readonly projects: readonly SkillSelectionProject[]
  readonly rootDisplayPaths: ReadonlyMap<string, string>
  readonly selectedInstallationIds: ReadonlySet<string>
  readonly onSelectionChange: (selection: ReadonlySet<string>) => void
  readonly onComplete?: () => void
  readonly completeBusy?: boolean
  readonly completeDisabled?: boolean
  readonly disabled?: boolean
  readonly footer?: ReactNode
}

const SCOPE_LABELS: Readonly<Record<"global" | "managed" | "system", string>> = {
  global: "Global",
  managed: "Gestionada",
  system: "Sistema",
}

function itemTitle(item: InventoryItemDto): string {
  return item.name.state === "known" ? item.name.value : item.key
}

function itemDescription(item: InventoryItemDto): string {
  return item.description.state === "known"
    ? item.description.value
    : "Descripción no observada"
}

function scopeLabel(
  item: InventoryItemDto,
  projectNames: ReadonlyMap<string, string>,
): string {
  if (item.scope.kind === "project") {
    return projectNames.get(item.scope.projectId) ?? "Proyecto"
  }
  return SCOPE_LABELS[item.scope.kind]
}

function countProjectItems(
  items: readonly InventoryItemDto[],
  projectId: string,
): number {
  return items.filter((item) => (
    item.scope.kind === "project" && item.scope.projectId === projectId
  )).length
}

function isKnownProjectScope(
  scope: SkillSelectionScope,
  projects: readonly SkillSelectionProject[],
): boolean {
  return scope.kind !== "project"
    || projects.some((project) => project.projectId === scope.projectId)
}

function searchPlaceholder(
  scope: SkillSelectionScope,
  itemCount: number,
  projectNames: ReadonlyMap<string, string>,
): string {
  if (scope.kind === "global") return "Buscar en Global"
  if (scope.kind === "project") {
    const projectName = projectNames.get(scope.projectId) ?? (getActiveLocale() === "es" ? "Proyecto" : "Project")
    return getActiveLocale() === "es" ? `Buscar en ${projectName}` : `Search ${projectName}`
  }
  return getActiveLocale() === "es"
    ? `Buscar entre ${formatCount(itemCount, "skill", "es")}`
    : `Search ${formatCount(itemCount, "skill", "en")}`
}

/**
 * A controlled selection surface. Filtering state stays local, while every
 * selection change produces a new Set so hidden selections remain untouched.
 */
export function SkillSelectionList({
  items,
  projects,
  rootDisplayPaths,
  selectedInstallationIds,
  onSelectionChange,
  onComplete,
  completeBusy = false,
  completeDisabled = false,
  disabled = false,
  footer,
}: SkillSelectionListProps): ReactNode {
  const instanceId = useId()
  const [scope, setScope] = useState<SkillSelectionScope>({ kind: "all" })
  const [search, setSearch] = useState("")
  const activeScope: SkillSelectionScope = isKnownProjectScope(scope, projects)
    ? scope
    : { kind: "all" }
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.projectId, project.displayName])),
    [projects],
  )
  const visibleItems = useMemo(
    () => filterSelectableSkills(items, activeScope, search),
    [activeScope, items, search],
  )
  const allVisibleSelected = areAllVisibleSkillsSelected(
    visibleItems,
    selectedInstallationIds,
  )
  const globalCount = items.filter((item) => item.scope.kind === "global").length
  const searchId = `${instanceId}-skill-search`

  const toggleItem = (installationId: string): void => {
    const next = new Set(selectedInstallationIds)
    if (next.has(installationId)) next.delete(installationId)
    else next.add(installationId)
    onSelectionChange(next)
  }

  const toggleVisible = (): void => {
    onSelectionChange(toggleVisibleSkillSelection(selectedInstallationIds, visibleItems))
  }

  return createElement(
    "section",
    {
      "aria-label": "Seleccionar skills bajo seguimiento",
      "aria-busy": disabled || undefined,
      className: "skill-selection",
    },
    createElement(
      "header",
      { className: "skill-selection__summary" },
      createElement(
        "output",
        { "aria-live": "polite", className: "skill-selection__counter" },
        createElement("strong", null, selectedInstallationIds.size),
        createElement("span", null, "bajo seguimiento"),
      ),
    ),
    createElement(
      "div",
      { className: "skill-selection__toolbar" },
      createElement(
        "div",
        {
          "aria-label": "Filtrar skills por ámbito",
          className: "skill-selection__scopes",
          role: "group",
        },
        createElement(
          "button",
          {
            "aria-pressed": activeScope.kind === "all",
            className: "skill-selection__scope",
            disabled,
            onClick: () => setScope({ kind: "all" }),
            type: "button",
          },
          `Todas · ${items.length}`,
        ),
        createElement(
          "button",
          {
            "aria-pressed": activeScope.kind === "global",
            className: "skill-selection__scope",
            disabled,
            onClick: () => setScope({ kind: "global" }),
            type: "button",
          },
          `Global · ${globalCount}`,
        ),
        createElement(
          "label",
          { className: "skill-selection__project" },
          createElement("span", { className: "visually-hidden" }, "Filtrar por proyecto"),
          createElement(
            "select",
            {
              "aria-label": "Filtrar por proyecto",
              disabled: disabled || projects.length === 0,
              onChange: (event) => {
                const projectId = (event.currentTarget as HTMLSelectElement).value
                if (projectId.length > 0) setScope({ kind: "project", projectId })
              },
              value: activeScope.kind === "project" ? activeScope.projectId : "",
            },
            createElement("option", { disabled: true, value: "" }, "Proyecto…"),
            ...projects.map((project) => createElement(
              "option",
              { key: project.projectId, value: project.projectId },
              verbatim(`${project.displayName} · ${countProjectItems(items, project.projectId)}`),
            )),
          ),
        ),
      ),
      createElement(
        "label",
        { className: "skill-selection__search", htmlFor: searchId },
        createElement("span", { className: "visually-hidden" }, "Buscar skills"),
        createElement("span", { "aria-hidden": "true", className: "skill-selection__search-icon" }),
        createElement("input", verbatimProps({
          disabled,
          id: searchId,
          onChange: (event) => setSearch(event.currentTarget.value),
          placeholder: searchPlaceholder(activeScope, items.length, projectNames),
          type: "search",
          value: search,
        })),
      ),
      createElement(
        QuietAction,
        {
          className: "skill-selection__toggle-visible",
          disabled: disabled || visibleItems.length === 0,
          onClick: toggleVisible,
        },
        allVisibleSelected ? "Quitar las visibles" : "Seleccionar las visibles",
      ),
    ),
    createElement(
      "div",
      { className: "skill-selection__results" },
      visibleItems.length === 0
        ? createElement(
            "div",
            { className: "skill-selection__empty", role: "status" },
            createElement("strong", null, items.length === 0 ? "No se han observado skills" : "No hay skills aquí."),
            createElement(
              "span",
              null,
              items.length === 0
                ? "Añade otra carpeta o proyecto para ampliar tu inventario."
                : "Prueba otro ámbito o borra la búsqueda.",
            ),
          )
        : createElement(
            "ul",
            { className: "skill-selection__list" },
            ...visibleItems.map((item) => {
              const selected = selectedInstallationIds.has(item.installationId)
              const title = itemTitle(item)
              const path = rootDisplayPaths.get(item.rootId) ?? "Ubicación no disponible"
              return createElement(
                "li",
                { key: item.installationId },
                createElement(
                  "label",
                  { className: glassSelectedRowClassName(selected, "skill-selection__row") },
                  createElement(SkillTile, {
                    adapterId: item.adapterId,
                    className: "skill-selection__tile",
                    skillKey: item.key,
                  }),
                  createElement(
                    "span",
                    { className: "skill-selection__copy" },
                    createElement("strong", { className: "skill-selection__name" }, verbatim(title)),
                    createElement("span", { className: "skill-selection__description" }, item.description.state === "known" ? verbatim(itemDescription(item)) : itemDescription(item)),
                    createElement(
                      "span",
                      { className: "skill-selection__origin" },
                      createElement("span", null, item.scope.kind === "project" ? verbatim(scopeLabel(item, projectNames)) : scopeLabel(item, projectNames)),
                      createElement("span", { "aria-hidden": "true" }, "·"),
                      createElement("span", verbatimProps({ className: "skill-selection__path", title: path }), verbatim(path)),
                    ),
                  ),
                  createElement("input", verbatimProps({
                    "aria-label": getActiveLocale() === "es" ? `Seleccionar ${title}` : `Select ${title}`,
                    checked: selected,
                    disabled,
                    onChange: () => toggleItem(item.installationId),
                    type: "checkbox",
                  })),
                ),
              )
            }),
          ),
    ),
    footer === undefined && onComplete === undefined
      ? null
      : createElement(
          "footer",
          { className: "skill-selection__footer" },
          footer,
          onComplete === undefined
            ? null
            : createElement(
                "div",
                { className: "skill-selection__completion" },
                createElement("p", null, "Podrás cambiar esta selección desde el inventario."),
                createElement(
                  MetalAction,
                  {
                    disabled: disabled
                      || completeBusy
                      || completeDisabled
                      || (items.length > 0 && selectedInstallationIds.size === 0),
                    onClick: onComplete,
                  },
                  completeBusy ? "Guardando…" : "Abrir mi inventario",
                ),
              ),
        ),
  )
}
