# Contributing to Skillglass

Skillglass is under active development and accepts contributions under the repository's [Apache License 2.0](LICENSE). Unless explicitly stated otherwise, intentionally submitted contributions are licensed under those same terms.

Bug reports and design or implementation proposals are welcome through
[GitHub Issues](https://github.com/r-bart/skillglass/issues). Issues are enabled
for this repository. Do not include vulnerability details, private skill
contents, or local filesystem paths in a public issue; follow
[SECURITY.md](SECURITY.md) instead.

## Development setup

Use the versions pinned by the repository:

- Node.js 24.19.x
- pnpm 11.5.x

Install and validate from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

Platform-specific packaging must run on the corresponding native operating system:

```sh
pnpm make
```

Landing screenshots are generated from real Electron flows with temporary
fixtures. After building the desktop bundle, regenerate them with:

```sh
pnpm exec tsx apps/landing/scripts/capture-product-assets.ts
```

Review every generated image before committing it. Visible fixture paths must
remain normalized to `/demo`, and screenshots must contain no private skills,
tokens, or personal filesystem paths.

The Arch Linux and Omarchy Pacman release candidate is built from the packaged
Linux application with `packaging/arch/build-package.sh`. The regular CI path
runs the same builder inside a clean Arch Linux container. Omarchy support must
not be claimed until the native checklist in
`packaging/arch/OMARCHY-VALIDATION.md` passes for the exact release artifact.

## Change requirements

- Preserve the filesystem as the authority; SQLite stores projections, snapshots, provenance, and operation journals.
- Keep all writes inside canonical, explicitly approved, user-writable roots.
- Do not add privilege elevation, permission-weakening workarounds, activation/deactivation controls, harness configuration, or general uninstall behavior.
- Do not add app-store publishing, mirrors, package-registry publishing, a standalone update service, or an automatic updater.
- Keep renderer filesystem paths behind validated IPC contracts and re-authorize in the main process immediately before a write.
- Add tests for observable behavior and failure paths. Cross-platform filesystem changes need native evidence on macOS, Windows, and Linux.

## Pull requests

Keep each pull request focused, explain the product or security boundary it affects, and include the commands used for validation. Generated and packaged output must not be committed.

## Branch workflow

- `main` contains releasable code and receives release pull requests.
- `develop` is the integration branch for completed work.
- Create short-lived `feature/<slug>` or `fix/<slug>` branches from `develop` and open pull requests back into `develop`.
- Promote a tested `develop` revision to `main` through a dedicated release pull request.

A release is cut only from an existing version tag by the manual repository-release workflow. The workflow runs typecheck, lint, tests, and native makers, builds the Pacman release candidate for Arch Linux and Omarchy, then attaches assets directly to a draft GitHub release. It does not use a package registry, mirror, or Actions artifacts as a distribution channel. A maintainer must verify the native packaged smoke evidence for macOS, Windows, and Linux, complete the Omarchy checklist against the exact Pacman artifact, inspect the checksums and metadata, and publish the draft manually.
