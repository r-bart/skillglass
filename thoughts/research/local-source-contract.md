# Local Source Contract — `local-source-v1`

**Date**: 2026-08-26
**Status**: Frozen for MVP implementation
**Applies to**: local directory and local ZIP installation/update sources

## Decision

Forge accepts one user-selected local directory or one user-selected local `.zip` as the source for one skill. Both source kinds produce the same normalized file manifest and `forge-tree-v1` hash before Forge offers an installation preview. ZIPs add a SHA-256 over the original archive bytes.

This contract is intentionally narrower than a general archive manager. It prevents ambiguous layout, path aliasing, link traversal, unbounded extraction, implicit overwrites, and an install undo becoming an uninstall primitive.

## Source authorization

1. The main process opens a native directory or file dialog and canonicalizes the selected object without accepting a path from the renderer.
2. A successful selection mints an unpredictable opaque `selectionToken` bound to the canonical path, source kind, current process, and creation time.
3. A token expires after 15 minutes, is consumed by one persisted plan, and cannot be reused for another path, operation, or source kind.
4. Tokens are not persisted. Provenance stores a canonical source locator after confirmation, never the token.
5. Planning and confirmation reopen the source without following links and compare its current identity and hashes with the preview. Any difference makes the plan stale.
6. A later update reauthorizes the persisted locator in the main process. A missing, replaced, inaccessible, or differently typed source yields `unknown`; Forge does not search for a replacement.

## Accepted payload layout

### Directory

- The selected directory is the payload root.
- `SKILL.md` must be a regular file directly inside that root after ignored metadata is removed.
- Parent or sibling content is never inspected or copied.

### ZIP

After name validation and ignored metadata removal, exactly one of these shapes is accepted:

```text
SKILL.md                 wrapper prefix = none
references/...
```

```text
one-wrapper/             wrapper prefix = "one-wrapper/"
  SKILL.md
  references/...
```

The second form is accepted only when all included entries are below the same single top-level directory. The wrapper is stripped from normalized payload paths. Multiple possible roots, more than one wrapper level before `SKILL.md`, or a rootless collection of skills is rejected. Nested ZIP files are ordinary bytes and are never recursively extracted.

One import always describes one skill. Multi-skill bundles require a future contract.

## Frozen resource limits

`MiB` means 1,048,576 bytes. Counts apply after the explicit ignored-metadata rules but before staging.

| Resource | Limit | Enforcement |
|---|---:|---|
| Directory included bytes | 100 MiB | Sum of regular-file sizes before preview and actual streamed bytes while hashing/copying |
| ZIP archive bytes | 25 MiB | File size before parsing and actual bytes read |
| ZIP expanded included bytes | 100 MiB | Declared sum before extraction and actual emitted-byte counter |
| One included file | 10 MiB | Declared size and actual streamed bytes |
| Included regular files | 2,000 | Enumeration/central-directory counter |
| Included directories | 512 | Enumeration/normalized archive paths |
| Nesting below payload root | 16 path segments | Normalized payload path |
| Relative path | 1,024 UTF-8 bytes | NFC-normalized payload path |
| One path segment | 255 UTF-8 bytes | NFC-normalized segment |
| ZIP compression ratio | 100:1 per entry and total | Declared compressed/expanded sizes and actual counters |

Crossing any limit aborts validation and removes staging owned by the current uncommitted journal. The implementation streams file data and never buffers an entire source, archive entry, or expanded archive merely to hash it.

The following ZIP forms are rejected:

- Encrypted entries or archives.
- Multi-disk/spanned archives.
- Malformed, overlapping, inconsistent, or duplicate central-directory entries.
- STORE/DEFLATE entries whose declared CRC or sizes do not match actual output.
- Compression methods other than STORE (`0`) and DEFLATE (`8`).
- ZIP64 data whose resolved values exceed any `local-source-v1` limit.
- An entry or aggregate with compressed size zero and non-zero expanded size.
- An entry or aggregate exceeding the 100:1 ratio, even if all byte ceilings pass.

Limits are checked against declared metadata before extraction and against actual data while extracting. Passing central-directory checks never disables runtime counters.

## Entry types and link policy

Only directories and regular files are admitted.

For directory sources, enumeration uses no-follow metadata checks for every component. Any symbolic link, junction, mount/reparse indirection inside the selected tree, socket, device, FIFO, or other special entry rejects the whole source. The selected root itself must canonicalize to a directory, and its identity is rechecked before confirmation.

For ZIP sources, Unix mode bits and DOS attributes are inspected before extraction. Symlink, device, FIFO, socket, and other special entries reject the whole archive. A link encoded as an ordinary file is just inert bytes; Forge never interprets its contents as a target. Hard links are not recreated: accepted regular-file content always becomes a newly created regular file.

Forge does not follow a link during enumeration, staging, hashing, verification, rollback, or undo. If a link appears after preview, the operation is stale. Executable bits, owners, ACLs, extended attributes, and archive timestamps are discarded. Staged directories and files use user-private defaults (`0700`/`0600` where POSIX modes exist), subject to the current user's umask; adapters may later broaden read bits only through a separately previewed contract.

## Path validation and portable identity

ZIP names treat both `/` and `\\` as separators for validation. Directory names are converted to relative logical paths. Before a path can enter the manifest:

1. Decode the name losslessly; reject undecodable ZIP names rather than guessing an encoding.
2. Reject NUL, C0 controls, DEL, absolute POSIX paths, drive-qualified paths, UNC paths, and Windows device paths.
3. Split on either separator. Reject empty segments, `.` and `..` before and after Unicode normalization.
4. Normalize every segment to Unicode NFC.
5. Reject trailing spaces/dots, `:` and the Windows-reserved device basenames `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, and `LPT1`–`LPT9`, case-insensitively and with any extension.
6. Enforce segment, total path, and depth limits.
7. Create a portable collision key by applying locale-independent Unicode default case folding to the NFC path.

Every included path must have a unique NFC path and portable collision key. File/directory prefix conflicts, exact duplicates, case-only aliases, and canonically equivalent Unicode names reject the source. These rules are applied even on a case-sensitive target so one accepted source behaves consistently on macOS, Windows, and Linux.

Destination containment is then proven using the actual target filesystem and approved-root identity. No lexical prefix check is sufficient.

## Ignored metadata

The following paths are excluded before limits, hashing, preview, staging, and installation:

- `.DS_Store`, `Thumbs.db`, and `desktop.ini` at any depth.
- `__MACOSX/**` at archive root.
- AppleDouble files whose basename starts with `._` at any depth.
- `.git/**`, `.hg/**`, and `.svn/**` at any depth.

Ignore matching is case-insensitive for the three OS metadata filenames and exact for repository-directory names. The ignored entry is still path-validated enough to prove that it is contained; an entry such as `../.DS_Store` is traversal, not ignorable metadata. Ignored archive bytes still count toward the 25 MiB archive ceiling and compression safety checks, because a malicious archive cannot bypass resource limits by choosing an ignored name.

No other dotfile, build output, executable, image, or unknown extension is silently excluded. It is accepted as inert regular-file data when all limits pass.

## Hash and manifest algorithm

Every accepted source yields this manifest:

```ts
type LocalSourceManifestV1 = {
  contract: "local-source-v1"
  hashAlgorithm: "forge-tree-v1"
  files: Array<{
    path: string       // NFC, `/` separators, relative to payload root
    byteLength: number
    sha256: string     // lowercase hexadecimal, raw file bytes
  }>
  treeHash: string     // lowercase hexadecimal SHA-256
}
```

Files are sorted by unsigned bytewise comparison of their NFC UTF-8 path bytes. `treeHash` is SHA-256 over this unambiguous byte stream:

```text
"forge-tree-v1\0"
for each file:
  "file\0"
  decimal(pathUtf8.length) + "\0"
  pathUtf8 + "\0"
  decimal(byteLength) + "\0"
  lowercaseHex(fileSha256) + "\0"
```

File SHA-256 is calculated from raw bytes. Text encoding and line endings are not changed. Directory entries, empty directories, traversal order, source root name, wrapper prefix, timestamps, owners, ACLs, extended attributes, and permission bits do not affect the tree hash. Empty directories are not installed.

For ZIP sources, `archiveSha256` is independently computed over every raw archive byte in file order. The archive hash identifies the selected container; `treeHash` identifies the normalized installable payload. Two different archives may legitimately yield the same tree hash.

The installer hashes staged output again and requires the staged and source manifests to match. After atomic publication it hashes the installed tree and requires the same manifest before commit.

## Provenance record

A committed local import persists at least:

```ts
type LocalImportProvenanceV1 = {
  contract: "local-source-v1"
  sourceKind: "directory" | "zip"
  sourceLocator: string
  sourceObservedAt: string
  sourceTreeHash: string
  archiveSha256?: string
  payloadWrapper?: string
  ignoredEntries: { count: number; categories: string[] }
  sourceManifest: LocalSourceManifestV1
  installedTreeHash: string
  installedManifest: LocalSourceManifestV1
  targetRootId: string
  installationId: string
  destinationCanonicalPath: string
  createdByJournalId: string
}
```

`sourceLocator` is a canonical, private, machine-local value. It may be displayed after explicit user action but is never treated as a shareable URL. Forge does not claim author, license, version, release, or commit from the path. Such fields require their own evidence.

An update checks both the current installed hash and the freshly authorized source. Update state is:

- `current`: installed and source tree hashes match.
- `available`: installed tree equals the prior installed/base hash and current source differs.
- `diverged`: installed tree differs from the prior installed/base hash.
- `unknown`: source identity cannot be reauthorized or a safe comparison cannot be completed.

An archive changing bytes while producing the same tree is `current` for content; provenance may record the newly observed archive hash only after a confirmed operation. No background write occurs.

## Destination and collision behavior

The adapter supplies and validates one destination child segment according to its runtime contract. The local-source layer never derives runtime identity from an arbitrary ZIP filename or frontmatter on its own.

At plan time and immediately before publication:

- The target root must still be approved, canonical, user-writable, and non-elevated.
- The destination must be a direct child allowed by the adapter and contained by the root after real filesystem resolution.
- No file, directory, link, junction, or other entry may already exist at the destination.
- No sibling may have the same portable collision key.

Any collision rejects the plan. MVP installation has no merge, overwrite, automatic suffix, or replace-existing mode. The user resolves the collision outside this install operation or selects another adapter-approved target. A destination appearing after preview makes the persisted plan stale.

Staging uses a Forge-owned uniquely named sibling on the same filesystem. Publication prefers a single atomic rename from staging to the absent destination. Cross-filesystem copying is not used for publication; if same-filesystem staging cannot be guaranteed, installation is unavailable for that target.

## Rollback and committed-install undo

### Failure before commit

Forge may delete its own hidden staging directory while it remains identified by the active journal and is not externally changed. If publication made the destination visible before a later verification failure, rollback may remove it only when all of these remain true:

1. The journal proves the destination did not exist at precondition check.
2. The canonical destination and filesystem object identity match the object published by this journal.
3. The current normalized entry set, per-file hashes, and tree hash exactly match the journal's installed manifest.
4. There are no added entries of any kind and no link or special entry has appeared.

Otherwise Forge leaves the path untouched and marks the operation `recovery-required`.

### Undo after a successful install

Install undo is an inverse of one journaled install, not an uninstall capability. It is addressable only by the committed `createdByJournalId`; there is no command that accepts an arbitrary installation path or ID for removal.

Before undo, Forge repeats the four checks above. Normally ignored metadata is not ignored for ownership: a later `.DS_Store`, `.git` directory, or any other added entry makes the tree non-exact. A changed timestamp alone does not block undo because timestamps were never installed identity; any content or path change does.

When safe, undo removes each journal-owned regular file using no-follow operations, then removes directories deepest-first only if each is empty, and finally removes the destination only if empty. A verification race, locked file, new entry, identity change, or unexpected link stops the operation. It never recursively deletes an unverified tree.

If undo is refused, Forge reports the conflicting entries/hashes and leaves every source and destination byte untouched. It does not offer force delete, uninstall, quarantine, relocation, or permission elevation.

Update undo follows the separate snapshot rule in `OPERATIONS.md`: it restores a prior snapshot only when the currently installed state still matches the update's committed postcondition.

## Fixture contract

`packages/test-fixtures/imports/` contains real small directory trees plus declarative JSON archive/filesystem cases. Archive manifests are input to future test helpers that generate ZIP bytes at test time; this keeps traversal names, links, duplicate central-directory entries, and size-limit cases reviewable without committing opaque or large binaries.

Each manifest states its expected admission result and reason. Generated entries represent logical ZIP central-directory entries, including cases that cannot safely exist as files in the repository. Implementations must not special-case fixture names.

## Acceptance checklist

- Directory and ZIP forms yield the same manifest/tree hash for identical normalized content.
- Every frozen count, byte, path, depth, and compression limit is tested at its boundary and at boundary plus one.
- Traversal using `/`, `\\`, drive, UNC, device, encoded Unicode aliases, and wrapper ambiguity is rejected before extraction.
- Links/special entries and portable collisions are rejected on every operating system.
- Ignored metadata cannot bypass containment, archive-byte, or decompression checks.
- A destination collision never mutates the destination.
- Rollback/undo removes an unchanged journal-owned install after restart.
- Rollback/undo refuses modified, replaced, linked, or augmented trees without deleting any entry.
