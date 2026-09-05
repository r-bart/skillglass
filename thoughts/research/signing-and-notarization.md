# Signing and notarization policy

**Status**: policy recorded; credentials and release signing are not configured.

Forge signing is an artifact-authenticity control. It does not create or change a download channel. Repository releases remain the sole intended publication channel, and signing must not introduce an updater, store submission, mirror, registry, or privileged installer path.

## Current beta artifacts

- macOS packages receive a deterministic ad-hoc signature after fuses are applied so the final bundle remains structurally valid and its sealed contents can be checked. This is only a bundle-integrity measure: it provides no trusted publisher identity, is not a Developer ID signature, and is not notarization. Gatekeeper may warn or quarantine the artifact.
- Windows Squirrel artifacts are currently unsigned. SmartScreen may warn until an Authenticode identity and reputation exist.
- Linux DEB, RPM, and Pacman artifacts are currently unsigned. Repository metadata signing is out of scope because Forge does not operate a package repository.
- SHA-256 release checksums are required independently of signing. A checksum proves transfer integrity; it is not a substitute for an OS-trusted publisher identity.

The build must not silently use an arbitrary local signing identity. Forge explicitly selects identity `-` for reproducible ad-hoc signing; it never discovers or substitutes a local Developer ID identity. Hardened runtime is disabled for this ad-hoc beta signature because it has no common Team ID with Electron's nested frameworks. A future Developer ID release must enable hardened runtime as part of its separate release gate. An artifact with an unexplained identity is rejected.

## macOS release gate

Before describing a macOS artifact as signed:

1. Use a dedicated Apple Developer ID Application certificate stored as a protected CI secret on a native macOS runner.
2. Sign the `.app` with hardened runtime enabled and the minimum entitlements required by the sandboxed application.
3. Submit the signed application archive to Apple's notary service, wait for acceptance, staple the ticket to the `.app`, and create the final ZIP from that verified application.
4. Verify the exact release artifact with `codesign --verify --deep --strict`, `spctl --assess`, and `xcrun stapler validate`.
5. Record the Team ID, certificate subject, artifact SHA-256, notarization request ID, build commit, Electron version, architecture, and verification output in release metadata.

Forge currently requests no privileged helper, login item, kernel/system extension, or installer authorization. Signing must not add one.

## Windows release gate

Before describing Windows artifacts as signed:

1. Use an organization-controlled Authenticode certificate through a protected signing service or hardware-backed key.
2. Sign the application executable and every distributed Squirrel artifact that supports Authenticode signing, with a trusted timestamp.
3. Verify publisher, chain, timestamp, and signature status using `Get-AuthenticodeSignature` on a native Windows runner.
4. Record certificate subject/thumbprint, artifact SHA-256, timestamp authority, build commit, Electron version, architecture, and verification output in release metadata.

Signing must not add elevation manifests, services, scheduled tasks, or an updater.

## Linux release gate

Forge may distribute native DEB, RPM, and Pacman files directly from repository releases without operating a package repository. If package signatures are added, their public key, rotation/revocation process, fingerprint, artifact SHA-256, and native verification commands must be published with the release. Package installation remains user-initiated and Forge never invokes `sudo`, `pkexec`, or an equivalent elevation mechanism.

## Credential and failure policy

- Signing credentials never enter the repository, application bundle, source maps, logs, caches, or pull-request builds.
- Signing/notarization runs only for an explicitly authorized tagged release from a protected environment.
- A missing, expired, revoked, mismatched, or unverifiable identity fails the signed-release job; it never falls back to a differently signed artifact.
- Beta artifacts without a trusted publisher identity must be labelled honestly and remain separate from any later Developer ID, Authenticode, or package-signed release assets.
