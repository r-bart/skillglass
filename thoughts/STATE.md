# Project State

**Updated**: 2026-08-26
**Branch**: `codex/forge-mvp`
**Active Feature**: Forge MVP implementation and release readiness
**Workflow Position**: Implementation plus macOS/Linux acceptance complete; native Windows release evidence explicitly deferred
**Active Plan**: `thoughts/plans/2026-08-26_forge-mvp.md` (In Progress)

## Key Decisions

- Use Electron + React + TypeScript + Vite for the cross-platform desktop application. (2026-08-26)
- Keep skill files as the source of truth; use SQLite only for indexing, snapshots, and the operation journal. (2026-08-26)
- Treat runtime semantics as adapter-owned and label all data by evidence state. (2026-08-26)
- Separate `Todas` / `Esta máquina` from the real `Global` scope. (2026-08-26)
- Treat harness runtime state as read-only; Forge never activates or deactivates skills. (2026-08-26)
- Limit mutations to installation and update in user-approved, user-writable roots. (2026-08-26)
- Never request administrator, root, or operating-system elevation. (2026-08-26)
- Publish official open-source binaries only as repository release assets. (2026-08-26)
- License source, documentation, contributions, and binaries under Apache-2.0. (2026-08-26)
- Require persisted operation plans and restart-safe undo for every mutation. (2026-08-26)
- Limit the MVP to discovery, inspection, static validation, local editing, history, and reversible local operations. (2026-08-26)

## Current Blockers

- Native packaged SQLite/filesystem evidence is still required on Windows before release.
- No Git remote is configured, so the native GitHub Actions matrix cannot yet be executed.

## Current Evidence

- Unit/integration: 38 files, 270 tests passing on Node 24.19.0 arm64.
- Electron acceptance: 17/17 passing; immutable BV suite 10/10 and hash unchanged.
- macOS package/make, strict code-sign verification, ASAR/fuses, bundled Apache-2.0 license, and packaged SQLite reopen smoke pass.
- Native Linux ARM64 package/runtime, all Electron E2E scenarios, packaged SQLite reopen, DEB/RPM makers, and artifact verification pass.
- Windows x64 cross-packaging produces a structurally valid PE GUI executable with the expected ASAR and hardened fuses; native launch, SQLite reopen, E2E, and Squirrel maker evidence remain pending.
- CI and manual draft-Release workflows are implemented for native macOS, Windows, and Linux runners.
- Final strict architecture re-review: APPROVE; no internal release-blocking finding remains.
- Acceptance record: `thoughts/reviews/2026-08-26_forge-mvp-acceptance.md`.
