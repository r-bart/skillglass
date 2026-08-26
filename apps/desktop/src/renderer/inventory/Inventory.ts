import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"

import type {
  ForgeBridge,
  InventoryItemDto,
  InventoryPageDto,
  InventoryQuery,
} from "@forge/contracts"

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
  const button = (label: string, value: Scope) => createElement(
    "button",
    {
      key: scopeKey(value),
      type: "button",
      className: "scope-button",
      "aria-pressed": scopeKey(scope) === scopeKey(value),
      onClick: () => onChange(value),
    },
    label,
  )
  return createElement(
    "nav",
    { className: "scope-navigation", "aria-label": "Ámbitos del inventario" },
    button("Esta máquina", { kind: "all" }),
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

function evidenceText(item: InventoryItemDto): string {
  return item.name.state === "unknown"
    ? "Nombre derivado de la carpeta"
    : "Nombre observado"
}

function InventoryTable({
  items,
  groupBy,
  selectedId,
  onSelect,
}: {
  items: readonly InventoryItemDto[]
  groupBy: GroupBy
  selectedId: string | undefined
  onSelect: (installationId: string) => void
}) {
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
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
        { className: "inventory-group-row", key: `group:${label}` },
        createElement("th", { colSpan: 5, scope: "rowgroup" }, label),
      ))
    }
    for (const item of entries) {
      const selected = selectedId === item.installationId
      rows.push(createElement(
        "tr",
        {
          key: item.installationId,
          ref: (node: HTMLTableRowElement | null) => {
            if (node === null) rowRefs.current.delete(item.installationId)
            else rowRefs.current.set(item.installationId, node)
          },
          className: "inventory-row",
          tabIndex: selected || (selectedId === undefined && item === items[0]) ? 0 : -1,
          "aria-selected": selected,
          onClick: () => onSelect(item.installationId),
          onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => move(event, item.installationId),
        },
        createElement(
          "th",
          { scope: "row" },
          createElement("span", { className: "skill-name" }, item.key),
          createElement("span", { className: "skill-description" },
            item.description.state === "unknown"
              ? "Sin descripción observada"
              : item.description.value,
          ),
        ),
        createElement("td", null, item.adapterId === "codex" ? "Codex" : item.adapterId),
        createElement(
          "td",
          null,
          item.scope.kind === "project"
            ? "Proyecto"
            : scopeLabels[item.scope.kind],
        ),
        createElement("td", null, validityLabels[item.status.validity]),
        createElement(
          "td",
          null,
          createElement("span", { className: `status-pill status-${item.status.update}` }, updateLabels[item.status.update]),
          createElement("span", { className: "visually-hidden" }, ` · ${sourceLabels[item.status.source]} · ${evidenceText(item)}`),
        ),
      ))
    }
  }
  return createElement(
    "div",
    { className: "inventory-table-wrap" },
    createElement(
      "table",
      { className: "inventory-table", "aria-label": "Skills instaladas" },
      createElement("thead", null, createElement(
        "tr",
        null,
        createElement("th", { scope: "col" }, "Skill"),
        createElement("th", { scope: "col" }, "Runtime"),
        createElement("th", { scope: "col" }, "Ámbito"),
        createElement("th", { scope: "col" }, "Validez"),
        createElement("th", { scope: "col" }, "Actualización"),
      )),
      createElement("tbody", null, ...rows),
    ),
  )
}

export interface InventoryProps {
  readonly inventoryBridge: ForgeBridge["inventory"]
  readonly eventBridge?: ForgeBridge["events"]
  readonly onSelectionChange?: (installationId: string | undefined) => void
}

export function Inventory({ inventoryBridge, eventBridge, onSelectionChange }: InventoryProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  const [scope, setScope] = useState<Scope>({ kind: "all" })
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
  }, [])

  useEffect(() => eventBridge?.onInventoryChanged(() => setRevision((current) => current + 1)), [eventBridge])

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
    .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" }))
  const packageOptions = [...new Set(page.items
    .map((item) => knownLabel(item.packageId))
    .filter((value): value is string => value !== undefined))]
    .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" }))
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

  return createElement(
    "section",
    { className: "content-surface inventory-surface", "aria-labelledby": "inventory-title" },
    createElement(
      "div",
      { className: "page-heading inventory-heading" },
      createElement("p", { className: "eyebrow" }, "Skills observadas"),
      createElement("h1", { id: "inventory-title" }, "Inventario"),
      createElement("p", { className: "page-description" }, "Consulta instalaciones reales y su evidencia sin alterar la activación del harness."),
    ),
    createElement(ScopeNavigation, { scope, projects: page.projects ?? [], onChange: setScope }),
    createElement(
      "div",
      { className: "inventory-controls", role: "search" },
      createElement(
        "label",
        { className: "inventory-search" },
        createElement("span", { className: "visually-hidden" }, "Buscar skills"),
        createElement("input", {
          ref: searchRef,
          type: "search",
          value: search,
          placeholder: "Buscar por nombre, descripción, ruta o metadatos…",
          onChange: (event) => setSearch(event.currentTarget.value),
        }),
      ),
      createElement(FilterSelect, { label: "Runtime", value: adapter, onChange: setAdapter, options: [
        { value: "", label: "Todos" }, { value: "codex", label: "Codex" }, { value: "folder", label: "Carpetas" },
      ] }),
      createElement(FilterSelect, { label: "Validez", value: validity, onChange: setValidity, options: [
        { value: "", label: "Todas" }, { value: "valid", label: "Válidas" }, { value: "warning", label: "Con avisos" }, { value: "invalid", label: "Inválidas" }, { value: "unknown", label: "Sin datos" },
      ] }),
      createElement(FilterSelect, { label: "Estado del harness", value: runtime, onChange: setRuntime, options: [
        { value: "", label: "Todos" }, { value: "enabled", label: "Activada (observada)" }, { value: "disabled", label: "Desactivada (observada)" }, { value: "inherited", label: "Heredada" }, { value: "shadowed", label: "Oculta" }, { value: "unknown", label: "Sin datos" }, { value: "unsupported", label: "No soportado" },
      ] }),
      createElement(FilterSelect, { label: "Estado de origen", value: source, onChange: setSource, options: [
        { value: "", label: "Todos" }, { value: "local", label: "Local" }, { value: "managed", label: "Gestionada" }, { value: "read-only", label: "Instalaciones de solo lectura" }, { value: "modified", label: "Modificada" }, { value: "unknown", label: "Sin datos" },
      ] }),
      createElement(FilterSelect, { label: "Procedencia", value: provenance, onChange: setProvenance, options: [
        { value: "", label: "Todas" }, { value: "local", label: "Local" }, { value: "forge-import", label: "Importada por Forge" }, { value: "registry", label: "Registro" }, { value: "package", label: "Paquete" }, { value: "plugin", label: "Plugin" }, { value: "system", label: "Sistema" }, { value: "unknown", label: "Sin datos" },
      ] }),
      createElement(FilterSelect, { label: "Actualización", value: update, onChange: setUpdate, options: [
        { value: "", label: "Todas" }, { value: "available", label: "Disponible" }, { value: "diverged", label: "Con cambios locales" }, { value: "current", label: "Actualizadas" }, { value: "unknown", label: "Sin datos" },
      ] }),
      createElement(FilterSelect, { label: "Orden", value: sort, onChange: setSort, options: [
        { value: "name:asc", label: "Nombre A–Z" }, { value: "name:desc", label: "Nombre Z–A" }, { value: "observedAt:desc", label: "Observación reciente" }, { value: "validity:asc", label: "Validez" }, { value: "update:asc", label: "Actualización" },
      ] }),
      createElement(FilterSelect, { label: "Agrupar", value: groupBy, onChange: (value) => setGroupBy(value as GroupBy), options: [
        { value: "none", label: "Sin agrupar" },
        ...(hasAuthor || groupBy === "author" ? [{ value: "author", label: "Autor observado" }] : []),
        ...(hasPackage || groupBy === "package" ? [{ value: "package", label: "Paquete observado" }] : []),
      ] }),
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
    error === undefined ? null : createElement("p", { role: "alert", className: "form-error" }, error),
    loading
      ? createElement("p", { "aria-live": "polite", className: "inventory-loading" }, "Consultando inventario…")
      : page.items.length > 0
        ? createElement(InventoryTable, { items: page.items, groupBy, selectedId, onSelect: select })
        : createElement(
            "div",
            { className: "empty-state" },
            createElement("p", { className: "empty-state-kicker" }, filtered ? "Ningún resultado" : "Inventario vacío"),
            createElement("h2", null, filtered ? "No hay skills que coincidan" : "No se han observado skills"),
            createElement("p", null, filtered ? "Cambia la búsqueda o los filtros para ampliar los resultados." : "Revisa las carpetas aprobadas o ejecuta un nuevo escaneo."),
            filtered ? createElement("button", {
              type: "button",
              className: "secondary-action",
              onClick: () => {
                setSearch("")
                setValidity("")
                setRuntime("")
                setUpdate("")
                setAdapter("")
                setSource("")
                setProvenance("")
                setAuthor("")
                setPackageId("")
              },
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
      loading
        ? ""
        : page.items.length < page.total
          ? `${page.items.length} de ${page.total} instalaciones`
          : `${page.total} instalaciones`,
    ),
  )
}
