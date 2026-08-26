import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { resolveRendererAssetPath } from "./protocol.js"

describe("forge protocol asset resolution", () => {
  const rendererRoot = resolve("/tmp/forge-renderer")

  it("maps only Forge app URLs inside the renderer bundle", () => {
    expect(resolveRendererAssetPath(rendererRoot, "forge://app/index.html")).toBe(
      resolve(rendererRoot, "index.html"),
    )
    expect(resolveRendererAssetPath(rendererRoot, "forge://app/assets/main.js?hash=1")).toBe(
      resolve(rendererRoot, "assets/main.js"),
    )
  })

  it("rejects other origins and malformed paths", () => {
    expect(resolveRendererAssetPath(rendererRoot, "forge://other/index.html")).toBeNull()
    expect(resolveRendererAssetPath(rendererRoot, "https://app/index.html")).toBeNull()
    expect(resolveRendererAssetPath(rendererRoot, "forge://app/%00secret")).toBeNull()
    expect(resolveRendererAssetPath(rendererRoot, "not a url")).toBeNull()
  })
})
