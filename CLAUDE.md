# Forge project guardrails

- Run repository gates with Node 24.19.x and pnpm 11.5.1.
- Do not modify `tests/spec/forge-mvp.e2e.spec.ts`; its accepted SHA-256 is `3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c`.
- The desktop package uses `type: module`, but Electron's bundled main output is CommonJS; keep its entrypoint and Vite output named `main.cjs`.
- Electron fuses mutate the macOS bundle during packaging. Preserve the fail-closed final deep ad-hoc re-sign in the Forge `postPackage` hook and verify the resulting app by launching it, not only with static `codesign` checks.
- Filesystem observations are authoritative. SQLite projections are rebuildable; operation journal, snapshots, provenance, and recovery metadata are durable.
- Revalidate `expectedBefore` immediately before any replacement. Never overwrite an external edit or remove a tree without an exact ownership/hash match.
- Runtime scope, precedence, and state come from adapters with evidence. Do not infer inheritance in storage or renderer code.
- Forge may read, install, and update in approved user-writable roots. Do not add activation/deactivation, harness configuration mutation, uninstall/delete/move, privilege elevation, an updater, or non-repository binary distribution.
