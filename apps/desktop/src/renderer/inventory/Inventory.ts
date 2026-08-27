import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { createElement, getActiveLocale } from "../i18n.js"

import type {
  ForgeBridge,
  InventoryItemDto,
  InventoryPageDto,
  InventoryQuery,
} from "@forge/contracts"

import {
  FilterChip,
  SkillTile,
  StatusPill,
  type StatusTone,
} from "../VisualPrimitives.js"

type Scope = InventoryQuery["scope"]
type GroupBy = "none" | "author" | "package"
type ProvenanceKind = NonNullable<InventoryQuery["provenanceKinds"]>[number]

const EMPTY_PAGE: InventoryPageDto = {
  items: [],
  projects: [],
  nextCursor: null,
  total: 0,
  observedAt: new Date(0).toISOString(),
}

const validityLabels: Record<InventoryItemDto["status"]["validity"], string> = {
  valid: "Válida",
  warning: "Con avisos",
  invalid: "Inválida",
  unknown: "Sin datos",
}

const updateLabels: Record<InventoryItemDto["status"]["update"], string> = {
  current: "Actualizada",
  available: "Actualización disponible",
  diverged: "Cambios locales",
  unavailable: "No disponible",
  unknown: "Sin datos",
}

const sourceLabels: Record<InventoryItemDto["status"]["source"], string> = {
  local: "Local",
  managed: "Gestionada",
  "read-only": "Solo lectura",
  modified: "Modificada",
  unknown: "Sin datos",
}

const scopeLabels: Record<Exclude<InventoryItemDto["scope"]["kind"], "project">, string> = {
  global: "Global",
  managed: "Gestionada",
  system: "Sistema",
}

const adapterOptions = [
  { value: "", label: "Todos" }, { value: "codex", label: "Codex" }, { value: "folder", label: "Carpetas" },
] as const
const validityOptions = [
  { value: "", label: "Todas" }, { value: "valid", label: "Válidas" }, { value: "warning", label: "Con avisos" }, { value: "invalid", label: "Inválidas" }, { value: "unknown", label: "Sin datos" },
] as const
const runtimeOptions = [
  { value: "", label: "Todos" }, { value: "enabled", label: "Activada (observada)" }, { value: "disabled", label: "Desactivada (observada)" }, { value: "inherited", label: "Heredada" }, { value: "shadowed", label: "Oculta" }, { value: "unknown", label: "Sin datos" }, { value: "unsupported", label: "No soportado" },
] as const
const sourceOptions = [
  { value: "", label: "Todos" }, { value: "local", label: "Local" }, { value: "managed", label: "Gestionada" }, { value: "read-only", label: "Instalaciones de solo lectura" }, { value: "modified", label: "Modificada" }, { value: "unknown", label: "Sin datos" },
] as const
const provenanceOptions = [
  { value: "", label: "Todas" }, { value: "local", label: "Local" }, { value: "forge-import", label: "Importada por Skillglass" }, { value: "registry", label: "Registro" }, { value: "package", label: "Paquete" }, { value: "plugin", label: "Plugin" }, { value: "system", label: "Sistema" }, { value: "unknown", label: "Sin datos" },
] as const
const updateOptions = [
  { value: "", label: "Todas" }, { value: "available", label: "Disponible" }, { value: "diverged", label: "Con cambios locales" }, { value: "current", label: "Actualizadas" }, { value: "unknown", label: "Sin datos" },
] as const
const sortOptions = [
  { value: "name:asc", label: "Nombre A–Z" }, { value: "name:desc", label: "Nombre Z–A" }, { value: "observedAt:desc", label: "Observación reciente" }, { value: "validity:asc", label: "Validez" }, { value: "update:asc", label: "Actualización" },
] as const

function optionLabel(
  options: readonly Readonly<{ value: string; label: string }>[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value
}

function knownLabel(claim: InventoryItemDto["author"]): string | undefined {
  return claim?.state === "known" ? claim.value : undefined
}

function scopeKey(scope: Scope): string {
  if (scope.kind === "project") return `project:${scope.projectId}`
  if (scope.kind === "root") return `root:${scope.rootId}`
  return scope.kind
}

function ScopeNavigation({
  scope,
  projects,
  onChange,
}: {
  scope: Scope
  projects: NonNullable<InventoryPageDto["projects"]>
  onChange: (scope: Scope) => void
}) {
  const button = (label: string, value: Scope, accessibleLabel = label) => createElement(
    "button",
    {
      key: scopeKey(value),
      type: "button",
      className: "navigation-item scope-button",
      "aria-label": accessibleLabel,
      "aria-pressed": scopeKey(scope) === scopeKey(value),
      onClick: () => onChange(value),
    },
    createElement("span", { "aria-hidden": "true", className: "navigation-dot navigation-dot--scope" }),
    createElement("span", { className: "navigation-text" }, label),
  )
  return createElement(
    "nav",
    { className: "scope-navigation scope-navigation--sidebar", "aria-label": "Vistas del inventario" },
    button("Todas las skills", { kind: "all" }, "Todas las skills · Esta máquina"),
    button("Global", { kind: "global" }),
    ...projects.map((project) => button(project.displayName, {
      kind: "project",
      projectId: project.projectId,
    })),
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly Readonly<{ value: string; label: string }>[]
  onChange: (value: string) => void
}) {
  return createElement(
    "label",
    { className: "inventory-filter" },
    createElement("span", null, label),
    createElement(
      "select",
      {
        value,
        onChange: (event) =>
          onChange((event.currentTarget as HTMLSelectElement).value),
      },
      ...options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label)),
    ),
  )
}

function statusTone(
  kind: "validity" | "source" | "update",
  value: string,
): StatusTone {
  if (kind === "validity") {
    if (value === "valid") return "ok"
    if (value === "warning") return "attention"
    if (value === "invalid") return "danger"
    return "idle"
  }
  if (kind === "update") {
    if (value === "current") return "ok"
    if (value === "available" || value === "diverged") return "attention"
    return "idle"
  }
  if (value === "modified") return "attention"
  return value === "unknown" || value === "read-only" ? "idle" : "neutral"
}

function scopeText(
  item: InventoryItemDto,
  projects: ReadonlyMap<string, string>,
): string {
  if (item.scope.kind === "project") {
    return projects.get(item.scope.projectId) ?? "Proyecto"
  }
  return scopeLabels[item.scope.kind]
}

function InventoryTable({
  items,
  projects,
  groupBy,
  monitoredInstallationIds,
  selectedId,
  onSelect,
}: {
  items: readonly InventoryItemDto[]
  projects: NonNullable<InventoryPageDto["projects"]>
  groupBy: GroupBy
  monitoredInstallationIds?: ReadonlySet<string>
  selectedId: string | undefined
  onSelect: (installationId: string) => void
}) {
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const projectLabels = useMemo(
    () => new Map(projects.map((project) => [project.projectId, project.displayName])),
    [projects],
  )
  const grouped = useMemo(() => {
    const groups = new Map<string | undefined, InventoryItemDto[]>()
    for (const item of items) {
      const key = groupBy === "author"
        ? knownLabel(item.author)
        : groupBy === "package"
          ? knownLabel(item.packageId)
          : undefined
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups.entries()]
  }, [groupBy, items])

  const move = (event: KeyboardEvent<HTMLTableRowElement>, currentId: string): void => {
    const current = items.findIndex(({ installationId }) => installationId === currentId)
    let next: number
    if (event.key === "ArrowDown") next = Math.min(items.length - 1, current + 1)
    else if (event.key === "ArrowUp") next = Math.max(0, current - 1)
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = items.length - 1
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onSelect(currentId)
      return
    } else return
    event.preventDefault()
    const item = items[next]
    if (item !== undefined) {
      onSelect(item.installationId)
      rowRefs.current.get(item.installationId)?.focus()
    }
  }

  const rows: ReactNode[] = []
  for (const [group, entries] of grouped) {
    if (groupBy !== "none") {
      const label = group ?? (groupBy === "author"
        ? "Sin autor observado"
        : "Sin paquete observado")
      rows.push(createElement(
        "tr",
        { className: "inventory-group-row", key: `group:${label}`, role: "row" },
        createElement("th", { scope: "rowgroup" }, label),
      ))
    }
    for (const item of entries) {
      const selected = selectedId === item.installationId
      const monitored = monitoredInstallationIds?.has(item.installationId) ?? false
      rows.push(createElement(
        "tr",
        {
          key: item.installationId,
          ref: (node: HTMLTableRowElement | null) => {
            if (node === null) rowRefs.current.delete(item.installationId)
            else rowRefs.current.set(item.installationId, node)
          },
          className: "inventory-row",
          role: "row",
          tabIndex: selected || (selectedId === undefined && item === items[0]) ? 0 : -1,
          "aria-selected": selected,
          onClick: () => onSelect(item.installationId),
          onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => move(event, item.installationId),
        },
        createElement("th", { scope: "row" },
          createElement("span", { className: "inventory-row__content" },
            createElement(
              "span",
              {
                className: `inventory-evidence-marker inventory-evidence-marker--${item.status.update}`,
                role: "img",
                "aria-label": `Actualización: ${updateLabels[item.status.update]}`,
              },
            ),
            createElement(SkillTile, {
              adapterId: item.adapterId,
              skillKey: item.key,
            }),
            createElement("span", { className: "inventory-row__copy" },
              createElement("span", { className: "inventory-row__identity" },
                createElement("span", { className: "skill-name" }, item.key),
                createElement("span", { className: "skill-scope" }, scopeText(item, projectLabels)),
                monitored
                  ? createElement(StatusPill, {
                      className: "inventory-monitoring-pill",
                      tone: "neutral",
                    }, "En seguimiento")
                  : null,
              ),
              createElement("span", { className: "skill-description" },
                item.description.state === "unknown"
                  ? "Sin descripción observada"
                  : item.description.value,
              ),
            ),
            createElement("span", {
              className: "inventory-row__evidence",
              "aria-label": `Evidencia de la instalación. Validez: ${validityLabels[item.status.validity]}. Origen: ${sourceLabels[item.status.source]}. Actualización: ${updateLabels[item.status.update]}`,
            },
              createElement(StatusPill, {
                ariaLabel: `Validez: ${validityLabels[item.status.validity]}`,
                className: "inventory-evidence-pill inventory-evidence-pill--validity",
                tone: statusTone("validity", item.status.validity),
              }, validityLabels[item.status.validity]),
              createElement(StatusPill, {
                ariaLabel: `Origen: ${sourceLabels[item.status.source]}`,
                className: "inventory-evidence-pill inventory-evidence-pill--source",
                tone: statusTone("source", item.status.source),
              }, sourceLabels[item.status.source]),
              createElement(StatusPill, {
                ariaLabel: `Actualización: ${updateLabels[item.status.update]}`,
                className: "inventory-evidence-pill inventory-evidence-pill--update",
                tone: statusTone("update", item.status.update),
              }, updateLabels[item.status.update]),
            ),
            item.declaredVersion.state === "known"
              ? createElement("span", {
                  className: "inventory-row__version",
                  title: `Versión declarada: ${item.declaredVersion.value}`,
                }, item.declaredVersion.value)
              : null,
          ),
        ),
      ))
    }
  }
  return createElement(
    "div",
    { className: "inventory-table-wrap" },
    createElement(
      "table",
      { className: "inventory-table", role: "grid", "aria-label": "Skills instaladas" },
      createElement("thead", { className: "inventory-table-head" }, createElement(
        "tr",
        null,
        createElement("th", { scope: "col" }, "Skill y evidencia observada"),
      )),
      createElement("tbody", null, ...rows),
    ),
  )
}

export interface InventoryProps {
  readonly active?: boolean
  readonly inventoryBridge: ForgeBridge["inventory"]
  readonly eventBridge?: ForgeBridge["events"]
  readonly externalNavigation?: boolean
  readonly monitoredInstallationIds?: ReadonlySet<string>
  readonly onManageMonitoring?: (trigger: HTMLElement) => void
  readonly onProjectsChange?: (projects: NonNullable<InventoryPageDto["projects"]>) => void
  readonly onSelectionChange?: (installationId: string | undefined) => void
  readonly scope?: Scope
}

export function Inventory({
  active = true,
  inventoryBridge,
  eventBridge,
  externalNavigation = false,
  monitoredInstallationIds,
  onManageMonitoring,
  onProjectsChange,
  onSelectionChange,
  scope: controlledScope,
}: InventoryProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  const [internalScope, setInternalScope] = useState<Scope>({ kind: "all" })
  const scope = controlledScope ?? internalScope
  const [search, setSearch] = useState("")
  const [validity, setValidity] = useState("")
  const [runtime, setRuntime] = useState("")
  const [update, setUpdate] = useState("")
  const [adapter, setAdapter] = useState("")
  const [source, setSource] = useState("")
  const [provenance, setProvenance] = useState("")
  const [author, setAuthor] = useState("")
  const [packageId, setPackageId] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("none")
  const [sort, setSort] = useState("name:asc")
  const [page, setPage] = useState<InventoryPageDto>(EMPTY_PAGE)
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!active) return
    const keydown = (event: globalThis.KeyboardEvent): void => {
      const macOS = /Mac|iPhone|iPad/u.test(navigator.platform)
      const primaryModifier = macOS ? event.metaKey : event.ctrlKey
      if (!primaryModifier || event.altKey || event.key.toLocaleLowerCase("en-US") !== "f") return
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [active])

  useEffect(() => eventBridge?.onInventoryChanged(() => setRevision((current) => current + 1)), [eventBridge])

  useEffect(() => {
    onProjectsChange?.(page.projects ?? [])
  }, [onProjectsChange, page.projects])

  const query = useMemo<InventoryQuery>(() => {
    const [sortBy = "name", direction = "asc"] = sort.split(":")
    return {
      scope,
      ...(search.trim().length === 0 ? {} : { search }),
      ...(adapter.length === 0 ? {} : { adapterIds: [adapter] }),
      ...(validity.length === 0 ? {} : { validity: [validity as InventoryItemDto["status"]["validity"]] }),
      ...(runtime.length === 0 ? {} : { runtimeStates: [runtime as InventoryItemDto["status"]["runtimeState"]] }),
      ...(update.length === 0 ? {} : { updates: [update as InventoryItemDto["status"]["update"]] }),
      ...(source.length === 0
        ? {}
        : { sourceStates: [source as InventoryItemDto["status"]["source"]] }),
      ...(provenance.length === 0
        ? {}
        : { provenanceKinds: [provenance as ProvenanceKind] }),
      ...(author.length === 0 ? {} : { authors: [author] }),
      ...(packageId.length === 0 ? {} : { packageIds: [packageId] }),
      groupBy,
      sort: {
        by: sortBy as "name" | "observedAt" | "validity" | "update",
        direction: direction as "asc" | "desc",
      },
      pageSize: 100,
    }
  }, [
    adapter,
    author,
    groupBy,
    packageId,
    provenance,
    runtime,
    scope,
    search,
    sort,
    source,
    update,
    validity,
  ])

  useEffect(() => {
    let current = true
    setLoading(true)
    setError(undefined)
    inventoryBridge.list(query).then((nextPage) => {
      if (!current) return
      setPage(nextPage)
      setSelectedId((selection) => nextPage.items.some(({ installationId }) => installationId === selection)
        ? selection
        : undefined)
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : "No se pudo consultar el inventario")
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [inventoryBridge, query, revision])

  const loadMore = async (): Promise<void> => {
    if (page.nextCursor === null || loadingMore) return
    setLoadingMore(true)
    setError(undefined)
    try {
      const nextPage = await inventoryBridge.list({
        ...query,
        cursor: page.nextCursor,
      })
      setPage((current) => ({
        ...nextPage,
        items: [...current.items, ...nextPage.items],
      }))
    } catch (reason) {
      setError(reason instanceof Error
        ? reason.message
        : "No se pudieron cargar más instalaciones")
    } finally {
      setLoadingMore(false)
    }
  }

  const select = (installationId: string): void => {
    setSelectedId(installationId)
  }
  useEffect(() => onSelectionChange?.(selectedId), [onSelectionChange, selectedId])

  const hasAuthor = page.items.some(({ author }) => knownLabel(author) !== undefined)
  const hasPackage = page.items.some(({ packageId }) => knownLabel(packageId) !== undefined)
  const authorOptions = [...new Set(page.items
    .map(({ author }) => knownLabel(author))
    .filter((value): value is string => value !== undefined))]
    .sort((left, right) => left.localeCompare(right, getActiveLocale(), { sensitivity: "base" }))
  const packageOptions = [...new Set(page.items
    .map((item) => knownLabel(item.packageId))
    .filter((value): value is string => value !== undefined))]
    .sort((left, right) => left.localeCompare(right, getActiveLocale(), { sensitivity: "base" }))
  const filtered = [
    search,
    validity,
    runtime,
    update,
    adapter,
    source,
    provenance,
    author,
    packageId,
  ].some((value) => value.trim().length > 0)
  const clearFilters = (): void => {
    setSearch("")
    setValidity("")
    setRuntime("")
    setUpdate("")
    setAdapter("")
    setSource("")
    setProvenance("")
    setAuthor("")
    setPackageId("")
  }
  const activeFilters: readonly Readonly<{
    clear: () => void
    id: string
    label: string
  }>[] = [
    ...(search.trim().length === 0 ? [] : [{ id: "search", label: `Búsqueda: “${search.trim()}”`, clear: () => setSearch("") }]),
    ...(adapter.length === 0 ? [] : [{ id: "adapter", label: `Runtime: ${optionLabel(adapterOptions, adapter)}`, clear: () => setAdapter("") }]),
    ...(validity.length === 0 ? [] : [{ id: "validity", label: `Validez: ${optionLabel(validityOptions, validity)}`, clear: () => setValidity("") }]),
    ...(runtime.length === 0 ? [] : [{ id: "runtime", label: `Harness: ${optionLabel(runtimeOptions, runtime)}`, clear: () => setRuntime("") }]),
    ...(source.length === 0 ? [] : [{ id: "source", label: `Origen: ${optionLabel(sourceOptions, source)}`, clear: () => setSource("") }]),
    ...(provenance.length === 0 ? [] : [{ id: "provenance", label: `Procedencia: ${optionLabel(provenanceOptions, provenance)}`, clear: () => setProvenance("") }]),
    ...(update.length === 0 ? [] : [{ id: "update", label: `Actualización: ${optionLabel(updateOptions, update)}`, clear: () => setUpdate("") }]),
    ...(author.length === 0 ? [] : [{ id: "author", label: `Autor: ${author}`, clear: () => setAuthor("") }]),
    ...(packageId.length === 0 ? [] : [{ id: "package", label: `Paquete: ${packageId}`, clear: () => setPackageId("") }]),
  ]
  const resultSummary = loading
    ? "Consultando inventario…"
    : page.items.length < page.total
      ? `${page.items.length} de ${page.total} instalaciones`
      : `${page.total} instalaciones`

  const scopeNavigation = createElement(ScopeNavigation, {
    scope,
    projects: page.projects ?? [],
    onChange: setInternalScope,
  })
  const searchControl = createElement(
    "label",
    { className: "inventory-search topbar-inventory-search" },
    createElement("span", { className: "visually-hidden" }, "Buscar skills"),
    createElement("span", { "aria-hidden": "true", className: "topbar-search-slot__icon" }),
    createElement("input", {
      ref: searchRef,
      type: "search",
      value: search,
      placeholder: "Filtrar por nombre o descripción",
      onChange: (event) => setSearch(event.currentTarget.value),
    }),
    createElement(
      "kbd",
      { "aria-hidden": "true" },
      /Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘F" : "Ctrl F",
    ),
  )
  const searchTarget = document.getElementById("inventory-search-slot")

  return createElement(
    "section",
    { className: "content-surface inventory-surface", "aria-labelledby": "inventory-title", "data-scroll-panel": "inventory" },
    searchTarget === null
      ? createElement("div", { className: "inventory-search-fallback", role: "search" }, searchControl)
      : createPortal(searchControl, searchTarget),
    externalNavigation
      ? null
      : createElement("div", { className: "inventory-scope-fallback" }, scopeNavigation),
    createElement(
      "div",
      { className: "page-heading inventory-heading" },
      createElement("p", { className: "eyebrow" }, "Skills observadas"),
      createElement("h1", { id: "inventory-title" }, "Inventario"),
      createElement("p", { className: "page-description" }, "Instalaciones y evidencia observada en los ámbitos aprobados."),
      onManageMonitoring === undefined
        ? null
        : createElement("button", {
            className: "visual-action visual-action--quiet inventory-monitoring-action",
            onClick: (event) => onManageMonitoring(event.currentTarget),
            type: "button",
          }, "Gestionar seguimiento"),
    ),
    createElement(
      "div",
      { className: "inventory-toolbar" },
      createElement("p", { className: "inventory-result-summary", "aria-live": "polite" }, resultSummary),
      createElement("div", { className: "inventory-toolbar__controls" },
        createElement(FilterSelect, { label: "Orden", value: sort, onChange: setSort, options: sortOptions }),
        createElement(FilterSelect, { label: "Agrupar", value: groupBy, onChange: (value) => setGroupBy(value as GroupBy), options: [
          { value: "none", label: "Sin agrupar" },
          ...(hasAuthor || groupBy === "author" ? [{ value: "author", label: "Autor observado" }] : []),
          ...(hasPackage || groupBy === "package" ? [{ value: "package", label: "Paquete observado" }] : []),
        ] }),
        createElement("details", { className: "inventory-filter-disclosure" },
          createElement("summary", {
            className: "visual-action visual-action--quiet inventory-filter-trigger",
            "aria-label": activeFilters.length === 0
              ? "Mostrar filtros del inventario"
              : `Mostrar filtros del inventario, ${activeFilters.length} activos`,
          },
          createElement("span", { "aria-hidden": "true", className: "inventory-filter-trigger__icon" }),
          "Filtros",
          activeFilters.length === 0
            ? null
            : createElement("span", { className: "inventory-filter-trigger__count" }, activeFilters.length),
          ),
          createElement("div", {
            className: "inventory-filter-panel",
            role: "group",
            "aria-label": "Filtros del inventario",
          },
          createElement("div", { className: "inventory-filter-panel__heading" },
            createElement("strong", null, "Filtrar inventario"),
            createElement("span", null, "Solo evidencia observada"),
          ),
          createElement("div", { className: "inventory-filter-panel__fields" },
            createElement(FilterSelect, { label: "Runtime", value: adapter, onChange: setAdapter, options: adapterOptions }),
            createElement(FilterSelect, { label: "Validez", value: validity, onChange: setValidity, options: validityOptions }),
            createElement(FilterSelect, { label: "Estado del harness", value: runtime, onChange: setRuntime, options: runtimeOptions }),
            createElement(FilterSelect, { label: "Estado de origen", value: source, onChange: setSource, options: sourceOptions }),
            createElement(FilterSelect, { label: "Procedencia", value: provenance, onChange: setProvenance, options: provenanceOptions }),
            createElement(FilterSelect, { label: "Actualización", value: update, onChange: setUpdate, options: updateOptions }),
            hasAuthor || author.length > 0
              ? createElement(FilterSelect, {
                  label: "Autor",
                  value: author,
                  onChange: setAuthor,
                  options: [
                    { value: "", label: "Todos" },
                    ...[...new Set([author, ...authorOptions].filter(Boolean))]
                      .map((value) => ({ value, label: value })),
                  ],
                })
              : null,
            hasPackage || packageId.length > 0
              ? createElement(FilterSelect, {
                  label: "Paquete",
                  value: packageId,
                  onChange: setPackageId,
                  options: [
                    { value: "", label: "Todos" },
                    ...[...new Set([packageId, ...packageOptions].filter(Boolean))]
                      .map((value) => ({ value, label: value })),
                  ],
                })
              : null,
          ),
          activeFilters.length === 0
            ? null
            : createElement("button", {
                type: "button",
                className: "quiet-action inventory-filter-panel__clear",
                onClick: clearFilters,
              }, "Limpiar todos los filtros"),
          ),
        ),
      ),
    ),
    activeFilters.length === 0
      ? null
      : createElement("div", { className: "inventory-active-filters", "aria-label": "Filtros activos" },
          ...activeFilters.map((filter) => createElement(FilterChip, {
            key: filter.id,
            label: filter.label,
            onRemove: filter.clear,
          })),
          createElement("span", { className: "inventory-active-filters__summary" }, resultSummary),
        ),
    error === undefined ? null : createElement("p", { role: "alert", className: "form-error" }, error),
    loading
      ? createElement("p", { "aria-live": "polite", className: "inventory-loading" }, "Consultando inventario…")
      : page.items.length > 0
        ? createElement(InventoryTable, {
            items: page.items,
            projects: page.projects ?? [],
            groupBy,
            ...(monitoredInstallationIds === undefined ? {} : { monitoredInstallationIds }),
            selectedId,
            onSelect: select,
          })
        : createElement(
            "div",
            { className: "empty-state" },
            createElement("p", { className: "empty-state-kicker" }, filtered ? "Ningún resultado" : "Inventario vacío"),
            createElement("h2", null, filtered ? "No hay skills que coincidan" : "No se han observado skills"),
            createElement("p", null, filtered ? "Cambia la búsqueda o los filtros para ampliar los resultados." : "Revisa las carpetas aprobadas o ejecuta un nuevo escaneo."),
            filtered ? createElement("button", {
              type: "button",
              className: "secondary-action",
              onClick: clearFilters,
            }, "Limpiar filtros") : null,
          ),
    !loading && page.nextCursor !== null
      ? createElement(
          "button",
          {
            type: "button",
            className: "secondary-action inventory-load-more",
            disabled: loadingMore,
            onClick: () => { void loadMore() },
          },
          loadingMore ? "Cargando…" : "Cargar más instalaciones",
        )
      : null,
    createElement(
      "p",
      { className: "inventory-count", "aria-live": "polite" },
      loading ? "" : resultSummary,
    ),
  )
}
