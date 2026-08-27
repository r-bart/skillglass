# Skill workspace acceptance lock

This directory freezes the acceptance references required by Task 0.2 of
`thoughts/plans/2026-08-27_skill-workspace-inline-diff.md`. The prototype was
observed only; none of its files were changed.

## Immutable specification

Command:

```bash
shasum -a 256 tests/spec/forge-mvp.e2e.spec.ts
git diff --exit-code -- tests/spec/forge-mvp.e2e.spec.ts
```

Result:

```text
3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c  tests/spec/forge-mvp.e2e.spec.ts
```

The scoped Git diff was empty.

## Prototype captures

The existing Vite server was checked before capture:

```bash
curl --silent --show-error --fail --max-time 2 \
  'http://127.0.0.1:4173/prototypes/editor-surface/?v=2' >/dev/null
```

It was already responding, so no additional server was started. Reproduce the
captures with:

```bash
node thoughts/research/artifacts/skill-workspace-inline-diff/capture-prototype.mjs
```

The script uses variant `v=2`, device scale factor 1, dark color scheme,
reduced motion, Spanish locale, and the installed Google Chrome binary. Set
`FORGE_PROTOTYPE_URL` or `FORGE_BROWSER_EXECUTABLE` to override those two local
paths. It records source and image hashes in `manifest.json`.

The accepted states are Code, Preview, and Changes at each exact viewport:

- `desktop-1420x892-{code,preview,changes}.png`
- `narrow-760x520-{code,preview,changes}.png`

The Changes state deterministically replaces one line and appends four lines,
producing the visible summary `5 añadidas · 1 eliminadas`. Exact source text,
capture dimensions, browser version, and SHA-256 values are in `manifest.json`.

## Direct-edit baseline tests

Focused renderer tests:

```bash
pnpm exec vitest run --project renderer \
  apps/desktop/src/renderer/inventory/Inspector.test.ts \
  apps/desktop/src/renderer/App.test.ts
```

Result: 2 files passed, 22 tests passed.

Focused packaged Electron tests were run with the available Node 24.19.0
runtime required by the repository:

```bash
env PATH="/Users/roberto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/roberto/.nvm/versions/node/v22.23.1/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  pnpm exec playwright test \
  tests/spec/forge-mvp.e2e.spec.ts \
  tests/e2e/accessibility-keyboard.e2e.spec.ts \
  --grep 'BV-6|200% zoom keeps editor|editor confirmation'
```

Result: 3 tests passed:

- editor alignment and visibility at 200% zoom;
- editor confirmation focus/Escape and restart-safe Undo;
- immutable BV-6 direct edit, exact preview, restart, and Undo.

## Pre-existing failures observed

An exploratory invocation using `pnpm test -- <paths>` did not filter Vitest
and ran the whole suite under the shell's Node 22.23.1. The renderer tests above
passed, but 29 Node-side tests failed because Node 22 lacks the required
`DatabaseSync.enableDefensive`; `package.json` requires Node 24.19.x. This is an
environment mismatch, not an editing-test failure.

A similarly over-broad `pnpm test:e2e -- <path>` invocation ran all 31 E2E tests
under Node 24.19.0. It produced 29 passes and two pre-existing failures outside
the direct-edit flow:

- BV-2 timed out waiting for a button named `Esta máquina`.
- BV-5's exact `Solo lectura` locator matched both the inventory status and the
  inspector fact, causing Playwright strict-mode ambiguity.

BV-6 and all current editor-specific E2E tests passed in both the broad run and
the correctly filtered run.
