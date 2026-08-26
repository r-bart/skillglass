import { net, protocol } from "electron"
import { isAbsolute, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const FORGE_SCHEME = "forge"
export const FORGE_APP_ORIGIN = `${FORGE_SCHEME}://app`

export function resolveRendererAssetPath(rendererRoot: string, requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== `${FORGE_SCHEME}:` || url.hostname !== "app") {
      return null
    }

    const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html"
    if (requestedPath.includes("\0")) {
      return null
    }

    const root = resolve(rendererRoot)
    const candidate = resolve(root, requestedPath)
    const fromRoot = relative(root, candidate)

    if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
      return null
    }

    return candidate
  } catch {
    return null
  }
}

export function registerForgeProtocol(rendererRoot: string): void {
  protocol.handle(FORGE_SCHEME, async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405 })
    }

    const assetPath = resolveRendererAssetPath(rendererRoot, request.url)
    if (assetPath === null) {
      return new Response(null, { status: 404 })
    }

    return net.fetch(pathToFileURL(assetPath).toString(), {
      method: request.method,
    })
  })
}
