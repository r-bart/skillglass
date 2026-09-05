# Omarchy and Arch packaging lessons

## What worked

- Building the Pacman artifact from the already tested Electron Linux bundle
  keeps DEB, RPM, and Pacman outputs on the same application payload.
- A clean Arch container catches package metadata, dependency, desktop-entry,
  ownership, and Chromium sandbox errors before release.
- Treating `.pkg.tar.zst` as a compound suffix prevents accidental `.zst`
  matching and gives stable release names.

## What was difficult

- A moving Arch image and the repository Node requirement are separate sources
  of drift. Pinning only one does not make the build boundary explainable.
- Package listings include a package-name prefix and directory entries, so
  substring checks can accept paths that were never actually installed.
- Docker emulation on Apple Silicon cannot currently provide the seccomp feature
  used by the Pacman download sandbox. The exception must remain limited to the
  disposable emulated build container while package signature verification stays
  enabled.

## Reusable patterns

- Pin the base image by digest, install the exact required Node binary by a fixed
  checksum, and record actual tool versions in release metadata.
- Require exactly one artifact per expected format; a total-count assertion is
  insufficient when duplicates can hide a missing format.
- Compare the packaged `app.asar` hash with the tested bundle and allowlist exact
  package paths before accepting the installer.
- Keep platform copy at release-candidate status until the exact artifact passes
  a native desktop-session checklist.
