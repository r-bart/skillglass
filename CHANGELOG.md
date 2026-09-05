# Changelog

All notable changes to Skillglass will be documented here.

## [1.0.0] - Unreleased

The first public release is being prepared. This entry describes the intended
release surface; platform verification and final asset hashes will be added from
the exact release commit before publication.

### Included

- Discover skills in approved Codex locations and folders containing
  `SKILL.md`.
- Search, filter, inspect, and read common Markdown without executing imported
  content.
- Show duplicate names and their locations without claiming an unobserved
  winner.
- Create and edit skills with a plan and exact diff before writing.
- Install from a local folder or ZIP into an approved, writable root.
- Keep a restart-safe local history and offer Undo while the affected tree
  remains unchanged outside Skillglass.
- Use the interface in English or Spanish.

### Known limits

- Discovery does not crawl plugin caches automatically. Additional compatible
  folders must be added and approved by the user.
- Source checks compare reconstructable local sources only. There is no remote
  registry or internet install.
- Skillglass does not activate, deactivate, configure, move, or uninstall a
  skill in Codex or another harness.
- There are no accounts, cloud sync, AI generation, telemetry, or automatic app
  updates.
- The first macOS package uses an ad-hoc integrity signature and is not
  notarized. Windows and Linux packages are unsigned.
- Omarchy support remains unverified until the exact Pacman release artifact
  passes the native Hyprland/Wayland checklist.

### Packages and verification

The release pipeline targets these files:

- `skillglass-v1.0.0-macos-arm64.zip`
- `skillglass-v1.0.0-windows-x64.exe`
- `skillglass-v1.0.0-linux-x64.deb`
- `skillglass-v1.0.0-linux-x64.rpm`
- `skillglass-v1.0.0-linux-x64.pkg.tar.zst`

The three Linux packages are assembled from the same x64 Electron bundle. This
list is not evidence that every artifact has passed final installation and UI
checks. Verified combinations, build environment metadata, and SHA-256 hashes
will be recorded before this section receives a release date. No minimum
supported OS version is declared until the final artifacts have been tested.

### Feedback

Use [GitHub Issues](https://github.com/r-bart/skillglass/issues) for bugs and
product suggestions. Follow [SECURITY.md](SECURITY.md) for vulnerabilities and
avoid including private skill contents or local paths in public reports.
