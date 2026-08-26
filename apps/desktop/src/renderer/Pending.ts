import { createElement, useEffect, useMemo, useState, type ReactNode } from "react"

import type { ForgeBridge, InventoryItemDto, InventoryQuery, OperationPlanDto } from "@forge/contracts"

import { AccessibleDialog } from "./AccessibleDialog.js"
import { OperationPlanDetails } from "./OperationPlanDetails.js"

type PendingKind = "update" | "conflict" | "validation"

interface PendingItem {
  readonly item: InventoryItemDto
  readonly kind: PendingKind
}

const labels: Record<PendingKind, string> = {
  update: "Actualizaciones disponibles",
  conflict: "Conflictos de origen",
  validation: "Validación pendiente",
}

async function loadAll(inventory: ForgeBridge["inventory"]): Promise<readonly InventoryItemDto[]> {
  const base: InventoryQuery = { scope: { kind: "all" }, pageSize: 100, sort: { by: "name", direction: "asc" } }
  const items: InventoryItemDto[] = []
  let cursor: string | undefined
  do {
    const page = await inventory.list({ ...base, ...(cursor === undefined ? {} : { cursor }) })
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor !== undefined)
  return items
}

function pendingItems(items: readonly InventoryItemDto[]): readonly PendingItem[] {
  const pending: PendingItem[] = []
  for (const item of items) {
    if (item.status.update === "available") pending.push({ item, kind: "update" })
    else if (item.status.update === "diverged") pending.push({ item, kind: "conflict" })
    else if (item.status.validity === "invalid" || item.status.validity === "warning") pending.push({ item, kind: "validation" })
  }
  return pending
}

export interface PendingProps {
  readonly inventoryBridge: ForgeBridge["inventory"]
  readonly operationBridge: ForgeBridge["operations"]
  readonly eventBridge: ForgeBridge["events"]
  readonly onSelectInstallation: (installationId: string) => void
  readonly onStatus: (message: string) => void
}

export function Pending({ inventoryBridge, operationBridge, eventBridge, onSelectInstallation, onStatus }: PendingProps): ReactNode {
  const [items, setItems] = useState<readonly PendingItem[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [plans, setPlans] = useState<readonly OperationPlanDto[]>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)

  useEffect(() => eventBridge.onInventoryChanged(() => setRevision((value) => value + 1)), [eventBridge])
  useEffect(() => {
    let current = true
    setLoading(true)
    setError(undefined)
    loadAll(inventoryBridge).then((loaded) => {
      if (!current) return
      const next = pendingItems(loaded)
      setItems(next)
      setSelected((selection) => new Set([...selection].filter((id) => next.some(({ item }) => item.installationId === id))))
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : "No se pudieron cargar los pendientes")
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [inventoryBridge, revision])

  const selectedItems = useMemo(
    () => items.filter(({ item }) => selected.has(item.installationId)),
    [items, selected],
  )
  const onlyUpdates = selectedItems.length > 0 && selectedItems.every(({ kind }) => kind === "update")
  const batchLabel = onlyUpdates ? `Actualizar ${selectedItems.length}` : `Resolver ${selectedItems.length} pendientes`

  const prepare = async (): Promise<void> => {
    if (!onlyUpdates) {
      const first = selectedItems[0]
      if (first !== undefined) {
        onSelectInstallation(first.item.installationId)
        onStatus("Revisa los pendientes seleccionados en el inspector; Forge no simula una resolución automática")
      }
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const next: OperationPlanDto[] = []
      for (const [index, pending] of selectedItems.entries()) {
        onStatus(`Preparando actualización ${index + 1} de ${selectedItems.length}`)
        const detail = await inventoryBridge.inspect({ installationId: pending.item.installationId })
        if (!detail.capabilities.canUpdateFromSource) throw new Error(`${pending.item.key} ya no admite actualización desde su origen`)
        next.push(await operationBridge.plan({
          kind: "update-from-local",
          installationId: pending.item.installationId,
          expectedSnapshotId: detail.snapshotId,
        }))
      }
      setPlans(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo preparar la actualización")
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (): Promise<void> => {
    if (plans === undefined) return
    setBusy(true)
    setError(undefined)
    let committed = 0
    try {
      for (const [index, plan] of plans.entries()) {
        onStatus(`Aplicando actualización ${index + 1} de ${plans.length}; no cancelable durante la escritura`)
        const result = await operationBridge.confirm({ planId: plan.planId })
        if (result.status !== "committed") throw new Error(result.message)
        committed += 1
      }
      setPlans(undefined)
      setSelected(new Set())
      onStatus(`${committed} ${committed === 1 ? "skill actualizada" : "skills actualizadas"}`)
    } catch (reason) {
      setPlans(undefined)
      setError(`${committed} actualizadas antes de detener el lote. ${reason instanceof Error ? reason.message : "No se pudo completar el lote"}`)
    } finally {
      setBusy(false)
    }
  }

  const grouped = (["update", "conflict", "validation"] as const).map((kind) => ({
    kind,
    entries: items.filter((item) => item.kind === kind),
  })).filter(({ entries }) => entries.length > 0)
  const blocked = plans?.some((plan) => plan.status === "blocked" || plan.conflicts.length > 0) ?? false

  return createElement(
    "section",
    { className: "content-surface pending-surface", "aria-labelledby": "pending-title" },
    createElement(
      "div",
      { className: "page-heading" },
      createElement("p", { className: "eyebrow" }, `${items.length} ${items.length === 1 ? "pendiente" : "pendientes"}`),
      createElement("h1", { id: "pending-title" }, "Pendientes"),
      createElement("p", { className: "page-description" }, "Agrupa hallazgos observados. Forge solo ejecuta en lote operaciones compatibles y siempre muestra cada plan antes de escribir."),
    ),
    error === undefined ? null : createElement("p", { className: "form-error", role: "alert" }, error),
    selectedItems.length === 0 ? null : createElement(
      "div",
      { className: "pending-batch", "aria-live": "polite" },
      createElement("span", null, `${selectedItems.length} seleccionados`),
      createElement("button", { type: "button", className: "primary-action", disabled: busy, onClick: () => { void prepare() } }, busy ? "Preparando…" : batchLabel),
      createElement("button", { type: "button", className: "secondary-action", disabled: busy, onClick: () => setSelected(new Set()) }, "Limpiar selección"),
    ),
    loading
      ? createElement("p", { role: "status" }, "Consultando pendientes…")
      : grouped.length === 0
        ? createElement("div", { className: "empty-state" }, createElement("p", { className: "empty-state-kicker" }, "Todo al día"), createElement("h2", null, "No hay acciones pendientes"), createElement("p", null, "Los nuevos hallazgos aparecerán aquí después de un escaneo o una observación del origen."))
        : grouped.map(({ kind, entries }) => createElement(
            "section",
            { className: "pending-group", key: kind, "aria-labelledby": `pending-${kind}` },
            createElement("h2", { id: `pending-${kind}` }, `${labels[kind]} · ${entries.length}`),
            createElement("ul", { className: "pending-list" }, ...entries.map(({ item }) => createElement(
              "li",
              { key: `${kind}:${item.installationId}` },
              createElement("label", null,
                createElement("input", {
                  type: "checkbox",
                  checked: selected.has(item.installationId),
                  onChange: () => setSelected((current) => {
                    const next = new Set(current)
                    if (next.has(item.installationId)) next.delete(item.installationId)
                    else next.add(item.installationId)
                    return next
                  }),
                }),
                createElement("span", null, createElement("strong", null, item.key), createElement("small", null, item.scope.kind === "project" ? "Proyecto" : item.scope.kind === "global" ? "Global" : item.scope.kind)),
              ),
              createElement("button", { type: "button", className: "secondary-action", onClick: () => onSelectInstallation(item.installationId) }, kind === "update" ? "Revisar actualización" : kind === "conflict" ? "Revisar conflicto" : "Revisar hallazgos"),
            ))),
          )),
    plans === undefined ? null : createElement(
      AccessibleDialog,
      { labelledBy: "pending-plan-title", ...(busy ? {} : { onDismiss: () => setPlans(undefined) }) },
      createElement("h2", { id: "pending-plan-title" }, `Confirmar ${plans.length === 1 ? "actualización" : `${plans.length} actualizaciones`}`),
      createElement("p", null, "El lote se aplica de forma secuencial. Si una precondición falla, Forge conserva lo ya confirmado y detiene el resto."),
      ...plans.map((plan) => createElement(OperationPlanDetails, { key: plan.planId, plan })),
      createElement("div", { className: "inspector-actions" },
        createElement("button", { type: "button", className: "primary-action", disabled: busy || blocked, onClick: () => { void confirm() } }, busy ? "Actualizando…" : `Confirmar ${plans.length}`),
        createElement("button", { type: "button", className: "secondary-action", disabled: busy, onClick: () => setPlans(undefined) }, "Cancelar"),
      ),
    ),
  )
}
