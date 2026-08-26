import {
  createElement,
  useEffect,
  useMemo,
  useRef,
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
import { CodeEditor } from "../CodeEditor.js"
import { OperationPlanDetails } from "../OperationPlanDetails.js"
import { TextDiff } from "../TextDiff.js"
import {
  DarkAction,
  MetalAction,
  SkillTile,
  StatusPill,
} from "../VisualPrimitives.js"

type Finding = InstallationDetailDto["findings"][number]
type SourceView = "preview" | "source"

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
  "read-only": "Solo lectura",
  modified: "Modificada",
  unknown: "Origen desconocido",
}

const updateLabels: Record<InventoryItemDto["status"]["update"], string> = {
  current: "Actualizada",
  available: "Actualización disponible",
  diverged: "Cambios locales",
  unavailable: "No disponible",
  unknown: "No observado",
}

const provenanceLabels: Record<InstallationDetailDto["provenance"]["kind"], string> = {
  local: "Local",
  "forge-import": "Importada por Forge",
  registry: "Registro",
  package: "Paquete",
  plugin: "Plugin",
  system: "Sistema",
  unknown: "Procedencia desconocida",
}

const managerLabels: Record<InstallationDetailDto["provenance"]["managedBy"], string> = {
  forge: "Forge",
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
      return `${precedence.candidateInstallationIds.length} candidatas coexisten y el adaptador no acredita una ganadora.`
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

function precedenceEvidence(detail: InstallationDetailDto): string {
  const evidence = detail.precedence?.reason.evidence
  if (evidence === undefined) return "Sin evidencia de resolución proyectada"
  const reason = detail.precedence?.reason.state === "known"
    ? detail.precedence.reason.value
    : "Razón no observada"
  return `${reason} · ${evidenceLabel(evidence)}${evidence.source === undefined ? "" : ` · ${evidence.source}`}`
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

function markdownBody(source: string): string {
  const opening = /^(?:\uFEFF)?---(?:\r\n|\n|\r)/u.exec(source)
  if (opening === null) return source
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|\r|$)/gmu
  closing.lastIndex = opening[0].length
  const match = closing.exec(source)
  return match === null ? source : source.slice(match.index + match[0].length)
}

/**
 * Intentionally small read-only renderer. Every token is emitted as React text;
 * raw HTML, links, images, directives and scripts are never interpreted.
 */
export function SafeMarkdown({ source }: { readonly source: string }) {
  const nodes: ReactNode[] = []
  const lines = markdownBody(source).split(/\r\n|\n|\r/u)
  let code: string[] | undefined
  for (const line of lines) {
    if (/^\s*```/u.test(line)) {
      if (code === undefined) code = []
      else {
        nodes.push(createElement("pre", { key: nodes.length }, createElement("code", null, code.join("\n"))))
        code = undefined
      }
      continue
    }
    if (code !== undefined) {
      code.push(line)
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line)
    if (heading !== null) {
      const level = Math.min(6, heading[1]?.length ?? 3)
      nodes.push(createElement(`h${level}`, { key: nodes.length }, heading[2]))
      continue
    }
    const listItem = /^\s*[-*+]\s+(.+)$/u.exec(line)
    if (listItem !== null) {
      nodes.push(createElement("ul", { key: nodes.length }, createElement("li", null, listItem[1])))
      continue
    }
    if (line.trim().length > 0) {
      nodes.push(createElement("p", { key: nodes.length }, line))
    }
  }
  if (code !== undefined) {
    nodes.push(createElement("pre", { key: nodes.length }, createElement("code", null, code.join("\n"))))
  }
  return createElement("div", { className: "safe-markdown" }, ...nodes)
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
    ["Estado del harness", runtimeLabels[status.runtimeState]],
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
  onStatus,
}: {
  readonly detail: InstallationDetailDto
  readonly inventoryBridge: ForgeBridge["inventory"]
  readonly operationBridge?: ForgeBridge["operations"]
  readonly onStatus?: (message: string) => void
}) {
  const [sourceView, setSourceView] = useState<SourceView>("preview")
  const [actionError, setActionError] = useState<string>()
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(detail.rawEntryContent)
  const [plan, setPlan] = useState<OperationPlanDto>()
  const [sourcePlan, setSourcePlan] = useState<OperationPlanDto>()
  const [sourceConflict, setSourceConflict] = useState<string>()
  const [operationBusy, setOperationBusy] = useState(false)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const reviewButtonRef = useRef<HTMLButtonElement>(null)
  const path = entryPath(detail)
  const name = detail.installation.name.state === "known"
    ? detail.installation.name.value
    : detail.installation.key
  const description = detail.installation.description.state === "known"
    ? detail.installation.description.value
    : "Descripción no observada"

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

  const review = async (): Promise<void> => {
    if (operationBridge === undefined) return
    setOperationBusy(true)
    setActionError(undefined)
    try {
      setPlan(await operationBridge.plan({
        kind: "update-entry-content",
        installationId: detail.installation.installationId,
        expectedSnapshotId: detail.snapshotId,
        content,
      }))
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "No se pudo preparar la actualización")
    } finally {
      setOperationBusy(false)
    }
  }

  const confirm = async (): Promise<void> => {
    if (operationBridge === undefined || plan === undefined) return
    setOperationBusy(true)
    setActionError(undefined)
    try {
      const result = await operationBridge.confirm({ planId: plan.planId })
      if (result.status !== "committed") throw new Error(result.message)
      setPlan(undefined)
      setEditing(false)
      onStatus?.(result.message)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "No se pudo actualizar la skill")
    } finally {
      setOperationBusy(false)
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
      setSourceConflict(`Forge detectó cambios locales y no sobrescribirá la instalación. ${message}`)
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
        setSourceConflict(`Forge detectó cambios locales y no sobrescribirá la instalación. ${result.message}`)
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

  const closeContentPlan = (): void => {
    setPlan(undefined)
    requestAnimationFrame(() => reviewButtonRef.current?.focus())
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
        createElement("p", { className: "inspector-skill-name" }, name),
        createElement(
          "p",
          { className: "inspector-skill-context" },
          `${adapterLabel(detail.installation.adapterId)} · ${scopeLabel(detail.installation.scope)}`,
        ),
      ),
      createElement(
        StatusPill,
        {
          ariaLabel: `Evidencia del nombre: ${evidenceLabel(detail.installation.name.evidence)}`,
          className: "inspector-evidence-pill",
          tone: evidenceTone(detail.installation.name.evidence),
        },
        evidenceLabel(detail.installation.name.evidence),
      ),
    ),
    createElement(
      "div",
      { className: "inspector-detail__description" },
      createElement("p", { className: "inspector-description" }, description),
    ),
    editing && plan === undefined
      ? createElement(
          AccessibleDialog,
          {
            className: "editor-sheet",
            describedBy: "editor-dialog-description",
            labelledBy: "editor-dialog-title",
            onDismiss: () => { setEditing(false); setPlan(undefined) },
            returnFocus: editButtonRef,
          },
            createElement(
              "header",
              { className: "sheet-header editor-sheet__header" },
              createElement(SkillTile, {
                adapterId: detail.installation.adapterId,
                className: "editor-sheet__tile",
                skillKey: detail.installation.key,
              }),
              createElement(
                "div",
                { className: "editor-sheet__identity" },
                createElement("h3", { id: "editor-dialog-title" }, `Editar ${name}`),
                createElement(
                  "p",
                  { id: "editor-dialog-description" },
                  `${adapterLabel(detail.installation.adapterId)} · ${scopeLabel(detail.installation.scope)} · editable`,
                ),
              ),
              createElement(StatusPill, { tone: "ok" }, "Editable"),
            ),
            createElement(
              "div",
              { className: "editor-sheet__body" },
              createElement(
                "section",
                { className: "entry-editor", "aria-labelledby": "editor-content-label" },
                createElement("p", { className: "editor-label", id: "editor-content-label" }, "Contenido de SKILL.md"),
                createElement(CodeEditor, { ariaLabel: "Contenido", value: content, onChange: setContent }),
              ),
              createElement(
                "aside",
                { className: "editor-sheet__facts", "aria-labelledby": "editor-context-title" },
                createElement("h4", { className: "editor-label", id: "editor-context-title" }, "Contexto observado"),
                createElement(
                  "dl",
                  null,
                  createElement("div", null, createElement("dt", null, "Skill"), createElement("dd", null, name)),
                  createElement("div", null, createElement("dt", null, "Ubicación"), createElement("dd", null, path)),
                  createElement("div", null, createElement("dt", null, "Gestión"), createElement("dd", null, managerLabels[detail.provenance.managedBy])),
                  createElement("div", null, createElement("dt", null, "Snapshot"), createElement("dd", null, detail.snapshotId)),
                ),
                createElement(
                  "p",
                  { className: "editor-sheet__safety" },
                  "Forge prepara un diff exacto antes de escribir y conserva una operación reversible cuando el backend lo acredita.",
                ),
              ),
            ),
            actionError === undefined
              ? null
              : createElement("p", { className: "form-error editor-sheet__error", role: "alert" }, actionError),
            createElement(
              "footer",
              { className: "sheet-footer editor-sheet__footer" },
              createElement("p", { className: "editor-sheet__note" }, "Los cambios aún no se han escrito en disco."),
              createElement("button", {
                className: "secondary-action",
                disabled: operationBusy,
                onClick: () => { setEditing(false); setPlan(undefined) },
                type: "button",
              }, "Cancelar"),
              createElement("button", {
                ref: reviewButtonRef,
                className: "primary-action",
                type: "button",
                disabled: operationBusy || content === detail.rawEntryContent,
                onClick: () => { void review() },
              }, operationBusy ? "Preparando…" : "Revisar cambios"),
            ),
        )
      : null,
    createElement(
      "div",
      { className: "inspector-detail__scroll" },
      plan === undefined
        ? null
        : createElement(
            AccessibleDialog,
            {
              labelledBy: "update-dialog-title",
              returnFocus: reviewButtonRef,
              ...(operationBusy ? {} : { onDismiss: closeContentPlan }),
            },
              createElement("h3", { id: "update-dialog-title" }, "Confirmar actualización"),
              createElement(OperationPlanDetails, { plan }),
              createElement("p", { className: "inspector-path" }, path),
              createElement("h4", null, "Diferencia de contenido"),
              createElement(TextDiff, { before: detail.rawEntryContent, after: content }),
              createElement(
                "div",
                { className: "inspector-actions" },
                createElement("button", {
                  type: "button",
                  className: "primary-action",
                  disabled: operationBusy,
                  onClick: () => { void confirm() },
                }, operationBusy ? "Actualizando…" : "Actualizar skill"),
                createElement("button", {
                  type: "button",
                  className: "secondary-action",
                  disabled: operationBusy,
                  onClick: closeContentPlan,
                }, "Volver"),
              ),
          ),
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
      actionError === undefined || editing
        ? null
        : createElement("p", { className: "form-error", role: "alert" }, actionError),
      createElement(
        "section",
        { className: "inspector-section", "aria-labelledby": "location-heading" },
        createElement("h3", { id: "location-heading" }, "Ubicación"),
        createElement("p", { className: "inspector-path" }, path),
        createElement(
          "dl",
          { className: "inspector-metadata" },
          createElement("div", null, createElement("dt", null, "Runtime"), createElement("dd", null, adapterLabel(detail.installation.adapterId))),
          createElement("div", null, createElement("dt", null, "Ámbito"), createElement("dd", null, scopeLabel(detail.installation.scope))),
          createElement("div", null, createElement("dt", null, "Carpeta canónica"), createElement("dd", null, detail.locationLabel)),
          createElement("div", null, createElement("dt", null, "Archivo de entrada"), createElement("dd", null, detail.entryFile)),
          createElement("div", null, createElement("dt", null, "Snapshot"), createElement("dd", null, detail.snapshotId)),
          createElement("div", null, createElement("dt", null, "Hash observado"), createElement("dd", null, detail.contentHash)),
          createElement("div", null, createElement("dt", null, "Versión declarada"), createElement("dd", null, detail.installation.declaredVersion.state === "known" ? detail.installation.declaredVersion.value : "No declarada")),
        ),
      ),
    createElement(
      "section",
      { className: "inspector-section", "aria-labelledby": "status-heading" },
      createElement("h3", { id: "status-heading" }, "Estados independientes"),
      createElement(StatusList, { detail }),
    ),
    createElement(
      "section",
      { className: "inspector-section", "aria-labelledby": "precedence-heading" },
      createElement("h3", { id: "precedence-heading" }, "Ámbito y precedencia"),
      createElement("p", null, precedenceText(detail)),
      detail.precedence === undefined || detail.precedence.candidateInstallationIds.length === 0
        ? null
        : createElement("p", { className: "inspector-path" }, `Candidatas: ${detail.precedence.candidateInstallationIds.join(", ")}`),
      createElement("p", { className: "evidence-note" }, precedenceEvidence(detail)),
      detail.scopeBinding === undefined
        ? createElement("p", { className: "evidence-note" }, "Sin vínculo de runtime proyectado")
        : createElement(
            "p",
            { className: "evidence-note" },
            `Vínculo ${detail.scopeBinding.relationship} · ${runtimeLabels[detail.installation.status.runtimeState]} · ${evidenceLabel(detail.scopeBinding.evidence)}${detail.scopeBinding.evidence.source === undefined ? "" : ` · ${detail.scopeBinding.evidence.source}`}`,
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
        createElement("div", null, createElement("dt", null, "Fuente"), createElement("dd", null, evidencedValue(detail.provenance.sourceLabel))),
        createElement("div", null, createElement("dt", null, "Release"), createElement("dd", null, evidencedValue(detail.provenance.release))),
        createElement("div", null, createElement("dt", null, "Commit"), createElement("dd", null, evidencedValue(detail.provenance.commit))),
        createElement("div", null, createElement("dt", null, "Licencia"), createElement("dd", null, evidencedValue(detail.provenance.license))),
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
              createElement("p", { className: "finding-title" }, findingTitle(finding)),
              findingTitle(finding) === finding.message
                ? null
                : createElement("p", null, finding.message),
              finding.relativeFile === undefined
                ? null
                : createElement("code", null, finding.relativeFile),
            )),
          ),
        ),
    createElement(
      "section",
      { className: "inspector-section", "aria-labelledby": "requirements-heading" },
      createElement("h3", { id: "requirements-heading" }, "Requisitos"),
      detail.requirements.length === 0
        ? createElement("p", null, "Dependencias no observadas; un resultado vacío no demuestra que no existan.")
        : createElement(
            "ul",
            { className: "inspector-list" },
            ...detail.requirements.map((requirement, index) => createElement(
              "li",
              { key: `${requirement.kind}:${requirement.name}:${index}` },
              createElement("strong", null, requirement.name),
              createElement("span", null, ` · ${requirement.resolution} · ${evidenceLabel(requirement.evidence).toLocaleLowerCase("es-ES")}`),
            )),
          ),
    ),
    createElement(
      "section",
      { className: "inspector-section", "aria-labelledby": "files-heading" },
      createElement("h3", { id: "files-heading" }, `Archivos · ${detail.files.length}`),
      createElement(
        "ul",
        { className: "inspector-list file-list" },
        ...detail.files.map((file) => createElement(
          "li",
          { key: file.relativePath },
          createElement("code", null, file.relativePath),
          createElement("span", null, `${file.byteLength} bytes · ${file.kind === "entry" ? "Entrada" : "Recurso"}`),
          createElement("code", { className: "file-hash" }, file.sha256),
        )),
      ),
    ),
    createElement(
      "section",
      { className: "inspector-section source-section", "aria-labelledby": "source-heading" },
      createElement("h3", { id: "source-heading" }, "Contenido de SKILL.md"),
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
            createElement("code", null, detail.rawEntryContent),
          ),
    ),
    ),
    createElement(
      "footer",
      { className: "inspector-footer" },
      editing
        ? createElement("span", { className: "inspector-read-only-note" }, "Edición abierta")
        : createElement(DarkAction, { onClick: () => { void openEntry() } }, "Abrir archivo"),
      !editing && detail.capabilities.canEditEntry
        ? createElement("button", {
              ref: editButtonRef,
              className: "visual-action visual-action--quiet",
              onClick: () => {
                setContent(detail.rawEntryContent)
                setEditing(true)
                setPlan(undefined)
              },
              type: "button",
            }, "Editar")
        : !editing
          ? createElement(
              "span",
              {
                className: "inspector-read-only-note",
                title: detail.capabilities.unavailableReasons.join(" · "),
              },
              "Solo inspección",
            )
          : null,
      !editing && detail.capabilities.canUpdateFromSource && (
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
  readonly onStatus?: (message: string) => void
  readonly revision?: number
}

export function Inspector({ installationId, inventoryBridge, operationBridge, onStatus, revision = 0 }: InspectorProps) {
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
    if (error !== undefined) return createElement("p", { role: "alert", className: "form-error" }, error)
    if (detail === undefined) return loading
      ? createElement("p", { role: "status" }, "Cargando inspector…")
      : createElement(EmptyInspector)
    return createElement(Inspection, {
      detail,
      inventoryBridge,
      ...(operationBridge === undefined ? {} : { operationBridge }),
      ...(onStatus === undefined ? {} : { onStatus }),
    })
  }, [detail, error, installationId, inventoryBridge, loading, onStatus, operationBridge])

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
