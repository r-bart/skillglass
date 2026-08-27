import { createHash } from "node:crypto"
import { posix } from "node:path"

import { createLocalSourceManifest } from "@forge/scanner"

import { OperationValidationError } from "./errors.js"
import type {
  ArtifactRef,
  OperationPlan,
  OperationPrecondition,
  RootRelativePath,
  TreeContentEntry,
} from "./types.js"

interface CommonPlanInput {
  readonly id: string
  readonly createdAt: string
  readonly expiresAt?: string
  readonly adapterId: string
  readonly installationIds?: readonly string[]
  readonly commitMetadata?: OperationPlan["commitMetadata"]
}

export interface CreateInstallPlanInput extends CommonPlanInput {
  readonly source: RootRelativePath
  readonly sourceHash: string
  readonly destination: RootRelativePath
  readonly stage: RootRelativePath
}

export interface CreateSourceUpdatePlanInput extends CommonPlanInput {
  readonly source: RootRelativePath
  readonly sourceHash: string
  readonly destination: RootRelativePath
  readonly expectedBeforeHash: string
  readonly stage: RootRelativePath
  readonly snapshot: RootRelativePath
}

export interface CreateContentUpdatePlanInput extends CommonPlanInput {
  readonly destination: RootRelativePath
  readonly expectedBeforeHash: string
  readonly content: string
  readonly stage: RootRelativePath
  readonly snapshot: RootRelativePath
}

export interface CreateContentTreePlanInput extends CommonPlanInput {
  readonly destination: RootRelativePath
  readonly stage: RootRelativePath
  readonly entries: readonly TreeContentEntry[]
}

function validateRootRelative(path: RootRelativePath, label: string): void {
  if (path.rootId.length === 0) {
    throw new OperationValidationError(`${label} rootId cannot be empty`)
  }
  const value = path.relativePath.replaceAll("\\", "/")
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/.test(value) ||
    value.startsWith("//") ||
    value.includes("\0")
  ) {
    throw new OperationValidationError(`${label} must be relative to its root ID`)
  }
  const segments = value.split("/")
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new OperationValidationError(`${label} contains an unsafe path segment`)
  }
}

function artifact(path: RootRelativePath, kind: ArtifactRef["kind"]): ArtifactRef {
  validateRootRelative(path, "artifact")
  return { rootId: path.rootId, relativePath: path.relativePath, kind }
}

function validateStageSibling(destination: ArtifactRef, stage: ArtifactRef): void {
  if (
    destination.rootId !== stage.rootId ||
    posix.dirname(destination.relativePath.replaceAll("\\", "/")) !==
      posix.dirname(stage.relativePath.replaceAll("\\", "/"))
  ) {
    throw new OperationValidationError(
      "The stage path must be a sibling of the destination in the same approved root",
    )
  }
}

function validateCommon(input: CommonPlanInput): void {
  if (input.id.length === 0 || input.adapterId.length === 0) {
    throw new OperationValidationError("Plan and adapter IDs cannot be empty")
  }
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new OperationValidationError("createdAt must be an ISO date-time")
  }
  if (input.expiresAt !== undefined && !Number.isFinite(Date.parse(input.expiresAt))) {
    throw new OperationValidationError("expiresAt must be an ISO date-time")
  }
}

function base(
  input: CommonPlanInput,
): Pick<
  OperationPlan,
  | "id"
  | "revision"
  | "state"
  | "applyStarted"
  | "createdAt"
  | "updatedAt"
  | "expiresAt"
  | "adapterId"
  | "installationIds"
  | "undoStatus"
  | "commitMetadata"
> {
  validateCommon(input)
  return {
    id: input.id,
    revision: 0,
    state: "planned",
    applyStarted: false,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    adapterId: input.adapterId,
    installationIds: input.installationIds ?? [],
    ...(input.commitMetadata === undefined ? {} : { commitMetadata: input.commitMetadata }),
    undoStatus: "pending",
  }
}

function pathOnly(path: ArtifactRef): RootRelativePath {
  return { rootId: path.rootId, relativePath: path.relativePath }
}

function commonPreconditions(
  source: ArtifactRef | undefined,
  destination: ArtifactRef,
  stage: ArtifactRef,
  snapshot: ArtifactRef | undefined,
  expectedBeforeHash?: string,
  sourceHash?: string,
): readonly OperationPrecondition[] {
  if (source !== undefined && sourceHash === undefined) {
    throw new OperationValidationError("Source precondition requires an expected hash")
  }
  return [
    ...(source === undefined
      ? []
      : [
          { code: "approved-read", path: pathOnly(source) } as const,
          {
            code: "source-hash",
            path: pathOnly(source),
            expected: sourceHash ?? "",
          } as const,
        ]),
    { code: "approved-write", path: pathOnly(destination) },
    expectedBeforeHash === undefined
      ? { code: "destination-absent", path: pathOnly(destination) }
      : {
          code: "destination-hash",
          path: pathOnly(destination),
          expected: expectedBeforeHash,
        },
    { code: "stage-absent", path: pathOnly(stage) },
    ...(snapshot === undefined
      ? []
      : [
          { code: "approved-write", path: pathOnly(snapshot) } as const,
          { code: "snapshot-absent", path: pathOnly(snapshot) } as const,
        ]),
  ]
}

export function createInstallPlan(input: CreateInstallPlanInput): OperationPlan {
  const source = artifact(input.source, "tree")
  const destination = artifact(input.destination, "tree")
  const stage = artifact(input.stage, "tree")
  validateStageSibling(destination, stage)
  return {
    ...base(input),
    kind: "install",
    artifacts: { source, destination, stage },
    expectedSourceHash: input.sourceHash,
    expectedBefore: { exists: false },
    expectedAfterHash: input.sourceHash,
    preconditions: commonPreconditions(
      source,
      destination,
      stage,
      undefined,
      undefined,
      input.sourceHash,
    ),
    affectedPaths: [pathOnly(destination)],
    backup: { kind: "none-created-installation" },
    postconditions: [
      { code: "destination-hash", path: pathOnly(destination), expected: input.sourceHash },
    ],
    undo: { kind: "remove-created", artifact: destination, expectedHash: input.sourceHash },
  }
}

export function createContentTreePlan(input: CreateContentTreePlanInput): OperationPlan {
  const destination = artifact(input.destination, "tree")
  const stage = artifact(input.stage, "tree")
  validateStageSibling(destination, stage)
  if (input.entries.length === 0) {
    throw new OperationValidationError("Created content tree requires at least one file")
  }
  const entries = input.entries.map((entry) => ({
    relativePath: entry.relativePath,
    content: entry.content,
  }))
  const manifest = createLocalSourceManifest(entries.map((entry) => ({
    path: entry.relativePath,
    byteLength: Buffer.byteLength(entry.content, "utf8"),
    sha256: createHash("sha256").update(entry.content).digest("hex"),
  })))
  return {
    ...base(input),
    kind: "create-content-tree",
    artifacts: { destination, stage },
    expectedBefore: { exists: false },
    expectedAfterHash: manifest.treeHash,
    treeContent: entries,
    preconditions: commonPreconditions(undefined, destination, stage, undefined),
    affectedPaths: [pathOnly(destination)],
    backup: { kind: "none-created-installation" },
    postconditions: [
      { code: "destination-hash", path: pathOnly(destination), expected: manifest.treeHash },
    ],
    undo: { kind: "remove-created", artifact: destination, expectedHash: manifest.treeHash },
  }
}

export function createSourceUpdatePlan(
  input: CreateSourceUpdatePlanInput,
): OperationPlan {
  const source = artifact(input.source, "tree")
  const destination = artifact(input.destination, "tree")
  const stage = artifact(input.stage, "tree")
  const snapshot = artifact(input.snapshot, "tree")
  validateStageSibling(destination, stage)
  return {
    ...base(input),
    kind: "update-source",
    artifacts: { source, destination, stage, snapshot },
    expectedSourceHash: input.sourceHash,
    expectedBefore: { exists: true, hash: input.expectedBeforeHash },
    expectedAfterHash: input.sourceHash,
    preconditions: commonPreconditions(
      source,
      destination,
      stage,
      snapshot,
      input.expectedBeforeHash,
      input.sourceHash,
    ),
    affectedPaths: [pathOnly(destination)],
    backup: { kind: "snapshot", artifact: snapshot, expectedHash: input.expectedBeforeHash },
    postconditions: [
      { code: "destination-hash", path: pathOnly(destination), expected: input.sourceHash },
    ],
    undo: {
      kind: "restore-snapshot",
      destination,
      snapshot,
      expectedCurrentHash: input.sourceHash,
      restoredHash: input.expectedBeforeHash,
    },
  }
}

export function createContentUpdatePlan(
  input: CreateContentUpdatePlanInput,
): OperationPlan {
  const destination = artifact(input.destination, "file")
  const stage = artifact(input.stage, "file")
  const snapshot = artifact(input.snapshot, "file")
  validateStageSibling(destination, stage)
  const contentHash = createHash("sha256").update(input.content).digest("hex")
  return {
    ...base(input),
    kind: "update-content",
    artifacts: { destination, stage, snapshot },
    expectedBefore: { exists: true, hash: input.expectedBeforeHash },
    expectedAfterHash: contentHash,
    content: input.content,
    preconditions: commonPreconditions(
      undefined,
      destination,
      stage,
      snapshot,
      input.expectedBeforeHash,
    ),
    affectedPaths: [pathOnly(destination)],
    backup: { kind: "snapshot", artifact: snapshot, expectedHash: input.expectedBeforeHash },
    postconditions: [
      { code: "destination-hash", path: pathOnly(destination), expected: contentHash },
    ],
    undo: {
      kind: "restore-snapshot",
      destination,
      snapshot,
      expectedCurrentHash: contentHash,
      restoredHash: input.expectedBeforeHash,
    },
  }
}

export function assertOperationPlan(plan: OperationPlan): void {
  validateCommon(plan)
  validateRootRelative(plan.artifacts.destination, "destination")
  validateRootRelative(plan.artifacts.stage, "stage")
  validateStageSibling(plan.artifacts.destination, plan.artifacts.stage)
  if (plan.commitMetadata !== undefined && plan.commitMetadata.contract.length === 0) {
    throw new OperationValidationError("Commit metadata contract cannot be empty")
  }
  const createsDestination = plan.kind === "install" || plan.kind === "create-content-tree"
  if (createsDestination && plan.expectedBefore.exists) {
    throw new OperationValidationError("Created destination must be absent")
  }
  if (!createsDestination && !plan.expectedBefore.exists) {
    throw new OperationValidationError("Update destination must have a known hash")
  }
  if (plan.kind === "update-content" && plan.content === undefined) {
    throw new OperationValidationError("Content update requires persisted content")
  }
  if (plan.kind === "create-content-tree" && (plan.treeContent === undefined || plan.treeContent.length === 0)) {
    throw new OperationValidationError("Created content tree requires persisted entries")
  }
  if (plan.kind === "create-content-tree" && plan.treeContent !== undefined) {
    if (plan.artifacts.destination.kind !== "tree" || plan.artifacts.stage.kind !== "tree") {
      throw new OperationValidationError("Created content tree requires tree artifacts")
    }
    const manifest = createLocalSourceManifest(plan.treeContent.map((entry) => ({
      path: entry.relativePath,
      byteLength: Buffer.byteLength(entry.content, "utf8"),
      sha256: createHash("sha256").update(entry.content).digest("hex"),
    })))
    if (manifest.treeHash !== plan.expectedAfterHash) {
      throw new OperationValidationError("Persisted tree content no longer matches its planned hash")
    }
    if (plan.artifacts.source !== undefined || plan.artifacts.snapshot !== undefined) {
      throw new OperationValidationError("Created content tree cannot use source or snapshot artifacts")
    }
  }
  if (plan.kind !== "update-content" && plan.kind !== "create-content-tree" && plan.artifacts.source === undefined) {
    throw new OperationValidationError("Source-based operation requires a source artifact")
  }
  if (!createsDestination && plan.artifacts.snapshot === undefined) {
    throw new OperationValidationError("Update operation requires a snapshot artifact")
  }
}
