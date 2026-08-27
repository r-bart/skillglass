# Skill Forge

Skill Forge is a desktop application for discovering, inspecting, installing, and safely updating agent skills, intended for release as open source.

The project is under active development. It targets macOS, Windows, and Linux.

## Official downloads

When available, official Skill Forge binaries are published **only as assets on this repository's [Releases page](../../releases)**.

Skill Forge is not distributed through third-party websites, mirrors, app stores, package registries, standalone download portals, or an automatic updater. A binary obtained anywhere other than this repository's Releases page is not an official Skill Forge binary.

Each release includes `SHA256SUMS.txt` and `build-metadata.json`. Verify the checksum before running a downloaded artifact. Builds do not yet carry an OS-trusted publisher identity; macOS bundles use only an ad-hoc integrity signature and are not notarized. The operating system may therefore display an unverified-developer warning. Releases are assembled as drafts and require a maintainer to review and publish them manually.

## Safety boundaries

- Skill Forge reads installed skills and may install or update them only inside user-approved, user-writable roots.
- Skill Forge never activates, deactivates, or uninstalls skills; users manage those actions through their own harnesses.
- Skill Forge never requests administrator, root, or operating-system elevation.

An installation rollback is available only for the exact unchanged tree created by a recorded Skill Forge operation. It is not a general uninstall feature.

## Local data and retention

Skill Forge keeps its SQLite index and operation-recovery material below the operating system's per-user application-data directory. On POSIX systems Skill Forge forces the database directory to mode `0700`, the database to `0600`, and the recovery directory to `0700`; it never uploads this data.

Observed content snapshots retain the latest 30 snapshots per installation or every snapshot from the latest 90 days, whichever keeps more recoverable history. A 256 MiB snapshot-content ceiling is applied by default, while the snapshot referenced by the current inventory is never pruned. Exact recovery copies required by an available undo remain until that undo is completed or the Skill Forge application data is removed, because deleting them earlier would make the persisted undo claim false.

## Development

Skill Forge requires Node.js 24.19.x and pnpm 11.5.x.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change and [SECURITY.md](SECURITY.md) for vulnerability reporting and the official-binary policy.

## License

Skill Forge is open-source software licensed under the [Apache License 2.0](LICENSE).
