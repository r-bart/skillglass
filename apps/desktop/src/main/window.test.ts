import { describe, expect, it } from "vitest"

import {
  MINIMUM_CONTENT_SIZE,
  PREFERRED_CONTENT_SIZE,
  calculateWindowOptions,
  developmentDockIconPath,
} from "./window.js"

describe("desktop window options", () => {
  it("uses the product icon for the macOS Dock only in source development", () => {
    expect(developmentDockIconPath("/workspace/apps/desktop", false, "darwin"))
      .toBe("/workspace/branding/SkillForge.png")
    expect(developmentDockIconPath("/workspace/apps/desktop", true, "darwin")).toBeUndefined()
    expect(developmentDockIconPath("/workspace/apps/desktop", false, "linux")).toBeUndefined()
  })

  it("uses the canonical content viewport when the display has enough room", () => {
    const options = calculateWindowOptions({ width: 1728, height: 1080 }, "darwin")

    expect(options).toMatchObject({
      ...PREFERRED_CONTENT_SIZE,
      minWidth: MINIMUM_CONTENT_SIZE.width,
      minHeight: MINIMUM_CONTENT_SIZE.height,
      useContentSize: true,
      show: false,
      backgroundColor: "#0b0b0d",
    })
  })

  it("clamps the preferred content viewport to a smaller display work area", () => {
    const options = calculateWindowOptions({ width: 1180, height: 760 }, "linux")

    expect(options.width).toBe(1180)
    expect(options.height).toBe(760)
    expect(options.minWidth).toBe(760)
    expect(options.minHeight).toBe(520)
  })

  it("never starts below the supported minimum content viewport", () => {
    const options = calculateWindowOptions({ width: 640, height: 480 }, "linux")

    expect(options.width).toBe(MINIMUM_CONTENT_SIZE.width)
    expect(options.height).toBe(MINIMUM_CONTENT_SIZE.height)
  })

  it("uses the inset macOS titlebar with native traffic lights", () => {
    const options = calculateWindowOptions({ width: 1420, height: 892 }, "darwin")

    expect(options.titleBarStyle).toBe("hiddenInset")
    expect(options.titleBarOverlay).toBeUndefined()
  })

  it.each(["win32", "linux"] as const)(
    "uses Electron native caption controls in a 46px overlay on %s",
    (platform) => {
      const options = calculateWindowOptions({ width: 1420, height: 892 }, platform)

      expect(options.titleBarStyle).toBe("hidden")
      expect(options.titleBarOverlay).toEqual({
        color: "#101013",
        symbolColor: "#f4f4f6",
        height: 46,
      })
    },
  )
})
