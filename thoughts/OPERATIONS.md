# Forge — Filesystem Operations Contract

**Status**: Draft for MVP; local-source rules frozen
**Updated**: 2026-08-26

## Purpose

Forge manages user-authored and externally managed files. Every mutation must be previewable, atomic where the platform allows it, recoverable after interruption, and honest about its scope.

## Operation Classes

### Read-only

- Discover roots.
- Scan installations.
- Parse and validate.
- Hash files.
- Resolve effective scope.
- Preview diffs and operation plans.

Read-only operations may update Forge's index but do not change skill files.

### Supported mutations

- Install into an approved user-writable root.
- Update a writable installation from a verified source revision.
- Update writable skill content through direct editing.

### Remote or source-managed mutations

- Import from URL.
- Install from a registry.
- Package-wide operations.
- Rebase a fork.
- Activation, deactivation, and harness configuration.
- Uninstall, deletion, quarantine, and filesystem relocation.
- Any write that requires administrator, root, or operating-system elevation.

These operations are outside the MVP unless a later contract explicitly enables them.

## Local Installation Sources (`local-source-v1`)

The only installation sources in the MVP are a directory selected by the user and a local `.zip` file selected by the user. The normative validation, hashing, provenance, collision, and undo rules are frozen in `thoughts/research/local-source-contract.md`. Implementations and tests use the contract identifier `local-source-v1`; changing a limit or identity rule requires a new identifier.

```ts
type LocalInstallSource =
  | {
      kind: "directory"
      selectionToken: string
      treeHash: string
    }
  | {
      kind: "zip"
      selectionToken: string
      archiveSha256: string
      treeHash: string
    }
```

Selection tokens are opaque, process-local capabilities minted by a native file dialog. They expire after 15 minutes, are valid for one plan, are bound to the selected canonical path and source kind, and are never persisted. The renderer never supplies an import path.

### Admission limits

| Limit | Directory | ZIP |
|---|---:|---:|
| Source/archive bytes | 100 MiB included bytes | 25 MiB archive bytes |
| Expanded included bytes | 100 MiB | 100 MiB |
| Single included file | 10 MiB | 10 MiB expanded |
| Included regular files | 2,000 | 2,000 |
| Included directories | 512 | 512 |
| Relative nesting below payload root | 16 segments | 16 segments |
| Relative path | 1,024 UTF-8 bytes | 1,024 UTF-8 bytes |
| Path segment | 255 UTF-8 bytes | 255 UTF-8 bytes |
| Compression ratio | n/a | 100:1 per entry and total |

Limit accounting is streaming and fail-closed. ZIP validation checks both declared central-directory values before extraction and actual emitted bytes during extraction. Encrypted, multi-disk, malformed, ZIP64 sources exceeding these limits, and compression methods other than STORE and DEFLATE are rejected.

### Payload and entry rules

- One source installs exactly one skill. A directory payload must have `SKILL.md` at its selected root.
- A ZIP may have `SKILL.md` at archive root or one unambiguous wrapper directory containing it; only that one wrapper is stripped.
- Only regular files and directories are admitted. Directory symlinks, junctions, reparse points, sockets, devices, and FIFOs are rejected. ZIP link entries and special Unix modes are rejected. Hard links are never reproduced; accepted regular-file bytes are copied into new files.
- Forge never follows links while enumerating, hashing, staging, verifying, or undoing an import.
- Entry names are interpreted with both `/` and `\\` as separators for security checks, normalized to NFC, and rejected if absolute, drive-qualified, UNC/device-qualified, empty, `.`/`..`, NUL/control-containing, Windows-reserved, or trailing in a dot or space.
- Two entries that collide after NFC normalization and locale-independent Unicode case folding are rejected even when the current filesystem would distinguish them.
- `.DS_Store`, `Thumbs.db`, `desktop.ini`, `__MACOSX/**`, AppleDouble `._*`, `.git/**`, `.hg/**`, and `.svn/**` are ignored before payload count/expanded-byte accounting, hashing, preview, and copy. Raw ZIP bytes and compressed-stream safety accounting still include ignored entries. No other hidden path is silently ignored.
- Archive timestamps, owners, ACLs, extended attributes, and executable bits are not restored. New content receives private user-owned defaults subject to the user's umask. Imported content is stored as data and is never executed.

### Identity and hashing

The archive SHA-256 is over the raw ZIP bytes. The tree hash is SHA-256 over the domain tag `forge-tree-v1`, followed by every included regular file in ascending bytewise order of its NFC-normalized UTF-8 relative path. Each record commits to the record kind, path byte length, path bytes, raw file byte length, and SHA-256 of raw file bytes using NUL-delimited fields. Line endings, encoding, and file contents are never normalized.

Directories, timestamps, ownership, permission bits, and ignored metadata do not affect `treeHash`; empty directories are not installed. The persisted per-file manifest makes the hash independently reproducible and supports exact undo verification.

### Provenance and collisions

Committed imports record source kind, canonical local source locator, source observation time, contract version, archive hash when applicable, normalized source tree hash, payload wrapper decision, ignored-entry summary, installed tree hash and manifest, target root/installation IDs, destination canonical path, and creating journal ID. The local locator is private local state and is never sent to the renderer unless explicitly needed for display.

Planning fails on any existing destination entry or any portable-name collision with a sibling. Forge does not merge, overwrite, rename automatically, or offer "replace" during installation. A destination that appears or changes after preview makes the plan stale. The adapter validates the destination directory segment; the source layer does not infer runtime naming semantics.

## Operation Plan

No mutating command is invoked directly from the renderer. The main process first creates and persists a plan.

```ts
type OperationPlan = {
  id: string
  kind: OperationKind
  createdAt: string
  adapterId: string
  installationIds: string[]
  targetScope?: ScopeRef
  preconditions: Precondition[]
  steps: FilesystemStep[]
  affectedPaths: CanonicalPath[]
  affectedScopes: ScopeRef[]
  conflicts: OperationConflict[]
  warnings: OperationWarning[]
  backup: BackupPlan
  postconditions: Postcondition[]
  undo: UndoPlan | "not-supported"
}
```

The confirmation surface shows:

- The exact action and target scope.
- Every path created or modified.
- Which projects may observe a precedence change.
- Collisions and external dependencies.
- Whether undo survives application restart.
- Why an operation is unavailable.

## Transaction Lifecycle

```text
planned
  → preconditions-checked
  → staged
  → snapshot-created
  → applying
  → verifying
  → committed

Any failure:
  → rolling-back
  → rolled-back | recovery-required
```

### 1. Validate paths

- Canonicalize every source and destination.
- Confirm each path is within an approved root.
- Reject traversal and unsafe external links.
- Detect symlink/junction cycles.
- Confirm source identity still matches the planned hash.

### 2. Check preconditions

- Source exists and has expected access.
- Destination has not appeared since planning.
- Files have not changed since preview.
- Adapter capability is still available.
- No conflicting Forge transaction is active.

### 3. Stage

Write new content into a sibling temporary location on the same filesystem when possible. Validate the staged tree before replacing any live path.

### 4. Snapshot

Persist original content and metadata in Forge's recovery store. Record hashes before applying the operation.

### 5. Apply

Prefer atomic rename or replace within a filesystem. Multi-path operations are journaled step by step because they cannot be globally atomic across filesystems.

### 6. Verify

Rescan affected roots, verify expected hashes and effective resolution, and surface unexpected runtime results as operation failures.

### 7. Commit

Mark the journal entry committed only after verification. Emit UI events from the committed observation rather than optimistic renderer state.

## Recovery and Undo

Undo is persistent and references a committed journal entry. It is not stored in toast state.

- A toast may expose the latest undo action.
- History exposes earlier reversible operations.
- Restarting Forge preserves undo.
- Interrupted operations are inspected before a new mutation begins.
- Recovery never overwrites newly changed user files without another conflict plan.
- Undo for a committed installation is available only through its creating journal entry. It may remove only the exact destination tree that the journal created, after canonical path, ownership, complete entry manifest, and installed tree hash still match.
- Any added, removed, renamed, or byte-modified entry—including later metadata files—makes install undo unavailable. Forge leaves the tree untouched and reports a conflict; it never turns this into a general uninstall or recursive delete.
- When install undo is admissible, Forge removes journal-owned files individually, then removes only directories proven empty, from deepest to shallowest. It never deletes an unowned entry and never follows a link encountered during verification.
- A failed installation uses the same ownership and exact-hash checks for rollback after the destination became visible. If those checks fail, the journal enters `recovery-required` rather than deleting uncertain content.

Snapshot retention follows `DOMAIN.md`.

## Operation Semantics

### Install

- Accept only `local-source-v1` directory and ZIP sources.
- Validate the complete skill tree in staging before copying it.
- Show every destination path and collision before confirmation.
- Install only into an approved user-writable root.
- Never change harness activation or configuration as a side effect.
- Record the mandatory source identity, normalized tree hash, installed manifest, destination identity, and journal ownership defined above.

### Update from source

- Require a verified source and a known installed revision or hash.
- Show the complete content diff before confirmation.
- Detect local divergence and refuse silent overwrite.
- Snapshot the installed tree before replacement.
- Preserve user-authored files unless the update plan explicitly includes them.
- Never imply that applying an update activates or reloads the skill in its harness.

### Direct content update

- Load the current raw snapshot.
- Detect external changes before saving.
- Save only after creating a snapshot.
- Preserve unknown metadata and unrelated formatting.
- Treat a content change as a local revision; do not invent a semantic version.
- Allow writes only when the installation is inside an approved user-writable root.

### Permission handling

- A destination that is not already user-writable is unavailable.
- Forge never invokes `sudo`, UAC elevation, privileged helpers, or permission-changing workarounds.
- The UI may explain how the harness owns a managed location, but must not instruct the user to weaken system permissions.

## Batch Operations

A batch is a collection of independently journaled child plans with a parent summary.

- Homogeneous compatible selections may expose one batch action.
- Mixed pending types use "Resolver" and present per-item operations.
- One child failure does not claim the entire batch succeeded.
- The completion summary reports committed, rolled back, skipped, and recovery-required items.
- Undo may target one child or every successfully committed child when safe.

## Import Security Contract

When remote import is introduced:

- Download into isolated staging.
- Enforce byte, file-count, nesting, and decompression limits.
- Reject absolute paths and traversal entries.
- Do not follow or create unsafe external links.
- Never execute bundled scripts or binaries.
- Render Markdown without active content.
- Record final URL, immutable revision where available, checksum, license, and source.
- Show a full tree and content diff before installation.
- Require explicit confirmation after inspection.

Remote content declarations such as "no network" or "read-only" are descriptive metadata, not a security boundary.

## Concurrency and Watchers

- Watchers update observations but never perform mutations automatically.
- Self-generated watcher events are correlated with the active journal entry.
- External edits invalidate stale plans.
- Expensive scans, hashes, and diffs run outside Electron's renderer and main event loop.
- Locked files, antivirus delays, permission prompts, and rename behavior are treated as normal platform failure modes.

## Renderer and IPC Boundary

The React renderer may request:

- A read model.
- A new operation plan.
- Confirmation or cancellation of a specific persisted plan.
- Undo of a committed journal entry.

It may not send arbitrary filesystem commands or unrestricted paths. IPC inputs and persisted data are runtime-validated. The main process rechecks authorization and preconditions regardless of renderer state.

## UI Feedback Contract

- Planning is visibly distinct from applying.
- Long operations expose current stage and cancellability.
- Toasts summarize committed outcomes; they are not the source of truth.
- Errors identify the failed path and safe recovery action without exposing secrets.
- Unsupported actions explain the missing adapter capability.
- High-impact confirmations never depend only on color.

## Verification Matrix

Each mutation is tested for:

- Success on macOS, Windows, and Linux fixtures.
- Source changed after preview.
- Destination collision.
- Read-only source or destination.
- Symlink/junction escape.
- Source and destination located on different filesystems.
- Interruption before and after each journal stage.
- Application restart during recovery.
- Undo after restart.
- Watcher events during self-mutation.
- Unicode and long paths.
- Partial batch failure.
