# Security policy

## Supported versions

Skillglass has not published a supported public release yet. This section will identify supported release lines when the first release is published.

## Reporting a vulnerability

Use this repository's private vulnerability-reporting flow under **Security → Report a vulnerability**. Include the affected version or commit, operating system, reproduction steps, impact, and any suggested mitigation.

Do not put exploit details, private skill contents, local filesystem paths, or other sensitive data in a public issue. If private vulnerability reporting is not available, open a public issue containing no vulnerability details and ask a maintainer to establish a private channel.

## Official binaries

The only official binary-distribution channel is this repository's [Releases page](../../releases). Skillglass does not publish binaries to app stores, mirrors, package registries, standalone download sites, or automatic-update endpoints.

Release assets include SHA-256 checksums and build metadata. Builds do not yet carry an OS-trusted publisher identity; the macOS ad-hoc signature protects bundle integrity but is neither a Developer ID signature nor notarization. An operating-system trust warning is therefore expected and must not be bypassed by weakening system security settings. Never treat a binary from another source as official.

## Security boundaries

- Skillglass reads skills and writes only installations or updates inside explicitly approved, user-writable roots.
- Skillglass does not request administrator, root, UAC, or other operating-system elevation and does not recommend changing permissions to make a write succeed.
- Skillglass does not activate, deactivate, configure, or uninstall skills in a harness.
- A journaled installation rollback removes only the exact unchanged tree created by that operation; it cannot delete an arbitrary installation.
- Imported skill content is treated as data and is not executed during inspection, staging, installation, or update.

## Sensitive local recovery data

Snapshots can contain private skill text. Skillglass stores its SQLite database and recovery artifacts only in the operating system's per-user application-data directory and applies user-only permissions where the platform supports POSIX modes. Observation snapshots follow the documented 30-snapshot/90-day policy under a 256 MiB default ceiling, without pruning the snapshot used by the current inventory. Journal-owned recovery copies remain while restart-safe undo is available; removing Skillglass's application data removes that local history but also makes recovery and undo unavailable.
