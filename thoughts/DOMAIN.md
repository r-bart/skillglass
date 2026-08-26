# Forge — Domain Contract

**Status**: Draft for MVP
**Updated**: 2026-08-26

## Purpose

This document defines the concepts that Forge may persist and present. Runtime-specific behavior is delegated to adapters; filesystem mutations are defined in `OPERATIONS.md`.

## Core Model

```text
Machine
├── RuntimeAdapter
│   └── SourceRoot
│       └── SkillInstallation
│           ├── SkillSnapshot
│           └── Provenance
├── ProjectScope
│   └── ScopeBinding
└── EffectiveSkill
    └── resolution evidence
```

### RuntimeAdapter

Describes one runtime or compatible skill convention.

```ts
type RuntimeAdapter = {
  id: string
  displayName: string
  capabilities: AdapterCapabilities
}
```

It owns root discovery, scope resolution, precedence, read-only runtime-state observation, validation additions, and supported install/update planning.

### SourceRoot

A canonical directory scanned by one adapter.

```ts
type SourceRoot = {
  id: string
  adapterId: string
  canonicalPath: CanonicalPath
  kind: "global" | "project" | "managed" | "system" | "user-added"
  projectId?: string
  access: "read-write" | "read-only" | "missing" | "denied"
  discovery: Evidence
}
```

Canonical roots are deduplicated after resolving platform aliases, symlinks, and junctions according to adapter policy.

### ProjectScope

A project known to Forge. It is not inferred solely from a folder name.

```ts
type ProjectScope = {
  id: string
  displayName: string
  canonicalPath: CanonicalPath
  adapterIds: string[]
}
```

`Todas` / `Esta máquina` is an inventory view, not a scope. `Global` is a real storage or runtime scope and never means "all installations".

### SkillInstallation

One concrete skill directory discovered in one source root.

```ts
type SkillInstallation = {
  id: string
  adapterId: string
  rootId: string
  canonicalPath: CanonicalPath
  entryFile: CanonicalPath
  scope: "global" | { projectId: string } | "managed" | "system"
  snapshotId: string
  provenanceId: string
  access: "read-write" | "read-only"
}
```

The primary identity is the adapter plus canonical path. Name alone is never an identity key.

### SkillSnapshot

An immutable observation of an installation at a point in time.

```ts
type SkillSnapshot = {
  id: string
  installationId: string
  contentHash: string
  observedAt: string
  name: Evidenced<string>
  description: Evidenced<string>
  declaredVersion: Evidenced<string>
  files: FileObservation[]
  requirements: Requirement[]
  findings: ValidationFinding[]
}
```

The snapshot retains raw source text. Parsing metadata must not silently rewrite formatting, comments, or unknown fields.

### Provenance

Describes where an installation came from and who controls updates.

```ts
type Provenance = {
  kind: "local" | "forge-import" | "registry" | "package" | "plugin" | "system" | "unknown"
  sourceUrl?: string
  packageId?: string
  release?: string
  commit?: string
  license?: string
  installedHash?: string
  managedBy: "forge" | "external" | "runtime" | "user" | "unknown"
}
```

Strings such as `"skills.sh · mit"` are presentation, not domain data.

### ScopeBinding

Describes visibility, inheritance, and any observable runtime state for one installation in one effective scope.

```ts
type ScopeBinding = {
  installationId: string
  targetScope: "global" | { projectId: string }
  relationship: "owned" | "inherited" | "shadowed" | "excluded" | "unavailable"
  runtimeState: "enabled" | "disabled" | "inherit" | "unsupported" | "unknown"
  evidence: Evidence
}
```

Runtime state is observed, never controlled by Forge. When present, it is scoped by installation × target scope × adapter and backed by evidence from the harness.

### EffectiveSkill

The result of adapter resolution for one name or runtime identity in one target scope.

```ts
type EffectiveSkill = {
  adapterId: string
  targetScope: "global" | { projectId: string }
  key: string
  winnerInstallationId?: string
  candidateInstallationIds: string[]
  reason: Evidenced<string>
  status: "resolved" | "conflict" | "unsupported" | "unknown"
}
```

Forge only labels one candidate as the winner when the adapter can prove the precedence rule.

## Evidence Model

```ts
type Evidence = {
  kind: "observed" | "derived" | "inferred" | "unknown"
  source?: string
  confidence?: number
  observedAt?: string
}

type Evidenced<T> = {
  value?: T
  evidence: Evidence
}
```

Rules:

- `unknown` has no fabricated fallback value.
- Inferred data is labelled in the interface.
- Confidence is for heuristics, not a substitute for a source.
- Derived data records its observed inputs.
- Stale evidence is not silently treated as current.

## Version and Revision

Forge separates four concepts:

- **Declared version**: optional metadata written by the author.
- **Source release**: registry, package, or repository release.
- **Source commit**: immutable upstream reference when available.
- **Local revision**: Forge snapshot number and content hash.

The UI must not manufacture semantic versions. Saving an unversioned skill creates a local revision, not `v1.1`.

## Validation

Validity is represented by findings rather than a single health flag.

```ts
type ValidationFinding = {
  code: string
  severity: "info" | "warning" | "error"
  message: string
  file?: CanonicalPath
  range?: { start: number; end: number }
  source: "core" | { adapterId: string }
}
```

Core validation may check:

- Required entry file.
- Parseable frontmatter.
- Required fields.
- Resource references contained within the skill directory.
- Duplicate canonical names in a scope.
- Unsafe links or inaccessible files.

Adapter validation adds only runtime-specific rules it can verify.

## Requirements and Dependencies

```ts
type Requirement = {
  kind: "skill" | "tool" | "runtime" | "file" | "environment" | "external" | "unknown"
  name: string
  evidence: Evidence
  resolution: "satisfied" | "missing" | "unknown"
}
```

Prose references are not automatically dependency edges. A graph may display only declared or deterministically resolved relationships; inferred relationships require a distinct visual and textual label.

## Status Dimensions

The former `health` enum is replaced by independent status dimensions:

```ts
type SkillStatus = {
  validity: "valid" | "warning" | "invalid" | "unknown"
  runtimeState: "enabled" | "disabled" | "inherited" | "shadowed" | "unsupported" | "unknown"
  source: "local" | "managed" | "read-only" | "modified" | "unknown"
  update: "current" | "available" | "diverged" | "unavailable" | "unknown"
  usage: "observed" | "unavailable"
}
```

The interface may summarize these statuses, but must preserve the underlying distinctions.

## Packages and Authors

Author and package are optional evidenced attributes.

For the MVP:

- Authors may be filtered or grouped when present.
- Package provenance may be displayed.
- A package is not a navigable or mutable domain object.
- Forge does not promise package-wide update or uninstall.

Package entities may be introduced later without changing installation identity.

## History

Forge history records content snapshots and operation journal entries. It does not rewrite or impersonate upstream version history.

Retention target:

- The latest 30 local snapshots per installation, or
- Snapshots from the latest 90 days,
- Whichever retains more recoverable user work, subject to a configurable storage ceiling.

## Domain Invariants

1. Canonical path identity is unique within an adapter.
2. `Global` contains only global installations.
3. Inventory view and storage scope are different concepts.
4. Unknown data remains unknown.
5. Name collisions are resolved by adapters, never by array order.
6. Runtime state is read-only, scoped, and evidence-backed; Forge never mutates it.
7. Managed, system, plugin, denied, and otherwise non-user-writable installations are never edited in place.
8. Every mutation references a persisted operation plan and journal entry.
9. A snapshot is immutable after creation.
10. The filesystem, not SQLite, determines current installed content.
11. Forge never requests elevated filesystem privileges.
