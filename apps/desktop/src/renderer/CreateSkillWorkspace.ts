import type { ForgeBridge, OnboardingStateDto, OperationPlanDto, OperationResultDto } from "@forge/contracts"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react"

import { AccessibleDialog } from "./AccessibleDialog.js"
import { CodeEditor } from "./CodeEditor.js"
import { OperationPlanDetails } from "./OperationPlanDetails.js"
import { SafeMarkdown } from "./SafeMarkdown.js"
import { createTextDiffModel, TextDiff } from "./TextDiff.js"
import { DangerAction, QuietAction, SkillTile, StatusPill } from "./VisualPrimitives.js"
import { createElement, getActiveLocale, verbatim, type Locale } from "./i18n.js"

type WritableRoot = OnboardingStateDto["approvedRoots"][number]
type CreateMode = "preview" | "code" | "changes"

export interface CreateSkillWorkspaceProps {
  readonly operationBridge: ForgeBridge["operations"]
  readonly roots: readonly WritableRoot[]
  readonly onBack: () => void
  readonly onCreated: (installationId: string) => void
  readonly onStatus?: (message: string) => void
  readonly onCloseStateChange?: (state: "clean" | "dirty" | "busy") => void
}

const skillKeyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

function titleFromKey(key: string): string {
  return key.split("-").filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ")
}

function template(skillKey: string, description: string, locale: Locale): string {
  const body = locale === "es"
    ? `Describe aquí las instrucciones que debe seguir el agente.\n\n## Cuándo usar esta skill\n\nExplica las señales concretas que deben activar esta skill.\n\n## Flujo de trabajo\n\n1. Define el primer paso verificable.\n2. Añade las decisiones y límites importantes.\n3. Indica cómo comprobar que el trabajo está terminado.`
    : `Describe the instructions the agent should follow.\n\n## When to use this skill\n\nExplain the specific signals that should trigger this skill.\n\n## Workflow\n\n1. Define the first verifiable step.\n2. Add the important decisions and boundaries.\n3. Explain how to verify that the work is complete.`
  return `---\nname: ${skillKey}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${titleFromKey(skillKey)}\n\n${body}\n`
}

function planCanApply(plan: OperationPlanDto | undefined): boolean {
  return plan?.kind === "create-skill" &&
    plan.status === "planned" &&
    plan.conflicts.length === 0 &&
    Date.parse(plan.expiresAt) > Date.now()
}

function failureMessage(result: OperationResultDto): string {
  const issues = result.issues.map(({ message }) => message).filter((message) => message !== result.message)
  return [result.message, ...issues].join(" ")
}

export function CreateSkillWorkspace(props: CreateSkillWorkspaceProps) {
  const writableRoots = props.roots.filter((root) => root.access === "read-write")
  const [stage, setStage] = useState<"details" | "authoring">("details")
  const [skillKey, setSkillKey] = useState("")
  const [description, setDescription] = useState("")
  const [rootId, setRootId] = useState(writableRoots[0]?.rootId ?? "")
  const [draft, setDraft] = useState("")
  const [mode, setMode] = useState<CreateMode>("code")
  const [plan, setPlan] = useState<OperationPlanDto>()
  const [plannedDraft, setPlannedDraft] = useState<string>()
  const [planning, setPlanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string>()
  const [discardOpen, setDiscardOpen] = useState(false)
  const initialRootIdRef = useRef(writableRoots[0]?.rootId ?? "")
  const exitTriggerRef = useRef<HTMLElement>(null)
  const codeTabRef = useRef<HTMLButtonElement>(null)
  const previewTabRef = useRef<HTMLButtonElement>(null)
  const changesTabRef = useRef<HTMLButtonElement>(null)
  const selectedRoot = writableRoots.find((root) => root.rootId === rootId)
  const busy = planning || applying
  const dirty = skillKey !== "" ||
    description !== "" ||
    rootId !== initialRootIdRef.current ||
    draft !== ""
  const diff = useMemo(() => createTextDiffModel("", draft), [draft])
  const changeCount = diff.added + diff.removed
  const planAvailable = plan !== undefined && planCanApply(plan) && plannedDraft === draft && plan.targetRootId === rootId

  useEffect(() => {
    props.onCloseStateChange?.(busy ? "busy" : dirty ? "dirty" : "clean")
  }, [busy, description, dirty, draft, props.onCloseStateChange, rootId, skillKey, stage])

  const startAuthoring = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const normalizedKey = skillKey.trim()
    const normalizedDescription = description.trim()
    if (!skillKeyPattern.test(normalizedKey)) {
      setError("Usa minúsculas, números y guiones; por ejemplo, revisar-contratos.")
      return
    }
    if (normalizedDescription.length === 0) {
      setError("Añade una descripción que explique cuándo debe usarla el agente.")
      return
    }
    if (selectedRoot === undefined) {
      setError("Elige una carpeta aprobada con escritura.")
      return
    }
    setSkillKey(normalizedKey)
    setDescription(normalizedDescription)
    setDraft(template(normalizedKey, normalizedDescription, getActiveLocale()))
    setError(undefined)
    setStage("authoring")
    setMode("code")
  }

  const review = async (): Promise<void> => {
    if (!dirty || busy || selectedRoot === undefined) return
    if (planAvailable) {
      setMode("changes")
      return
    }
    const requestedDraft = draft
    const requestedRootId = rootId
    setPlanning(true)
    setError(undefined)
    setPlan(undefined)
    setPlannedDraft(undefined)
    try {
      const nextPlan = await props.operationBridge.plan({
        kind: "create-skill",
        targetRootId: requestedRootId,
        skillKey,
        content: requestedDraft,
      })
      if (!planCanApply(nextPlan)) {
        setError(nextPlan.conflicts.map(({ message }) => message).join(" ") || "No se pudo preparar una creación segura.")
        return
      }
      if (draft !== requestedDraft || rootId !== requestedRootId) {
        setError("El borrador cambió mientras se preparaba la revisión. Vuelve a revisarlo.")
        return
      }
      setPlan(nextPlan)
      setPlannedDraft(requestedDraft)
      setMode("changes")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo preparar la creación")
    } finally {
      setPlanning(false)
    }
  }

  const confirm = async (): Promise<void> => {
    if (!planAvailable || applying || plan === undefined) return
    setApplying(true)
    setError(undefined)
    try {
      const result = await props.operationBridge.confirm({ planId: plan.planId })
      if (result.status !== "committed") {
        setError(failureMessage(result))
        setPlan(undefined)
        setPlannedDraft(undefined)
        return
      }
      const installationId = result.installationIds[0]
      if (installationId === undefined) {
        setError("La skill se creó, pero no se pudo abrir desde el inventario.")
        return
      }
      props.onStatus?.(result.message)
      props.onCreated(installationId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo crear la skill")
    } finally {
      setApplying(false)
    }
  }

  const requestExit = (trigger: HTMLElement): void => {
    if (busy) return
    if (!dirty) {
      props.onBack()
      return
    }
    exitTriggerRef.current = trigger
    setDiscardOpen(true)
  }

  const changeMode = (nextMode: Exclude<CreateMode, "changes">): void => {
    if (busy) return
    setMode(nextMode)
  }

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    const tabs = [
      { mode: "preview" as const, ref: previewTabRef },
      { mode: "code" as const, ref: codeTabRef },
      ...(dirty ? [{ mode: "changes" as const, ref: changesTabRef }] : []),
    ]
    const current = tabs.findIndex(({ ref }) => ref.current === event.currentTarget)
    if (current < 0) return
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
      : event.key === "ArrowRight" ? (current + 1) % tabs.length
      : (current - 1 + tabs.length) % tabs.length
    const next = tabs[nextIndex]
    if (next === undefined) return
    event.preventDefault()
    next.ref.current?.focus()
    if (next.mode === "changes") void review()
    else changeMode(next.mode)
  }

  const discardDialog = discardOpen ? createElement(AccessibleDialog, {
    describedBy: "discard-create-description", labelledBy: "discard-create-title",
    onDismiss: () => setDiscardOpen(false), returnFocus: exitTriggerRef,
  },
  createElement("h2", { id: "discard-create-title" }, "Descartar nueva skill"),
  createElement("p", { id: "discard-create-description" }, "El borrador se perderá. No se ha escrito nada en disco."),
  createElement("div", { className: "inspector-actions" },
    createElement(QuietAction, { onClick: () => setDiscardOpen(false) }, "Seguir editando"),
    createElement(DangerAction, { onClick: props.onBack }, "Descartar y salir"))) : null

  if (stage === "details") {
    return createElement(
      "section",
      { "aria-labelledby": "create-skill-title", className: "skill-workspace create-skill-workspace create-skill-workspace--details" },
      createElement(
        "header",
        { className: "workspace-bar" },
        createElement(QuietAction, {
          "aria-label": "Volver al inventario",
          className: "workspace-back",
          onClick: (event: ReactMouseEvent<HTMLButtonElement>) => requestExit(event.currentTarget),
        }, createElement("span", { "aria-hidden": "true" }, "←")),
        createElement(
          "div",
          { className: "workspace-identity" },
          createElement(SkillTile, { adapterId: selectedRoot?.adapterId ?? "folder", className: "workspace-identity__tile", skillKey: skillKey || "new" }),
          createElement("div", { className: "workspace-identity__copy" },
            createElement("h1", { id: "create-skill-title" }, "Crear skill"),
            createElement("p", null, "Nuevo borrador local")),
        ),
        createElement(StatusPill, { tone: "attention" }, "Nueva"),
      ),
      createElement(
        "div",
        { className: "create-setup" },
        createElement(
          "form",
          { className: "create-setup__form", onSubmit: startAuthoring },
          createElement("p", { className: "section-label" }, "Detalles básicos"),
          createElement("h2", null, "Prepara el borrador"),
          createElement("p", { className: "create-setup__intro" }, "Revisa los cambios antes de crear la carpeta."),
          createElement("label", { htmlFor: "create-skill-key" }, "Identificador"),
          createElement("input", {
            autoComplete: "off",
            autoFocus: true,
            id: "create-skill-key",
            name: "skillKey",
            onChange: (event) => { setSkillKey((event.currentTarget as HTMLInputElement).value); setError(undefined) },
            placeholder: "revisar-contratos",
            spellCheck: false,
            value: skillKey,
          }),
          createElement("small", null, "Se usará como nombre de carpeta. Solo minúsculas, números y guiones."),
          createElement("label", { htmlFor: "create-skill-description" }, "Descripción"),
          createElement("textarea", {
            id: "create-skill-description",
            name: "description",
            onChange: (event) => { setDescription((event.currentTarget as HTMLTextAreaElement).value); setError(undefined) },
            placeholder: "Cuándo debe usar el agente esta skill y qué resultado produce.",
            rows: 3,
            value: description,
          }),
          createElement("label", { htmlFor: "create-skill-root" }, "Ubicación"),
          createElement(
            "select",
            {
              disabled: writableRoots.length === 0,
              id: "create-skill-root",
              name: "rootId",
              onChange: (event) => { setRootId((event.currentTarget as HTMLSelectElement).value); setError(undefined) },
              value: rootId,
            },
            ...writableRoots.map((root) => createElement("option", { key: root.rootId, value: root.rootId }, verbatim(`${root.displayName} · ${root.displayPath}`))),
          ),
          error === undefined ? null : createElement("p", { className: "form-error", role: "alert" }, verbatim(error)),
          writableRoots.length > 0 ? null : createElement("p", { className: "form-error", role: "alert" }, "No hay una carpeta aprobada con escritura."),
          createElement("div", { className: "create-setup__actions" },
            createElement(QuietAction, { onClick: (event: ReactMouseEvent<HTMLButtonElement>) => requestExit(event.currentTarget) }, "Cancelar"),
            createElement("button", { className: "workspace-review", disabled: writableRoots.length === 0, type: "submit" }, "Abrir borrador")),
        ),
        createElement("aside", { className: "create-setup__aside" },
          createElement("p", { className: "section-label" }, "Cómo funciona"),
          createElement("ol", null,
            createElement("li", null, "Skillglass genera una plantilla editable."),
            createElement("li", null, "Revisas cada línea añadida antes de escribir."),
            createElement("li", null, "La creación queda registrada y se puede deshacer si el contenido no cambia."))),
        discardDialog,
      ),
    )
  }

  return createElement(
    "section",
    {
      "aria-busy": busy,
      "aria-labelledby": "create-skill-title",
      className: `skill-workspace skill-workspace--ready skill-workspace--${mode} create-skill-workspace`,
      onKeyDownCapture: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key !== "Escape" || busy || discardOpen) return
        event.preventDefault()
        if (mode === "changes") setMode("code")
        else requestExit(document.activeElement instanceof HTMLElement ? document.activeElement : event.currentTarget)
      },
    },
    createElement(
      "header",
      { className: "workspace-bar" },
      createElement(QuietAction, {
        "aria-label": "Volver al inventario",
        className: "workspace-back",
        disabled: busy,
        onClick: (event: ReactMouseEvent<HTMLButtonElement>) => requestExit(event.currentTarget),
      }, createElement("span", { "aria-hidden": "true" }, "←")),
      createElement("div", { className: "workspace-identity" },
        createElement(SkillTile, { adapterId: selectedRoot?.adapterId ?? "folder", className: "workspace-identity__tile", skillKey }),
        createElement("div", { className: "workspace-identity__copy" },
          createElement("h1", { id: "create-skill-title" }, titleFromKey(skillKey)),
          createElement("p", null, selectedRoot === undefined
            ? "Destino · Borrador nuevo"
            : createElement("span", null, verbatim(selectedRoot.displayName), " · Borrador nuevo")))),
      createElement(StatusPill, { className: "workspace-update-status", tone: "attention" }, "Nueva"),
      createElement(QuietAction, {
        className: "workspace-discard",
        disabled: busy,
        onClick: () => { setDraft(template(skillKey, description, getActiveLocale())); setMode("code"); setPlan(undefined); setPlannedDraft(undefined) },
      }, "Restablecer"),
      createElement("button", {
        className: "workspace-review",
        disabled: !dirty || busy,
        onClick: () => { void review() },
        type: "button",
      }, planning ? "Preparando…" : "Revisar creación"),
    ),
    createElement(
      "nav",
      { "aria-label": "Vista de la nueva skill", className: "workspace-tabs" },
      createElement("div", { "aria-orientation": "horizontal", role: "tablist" },
        createElement("button", {
          "aria-controls": "create-skill-preview-panel", "aria-selected": mode === "preview", disabled: busy,
          id: "create-skill-preview-tab", onClick: () => changeMode("preview"), onKeyDown: handleTabKeyDown,
          ref: previewTabRef, role: "tab", tabIndex: mode === "preview" ? 0 : -1, type: "button",
        }, "Vista previa"),
        createElement("button", {
          "aria-controls": "create-skill-code-panel", "aria-selected": mode === "code", disabled: busy,
          id: "create-skill-code-tab", onClick: () => changeMode("code"), onKeyDown: handleTabKeyDown,
          ref: codeTabRef, role: "tab", tabIndex: mode === "code" ? 0 : -1, type: "button",
        }, "Código"),
        createElement("button", {
          "aria-controls": "create-skill-changes-panel", "aria-selected": mode === "changes", disabled: !dirty || busy,
          id: "create-skill-changes-tab", onClick: () => { void review() }, onKeyDown: handleTabKeyDown,
          ref: changesTabRef, role: "tab", tabIndex: mode === "changes" ? 0 : -1, type: "button",
        }, "Cambios ", createElement("span", { className: "workspace-tabs__count" }, changeCount))),
    ),
    createElement("div", { className: "workspace-body" },
      createElement("main", { className: "workspace-editor" },
        createElement("section", {
          "aria-labelledby": "create-skill-preview-tab", className: "skill-preview", hidden: mode !== "preview",
          id: "create-skill-preview-panel", role: "tabpanel", tabIndex: 0,
        },
        createElement("header", { className: "skill-preview__header" },
          createElement("p", { className: "section-label" }, "Nueva skill"),
          createElement("h2", null, verbatim(titleFromKey(skillKey))),
          createElement("p", null, verbatim(description))),
        createElement("article", { className: "skill-preview__content" }, mode === "preview" ? createElement(SafeMarkdown, { headingOffset: 1, source: draft }) : null)),
        createElement("section", {
          "aria-labelledby": "create-skill-code-tab", className: "code-workbench", hidden: mode !== "code",
          id: "create-skill-code-panel", role: "tabpanel", tabIndex: 0,
        },
        createElement("header", { className: "workspace-editor__meta" },
          createElement("div", null, createElement("p", { className: "section-label" }, "Archivo"), createElement("strong", null, verbatim(`${skillKey}/SKILL.md`))),
          createElement("span", { className: "workspace-change-state workspace-change-state--dirty" }, "Borrador nuevo")),
        createElement("div", { "aria-disabled": busy, className: "workspace-editor__field", inert: busy },
          createElement(CodeEditor, {
            ariaLabel: "Contenido de la nueva SKILL.md", busy, dirty,
            onChange: (content: string) => { setDraft(content); setError(undefined); setPlan(undefined); setPlannedDraft(undefined) },
            onReview: () => { void review() }, value: draft,
          }))),
        createElement("section", {
          "aria-labelledby": "create-skill-changes-tab", className: "diff-workbench", hidden: mode !== "changes",
          id: "create-skill-changes-panel", role: "tabpanel", tabIndex: 0,
        },
        createElement("div", { "aria-labelledby": "create-skill-confirm-title", className: "workspace-confirmation", role: "dialog", tabIndex: -1 },
          createElement("header", { className: "diff-workbench__header" },
            createElement("div", null, createElement("p", { className: "section-label" }, "Revisión antes de crear"), createElement("h2", { id: "create-skill-confirm-title" }, "Confirmar creación")),
            createElement("p", null, `${diff.added} líneas añadidas`)),
          createElement("div", { className: "workspace-confirmation__body" },
            createElement("div", { className: "inline-diff" }, mode === "changes" ? createElement(TextDiff, { after: draft, before: "" }) : null),
            createElement("aside", { "aria-label": "Detalles de la creación", className: "workspace-plan" },
              createElement("p", { className: "inspector-path" }, verbatim(`${selectedRoot?.displayPath ?? ""}/${skillKey}/SKILL.md`)),
              plan === undefined ? null : createElement(OperationPlanDetails, { plan }),
              error === undefined ? null : createElement("p", { className: "form-error", role: "alert" }, verbatim(error)))),
          createElement("footer", { className: "diff-actions" },
            createElement("p", null, "La carpeta no existirá hasta confirmar."),
            createElement(QuietAction, { disabled: busy, onClick: () => setMode("code") }, "Volver a editar"),
            createElement("button", {
              className: "workspace-apply", disabled: !planAvailable || busy,
              onClick: () => { void confirm() }, type: "button",
            }, applying ? "Creando…" : "Crear skill")))),
        error === undefined || mode === "changes" ? null : createElement("div", { className: "workspace-error" }, createElement("p", { className: "form-error", role: "alert" }, verbatim(error)))),
      createElement("aside", { "aria-labelledby": "create-context-title", className: "workspace-context" },
        createElement("h2", { className: "section-label", id: "create-context-title" }, "Destino"),
        createElement("p", { className: "inspector-path" }, selectedRoot === undefined ? "No disponible" : verbatim(selectedRoot.displayPath)),
        createElement("details", { className: "workspace-context__disclosure" },
          createElement("summary", { className: "workspace-disclosure-summary" },
            createElement("span", null, "Detalles técnicos"),
            createElement("span", { "aria-hidden": "true", className: "workspace-disclosure-summary__marker" })),
          createElement("div", { className: "workspace-context__disclosure-body" },
            createElement("dl", { className: "workspace-context__facts" },
              createElement("div", null, createElement("dt", null, "Skill"), createElement("dd", null, skillKey)),
              createElement("div", null, createElement("dt", null, "Ubicación"), createElement("dd", null, selectedRoot === undefined ? "No disponible" : verbatim(selectedRoot.displayPath))),
              createElement("div", null, createElement("dt", null, "Archivo"), createElement("dd", null, "SKILL.md"))),
            createElement("p", { className: "workspace-context__safety" }, "Skillglass comprueba que el destino sigue libre y mantiene Deshacer mientras el contenido no cambie."))))),
    createElement("footer", { className: "workspace-footer" },
      createElement("p", { "aria-live": "polite", role: "status" }, planning ? "Preparando una revisión segura." : applying ? "Creando la skill." : "Borrador local · todavía no se ha escrito en disco"),
      createElement("kbd", null, "⌘ ↵"), createElement("span", null, "Revisar creación")),
    discardDialog,
  )
}
