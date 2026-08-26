# Project State

**Updated**: 2026-08-26
**Branch**: `codex/forge-mvp`
**Active Feature**: Forge MVP strategic planning
**Workflow Position**: Phase 0 locally validated; executing repository foundation
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
- Require persisted operation plans and restart-safe undo for every mutation. (2026-08-26)
- Limit the MVP to discovery, inspection, static validation, local editing, history, and reversible local operations. (2026-08-26)

## Current Blockers

- Native packaged SQLite evidence is still required on Windows and Linux before release.
- The application package and workspace have not yet been scaffolded.

## Modified Files This Session

- `thoughts/PRODUCT.md` — complete draft.
- `thoughts/DOMAIN.md` — complete draft.
- `thoughts/ADAPTERS.md` — complete draft; Codex verification pending.
- `thoughts/OPERATIONS.md` — complete draft.
- `thoughts/checkpoints/2026-08-26_12-23_product-contracts.md` — complete.
- `thoughts/STATE.md` — complete.
- `thoughts/SUMMARY.md` — complete.
- `thoughts/plans/2026-08-26_forge-mvp.md` — draft strategic implementation plan.
