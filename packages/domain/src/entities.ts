import type { Evidence, Evidenced } from "./evidence.js"

declare const canonicalPathBrand: unique symbol

/** A path that has already been canonicalized by the scanner path service. */
export type CanonicalPath = string & {
  readonly [canonicalPathBrand]: "CanonicalPath"
}

export function canonicalPath(value: string): CanonicalPath {
  if (value.length === 0) {
    throw new TypeError("Canonical path cannot be empty")
  }

  if (value.includes("\0")) {
    throw new TypeError("Canonical path cannot contain a null byte")
  }

  return value as CanonicalPath
}

export type RootKind =
  | "global"
  | "project"
  | "managed"
  | "system"
  | "user-added"

export type RootAccess = "read-write" | "read-only" | "missing" | "denied"

export interface SourceRoot {
  readonly id: string
  readonly adapterId: string
  readonly canonicalPath: CanonicalPath
  readonly kind: RootKind
  readonly projectId?: string
  readonly access: RootAccess
  readonly discovery: Evidence
}

export interface ProjectScope {
  readonly id: string
  readonly displayName: string
  readonly canonicalPath: CanonicalPath
  readonly adapterIds: readonly string[]
}

export type InstallationScope =
  | "global"
  | Readonly<{ projectId: string }>
  | "managed"
  | "system"

export type InstallationAccess = "read-write" | "read-only"

export interface SkillInstallation {
  readonly id: string
  readonly adapterId: string
  readonly rootId: string
  readonly canonicalPath: CanonicalPath
  readonly entryFile: CanonicalPath
  readonly scope: InstallationScope
  readonly snapshotId: string
  readonly provenanceId: string
  readonly access: InstallationAccess
}

export interface FileObservation {
  readonly canonicalPath: CanonicalPath
  readonly contentHash: string
  readonly size: number
}

export interface SourceRange {
  readonly start: number
  readonly end: number
}

export interface ValidationFinding {
  readonly code: string
  readonly severity: "info" | "warning" | "error"
  readonly message: string
  readonly file?: CanonicalPath
  readonly range?: SourceRange
  readonly source: "core" | Readonly<{ adapterId: string }>
}

export type RequirementKind =
  | "skill"
  | "tool"
  | "runtime"
  | "file"
  | "environment"
  | "external"
  | "unknown"

export interface Requirement {
  readonly kind: RequirementKind
  readonly name: string
  readonly evidence: Evidence
  readonly resolution: "satisfied" | "missing" | "unknown"
}

/** Immutable observation. Every member is readonly, including nested arrays. */
export interface SkillSnapshot {
  readonly id: string
  readonly installationId: string
  readonly contentHash: string
  readonly observedAt: string
  readonly name: Evidenced<string>
  readonly description: Evidenced<string>
  readonly declaredVersion: Evidenced<string>
  readonly files: readonly FileObservation[]
  readonly requirements: readonly Requirement[]
  readonly findings: readonly ValidationFinding[]
  /** Unmodified entry-file source, retained for lossless inspection/editing. */
  readonly rawSource: string
}

export type ProvenanceKind =
  | "local"
  | "forge-import"
  | "registry"
  | "package"
  | "plugin"
  | "system"
  | "unknown"

export interface Provenance {
  readonly kind: ProvenanceKind
  readonly sourceUrl?: string
  readonly packageId?: string
  readonly release?: string
  readonly commit?: string
  readonly license?: string
  readonly installedHash?: string
  readonly managedBy: "forge" | "external" | "runtime" | "user" | "unknown"
}

export type TargetScope = "global" | Readonly<{ projectId: string }>

export interface ScopeBinding {
  readonly installationId: string
  readonly targetScope: TargetScope
  readonly relationship:
    | "owned"
    | "inherited"
    | "shadowed"
    | "excluded"
    | "unavailable"
  readonly runtimeState:
    | "enabled"
    | "disabled"
    | "inherit"
    | "unsupported"
    | "unknown"
  readonly evidence: Evidence
}

export interface EffectiveSkill {
  readonly adapterId: string
  readonly targetScope: TargetScope
  readonly key: string
  readonly winnerInstallationId?: string
  readonly candidateInstallationIds: readonly string[]
  readonly reason: Evidenced<string>
  readonly status: "resolved" | "conflict" | "unsupported" | "unknown"
}

export interface SkillStatus {
  readonly validity: "valid" | "warning" | "invalid" | "unknown"
  readonly runtimeState:
    | "enabled"
    | "disabled"
    | "inherited"
    | "shadowed"
    | "unsupported"
    | "unknown"
  readonly source: "local" | "managed" | "read-only" | "modified" | "unknown"
  readonly update: "current" | "available" | "diverged" | "unavailable" | "unknown"
  readonly usage: "observed" | "unavailable"
}
