# Storage and Packaging Spike

**Date**: 2026-08-26
**Plan task**: 0.2
**Local status**: Passed on macOS ARM64
**Cross-platform status**: Windows and Linux not yet tested
**Driver decision**: Use `node:sqlite` provisionally; native CI smoke tests are a release gate

## Decision

Forge will initially use Electron's bundled `node:sqlite` from the main process. It is the only candidate in this spike that completed the required packaged runtime flow with direct evidence:

1. Electron Forge invoked the pinned Vite integration and produced a macOS ARM64 `.app`.
2. The packaged Electron main process opened a database.
3. It applied migration 1, wrote a row, closed the connection, reopened read-only, and read both values.
4. The renderer reported both `globalThis.process` and `globalThis.require` as `undefined`.
5. The database path was exactly below `app.getPath("userData")`, while `app.getAppPath()` pointed inside `app.asar`.

This is a conditional selection, not a cross-platform claim. `node:sqlite` is currently documented by Node.js as stability 1.2, release candidate. Forge must isolate it behind an internal storage interface and must not ship a release until the same packaged smoke test passes on native macOS, Windows, and Linux runners.

`better-sqlite3` was evaluated as the conservative API alternative. Version `13.0.3` installed and Forge built an application after adding Vite externalization and the auto-unpack plugin, but the packaged ASAR did not contain the external dependency and the launched binary did not emit the success evidence within 30 seconds. It is therefore not selected: the spike did not prove it works in the tested packaged configuration. This is evidence about the tested configuration, not a claim that the library cannot work with Electron.

## Tested combination

| Component | Tested version | Pinning decision |
|---|---:|---|
| Build host Node.js | `24.19.0` | Pin CI and local packaging to Node 24 |
| Electron | `43.4.1` | Exact version |
| Electron runtime Node.js | `24.18.1` | Supplied by Electron |
| Electron Forge CLI | `7.11.2` | Exact version |
| Electron Forge Vite plugin | `7.11.2` | Exact version |
| Vite | `5.4.21` | Exact version for the proven combination |
| Host OS | macOS `26.5.2`, Darwin ARM64 | Local evidence only |

Electron `44.0.0` had just reached the registry, but the official Forge scaffold resolved Electron `43.4.1` under the machine's package release-age policy. This document records the combination actually executed, not an inferred equivalent.

Forge's own documentation still labels its Vite integration experimental and warns that minor releases may contain breaking changes. All four build components above must remain exact in the first lockfile; upgrades require rerunning this smoke test.

## Packaged runtime evidence

The packaged executable printed:

```json
{
  "driver": "node:sqlite",
  "electron": "43.4.1",
  "node": "24.18.1",
  "dbPath": "/tmp/forge-sqlite-userdata-built-in/forge-spike.sqlite3",
  "userDataPath": "/tmp/forge-sqlite-userdata-built-in",
  "dbInsideUserData": true,
  "appPath": "/private/tmp/forge-sqlite-spike.g67k42/app/out/app-darwin-arm64/app.app/Contents/Resources/app.asar",
  "dbInsideAppBundle": false,
  "migrationVersion": 1,
  "reopenedValue": "persisted-after-reopen",
  "renderer": {
    "processType": "undefined",
    "requireType": "undefined"
  }
}
```

An independent read after the packaged process exited returned:

```text
[{ version: 1 }]
[{ value: 'persisted-after-reopen' }]
```

The database was a 12,288-byte SQLite 3.x file. The spike overrode the user-data directory with `app.setPath("userData", temporaryDirectory)` before `ready` solely to keep test data isolated; production must use Electron's normal `app.getPath("userData")` value.

## Security configuration exercised

The hidden test window used:

```ts
new BrowserWindow({
  show: false,
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
})
```

SQLite was imported only by the main-process Vite entry. The renderer check was executed in the packaged window after its local HTML loaded. This spike does not replace the complete Electron hardening work in Task 1.2.

## Commands and results

The disposable app was generated outside the project; its code is intentionally not retained.

```bash
npx --yes create-electron-app@7.11.2 app --template=vite-typescript
# PASS: official template generated and installed

PATH=<node-24-bin>:$PATH CI=1 npm run package
# PASS: Forge/Vite built main, preload, and renderer; Packager produced
# out/app-darwin-arm64/app.app

FORGE_SPIKE_USER_DATA=/tmp/forge-sqlite-userdata-built-in \
  ./out/app-darwin-arm64/app.app/Contents/MacOS/app
# PASS: emitted the JSON evidence above and exited normally

file /tmp/forge-sqlite-userdata-built-in/forge-spike.sqlite3
# PASS: SQLite 3.x database
```

The same package command was attempted with host Node `26.4.0`. Electron Packager stopped during archive extraction/finalization, returned without producing `out/`, and emitted no actionable error. Repeating with Node `24.19.0` completed. This is sufficient evidence to pin packaging to Node 24; it is not a general compatibility diagnosis for Node 26.

The generated template dependency audit reported 32 findings (`3 low`, `1 moderate`, `27 high`, `1 critical`). No production dependency decision should inherit that scaffold wholesale. Task 1.1 must create a minimal dependency graph, run a fresh audit, and review each production-path finding.

## Required native CI gate

Task 0.2 is locally proven only. Before Task 6.3 may publish binaries, native runners must execute the disposable equivalent of this smoke test:

| Runner | Required artifact | Current evidence |
|---|---|---|
| macOS ARM64 | Packaged `.app` | Passed locally; CI still required |
| Windows x64 | Packaged Windows application | Missing |
| Linux x64 | Packaged Linux application | Missing |

Each runner must assert, from the packaged executable rather than the build host:

- exact Electron and bundled Node versions;
- migration version equals `1`;
- value survives close and reopen;
- database parent equals the runner's `app.getPath("userData")`;
- database path is outside `app.getAppPath()` and application resources;
- renderer `process` and `require` are `undefined`;
- second process can reopen and read the existing database.

Any failure reopens the driver decision. There is no evidence here for Windows/Linux behavior, makers, installers, signing, notarization, or distribution.

## Implementation constraints carried forward

- Wrap `DatabaseSync` behind a Forge-owned storage interface so a driver swap is localized.
- Open databases only in the main process or a dedicated Node worker; never expose SQL or paths through IPC.
- Keep main-thread transactions short. `DatabaseSync` is synchronous.
- Store schema migrations as ordered, idempotent files or constants and record them transactionally.
- Use prepared statements for values; do not construct SQL from renderer input.
- Resolve the database path from `app.getPath("userData")` at runtime and create no database under source, `.vite`, `resources`, or `app.asar`.
- Pin packaging to Node 24 and pin Electron, Forge, the Forge Vite plugin, and Vite exactly.
- Treat the native CI smoke matrix as mandatory before repository release publishing.

## Primary references

- [Node.js SQLite API](https://nodejs.org/api/sqlite.html) — `node:sqlite` availability, synchronous API, and stability 1.2.
- [Electron 43.4.1 release](https://releases.electronjs.org/release/v43.4.1) — bundled Node.js `24.18.1`.
- [Electron Forge Vite plugin](https://www.electronforge.io/config/plugins/vite) — experimental status, pinning risk, and native-module externalization guidance.
- [Electron Forge auto-unpack plugin](https://js.electronforge.io/modules/_electron_forge_plugin_auto_unpack_natives.html) — native module ASAR behavior.
