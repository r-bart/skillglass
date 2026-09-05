import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setActiveLocale } from "../i18n.js"
import {
  WelcomeCarousel,
  type WelcomeSlideIndex,
} from "./WelcomeCarousel.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: Root

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) => (
    candidate.textContent?.trim() === name
    || candidate.getAttribute("aria-label") === name
  ))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${name}`)
  return button
}

function Harness({ onSkip }: { readonly onSkip: () => void }) {
  const [slide, setSlide] = useState<WelcomeSlideIndex>(0)
  return createElement(WelcomeCarousel, {
    slide,
    onNext: () => setSlide((Math.min(2, slide + 1)) as WelcomeSlideIndex),
    onPrevious: () => setSlide((Math.max(0, slide - 1)) as WelcomeSlideIndex),
    onSkip,
    onSlideChange: setSlide,
  })
}

beforeEach(() => {
  setActiveLocale("es")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("WelcomeCarousel", () => {
  it("navigates with actions and indicators, keeps bounds, and focuses the changed title", async () => {
    await act(async () => root.render(createElement(Harness, { onSkip: vi.fn() })))

    expect(container.querySelector("h1")?.textContent)
      .toBe("Entiende todas las skills que ya tienes.")
    expect(container.querySelectorAll('.welcome-carousel__indicator[aria-current="step"]'))
      .toHaveLength(1)
    expect([...container.querySelectorAll("button")].some(({ textContent }) => textContent === "Anterior"))
      .toBe(false)

    await act(async () => buttonNamed("Continuar").click())
    const secondTitle = container.querySelector("h1")
    expect(secondTitle?.textContent).toBe("Abre una skill y entiende cómo funciona.")
    expect(document.activeElement).toBe(secondTitle)

    await act(async () => buttonNamed("Ir a la explicación 3").click())
    const thirdTitle = container.querySelector("h1")
    expect(thirdTitle?.textContent).toBe("Crea nuevas skills para el trabajo que repites.")
    expect(document.activeElement).toBe(thirdTitle)
    expect(buttonNamed("Elegir carpetas")).toBeInstanceOf(HTMLButtonElement)

    await act(async () => buttonNamed("Anterior").click())
    expect(container.querySelector("h1")?.textContent)
      .toBe("Abre una skill y entiende cómo funciona.")
  })

  it("exposes skip independently from slide navigation", async () => {
    const onSkip = vi.fn()
    await act(async () => root.render(createElement(Harness, { onSkip })))

    await act(async () => buttonNamed("Saltar explicación").click())

    expect(onSkip).toHaveBeenCalledOnce()
    expect(container.querySelector("h1")?.textContent)
      .toBe("Entiende todas las skills que ya tienes.")
  })
})
