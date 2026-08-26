import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  MemoryOperationRepository,
  OperationConflictError,
  OperationEngine,
  OperationInterruptedError,
  OperationNotReadyError,
  OperationValidationError,
  createContentUpdatePlan,
  createInstallPlan,
  createSourceUpdatePlan,
  type ArtifactRef,
  type FileSystemPort,
  type OperationPlan,
  type OperationState,
} from "../src/index.js"

const OLD_HASH = "a".repeat(64)
const NEW_HASH = "b".repeat(64)
const BAD_HASH = "c".repeat(64)
const NOW = "2026-08-26T12:00:00.000Z"

interface StoredArtifact {
  readonly kind: ArtifactRef["kind"]
  readonly hash: string
  readonly content?: string
}

function key(ref: ArtifactRef): string {
  return `${ref.rootId}:${ref.relativePath}`
}

class FakeFileSystem implements FileSystemPort {
  readonly artifacts = new Map<string, StoredArtifact>()
  readonly approvedRoots = new Set(["source", "skills", "recovery"])
  replaceFailure: "none" | "before" | "ambiguous" = "none"

  seed(ref: ArtifactRef, hash: string, content?: string): void {
    this.artifacts.set(key(ref), {
      kind: ref.kind,
      hash,
      ...(content === undefined ? {} : { content }),
    })
  }

  async authorize(path: ArtifactRef): Promise<void> {
    if (!this.approvedRoots.has(path.rootId)) throw new Error("root not approved")
    expect(path.relativePath.startsWith("/")).toBe(false)
    expect(path.relativePath.includes("..")).toBe(false)
  }

  async observe(path: ArtifactRef): Promise<{ exists: boolean; hash?: string }> {
    const value = this.artifacts.get(key(path))
    return value === undefined ? { exists: false } : { exists: true, hash: value.hash }
  }

  async copyExclusive(source: ArtifactRef, destination: ArtifactRef): Promise<void> {
    const value = this.artifacts.get(key(source))
    if (value === undefined) throw new Error("copy source missing")
    if (this.artifacts.has(key(destination))) throw new Error("copy destination exists")
    this.artifacts.set(key(destination), { ...value })
  }

  async writeFileExclusive(destination: ArtifactRef, content: string): Promise<void> {
    if (this.artifacts.has(key(destination))) throw new Error("write destination exists")
    this.artifacts.set(key(destination), {
      kind: "file",
      hash: createHash("sha256").update(content).digest("hex"),
      content,
    })
  }

  async replace(source: ArtifactRef, destination: ArtifactRef): Promise<void> {
    const value = this.artifacts.get(key(source))
    if (value === undefined) throw new Error("replace source missing")
    if (this.replaceFailure === "before") {
      this.replaceFailure = "none"
      throw new Error("replace failed before mutation")
    }
    if (this.replaceFailure === "ambiguous") {
      this.replaceFailure = "none"
      this.artifacts.delete(key(source))
      this.artifacts.set(key(destination), { kind: destination.kind, hash: BAD_HASH })
      throw new Error("replace failed ambiguously")
    }
    this.artifacts.delete(key(source))
    this.artifacts.set(key(destination), { ...value })
  }

  async removeExact(path: ArtifactRef, expectedHash: string): Promise<boolean> {
    const value = this.artifacts.get(key(path))
    if (value === undefined || value.hash !== expectedHash) return false
    this.artifacts.delete(key(path))
    return true
  }
}

function paths(kind: ArtifactRef["kind"] = "tree") {
  return {
    source: { rootId: "source", relativePath: "example", kind } as const,
    destination: { rootId: "skills", relativePath: "example", kind } as const,
    stage: { rootId: "skills", relativePath: ".example.forge-stage", kind } as const,
    snapshot: { rootId: "recovery", relativePath: "plans/plan/snapshot", kind } as const,
  }
}

function updatePlan(): OperationPlan {
  const value = paths()
  return createSourceUpdatePlan({
    id: "plan",
    createdAt: NOW,
    adapterId: "codex",
    installationIds: ["installation"],
    source: value.source,
    sourceHash: NEW_HASH,
    destination: value.destination,
    expectedBeforeHash: OLD_HASH,
    stage: value.stage,
    snapshot: value.snapshot,
  })
}

function seededUpdateFileSystem(): FakeFileSystem {
  const fileSystem = new FakeFileSystem()
  const value = paths()
  fileSystem.seed(value.source, NEW_HASH)
  fileSystem.seed(value.destination, OLD_HASH)
  return fileSystem
}

async function readyEngine(
  repository: MemoryOperationRepository,
  fileSystem: FakeFileSystem,
  afterPersist?: (plan: OperationPlan) => void,
): Promise<OperationEngine> {
  const engine = new OperationEngine({
    repository,
    fileSystem,
    clock: { now: () => new Date(NOW) },
    ids: { next: (() => { let id = 0; return () => `event-${String(id++)}` })() },
    ...(afterPersist === undefined ? {} : { afterPersist }),
  })
  await engine.recoverStartup()
  return engine
}

describe("operation plan builders", () => {
  it("stores exact root-relative affected paths and rejects traversal or non-sibling stages", () => {
    const value = paths()
    const plan = createInstallPlan({
      id: "install",
      createdAt: NOW,
      adapterId: "codex",
      source: value.source,
      sourceHash: NEW_HASH,
      destination: value.destination,
      stage: value.stage,
    })
    expect(plan.affectedPaths).toEqual([{ rootId: "skills", relativePath: "example" }])
    expect(JSON.stringify(plan)).not.toContain("/Users/")
    expect(() =>
      createInstallPlan({
        id: "unsafe",
        createdAt: NOW,
        adapterId: "codex",
        source: value.source,
        sourceHash: NEW_HASH,
        destination: { rootId: "skills", relativePath: "../outside" },
        stage: value.stage,
      }),
    ).toThrow(OperationValidationError)
  })
})

describe("operation execution and persistent undo", () => {
  it("blocks writes until startup recovery has completed", async () => {
    const repository = new MemoryOperationRepository()
    const fileSystem = seededUpdateFileSystem()
    const engine = new OperationEngine({ repository, fileSystem })
    await engine.register(updatePlan())
    await expect(engine.execute("plan")).rejects.toBeInstanceOf(OperationNotReadyError)
  })

  it("stages, snapshots, applies, verifies, commits, and undoes after restart", async () => {
    const repository = new MemoryOperationRepository()
    const fileSystem = seededUpdateFileSystem()
    let engine = await readyEngine(repository, fileSystem)
    await engine.register(updatePlan())
    const committed = await engine.execute("plan")
    expect(committed).toMatchObject({ state: "committed", undoStatus: "available" })
    expect(await fileSystem.observe(paths().destination)).toEqual({ exists: true, hash: NEW_HASH })
    expect(await fileSystem.observe(paths().snapshot)).toEqual({ exists: true, hash: OLD_HASH })

    engine = await readyEngine(repository, fileSystem)
    const undone = await engine.undo("plan")
    expect(undone.undoStatus).toBe("completed")
    expect(await fileSystem.observe(paths().destination)).toEqual({ exists: true, hash: OLD_HASH })
    const events = await repository.listEvents("plan")
    expect(events.map(({ sequence }) => sequence)).toEqual(events.map((_, index) => index))
  })

  it("supports direct content updates without filesystem paths or execution", async () => {
    const repository = new MemoryOperationRepository()
    const fileSystem = new FakeFileSystem()
    const value = paths("file")
    fileSystem.seed(value.destination, OLD_HASH, "old")
    const content = "---\nname: Safe\n---\nUpdated\n"
    const plan = createContentUpdatePlan({
      id: "content",
      createdAt: NOW,
      adapterId: "folder",
      installationIds: ["installation"],
      destination: value.destination,
      expectedBeforeHash: OLD_HASH,
      content,
      stage: value.stage,
      snapshot: value.snapshot,
    })
    const engine = await readyEngine(repository, fileSystem)
    await engine.register(plan)
    await expect(engine.execute(plan.id)).resolves.toMatchObject({ state: "committed" })
    expect(fileSystem.artifacts.get(key(value.destination))?.content).toBe(content)
  })

  it("refuses undo after an external edit and leaves the tree untouched", async () => {
    const repository = new MemoryOperationRepository()
    const fileSystem = seededUpdateFileSystem()
    const engine = await readyEngine(repository, fileSystem)
    await engine.register(updatePlan())
    await engine.execute("plan")
    fileSystem.seed(paths().destination, BAD_HASH)
    await expect(engine.undo("plan")).rejects.toBeInstanceOf(OperationConflictError)
    expect(await fileSystem.observe(paths().destination)).toEqual({ exists: true, hash: BAD_HASH })
    expect((await repository.get("plan"))?.undoStatus).toBe("available")
  })
})

describe("interruption and startup recovery", () => {
  const forwardStates: readonly OperationState[] = [
    "planned",
    "preconditions-checked",
    "staged",
    "snapshot-created",
    "applying",
    "verifying",
    "committed",
  ]

  for (const interruptedState of forwardStates) {
    it(`recovers an interruption after durable ${interruptedState}`, async () => {
      const repository = new MemoryOperationRepository()
      const fileSystem = seededUpdateFileSystem()
      let armed = interruptedState === "planned"
      let interrupted = false
      const engine = await readyEngine(repository, fileSystem, (plan) => {
        if (armed && !interrupted && plan.state === interruptedState) {
          interrupted = true
          throw new OperationInterruptedError(`crash at ${interruptedState}`)
        }
      })
      if (interruptedState !== "planned") armed = false
      const registration = engine.register(updatePlan())
      if (interruptedState === "planned") {
        await expect(registration).rejects.toBeInstanceOf(OperationInterruptedError)
      } else {
        await registration
        armed = true
        await expect(engine.execute("plan")).rejects.toBeInstanceOf(OperationInterruptedError)
      }

      const restarted = await readyEngine(repository, fileSystem)
      expect(restarted.ready).toBe(true)
      const recovered = await repository.get("plan")
      expect(recovered?.state).toBe(
        interruptedState === "verifying" || interruptedState === "committed"
          ? "committed"
          : "rolled-back",
      )
    })
  }

  for (const interruptedState of ["rolling-back", "rolled-back"] as const) {
    it(`resumes interruption at ${interruptedState}`, async () => {
      const repository = new MemoryOperationRepository()
      const fileSystem = seededUpdateFileSystem()
      let armed = false
      let interrupted = false
      const engine = await readyEngine(repository, fileSystem, (plan) => {
        if (armed && !interrupted && plan.state === interruptedState) {
          interrupted = true
          throw new OperationInterruptedError(`crash at ${interruptedState}`)
        }
      })
      await engine.register(updatePlan())
      armed = true
      fileSystem.replaceFailure = "before"
      await expect(engine.execute("plan")).rejects.toBeInstanceOf(OperationInterruptedError)
      await readyEngine(repository, fileSystem)
      expect((await repository.get("plan"))?.state).toBe("rolled-back")
    })
  }

  it("persists recovery-required when interrupted apply leaves an unknown tree", async () => {
    const repository = new MemoryOperationRepository()
    const fileSystem = seededUpdateFileSystem()
    let armed = false
    const engine = await readyEngine(repository, fileSystem, (plan) => {
      if (armed && plan.state === "recovery-required") {
        throw new OperationInterruptedError("crash after recovery-required")
      }
    })
    await engine.register(updatePlan())
    armed = true
    fileSystem.replaceFailure = "ambiguous"
    await expect(engine.execute("plan")).rejects.toBeInstanceOf(OperationInterruptedError)
    await readyEngine(repository, fileSystem)
    expect((await repository.get("plan"))?.state).toBe("recovery-required")
    expect(await fileSystem.observe(paths().destination)).toEqual({ exists: true, hash: BAD_HASH })
  })

  it("finishes an interrupted undo after restart", async () => {
    const repository = new MemoryOperationRepository()
    const fileSystem = seededUpdateFileSystem()
    let interruptUndo = false
    const engine = await readyEngine(repository, fileSystem, (plan) => {
      if (interruptUndo && plan.undoStatus === "applying") {
        interruptUndo = false
        throw new OperationInterruptedError("crash before undo mutation")
      }
    })
    await engine.register(updatePlan())
    await engine.execute("plan")
    interruptUndo = true
    await expect(engine.undo("plan")).rejects.toBeInstanceOf(OperationInterruptedError)
    await readyEngine(repository, fileSystem)
    expect((await repository.get("plan"))?.undoStatus).toBe("completed")
    expect(await fileSystem.observe(paths().destination)).toEqual({ exists: true, hash: OLD_HASH })
  })
})
