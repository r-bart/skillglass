import type {
  ForgeBridge,
  InventoryItemDto,
  InventoryPageDto,
  MonitoringStateDto,
  OnboardingStateDto,
} from "@forge/contracts"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { createElement, verbatim } from "../i18n.js"
import { loadAllInventoryItems } from "../inventory/load-all.js"
import { MetalAction, QuietAction } from "../VisualPrimitives.js"
import { SkillSelectionList } from "./SkillSelectionList.js"
import { SourceApprovalStep } from "./SourceApprovalStep.js"
import {
  WelcomeCarousel,
  WELCOME_SLIDE_COUNT,
  type WelcomeSlideIndex,
} from "./WelcomeCarousel.js"

export type OnboardingPhase =
  | "loading"
  | "intro"
  | "tour"
  | "sources"
  | "scanning"
  | "monitoring-summary"
  | "skills"
  | "saving"
  | "complete"

type LoadedInventory = Readonly<{
  items: readonly InventoryItemDto[]
  projects: NonNullable<InventoryPageDto["projects"]>
}>

export interface OnboardingFlowProps {
  readonly roots: OnboardingStateDto | null
  readonly monitoring: MonitoringStateDto | null
  readonly inventoryBridge: ForgeBridge["inventory"]
  readonly selectedCandidateIds: ReadonlySet<string>
  readonly sourceBusy: boolean
  readonly sourceError: string | null
  readonly onToggleRoot: (candidateId: string) => void
  readonly onAddFolder: () => void
  readonly onAddProject: () => void
  readonly onApproveRoots: () => Promise<OnboardingStateDto>
  readonly onSaveMonitoring: (
    installationIds: readonly string[],
  ) => Promise<MonitoringStateDto>
  readonly onComplete: (state: MonitoringStateDto) => void
}

const PROJECTS_QUERY = {
  scope: { kind: "all" as const },
  pageSize: 1,
  sort: { by: "name" as const, direction: "asc" as const },
}

function BusyStep({ message, error, onRetry }: {
  readonly message: string
  readonly error?: string
  readonly onRetry?: () => void
}): ReactNode {
  return createElement(
    "main",
    {
      "aria-busy": error === undefined || undefined,
      className: "onboarding-flow__status",
      id: "main-content",
      tabIndex: -1,
    },
    createElement("p", { role: error === undefined ? "status" : "alert" }, error === undefined ? message : verbatim(error)),
    error !== undefined && onRetry !== undefined
      ? createElement(QuietAction, { onClick: onRetry }, "Reintentar")
      : null,
  )
}

/**
 * Owns the resumable first-run state machine. Filesystem approval and
 * persistence stay in App, while this component coordinates the user-visible
 * transitions and the full, paginated inventory load between both steps.
 */
export function OnboardingFlow({
  roots,
  monitoring,
  inventoryBridge,
  selectedCandidateIds,
  sourceBusy,
  sourceError,
  onToggleRoot,
  onAddFolder,
  onAddProject,
  onApproveRoots,
  onSaveMonitoring,
  onComplete,
}: OnboardingFlowProps): ReactNode {
  const initialized = useRef(false)
  const phaseMain = useRef<HTMLElement>(null)
  const [phase, setPhase] = useState<OnboardingPhase>("loading")
  const [slide, setSlide] = useState<WelcomeSlideIndex>(0)
  const [inventory, setInventory] = useState<LoadedInventory>()
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  const [flowError, setFlowError] = useState<string>()

  useEffect(() => {
    if (phase !== "sources" && phase !== "monitoring-summary" && phase !== "skills") return
    const main = phaseMain.current
    if (main === null) return
    main.scrollTop = 0
    main.scrollLeft = 0
    for (const panel of main.querySelectorAll<HTMLElement>("[data-scroll-panel], .skill-selection__results")) {
      panel.scrollTop = 0
      panel.scrollLeft = 0
    }
    const title = main.querySelector<HTMLElement>("h1")
    if (title === null) return
    title.tabIndex = -1
    title.focus({ preventScroll: true })
  }, [phase])

  const loadSkills = async (
    currentMonitoring: MonitoringStateDto,
  ): Promise<void> => {
    setPhase("scanning")
    setFlowError(undefined)
    try {
      const [items, projectPage] = await Promise.all([
        loadAllInventoryItems(inventoryBridge),
        inventoryBridge.list(PROJECTS_QUERY),
      ])
      const availableIds = new Set(items.map(({ installationId }) => installationId))
      const persistedSelection = currentMonitoring.selectedInstallationIds.filter(
        (installationId) => availableIds.has(installationId),
      )
      setInventory({ items, projects: projectPage.projects ?? [] })
      setSelection(new Set(
        currentMonitoring.status === "required" && persistedSelection.length === 0
          ? items.map(({ installationId }) => installationId)
          : persistedSelection,
      ))
      setPhase("monitoring-summary")
    } catch (reason) {
      setFlowError(reason instanceof Error ? reason.message : "No se pudo cargar el inventario")
    }
  }

  useEffect(() => {
    if (roots === null || monitoring === null || initialized.current) return
    initialized.current = true
    if (roots.status !== "complete") {
      setPhase("intro")
      return
    }
    if (monitoring.status !== "complete") {
      void loadSkills(monitoring)
      return
    }
    setPhase("complete")
    onComplete(monitoring)
  }, [monitoring, onComplete, roots])

  const rootDisplayPaths = useMemo(
    () => new Map((roots?.approvedRoots ?? []).map((root) => [root.rootId, root.displayPath])),
    [roots?.approvedRoots],
  )

  const continueAfterIntro = (): void => {
    if (roots?.status !== "complete") {
      setPhase("sources")
      return
    }
    if (monitoring !== null) void loadSkills(monitoring)
  }

  const approveRoots = async (): Promise<void> => {
    setPhase("scanning")
    setFlowError(undefined)
    try {
      await onApproveRoots()
      if (monitoring?.status === "complete") {
        setPhase("complete")
        onComplete(monitoring)
        return
      }
      if (monitoring !== null) await loadSkills(monitoring)
    } catch {
      // SourceApprovalStep receives the authoritative, retryable error from App.
      setPhase("sources")
    }
  }

  const saveMonitoring = async (
    nextSelection: ReadonlySet<string> = selection,
    failurePhase: "monitoring-summary" | "skills" = "skills",
  ): Promise<void> => {
    setPhase("saving")
    setFlowError(undefined)
    try {
      const state = await onSaveMonitoring([...nextSelection])
      setPhase("complete")
      onComplete(state)
    } catch (reason) {
      setFlowError(reason instanceof Error ? reason.message : "No se pudo guardar el seguimiento.")
      setPhase(failurePhase)
    }
  }

  if (roots === null || monitoring === null || phase === "loading") {
    return createElement(BusyStep, {
      ...(sourceError === null ? {} : { error: sourceError }),
      message: "Cargando configuración…",
    })
  }

  if (phase === "intro") {
    return createElement(
      "main",
      { className: "onboarding-flow", id: "main-content", tabIndex: -1 },
      createElement(
        "section",
        { "aria-labelledby": "onboarding-welcome-title", className: "onboarding-welcome" },
        createElement(
          "span",
          { "aria-hidden": "true", className: "welcome-carousel__mark" },
          createElement("i", null),
          createElement("strong", null, "S"),
        ),
        createElement("p", { className: "welcome-carousel__eyebrow" }, "Bienvenido a Skillglass"),
        createElement("h1", { id: "onboarding-welcome-title" }, "Entiende todas las skills que ya tienes."),
        createElement(
          "p",
          { className: "onboarding-welcome__description" },
          "Elige las carpetas que Skillglass puede leer y abre tu inventario en unos pasos.",
        ),
        createElement(
          "div",
          { className: "onboarding-welcome__actions" },
          createElement(MetalAction, { onClick: continueAfterIntro }, "Elegir carpetas"),
          createElement(QuietAction, { onClick: () => setPhase("tour") }, "Ver tour de 3 pasos"),
        ),
      ),
    )
  }

  if (phase === "tour") {
    return createElement(
      "main",
      { className: "onboarding-flow", id: "main-content", tabIndex: -1 },
      createElement(WelcomeCarousel, {
        slide,
        onNext: () => {
          if (slide === WELCOME_SLIDE_COUNT - 1) continueAfterIntro()
          else setSlide((slide + 1) as WelcomeSlideIndex)
        },
        onPrevious: () => setSlide(Math.max(0, slide - 1) as WelcomeSlideIndex),
        onSkip: continueAfterIntro,
        onSlideChange: setSlide,
      }),
    )
  }

  if (phase === "sources") {
    return createElement(
      "main",
      { className: "onboarding-flow", id: "main-content", ref: phaseMain, tabIndex: -1 },
      createElement(SourceApprovalStep, {
        busy: sourceBusy,
        error: sourceError,
        onAddFolder,
        onAddProject,
        onApprove: () => { void approveRoots() },
        onToggle: onToggleRoot,
        selectedCandidateIds,
        state: roots,
      }),
    )
  }

  if (phase === "scanning" || inventory === undefined) {
    return createElement(BusyStep, {
      ...(flowError === undefined ? {} : {
        error: flowError,
        onRetry: () => { void loadSkills(monitoring) },
      }),
      message: "Buscando skills…",
    })
  }

  if (phase === "monitoring-summary") {
    const itemCount = inventory.items.length
    const allInstallationIds = new Set(inventory.items.map(({ installationId }) => installationId))
    return createElement(
      "main",
      { className: "onboarding-flow", id: "main-content", ref: phaseMain, tabIndex: -1 },
      createElement(
        "section",
        { "aria-labelledby": "monitoring-summary-title", className: "onboarding-follow-up" },
        createElement("p", { className: "eyebrow" }, "Inventario preparado"),
        createElement(
          "h1",
          { id: "monitoring-summary-title", tabIndex: -1 },
          itemCount === 0
            ? "No hemos encontrado skills todavía."
            : `Hemos encontrado ${itemCount} ${itemCount === 1 ? "skill" : "skills"}.`,
        ),
        createElement(
          "p",
          null,
          itemCount === 0
            ? "Puedes abrir el inventario vacío para crear una skill o añadir otra carpeta ahora."
            : "Puedes seguirlas todas ahora o revisar la lista y elegir cuáles quieres destacar.",
        ),
        flowError === undefined
          ? null
          : createElement("p", { className: "form-error", role: "alert" }, verbatim(flowError)),
        createElement(
          "div",
          { className: "onboarding-follow-up__actions" },
          createElement(
            MetalAction,
            {
              onClick: () => { void saveMonitoring(allInstallationIds, "monitoring-summary") },
            },
            itemCount === 0 ? "Abrir inventario" : "Seguir todas y abrir inventario",
          ),
          itemCount === 0
            ? createElement(
                QuietAction,
                {
                  onClick: () => {
                    onAddFolder()
                    setPhase("sources")
                  },
                },
                "Añadir otra carpeta",
              )
            : createElement(
                QuietAction,
                { onClick: () => setPhase("skills") },
                "Elegir cuáles seguir",
              ),
        ),
      ),
    )
  }

  return createElement(
    "main",
    { className: "onboarding-flow", id: "main-content", ref: phaseMain, tabIndex: -1 },
    createElement(
      "header",
      { className: "onboarding-flow__selection-heading" },
      createElement("p", { className: "eyebrow" }, "Personaliza tu inventario"),
      createElement("h1", null, "Elige las skills que quieres seguir de cerca."),
      createElement(
        "p",
        null,
        "Skillglass destacará cambios en su contenido, validez y origen. Solo observa archivos locales: nunca ejecuciones ni conversaciones.",
      ),
    ),
    createElement(SkillSelectionList, {
      completeBusy: phase === "saving",
      disabled: phase === "saving",
      footer: flowError === undefined
        ? undefined
        : createElement("p", { className: "form-error", role: "alert" }, verbatim(flowError)),
      items: inventory.items,
      onComplete: () => { void saveMonitoring() },
      onSelectionChange: setSelection,
      projects: inventory.projects,
      rootDisplayPaths,
      selectedInstallationIds: selection,
    }),
  )
}
