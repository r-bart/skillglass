import type { InventoryItemDto } from "@forge/contracts"

export type SkillSelectionScope =
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "global" }>
  | Readonly<{ kind: "project"; projectId: string }>

function matchesScope(item: InventoryItemDto, scope: SkillSelectionScope): boolean {
  if (scope.kind === "all") return true
  if (scope.kind === "global") return item.scope.kind === "global"
  return item.scope.kind === "project" && item.scope.projectId === scope.projectId
}

function matchesSearch(item: InventoryItemDto, normalizedSearch: string): boolean {
  if (normalizedSearch.length === 0) return true
  return [
    item.key,
    item.name.state === "known" ? item.name.value : "",
    item.description.state === "known" ? item.description.value : "",
  ]
    .some((candidate) => candidate.toLocaleLowerCase().includes(normalizedSearch))
}

export function filterSelectableSkills(
  items: readonly InventoryItemDto[],
  scope: SkillSelectionScope,
  search: string,
): readonly InventoryItemDto[] {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  return items.filter((item) => matchesScope(item, scope) && matchesSearch(item, normalizedSearch))
}

export function areAllVisibleSkillsSelected(
  visibleItems: readonly InventoryItemDto[],
  selectedInstallationIds: ReadonlySet<string>,
): boolean {
  return visibleItems.length > 0
    && visibleItems.every((item) => selectedInstallationIds.has(item.installationId))
}

export function toggleVisibleSkillSelection(
  selectedInstallationIds: ReadonlySet<string>,
  visibleItems: readonly InventoryItemDto[],
): ReadonlySet<string> {
  const next = new Set(selectedInstallationIds)
  const shouldRemove = areAllVisibleSkillsSelected(visibleItems, selectedInstallationIds)

  for (const item of visibleItems) {
    if (shouldRemove) next.delete(item.installationId)
    else next.add(item.installationId)
  }

  return next
}
