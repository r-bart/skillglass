import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import type {
  Evidence,
  ForgeBridge,
  InstallationDetailDto,
  InventoryItemDto,
  OperationPlanDto,
} from "@forge/contracts"

import { AccessibleDialog } from "../AccessibleDialog.js"
import { OperationPlanDetails } from "../OperationPlanDetails.js"
import { createElement, getActiveLocale, localize, verbatim } from "../i18n.js"
import { SafeMarkdown } from "../SafeMarkdown.js"
import {
  DarkAction,
  MetalAction,
  SkillTile,
  StatusPill,
} from "../VisualPrimitives.js"

type Finding = InstallationDetailDto["findings"][number]
type SourceView = "preview" | "source"
const DUPLICATE_DETAIL_LIMIT = 25

const validityLabels: Record<InventoryItemDto["status"]["validity"], string> = {
  valid: "Válida",
  warning: "Con avisos",
  invalid: "Inválida",
  unknown: "Validez desconocida",
}

const runtimeLabels: Record<InventoryItemDto["status"]["runtimeState"], string> = {
  enabled: "Activada (observada)",
  disabled: "Desactivada (observada)",
  inherited: "Heredada",
  shadowed: "Oculta por precedencia",
  unsupported: "No soportado",
  unknown: "Sin datos",
}

const sourceLabels: Record<InventoryItemDto["status"]["source"], string> = {
  local: "Local",
  managed: "Gestionada",
  "read-only": "Solo lectura · origen observado",
  modified: "Modificada",
  unknown: "Origen desconocido",
}

const updateLabels: Record<InventoryItemDto["status"]["update"], string> = {
  current: "Actualizada",
  available: "Actualización disponible",
  diverged: "Cambios locales",
  unavailable: "No disponible",
  unknown: "Sin datos",
}

const provenanceLabels: Record<InstallationDetailDto["provenance"]["kind"], string> = {
  local: "Local",
  "forge-import": "Importada por Skillglass",
  registry: "Registro",
  package: "Paquete",
  plugin: "Plugin",
  system: "Sistema",
  unknown: "Procedencia desconocida",
}

const managerLabels: Record<InstallationDetailDto["provenance"]["managedBy"], string> = {
  forge: "Skillglass",
  external: "Herramienta externa",
  runtime: "Runtime",
  user: "Usuario",
  unknown: "Gestor desconocido",
}

function adapterLabel(adapterId: string): string {
  if (adapterId === "codex") return "Codex"
  if (adapterId === "folder") return "Carpetas Agent Skills"
  return adapterId
}

function evidenceLabel(evidence: Evidence): string {
  switch (evidence.kind) {
    case "observed": return "Observado"
    case "derived": return "Derivado"
    case "inferred": return "Inferido"
    case "unknown": return "Evidencia desconocida"
  }
}

function evidencedValue(
  claim: InstallationDetailDto["provenance"]["release"],
): string {
  return claim.state === "known" ? claim.value : "No observado"
}

function entryPath(detail: InstallationDetailDto): string {
  const windows = detail.locationLabel.includes("\\") &&
    !detail.locationLabel.includes("/")
  const separator = windows ? "\\" : "/"
  const base = detail.locationLabel.replace(/[\\/]+$/u, "")
  return `${base}${separator}${detail.entryFile.replaceAll("/", separator)}`
}

function scopeLabel(scope: InventoryItemDto["scope"]): string {
  switch (scope.kind) {
    case "global": return "Global"
    case "managed": return "Gestionada"
    case "system": return "Sistema"
    case "project": return `Proyecto · ${scope.projectId}`
  }
}

function precedenceText(detail: InstallationDetailDto): string {
  const precedence = detail.precedence
  if (precedence === undefined) return "El scan no aportó una resolución de ámbito para esta instalación."
  switch (precedence.status) {
    case "conflict":
      return "Hay varias copias con este nombre. No se puede confirmar cuál utiliza Codex."
    case "unsupported":
      return "El adaptador declara que no puede resolver precedencia para este ámbito."
    case "unknown":
      return "La precedencia efectiva no está verificada por el adaptador."
    case "resolved":
      return precedence.winnerInstallationId === detail.installation.installationId
        ? "El adaptador identifica esta instalación como candidata efectiva para el ámbito."
        : "El adaptador identifica otra instalación como candidata efectiva para el ámbito."
  }
}

function precedenceEvidence(detail: InstallationDetailDto): ReactNode {
  const evidence = detail.precedence?.reason.evidence
  if (evidence === undefined) return "Sin evidencia de resolución proyectada"
  const rawReason = detail.precedence?.reason.state === "known"
    ? detail.precedence.reason.value
    : undefined
  const reason = rawReason !== undefined
    ? rawReason === "Only candidate in the effective scope"
      ? "Única copia en este ámbito"
      : rawReason === "Multiple candidates and no evidenced precedence winner"
        ? "Varias copias sin una ganadora acreditada"
        : verbatim(rawReason)
    : "Razón no observada"
  return createElement(
    "span",
    null,
    reason,
    " · ",
    evidenceLabel(evidence),
    evidence.source === undefined ? null : createElement("span", null, " · ", verbatim(evidence.source)),
  )
}

function runtimeText(detail: InstallationDetailDto): string {
  if (detail.installation.status.runtimeState === "unknown") {
    return detail.installation.adapterId === "codex"
      ? "No se puede confirmar si Codex la utiliza"
      : "No se puede confirmar si el runtime la utiliza"
  }
  return runtimeLabels[detail.installation.status.runtimeState]
}

const relationshipLabels: Record<NonNullable<InstallationDetailDto["scopeBinding"]>["relationship"], string> = {
  owned: "Propia de este ámbito",
  inherited: "Heredada",
  shadowed: "Oculta por precedencia observada",
  excluded: "Excluida",
  unavailable: "No disponible",
}

function findingTitle(finding: Finding): string {
  return finding.code.startsWith("FRONTMATTER_")
    ? "No se pudo leer el frontmatter"
    : finding.message
}

function evidenceTone(evidence: Evidence): "ok" | "attention" | "idle" {
  switch (evidence.kind) {
    case "observed": return "ok"
    case "derived":
    case "inferred": return "attention"
    case "unknown": return "idle"
  }
}

function EmptyInspector() {
  return createElement(
    "div",
    { className: "inspector-empty" },
    createElement("p", { className: "inspector-empty-title" }, "Ninguna skill seleccionada"),
    createElement(
      "p",
      null,
      "Selecciona una skill del inventario para revisar su origen, ubicación y evidencia disponible.",
    ),
  )
}

function StatusList({ detail }: { readonly detail: InstallationDetailDto }) {
  const status = detail.installation.status
  const rows = [
    ["Validez", validityLabels[status.validity]],
    [detail.installation.adapterId === "codex" ? "Uso en Codex" : "Estado del runtime", runtimeText(detail)],
    ["Origen", sourceLabels[status.source]],
    ["Actualización", updateLabels[status.update]],
    ["Uso", status.usage === "observed" ? "Observado por el runtime" : "No disponible"],
  ] as const
  return createElement(
    "dl",
    { className: "inspector-status-grid" },
    ...rows.map(([term, value]) => createElement(
      "div",
      { key: term },
      createElement("dt", null, term),
      createElement("dd", null, value),
    )),
  )
}

function Inspection({
  detail,
  inventoryBridge,
  operationBridge,
  onEditEntry,
  onStatus,
}: {
  readonly detail: InstallationDetailDto
  readonly inventoryBridge: ForgeBridge["inventory"]
  readonly operationBridge?: ForgeBridge["operations"]
  readonly onEditEntry?: (installationId: string, trigger: HTMLElement) => void
  readonly onStatus?: (message: string) => void
}) {
  const [sourceView, setSourceView] = useState<SourceView>("preview")
  const [actionError, setActionError] = useState<string>()
  const [sourcePlan, setSourcePlan] = useState<OperationPlanDto>()
  const [sourceConflict, setSourceConflict] = useState<string>()
  const [operationBusy, setOperationBusy] = useState(false)
  const [duplicateDetails, setDuplicateDetails] = useState<readonly InstallationDetailDto[]>([])
  const [duplicateDetailsIncomplete, setDuplicateDetailsIncomplete] = useState(false)
  const path = entryPath(detail)
  const name = detail.installation.name.state === "known"
    ? detail.installation.name.value
    : detail.installation.key
  const description = detail.installation.description.state === "known"
    ? detail.installation.description.value
    : "Descripción no observada"

  useEffect(() => {
    let current = true
    const candidateIds = detail.precedence?.status === "conflict"
      ? detail.precedence.candidateInstallationIds
      : []
    if (candidateIds.length === 0) {
      setDuplicateDetails([])
      setDuplicateDetailsIncomplete(false)
      return () => { current = false }
    }
    const requestedIds = candidateIds.slice(0, DUPLICATE_DETAIL_LIMIT)
    void Promise.all(requestedIds.map(async (installationId) => {
      try {
        return await inventoryBridge.inspect({ installationId })
      } catch {
        return undefined
      }
    })).then((values) => {
      if (!current) return
      setDuplicateDetails(values.filter((value): value is InstallationDetailDto => value !== undefined))
      setDuplicateDetailsIncomplete(
        candidateIds.length > requestedIds.length || values.some((value) => value === undefined),
      )
    })
    return () => { current = false }
  }, [detail, inventoryBridge])

  const openEntry = async (): Promise<void> => {
    setActionError(undefined)
    try {
      await inventoryBridge.openEntry({
        installationId: detail.installation.installationId,
      })
    } catch (reason) {
      setActionError(reason instanceof Error
        ? reason.message
        : "No se pudo mostrar el archivo")
    }
  }

  const prepareSourceUpdate = async (): Promise<void> => {
    if (operationBridge === undefined) return
    setOperationBusy(true)
    setActionError(undefined)
    setSourceConflict(undefined)
    try {
      const next = await operationBridge.plan({
        kind: "update-from-local",
        installationId: detail.installation.installationId,
        expectedSnapshotId: detail.snapshotId,
      })
      if (next.status === "blocked" || next.conflicts.length > 0) {
        setSourceConflict(next.conflicts.map(({ message }) => message).join(" ") || "Se detectaron cambios locales")
      } else {
        setSourcePlan(next)
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "La instalación contiene cambios locales"
      setSourceConflict(`Skillglass detectó cambios locales y no sobrescribirá la instalación. ${message}`)
    } finally {
      setOperationBusy(false)
    }
  }

  const confirmSourceUpdate = async (): Promise<void> => {
    if (operationBridge === undefined || sourcePlan === undefined) return
    setOperationBusy(true)
    setActionError(undefined)
    try {
      const result = await operationBridge.confirm({ planId: sourcePlan.planId })
      if (result.status === "conflict") {
        setSourceConflict(`Skillglass detectó cambios locales y no sobrescribirá la instalación. ${result.message}`)
        setSourcePlan(undefined)
        return
      }
      if (result.status !== "committed") throw new Error(result.message)
      setSourcePlan(undefined)
      onStatus?.(result.message)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "No se pudo actualizar desde el origen")
    } finally {
      setOperationBusy(false)
    }
  }

  return createElement(
    "div",
    { className: "inspector-detail" },
    createElement(
      "header",
      { className: "inspector-detail__header" },
      createElement(SkillTile, {
        adapterId: detail.installation.adapterId,
        className: "inspector-identity-tile",
        skillKey: detail.installation.key,
      }),
      createElement(
        "div",
        { className: "inspector-detail__identity" },
        createElement("p", { className: "inspector-skill-name" }, verbatim(name)),
        createElement(
          "p",
          { className: "inspector-skill-context" },
          ["codex", "folder"].includes(detail.installation.adapterId)
            ? createElement("span", null, adapterLabel(detail.installation.adapterId))
            : verbatim(adapterLabel(detail.installation.adapterId)),
          " · ",
          detail.installation.scope.kind === "project"
            ? createElement("span", null, "Proyecto · ", verbatim(detail.installation.scope.projectId))
            : scopeLabel(detail.installation.scope),
        ),
      ),
      createElement(
        StatusPill,
        {
          ariaLabel: detail.installation.status.source === "read-only"
            ? "Origen: Solo lectura"
            : `Evidencia del nombre: ${evidenceLabel(detail.installation.name.evidence)}`,
          className: "inspector-evidence-pill",
          tone: detail.installation.status.source === "read-only"
            ? "idle"
            : evidenceTone(detail.installation.name.evidence),
        },
        detail.installation.status.source === "read-only"
          ? "Solo lectura"
          : evidenceLabel(detail.installation.name.evidence),
      ),
    ),
    createElement(
      "div",
      { className: "inspector-detail__description" },
      createElement("p", { className: "inspector-description" }, detail.installation.description.state === "known" ? verbatim(description) : description),
      createElement("p", { className: "inspector-path" }, verbatim(path)),
    ),
    createElement(
      "div",
      { className: "inspector-detail__scroll" },
      sourceConflict === undefined
        ? null
        : createElement(
            AccessibleDialog,
            { labelledBy: "source-conflict-title", onDismiss: () => setSourceConflict(undefined) },
              createElement("h3", { id: "source-conflict-title" }, "Conflicto de actualización"),
              createElement("p", null, sourceConflict),
              createElement("button", { type: "button", className: "secondary-action", onClick: () => setSourceConflict(undefined) }, "Cerrar"),
          ),
      sourcePlan === undefined
        ? null
        : createElement(
            AccessibleDialog,
            {
              labelledBy: "source-update-title",
              ...(operationBusy ? {} : { onDismiss: () => setSourcePlan(undefined) }),
            },
              createElement("h3", { id: "source-update-title" }, "Confirmar actualización de origen"),
              createElement(OperationPlanDetails, { plan: sourcePlan }),
              createElement(
                "div",
                { className: "inspector-actions" },
                createElement("button", { type: "button", className: "primary-action", disabled: operationBusy, onClick: () => { void confirmSourceUpdate() } }, operationBusy ? "Actualizando…" : "Actualizar skill"),
                createElement("button", { type: "button", className: "secondary-action", disabled: operationBusy, onClick: () => setSourcePlan(undefined) }, "Cancelar"),
              ),
          ),
      actionError === undefined
        ? null
        : createElement("p", { className: "form-error", role: "alert" }, verbatim(actionError)),
    createElement(
      "section",
      { className: "inspector-section source-section", "aria-labelledby": "source-heading" },
      createElement("h3", { id: "source-heading" }, "Instrucciones"),
      createElement(
        "div",
        { className: "source-switch", "aria-label": "Vista del contenido" },
        createElement("button", {
          type: "button",
          "aria-pressed": sourceView === "preview",
          onClick: () => setSourceView("preview"),
        }, "Vista previa"),
        createElement("button", {
          type: "button",
          "aria-pressed": sourceView === "source",
          onClick: () => setSourceView("source"),
        }, "Fuente"),
      ),
      sourceView === "preview"
        ? createElement(SafeMarkdown, { source: detail.rawEntryContent })
        : createElement(
            "pre",
            { className: "source-code", "aria-label": "Fuente de SKILL.md" },
            createElement("code", null, verbatim(detail.rawEntryContent)),
          ),
    ),
    detail.findings.length === 0
      ? null
      : createElement(
          "section",
          { className: "inspector-section", "aria-labelledby": "findings-heading" },
          createElement("h3", { id: "findings-heading" }, "Hallazgos de validación"),
          createElement(
            "ul",
            { className: "inspector-list" },
            ...detail.findings.map((finding, index) => createElement(
              "li",
              { key: `${finding.code}:${index}`, className: `finding finding-${finding.severity}` },
              createElement("p", { className: "finding-title" }, finding.code.startsWith("FRONTMATTER_")
                ? findingTitle(finding)
                : verbatim(findingTitle(finding))),
              findingTitle(finding) === finding.message
                ? null
                : createElement("p", null, verbatim(finding.message)),
              finding.relativeFile === undefined
                ? null
                : createElement("code", null, verbatim(finding.relativeFile)),
            )),
          ),
        ),
    createElement(
      "section",
      { className: "inspector-section", "aria-labelledby": "status-heading" },
      createElement("h3", { id: "status-heading" }, "Estado"),
      createElement(StatusList, { detail }),
    ),
    createElement(
      "details",
      { className: "inspector-technical" },
      createElement(
        "summary",
        { className: "workspace-disclosure-summary" },
        createElement("span", null, "Detalles técnicos"),
        createElement("span", { "aria-hidden": "true", className: "workspace-disclosure-summary__marker" }),
      ),
      createElement(
        "div",
        { className: "inspector-technical__body" },
        createElement(
          "section",
          { className: "inspector-section", "aria-labelledby": "location-heading" },
          createElement("h3", { id: "location-heading" }, "Archivo y ubicación"),
          createElement(
            "dl",
            { className: "inspector-metadata" },
            createElement("div", null, createElement("dt", null, "Ámbito"), createElement("dd", null, detail.installation.scope.kind === "project" ? createElement("span", null, "Proyecto · ", verbatim(detail.installation.scope.projectId)) : scopeLabel(detail.installation.scope))),
            createElement("div", null, createElement("dt", null, "Carpeta canónica"), createElement("dd", null, verbatim(detail.locationLabel))),
            createElement("div", null, createElement("dt", null, "Archivo de entrada"), createElement("dd", null, verbatim(detail.entryFile))),
            createElement("div", null, createElement("dt", null, "Snapshot"), createElement("dd", null, verbatim(detail.snapshotId))),
            createElement("div", null, createElement("dt", null, "Hash observado"), createElement("dd", null, verbatim(detail.contentHash))),
            createElement("div", null, createElement("dt", null, "Versión declarada"), createElement("dd", null, detail.installation.declaredVersion.state === "known" ? verbatim(detail.installation.declaredVersion.value) : "No declarada")),
          ),
        ),
        createElement(
          "section",
          { className: "inspector-section", "aria-labelledby": "precedence-heading" },
          createElement("h3", { id: "precedence-heading" }, "Copias y ámbito"),
          createElement("p", null, precedenceText(detail)),
          detail.precedence?.status !== "conflict" || (duplicateDetails.length === 0 && !duplicateDetailsIncomplete)
            ? null
            : createElement(
                "div",
                null,
                createElement("p", { className: "evidence-note" }, "Copias encontradas:"),
                createElement("ul", { className: "inspector-list" }, ...duplicateDetails.map((candidate) => createElement(
                  "li", { key: candidate.installation.installationId }, createElement("code", null, verbatim(entryPath(candidate))),
                ))),
                duplicateDetailsIncomplete
                  ? createElement("p", { className: "evidence-note" }, "No se han podido cargar todos los detalles de las copias.")
                  : null,
              ),
          createElement("p", { className: "evidence-note" }, precedenceEvidence(detail)),
          detail.scopeBinding === undefined
            ? createElement("p", { className: "evidence-note" }, "Sin vínculo de runtime proyectado")
            : createElement(
                "p",
                { className: "evidence-note" },
                relationshipLabels[detail.scopeBinding.relationship],
                " · ",
                runtimeText(detail),
                " · ",
                evidenceLabel(detail.scopeBinding.evidence),
                detail.scopeBinding.evidence.source === undefined
                  ? null
                  : createElement("span", null, " · ", verbatim(detail.scopeBinding.evidence.source)),
              ),
        ),
        createElement(
          "section",
          { className: "inspector-section", "aria-labelledby": "provenance-heading" },
          createElement("h3", { id: "provenance-heading" }, "Procedencia"),
          createElement(
            "dl",
            { className: "inspector-metadata" },
            createElement("div", null, createElement("dt", null, "Tipo"), createElement("dd", null, provenanceLabels[detail.provenance.kind])),
            createElement("div", null, createElement("dt", null, "Gestionado por"), createElement("dd", null, managerLabels[detail.provenance.managedBy])),
            createElement("div", null, createElement("dt", null, "Fuente"), createElement("dd", null, detail.provenance.sourceLabel.state === "known" ? verbatim(evidencedValue(detail.provenance.sourceLabel)) : evidencedValue(detail.provenance.sourceLabel))),
            createElement("div", null, createElement("dt", null, "Release"), createElement("dd", null, detail.provenance.release.state === "known" ? verbatim(evidencedValue(detail.provenance.release)) : evidencedValue(detail.provenance.release))),
            createElement("div", null, createElement("dt", null, "Commit"), createElement("dd", null, detail.provenance.commit.state === "known" ? verbatim(evidencedValue(detail.provenance.commit)) : evidencedValue(detail.provenance.commit))),
            createElement("div", null, createElement("dt", null, "Licencia"), createElement("dd", null, detail.provenance.license.state === "known" ? verbatim(evidencedValue(detail.provenance.license)) : evidencedValue(detail.provenance.license))),
          ),
        ),
        createElement(
          "section",
          { className: "inspector-section", "aria-labelledby": "requirements-heading" },
          createElement("h3", { id: "requirements-heading" }, "Requisitos"),
          detail.requirements.length === 0
            ? createElement("p", null, "No se han encontrado requisitos declarados.")
            : createElement("ul", { className: "inspector-list" }, ...detail.requirements.map((requirement, index) => createElement(
                "li",
                { key: `${requirement.kind}:${requirement.name}:${index}` },
                createElement("strong", null, verbatim(requirement.name)),
                createElement("span", null, " · ", verbatim(requirement.resolution), " · ", localize(evidenceLabel(requirement.evidence)).toLocaleLowerCase(getActiveLocale() === "es" ? "es-ES" : "en-US")),
              ))),
        ),
        createElement(
          "section",
          { className: "inspector-section", "aria-labelledby": "files-heading" },
          createElement("h3", { id: "files-heading" }, `Archivos · ${detail.files.length}`),
          createElement("ul", { className: "inspector-list file-list" }, ...detail.files.map((file) => createElement(
            "li",
            { key: file.relativePath },
            createElement("code", null, verbatim(file.relativePath)),
            createElement("span", null, `${file.byteLength} bytes · ${file.kind === "entry" ? "Entrada" : "Recurso"}`),
            createElement("code", { className: "file-hash" }, verbatim(file.sha256)),
          ))),
        ),
      ),
    ),
    ),
    createElement(
      "footer",
      { className: "inspector-footer" },
      createElement(DarkAction, { onClick: () => { void openEntry() } }, "Abrir archivo"),
      detail.capabilities.canEditEntry
        ? createElement("button", {
              className: "visual-action visual-action--quiet",
              onClick: (event) => {
                onEditEntry?.(detail.installation.installationId, event.currentTarget)
              },
              type: "button",
            }, "Editar")
        : createElement(
            "span",
            {
              className: "inspector-read-only-note",
              title: detail.capabilities.unavailableReasons.join(" · "),
            },
            "Solo inspección",
          ),
      detail.capabilities.canUpdateFromSource && (
        detail.installation.status.update === "available" ||
        detail.installation.status.update === "diverged"
      )
        ? createElement(MetalAction, {
            disabled: operationBusy,
            onClick: () => { void prepareSourceUpdate() },
          }, "Actualizar")
        : null,
    ),
  )
}

export interface InspectorProps {
  readonly installationId?: string
  readonly inventoryBridge: ForgeBridge["inventory"]
  readonly operationBridge?: ForgeBridge["operations"]
  readonly onEditEntry?: (installationId: string, trigger: HTMLElement) => void
  readonly onStatus?: (message: string) => void
  readonly revision?: number
}

export function Inspector({ installationId, inventoryBridge, operationBridge, onEditEntry, onStatus, revision = 0 }: InspectorProps) {
  const [detail, setDetail] = useState<InstallationDetailDto>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let current = true
    if (installationId === undefined) {
      setDetail(undefined)
      setError(undefined)
      setLoading(false)
      return () => { current = false }
    }
    setLoading(true)
    setError(undefined)
    inventoryBridge.inspect({ installationId }).then((next) => {
      if (current) setDetail(next)
    }).catch((reason: unknown) => {
      if (current) {
        setDetail(undefined)
        setError(reason instanceof Error
          ? reason.message
          : "No se pudo inspeccionar la instalación")
      }
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [installationId, inventoryBridge, revision])

  const content = useMemo(() => {
    if (installationId === undefined) return createElement(EmptyInspector)
    if (error !== undefined) return createElement("p", { role: "alert", className: "form-error" }, verbatim(error))
    if (detail === undefined) return loading
      ? createElement("p", { role: "status" }, "Cargando inspector…")
      : createElement(EmptyInspector)
    return createElement(Inspection, {
      detail,
      inventoryBridge,
      ...(operationBridge === undefined ? {} : { operationBridge }),
      ...(onEditEntry === undefined ? {} : { onEditEntry }),
      ...(onStatus === undefined ? {} : { onStatus }),
    })
  }, [detail, error, installationId, inventoryBridge, loading, onEditEntry, onStatus, operationBridge])

  return createElement(
    "aside",
    {
      className: `inspector ${installationId === undefined ? "inspector--empty" : "inspector--selected"}`,
      "aria-labelledby": "inspector-title",
    },
    createElement("h2", { className: "visually-hidden", id: "inspector-title" }, "Inspector"),
    content,
  )
}
