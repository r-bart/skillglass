import type { OnboardingStateDto, RootCandidateDto } from "@forge/contracts"
import type { ReactNode } from "react"

import { createElement } from "../i18n.js"
import {
  CompactSurfaceHeader,
  MetalAction,
  QuietAction,
  SectionLabel,
  StatusPill,
} from "../VisualPrimitives.js"

const ACCESS_LABELS: Record<RootCandidateDto["access"], string> = {
  "read-write": "Lectura y escritura",
  "read-only": "Solo lectura",
  missing: "No disponible",
  denied: "Acceso denegado",
}

const DISCOVERY_LABELS: Record<RootCandidateDto["discovery"]["kind"], string> = {
  observed: "observada",
  derived: "derivada",
  inferred: "inferida",
  unknown: "desconocida",
}

export interface SourceApprovalStepProps {
  readonly state: OnboardingStateDto | null
  readonly selectedCandidateIds: ReadonlySet<string>
  readonly busy: boolean
  readonly error: string | null
  readonly onToggle: (candidateId: string) => void
  readonly onAddFolder: () => void
  readonly onAddProject: () => void
  readonly onApprove: () => void
  readonly mode?: "setup" | "management"
}

/**
 * Presents root approval without owning filesystem or scan behavior. The parent
 * keeps state and performs approval, so submitting again after an error retries
 * with the same selected candidate IDs.
 */
export function SourceApprovalStep({
  state,
  selectedCandidateIds,
  busy,
  error,
  onToggle,
  onAddFolder,
  onAddProject,
  onApprove,
  mode = "setup",
}: SourceApprovalStepProps): ReactNode {
  const managing = mode === "management"
  return createElement(
    "section",
    {
      "aria-labelledby": "source-approval-title",
      className: "content-surface onboarding-surface",
      "data-scroll-panel": "onboarding",
    },
    createElement(CompactSurfaceHeader, {
      className: "onboarding-header",
      description: managing
        ? "Revisa las carpetas globales y los proyectos incluidos. Al guardar, Skillglass volverá a buscar cambios en las ubicaciones aprobadas."
        : "Selecciona las carpetas globales y los proyectos que quieres incluir. Skillglass esperará tu aprobación antes de buscar.",
      eyebrow: managing ? "Gestión" : "Prepara tu inventario",
      title: managing ? "Carpetas de skills" : "Elige dónde buscar tus skills",
      titleId: "source-approval-title",
    }),
    state === null
      ? createElement("p", { className: "surface-note", role: "status" }, "Detectando ubicaciones compatibles…")
      : createElement(
          "form",
          {
            className: "root-form",
            onSubmit: (event) => {
              event.preventDefault()
              onApprove()
            },
          },
          createElement(
            "div",
            { className: "onboarding-card" },
            createElement(
              "fieldset",
              { className: "root-fieldset", disabled: busy },
              createElement(
                "legend",
                null,
                createElement(SectionLabel, { as: "span" }, "Ubicaciones que Skillglass puede observar"),
              ),
              createElement(
                "div",
                { className: "root-list" },
                ...state.proposedRoots.map((root) => createElement(
                  "label",
                  { className: "root-option glass-selectable-row", key: root.candidateId },
                  createElement("input", {
                    checked: selectedCandidateIds.has(root.candidateId),
                    onChange: () => onToggle(root.candidateId),
                    type: "checkbox",
                  }),
                  createElement(
                    "span",
                    { className: "root-copy" },
                    createElement("span", { className: "root-name" }, root.displayName),
                    createElement("span", { className: "root-path" }, root.displayPath),
                    createElement(
                      "span",
                      { className: "root-meta" },
                      createElement(StatusPill, {
                        tone: root.access === "read-write" ? "ok" : root.access === "denied" ? "danger" : "idle",
                      }, ACCESS_LABELS[root.access]),
                      createElement(
                        "span",
                        { className: "root-evidence" },
                        `Evidencia: ${DISCOVERY_LABELS[root.discovery.kind]}`,
                      ),
                    ),
                  ),
                )),
              ),
            ),
            createElement(
              "div",
              { className: "onboarding-card__footer" },
              createElement(
                "div",
                { className: "root-secondary-actions" },
                createElement(QuietAction, { disabled: busy, onClick: onAddFolder }, "Añadir carpeta…"),
                createElement(QuietAction, { disabled: busy, onClick: onAddProject }, "Añadir proyecto Codex…"),
              ),
              createElement(
                MetalAction,
                { disabled: busy || selectedCandidateIds.size === 0, type: "submit" },
                busy
                  ? managing ? "Volviendo a escanear…" : "Buscando skills…"
                  : managing ? "Guardar y volver a escanear" : "Buscar mis skills",
              ),
            ),
          ),
          createElement(
            "p",
            { className: "root-safety-note" },
            createElement("span", { "aria-hidden": "true", className: "root-safety-note__icon" }, "✓"),
            createElement(
              "span",
              null,
              "Elige las carpetas mediante el diálogo del sistema. Todo permanece en este dispositivo y Skillglass nunca solicita privilegios de administrador.",
            ),
          ),
        ),
    error === null ? null : createElement("p", { className: "form-error", role: "alert" }, error),
  )
}
