import type { ForgeBridge, InventoryItemDto, InventoryQuery } from "@forge/contracts"

const ALL_INVENTORY_QUERY: InventoryQuery = {
  scope: { kind: "all" },
  pageSize: 100,
  sort: { by: "name", direction: "asc" },
}

/**
 * Loads the complete inventory while keeping pagination inside one shared
 * renderer boundary. Cursors are opaque: every value returned by the bridge is
 * forwarded unchanged to the following request.
 */
export async function loadAllInventoryItems(
  inventory: ForgeBridge["inventory"],
): Promise<readonly InventoryItemDto[]> {
  const items: InventoryItemDto[] = []
  let cursor: string | null = null

  do {
    const page = await inventory.list({
      ...ALL_INVENTORY_QUERY,
      ...(cursor === null ? {} : { cursor }),
    })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== null)

  return items
}
