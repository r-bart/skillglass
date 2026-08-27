import { watch } from "chokidar"

import type {
  WatchEventKind,
  WatchSource,
  WatchSourceFactory,
} from "./types.js"

const SUPPORTED_EVENTS = new Set<WatchEventKind>([
  "add",
  "addDir",
  "change",
  "unlink",
  "unlinkDir",
])

const FORGE_INTERNAL_ARTIFACT = /(^|[\\/])(?:\.forge-(?:source|stage|displaced)-|[^\\/]*\.forge-stage-)/u

function isSupportedEvent(kind: string): kind is WatchEventKind {
  return SUPPORTED_EVENTS.has(kind as WatchEventKind)
}

export const createChokidarWatchSource: WatchSourceFactory = (paths) => {
  const watcher = watch([...paths], {
    atomic: true,
    ignored: FORGE_INTERNAL_ARTIFACT,
    ignoreInitial: true,
    persistent: true,
  })
  const ready = new Promise<void>((resolve, reject) => {
    const onStartupError = (error: unknown): void => reject(error)
    watcher.once("error", onStartupError)
    watcher.once("ready", () => {
      watcher.off("error", onStartupError)
      resolve()
    })
  })
  const source: WatchSource = {
    onAll(listener) {
      watcher.on("all", (kind, candidate) => {
        if (isSupportedEvent(kind)) listener(kind, candidate)
      })
    },
    onError(listener) {
      watcher.on("error", listener)
    },
    ready() {
      return ready
    },
    async close() {
      await watcher.close()
    },
  }
  return source
}
