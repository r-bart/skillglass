import { type ReactNode } from "react"

import type { OperationPlanDto } from "@forge/contracts"
import { createElement } from "./i18n.js"

function scopeLabel(scope: OperationPlanDto["affectedScopes"][number]): string {
  return scope.kind === "global" ? "Global" : `Proyecto ${scope.projectId}`
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
      issue.message,
      issue.relativePath === undefined ? null : createElement("code", null, issue.relativePath),
    ))),
  )
}

export function OperationPlanDetails({ plan }: { readonly plan: OperationPlanDto }): ReactNode {
  return createElement(
    "div",
    { className: "operation-plan-details" },
    createElement("p", { className: "operation-summary" }, plan.summary),
    plan.destinationLabel === undefined
      ? null
      : createElement("p", { className: "inspector-path" }, plan.destinationLabel),
    createElement(
      "dl",
      { className: "operation-facts" },
      createElement("div", null, createElement("dt", null, "Ámbito"), createElement("dd", null, plan.affectedScopes.map(scopeLabel).join(", ") || "Sin cambio de ámbito")),
      createElement("div", null, createElement("dt", null, "Deshacer"), createElement("dd", null, plan.undo === "persistent" ? "Disponible tras reiniciar" : "No disponible")),
      createElement("div", null, createElement("dt", null, "Cancelación"), createElement("dd", null, "Disponible antes de confirmar; no durante la escritura atómica")),
      createElement("div", null, createElement("dt", null, "Recuperación"), createElement("dd", null, "Persistente; Skillglass la comprueba al volver a arrancar")),
    ),
    createElement("h4", null, "Cambios exactos"),
    createElement(
      "ul",
      { className: "operation-diff" },
      ...plan.affectedEntries.map((entry) => createElement(
        "li",
        { key: `${entry.action}:${entry.rootId}:${entry.relativePath}` },
        createElement("span", { className: `diff-action diff-${entry.action}` }, entry.action === "create" ? "Crear" : entry.action === "delete" ? "Eliminar" : "Modificar"),
        createElement("code", null, entry.relativePath),
      )),
    ),
    issueList("Precondiciones", plan.preconditions, "operation-preconditions"),
    issueList("Avisos", plan.warnings, "operation-warnings"),
    issueList("Conflictos", plan.conflicts, "operation-conflicts"),
  )
}
