import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import { applyUserDataCommandLineOverride } from "./user-data-path.js"

function fakeApp(value: string) {
  return {
    commandLine: {
      getSwitchValue: vi.fn(() => value),
    },
    setPath: vi.fn(),
  }
}

describe("applyUserDataCommandLineOverride", () => {
  it("leaves Electron's default userData path unchanged without the switch", () => {
    const electronApp = fakeApp("")

    applyUserDataCommandLineOverride(electronApp)

    expect(electronApp.setPath).not.toHaveBeenCalled()
  })

  it("normalizes and applies an absolute userData path", () => {
    const requestedPath = path.join(path.parse(process.cwd()).root, "forge", "nested", "..", "profile")
    const electronApp = fakeApp(requestedPath)

    applyUserDataCommandLineOverride(electronApp)

    expect(electronApp.setPath).toHaveBeenCalledOnce()
    expect(electronApp.setPath).toHaveBeenCalledWith("userData", path.normalize(requestedPath))
  })

  it("rejects a relative userData path", () => {
    const electronApp = fakeApp(path.join("relative", "profile"))

    expect(() => applyUserDataCommandLineOverride(electronApp)).toThrow(
      "--user-data-dir must be an absolute path",
    )
    expect(electronApp.setPath).not.toHaveBeenCalled()
  })
})
