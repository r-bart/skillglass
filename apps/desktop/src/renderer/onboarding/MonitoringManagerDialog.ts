import type {
  ForgeBridge,
  MonitoringStateDto,
} from "@forge/contracts"
import {
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react"

import { AccessibleDialog } from "../AccessibleDialog.js"
import { createElement } from "../i18n.js"
import { loadAllInventoryItems } from "../inventory/load-all.js"
import { MetalAction, QuietAction } from "../VisualPrimitives.js"
import {
  SkillSelectionList,
  type SkillSelectionProject,
} from "./SkillSelectionList.js"

type MonitoringBridge = Pick<ForgeBridge, "inventory" | "monitoring">

type DialogContent = Readonly<{
  items: Awaited<ReturnType<typeof loadAllInventoryItems>>
  selectedInstallationIds: ReadonlySet<string>
}>

export interface MonitoringManagerDialogProps {
  readonly bridge: MonitoringBridge
  readonly projects: readonly SkillSelectionProject[]
  readonly rootDisplayPaths: ReadonlyMap<string, string>
  readonly onDismiss: () => void
  readonly onSaved: (state: MonitoringStateDto) => void
  readonly returnFocus?: HTMLElement | null | Readonly<{ current: HTMLElement | null }>
}

export function MonitoringManagerDialog({
  bridge,
  projects,
  rootDisplayPaths,
  onDismiss,
  onSaved,
  returnFocus,
}: MonitoringManagerDialogProps): ReactNode {
  const instanceId = useId()
  const [reloadKey, setReloadKey] = useState(0)
  const [content, setContent] = useState<DialogContent | undefined>()
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setContent(undefined)
    setLoadError(false)
    setSaveError(false)

    void Promise.all([
      loadAllInventoryItems(bridge.inventory),
      bridge.monitoring.state(),
    ]).then(([items, monitoring]) => {
      if (!active) return
      const selectedInstallationIds = new Set(monitoring.selectedInstallationIds)
      setSelection(selectedInstallationIds)
      setContent({ items, selectedInstallationIds })
    }).catch(() => {
      if (active) setLoadError(true)
    })

    return () => {
      active = false
    }
  }, [bridge, reloadKey])

  const titleId = `${instanceId}-monitoring-title`
  const descriptionId = `${instanceId}-monitoring-description`
  const validationError = content !== undefined
    && content.items.length > 0
    && selection.size === 0
  const canSave = content !== undefined && !validationError && !busy

  const cancel = (): void => {
    if (busy) return
    if (content !== undefined) setSelection(new Set(content.selectedInstallationIds))
    onDismiss()
  }

  const save = async (): Promise<void> => {
    if (!canSave) return
    setBusy(true)
    setSaveError(false)
    try {
      const state = await bridge.monitoring.save({
        installationIds: [...selection],
      })
      onSaved(state)
    } catch {
      setSaveError(true)
      setBusy(false)
    }
  }

  return createElement(
    AccessibleDialog,
    {
      className: "monitoring-manager",
      describedBy: descriptionId,
      labelledBy: titleId,
      ...(busy ? {} : { onDismiss: cancel }),
      ...(returnFocus === undefined ? {} : { returnFocus }),
    },
    createElement(
      "header",
      { className: "sheet-header monitoring-manager__header" },
      createElement("h2", { id: titleId }, "Gestionar seguimiento"),
      createElement(
        "p",
        { id: descriptionId },
        "Elige qué skills quieres seguir de cerca. Todas seguirán visibles en el inventario.",
      ),
    ),
    loadError
      ? createElement(
          "div",
          { className: "monitoring-manager__state" },
          createElement("p", { className: "form-error", role: "alert" }, "No se pudo cargar el seguimiento."),
          createElement(
            "div",
            { className: "monitoring-manager__state-actions" },
            createElement(QuietAction, { onClick: () => setReloadKey((value) => value + 1) }, "Reintentar"),
            createElement(QuietAction, { onClick: cancel }, "Cancelar"),
          ),
        )
      : content === undefined
        ? createElement(
            "div",
            { className: "monitoring-manager__state", role: "status", "aria-live": "polite" },
            "Cargando seguimiento…",
          )
        : createElement(
            "div",
            { "aria-busy": busy || undefined, className: "monitoring-manager__body" },
            createElement(SkillSelectionList, {
              disabled: busy,
              items: content.items,
              onSelectionChange: (next) => {
                setSaveError(false)
                setSelection(next)
              },
              projects,
              rootDisplayPaths,
              selectedInstallationIds: selection,
            }),
            validationError
              ? createElement("p", { className: "form-error", role: "alert" }, "Selecciona al menos una skill para continuar.")
              : null,
            saveError
              ? createElement("p", { className: "form-error", role: "alert" }, "No se pudo guardar el seguimiento.")
              : null,
            createElement(
              "footer",
              { className: "sheet-footer monitoring-manager__footer" },
              createElement(
                "p",
                null,
                "Esta selección solo organiza tu atención; no cambia las carpetas aprobadas.",
              ),
              createElement(
                "div",
                { className: "monitoring-manager__actions" },
                createElement(QuietAction, { disabled: busy, onClick: cancel }, "Cancelar"),
                createElement(
                  MetalAction,
                  { disabled: !canSave, onClick: () => { void save() } },
                  busy ? "Guardando…" : "Guardar cambios",
                ),
              ),
            ),
          ),
  )
}
