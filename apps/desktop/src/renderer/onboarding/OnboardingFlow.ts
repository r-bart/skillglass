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

import { createElement } from "../i18n.js"
import { loadAllInventoryItems } from "../inventory/load-all.js"
import { QuietAction } from "../VisualPrimitives.js"
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
  | "sources"
  | "scanning"
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
    createElement("p", { role: error === undefined ? "status" : "alert" }, error ?? message),
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
    if (phase !== "sources" && phase !== "skills") return
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
      setPhase("skills")
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

  const saveMonitoring = async (): Promise<void> => {
    setPhase("saving")
    setFlowError(undefined)
    try {
      const state = await onSaveMonitoring([...selection])
      setPhase("complete")
      onComplete(state)
    } catch (reason) {
      setFlowError(reason instanceof Error ? reason.message : "No se pudo guardar el seguimiento.")
      setPhase("skills")
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
        : createElement("p", { className: "form-error", role: "alert" }, flowError),
      items: inventory.items,
      onComplete: () => { void saveMonitoring() },
      onSelectionChange: setSelection,
      projects: inventory.projects,
      rootDisplayPaths,
      selectedInstallationIds: selection,
    }),
  )
}
