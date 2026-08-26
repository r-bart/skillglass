import path from "node:path"

import type { App } from "electron"

/**
 * Electron forwards this Chromium switch but does not map it to app.getPath("userData")
 * on every platform. Honour it before ready so native smoke runs and portable launches
 * use one unambiguous profile directory.
 */
export function applyUserDataCommandLineOverride(
  electronApp: Pick<App, "setPath"> & {
    readonly commandLine: Pick<App["commandLine"], "getSwitchValue">
  },
): void {
  const requestedPath = electronApp.commandLine.getSwitchValue("user-data-dir")
  if (requestedPath.length === 0) return
  if (!path.isAbsolute(requestedPath)) {
    throw new TypeError("--user-data-dir must be an absolute path")
  }
  electronApp.setPath("userData", path.normalize(requestedPath))
}
