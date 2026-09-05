# Project State

**Updated**: 2026-09-05
**Branch**: `develop`
**Active Feature**: Skillglass 1.0.0 local release candidate
**Workflow Position**: Product and local validation complete; final commit, native CI and public release remain

## Key Decisions

- Use Electron + React + TypeScript + Vite for the cross-platform desktop application. (2026-08-26)
- Keep skill files as the source of truth; use SQLite only for indexing, snapshots, and the operation journal. (2026-08-26)
- Treat runtime semantics as adapter-owned and label all data by evidence state. (2026-08-26)
- Limit mutations to installation and update in user-approved, user-writable roots; never elevate privileges or mutate harness activation. (2026-08-26)
- Publish official open-source binaries only as repository release assets under Apache-2.0. (2026-08-26)
- Require persisted operation plans and restart-safe undo for every mutation. (2026-08-26)
- Keep English as the default landing language, with browser-language detection and a persisted manual override. (2026-08-27)
- Promote the reviewed public candidate to version `1.0.0` with tag `v1.0.0`. (2026-09-05)
- Treat Windows, Linux and the x86-64 Pacman build as unverified until the exact final-commit artifacts pass their native checks. (2026-09-05)
- Keep release links inactive until the matching public assets and checksums have been verified without authentication. (2026-09-05)

## Current Blockers

- The dirty working tree must be reviewed and turned into a final candidate commit before native CI can produce traceable artifacts.
- The exact Windows and Linux artifacts need the native GitHub Actions matrix. Omarchy still needs the Hyprland/Wayland checklist in `packaging/arch/OMARCHY-VALIDATION.md`.
- Repository visibility, tag, release and landing deployment have not been changed. They require the final publication authorization.
- Trusted publisher identities are not configured: macOS is ad hoc only; Windows and Linux are unsigned. Release copy must keep this explicit.

## Current Evidence

- The v1 readiness plan has completed phases 1–5 and local validation. Close protection, root diagnostics, safe Markdown, ES/EN, onboarding, visual polish, landing copy and release metadata are implemented.
- Final architecture post-review: **PASS with 0 actionable findings**.
- Node 24.19.0 and pnpm 11.5.1: root and E2E typechecks, lint, Astro check/build and production dependency audit pass.
- Unit/integration: **55 files and 414 tests pass**.
- Immutable Forge MVP suite: **10/10 pass**; SHA-256 remains `3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c` and the spec has no diff.
- E2E coverage passes. The final full run passed 44 tests; its two failures were pixel comparisons of an unmasked seconds field. After masking that volatile field, both affected tests pass. The 18 visual tests and 21 updated references were reviewed.
- Landing ES/EN has no horizontal overflow at 320, 390, 760 or 1440 px; 390 px was reviewed visually. RTL at 390 px and CSS zoom 200% retain the layout.
- Local macOS arm64 ZIP: `release-candidate/macos/skillglass-v1.0.0-macos-arm64.zip`, 123,912,891 bytes, SHA-256 `8e1046b99696a8bb5f70300ead6e78eda1fe357c952040c7fe43a716ea2502ae`.
- The extracted ZIP passes strict code-sign verification and launches with an intact schema-v4 SQLite store. It remains a local working-tree candidate and must be rebuilt from the final commit.
- Detailed evidence and limitations are recorded in `thoughts/reviews/2026-09-05-v1-release-verification.md`.
