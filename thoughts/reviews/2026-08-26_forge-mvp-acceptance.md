# Forge MVP — Beta Acceptance Evidence

**Date**: 2026-08-26  
**Branch**: `codex/forge-mvp`  
**Plan**: `thoughts/plans/2026-08-26_forge-mvp.md`  
**Local platform**: macOS arm64  
**Pinned validation runtime**: Node 24.19.0 arm64, pnpm 11.5.1

## Outcome

The MVP implementation and local macOS acceptance are green. Release readiness remains gated by two owner/external facts that cannot be manufactured locally: choosing the open-source license and executing the committed native CI workflow on Windows and Linux after a repository remote exists.

## Automated evidence

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass |
| `pnpm typecheck` | Pass |
| E2E helper TypeScript check | Pass |
| `pnpm lint` | Pass |
| `pnpm test` | Pass — 37 files, 262 tests |
| `pnpm test:e2e` | Pass — 16/16 Electron tests |
| Immutable business-value suite | Pass — BV-1 through BV-10 |
| Immutable suite SHA-256 | `3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c` |
| `pnpm package` | Pass — macOS arm64 |
| Packaged SQLite reopen smoke | Pass — two launches, migrations 1–4, integrity and persisted marker |
| `pnpm make` | Pass — `Forge-darwin-arm64-0.0.0.zip` |
| Maker artifact verifier | Pass |
| `pnpm audit --prod --audit-level high` | Pass — no known vulnerabilities |
| `git diff --check` | Pass |
| Production TODO/FIXME/HACK scan | Pass — none |

## Security and packaging evidence

- Renderer remains sandboxed and has no Node integration.
- Preload exposes only typed, runtime-validated operations.
- IPC rejects untrusted origin, non-main-frame senders, and invalid payloads.
- CSP, navigation, new-window, permission, and external-link policies are deny-by-default.
- ASAR contains no source maps, unpacked native modules, or application `node_modules` tree.
- Electron fuses disable RunAsNode, NODE_OPTIONS, and CLI inspect; ASAR integrity and ASAR-only loading are enabled.
- The final macOS bundle passes `codesign --verify --deep --strict`; its signature is explicitly ad hoc, not Developer ID or notarization.
- No updater, privilege-elevation path, harness-state mutation, uninstall, delete, or move capability exists in application code.

## Business and failure-path evidence

- Root scanning remains blocked until explicit persisted approval.
- Projects can be selected and persisted from a neutral process CWD.
- Global/project visibility, adapter-owned precedence, collisions, and observed disabled state are preserved as evidence.
- Identical content in two installations produces distinct snapshots and both remain editable.
- Invalid skills remain visible with findings.
- Install, direct update, local-source update, history, and restart-safe undo pass Electron E2E.
- ZIP traversal is rejected before destination materialization.
- A process interruption after commit reconstructs provenance and update base state idempotently on restart.
- A destination edit between snapshot and replace is detected and preserved.
- Watchers reconcile external filesystem edits without restart, distinguish journal-originated events, invalidate overlapping previews, and surface scan/watcher findings.
- Multiple writable install roots require an explicit destination choice.

## Native matrix status

| Platform | Workflow defined | Executed evidence |
|---|---:|---:|
| macOS arm64 | Yes | Pass locally |
| Windows | Yes | Pending repository remote / GitHub Actions run |
| Linux | Yes | Pending repository remote / GitHub Actions run |

Cross-compilation is intentionally not substituted for the required native evidence.

## Remaining release gates

1. Owner selects Apache-2.0, MIT, GPL-3.0, or another explicit open-source license; then add the exact `LICENSE` text and package metadata.
2. Create/push the source repository and run `.github/workflows/ci.yml` on macOS, Windows, and Linux.
3. Keep the Release workflow manual and draft-only until the signing policy is selected. Official binaries remain repository Release assets only.

## Post-review verdict

`devtronic:post-review`: **APPROVE** after a second architecture pass. All six original P1 findings and the two follow-up packaging/watcher-lifecycle findings were revalidated as closed. No unresolved internal release-blocking finding remains.
