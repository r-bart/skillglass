import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react"
import { createElement } from "../i18n.js"

export type WelcomeSlideIndex = 0 | 1 | 2

export interface WelcomeCarouselProps {
  readonly slide: WelcomeSlideIndex
  readonly onNext: () => void
  readonly onPrevious: () => void
  readonly onSkip: () => void
  readonly onSlideChange: (slide: WelcomeSlideIndex) => void
}

type WelcomeSlide = Readonly<{
  eyebrow: string
  title: string
  description: string
  visual: "inventory" | "evidence" | "create"
}>

const SLIDES: readonly WelcomeSlide[] = [
  {
    eyebrow: "Todas tus skills, por fin claras",
    title: "Entiende todas las skills que ya tienes.",
    description: "Reúne las skills globales y de tus proyectos en un solo inventario. Ve qué hace cada una, dónde vive y en qué flujos puede ayudarte.",
    visual: "inventory",
  },
  {
    eyebrow: "Cada detalle, a mano",
    title: "Abre una skill y entiende cómo funciona.",
    description: "Revisa sus instrucciones, archivos, origen, ámbito y estado para saber cuándo usarla y qué cambiar con confianza.",
    visual: "evidence",
  },
  {
    eyebrow: "Tus flujos, a tu manera",
    title: "Crea nuevas skills para el trabajo que repites.",
    description: "Empieza con una estructura clara, adapta las instrucciones a tu proceso y guarda la nueva skill donde la necesites.",
    visual: "create",
  },
]

export const WELCOME_SLIDE_COUNT = SLIDES.length

function SkillMark({ tone, glyph }: { readonly tone: string; readonly glyph: string }): ReactNode {
  return createElement(
    "span",
    { "aria-hidden": "true", className: `welcome-carousel__skill-mark welcome-carousel__skill-mark--${tone}` },
    glyph,
  )
}

function InventoryVisual(): ReactNode {
  return createElement(
    "div",
    {
      "aria-label": "Varias skills de distintos proyectos reunidas en una lista",
      className: "welcome-carousel__visual welcome-carousel__visual--inventory",
      role: "img",
    },
    createElement(
      "div",
      { className: "welcome-carousel__source" },
      createElement("span", null, "Global"),
      createElement("i", null),
      createElement("i", null),
      createElement("i", null),
    ),
    createElement("span", { "aria-hidden": "true", className: "welcome-carousel__flow" }, "→"),
    createElement(
      "div",
      { className: "welcome-carousel__inventory" },
      createElement("strong", null, "Inventario"),
      createElement(
        "span",
        null,
        createElement(SkillMark, { glyph: "I", tone: "blue" }),
        "accessibility-audit",
      ),
      createElement(
        "span",
        null,
        createElement(SkillMark, { glyph: "•", tone: "green" }),
        "api-contract-review",
      ),
      createElement(
        "span",
        null,
        createElement(SkillMark, { glyph: "■", tone: "plum" }),
        "broken-frontmatter",
      ),
    ),
    createElement(
      "div",
      { className: "welcome-carousel__source" },
      createElement("span", null, "Acme Web"),
      createElement("i", null),
      createElement("i", null),
    ),
  )
}

function EvidenceVisual(): ReactNode {
  return createElement(
    "div",
    {
      "aria-label": "Ficha de una skill con origen, ámbito y validez observada",
      className: "welcome-carousel__visual welcome-carousel__visual--evidence",
      role: "img",
    },
    createElement(SkillMark, { glyph: "I", tone: "blue" }),
    createElement(
      "div",
      { className: "welcome-carousel__evidence-copy" },
      createElement("strong", null, "accessibility-audit"),
      createElement("p", null, "Revisa navegación por teclado, foco y contraste."),
      createElement(
        "dl",
        null,
        createElement("dt", null, "Validez"),
        createElement("dd", null, createElement("span", { className: "welcome-carousel__validity" }, "• Válida")),
        createElement("dt", null, "Ámbito"),
        createElement("dd", null, "Global"),
        createElement("dt", null, "Origen"),
        createElement("dd", null, "Carpeta local"),
      ),
    ),
  )
}

function CreateVisual(): ReactNode {
  return createElement(
    "div",
    {
      "aria-label": "Un flujo de trabajo repetido convertido en una nueva skill",
      className: "welcome-carousel__visual welcome-carousel__visual--create",
      role: "img",
    },
    createElement(
      "div",
      { className: "welcome-carousel__brief" },
      createElement("span", null, "Flujo que repites"),
      createElement("strong", null, "“Antes de cada release, revisa cambios, riesgos y notas.”"),
    ),
    createElement("span", { "aria-hidden": "true", className: "welcome-carousel__flow" }, "→"),
    createElement(
      "div",
      { className: "welcome-carousel__draft" },
      createElement(
        "header",
        null,
        createElement(SkillMark, { glyph: "■", tone: "green" }),
        createElement(
          "div",
          null,
          createElement("strong", null, "release-checklist"),
          createElement("small", null, "Nueva skill · Acme Web"),
        ),
      ),
      createElement("code", null, "name: release-checklist"),
      createElement("p", null, "Comprueba cambios, riesgos y notas antes de publicar."),
      createElement(
        "footer",
        null,
        createElement("span", null, "SKILL.md"),
        createElement("span", { className: "welcome-carousel__example-action" }, "Crear skill"),
      ),
    ),
  )
}

function SlideVisual({ kind }: { readonly kind: WelcomeSlide["visual"] }): ReactNode {
  if (kind === "inventory") return createElement(InventoryVisual)
  if (kind === "evidence") return createElement(EvidenceVisual)
  return createElement(CreateVisual)
}

function slideIndex(value: number): WelcomeSlideIndex {
  if (value === 0 || value === 1 || value === 2) return value
  throw new RangeError(`Invalid welcome slide index: ${value}`)
}

export function WelcomeCarousel({
  slide,
  onNext,
  onPrevious,
  onSkip,
  onSlideChange,
}: WelcomeCarouselProps): ReactNode {
  const instanceId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const focusTitleAfterNavigation = useRef(false)
  const current = SLIDES[slide]
  if (current === undefined) throw new RangeError(`Invalid welcome slide index: ${slide}`)

  useEffect(() => {
    if (!focusTitleAfterNavigation.current) return
    focusTitleAfterNavigation.current = false
    titleRef.current?.focus({ preventScroll: true })
  }, [slide])

  const navigateTo = (target: WelcomeSlideIndex): void => {
    if (target === slide) return
    focusTitleAfterNavigation.current = true
    onSlideChange(target)
  }

  const next = (): void => {
    if (slide < WELCOME_SLIDE_COUNT - 1) focusTitleAfterNavigation.current = true
    onNext()
  }

  const previous = (): void => {
    if (slide > 0) focusTitleAfterNavigation.current = true
    onPrevious()
  }

  const titleId = `${instanceId}-welcome-title`
  const descriptionId = `${instanceId}-welcome-description`
  const slideId = `${instanceId}-welcome-slide`

  return createElement(
    "section",
    {
      "aria-label": "Introducción a Skillglass",
      className: "welcome-carousel onboarding-motion-region",
      "data-motion": "appearance",
    },
    createElement(
      "article",
      {
        "aria-describedby": descriptionId,
        "aria-labelledby": titleId,
        className: "welcome-carousel__slide onboarding-motion-slide",
        "data-slide": slide,
        id: slideId,
      },
      createElement(
        "div",
        { className: "welcome-carousel__copy" },
        createElement(
          "span",
          { "aria-hidden": "true", className: "welcome-carousel__mark" },
          createElement("i", null),
          createElement("strong", null, "S"),
        ),
        createElement(
          "p",
          { className: "welcome-carousel__eyebrow" },
          slide === 0 ? "Bienvenido a Skillglass" : current.eyebrow,
        ),
        createElement("h1", { id: titleId, ref: titleRef, tabIndex: -1 }, current.title),
        createElement("p", { id: descriptionId }, current.description),
        createElement(
          "div",
          { "aria-label": "Pasos de introducción", className: "welcome-carousel__indicators", role: "group" },
          ...SLIDES.map((_, index) => {
            const target = slideIndex(index)
            return createElement(
              "button",
              {
                "aria-controls": slideId,
                "aria-current": target === slide ? "step" : undefined,
                "aria-label": `Ir a la explicación ${index + 1}`,
                className: "welcome-carousel__indicator",
                key: target,
                onClick: () => navigateTo(target),
                type: "button",
              },
              createElement("span", { "aria-hidden": "true" }),
            )
          }),
        ),
      ),
      createElement("div", { className: "welcome-carousel__visual-frame" }, createElement(SlideVisual, { kind: current.visual })),
      createElement(
        "footer",
        { className: "welcome-carousel__footer" },
        createElement("button", { className: "welcome-carousel__skip", onClick: onSkip, type: "button" }, "Saltar explicación"),
        createElement(
          "div",
          { className: "welcome-carousel__actions" },
          slide === 0
            ? null
            : createElement("button", { className: "welcome-carousel__previous", onClick: previous, type: "button" }, "Anterior"),
          createElement(
            "button",
            { className: "welcome-carousel__next", onClick: next, type: "button" },
            slide === WELCOME_SLIDE_COUNT - 1 ? "Elegir carpetas" : "Continuar",
          ),
        ),
      ),
    ),
    createElement(
      "p",
      { "aria-hidden": "true", className: "welcome-carousel__progress" },
      `Explicación ${slide + 1} de ${WELCOME_SLIDE_COUNT}`,
    ),
  )
}
