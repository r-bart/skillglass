import { type ReactNode } from "react"

import type { OperationPlanDto } from "@forge/contracts"
import { createElement, verbatim } from "./i18n.js"

function scopeLabel(scope: OperationPlanDto["affectedScopes"][number]): ReactNode {
  return scope.kind === "global"
    ? "Global"
    : createElement("span", null, "Proyecto ", verbatim(scope.projectId))
}

function issueList(title: string, issues: OperationPlanDto["warnings"], className: string): ReactNode {
  if (issues.length === 0) return null
  return createElement(
    "section",
    { className: `operation-plan-section ${className}` },
    createElement("h4", null, title),
    createElement("ul", null, ...issues.map((issue, index) => createElement(
      "li",
      { key: `${issue.code}:${issue.relativePath ?? ""}:${index}` },
      verbatim(issue.message),
      issue.relativePath === undefined ? null : createElement("code", null, verbatim(issue.relativePath)),
    ))),
  )
}

export function OperationPlanDetails({ plan }: { readonly plan: OperationPlanDto }): ReactNode {
  return createElement(
    "div",
    { className: "operation-plan-details" },
    createElement("p", { className: "operation-summary" }, verbatim(plan.summary)),
    plan.destinationLabel === undefined
      ? null
      : createElement("p", { className: "inspector-path" }, verbatim(plan.destinationLabel)),
    createElement("h4", null, "Cambios exactos"),
    createElement(
      "ul",
      { className: "operation-diff" },
      ...plan.affectedEntries.map((entry) => createElement(
        "li",
        { key: `${entry.action}:${entry.rootId}:${entry.relativePath}` },
        createElement("span", { className: `diff-action diff-${entry.action}` }, entry.action === "create" ? "Crear" : entry.action === "delete" ? "Eliminar" : "Modificar"),
        createElement("code", null, verbatim(entry.relativePath)),
      )),
    ),
    issueList("Precondiciones", plan.preconditions, "operation-preconditions"),
    issueList("Avisos", plan.warnings, "operation-warnings"),
    issueList("Conflictos", plan.conflicts, "operation-conflicts"),
    createElement(
      "details",
      { className: "operation-technical" },
      createElement("summary", null, "Detalles técnicos"),
      createElement(
        "dl",
        { className: "operation-facts" },
        createElement("div", null, createElement("dt", null, "Ámbito"), createElement("dd", null, plan.affectedScopes.length === 0
          ? "Sin cambio de ámbito"
          : plan.affectedScopes.flatMap((scope, index) => index === 0 ? [scopeLabel(scope)] : [", ", scopeLabel(scope)]))),
        createElement("div", null, createElement("dt", null, "Deshacer"), createElement("dd", null, plan.undo === "persistent" ? "Disponible tras reiniciar" : "No disponible")),
        createElement("div", null, createElement("dt", null, "Cancelación"), createElement("dd", null, "Disponible antes de confirmar. La escritura no se interrumpe una vez iniciada.")),
        createElement("div", null, createElement("dt", null, "Recuperación"), createElement("dd", null, "Skillglass conserva una copia de recuperación y la comprueba al volver a abrir.")),
      ),
    ),
  )
}
