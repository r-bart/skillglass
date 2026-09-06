# Installing Skillglass

Skillglass 1.0.0 is in final local testing. There is no public binary download
yet. This guide documents the planned package formats, verification steps, and
the checks that must be completed before publication.

## Official downloads

Official binaries are published only as assets on this repository's
[Releases page](../../releases). A public release must include:

- the native package for each listed platform and architecture;
- `SHA256SUMS.txt` covering every downloadable asset;
- `build-metadata.json` identifying the source revision and build environment.

Do not treat files from mirrors, package registries, app stores, standalone
download sites, or another repository as official Skillglass binaries.

## Verify an asset

Download the package and `SHA256SUMS.txt` from the same release. From the
directory containing both files, compare the package with its recorded digest:

```sh
shasum -a 256 -c SHA256SUMS.txt
```

On Windows PowerShell, compute a package digest with:

```powershell
Get-FileHash .\skillglass-v1.0.0-windows-x64.exe -Algorithm SHA256
```

Compare the result with the matching line in `SHA256SUMS.txt` before opening
the installer.

## Planned packages

| Platform | Architecture | Release asset | Release verification |
| --- | --- | --- | --- |
| macOS | Apple Silicon (`arm64`) | `skillglass-v1.0.0-macos-arm64.zip` | Pending final 1.0.0 artifact check |
| Windows | x64 | `skillglass-v1.0.0-windows-x64.exe` | Pending native CI and install check |
| Debian/Ubuntu | x64 | `skillglass-v1.0.0-linux-x64.deb` | Pending native CI and install check |
| RPM-based Linux | x64 | `skillglass-v1.0.0-linux-x64.rpm` | Pending native CI and install check |
| Arch Linux | x64 | `skillglass-v1.0.0-linux-x64.pkg.tar.zst` | Container check prepared; native Omarchy check pending |

The table will be updated with results from the exact release commit. A built
package is described as a candidate until installation and the required smoke
checks pass.

The release workflow currently builds on the GitHub-hosted
`macos-latest` (`arm64`), `windows-latest` (`x64`), and `ubuntu-latest` (`x64`)
runners with Node.js 24.19.0. The workflow checks the process architecture
before assigning these filenames and records the actual OS image and toolchain
in `build-metadata.json`. These build environments do not establish a minimum
supported OS version. Skillglass does not declare one for 1.0.0; operating
systems checked by installing the final files will be recorded separately.

## Signing status

The first packages do not carry an operating-system-trusted publisher identity:

- macOS applies Electron fuses and then re-seals the final application bundle
  with an ad-hoc integrity signature; it is not Developer ID signed or notarized;
- Windows packages are unsigned;
- Linux packages are unsigned.

The operating system may therefore show an unverified-publisher warning. Do not
disable system security globally or weaken file permissions to install
Skillglass. If local policy prevents installation, build from reviewed source or
wait for a signing option that satisfies that policy.

## macOS

The initial target is Apple Silicon. After verifying the ZIP checksum, extract
`Skillglass.app` and move it to `/Applications` or another user-controlled app
folder. The exact steps for opening the unnotarized candidate will be verified
and added from the release artifact; this guide will not recommend bypassing
Gatekeeper globally.

## Windows

After verifying the `.exe` checksum, run the Squirrel installer as your normal
user. Skillglass itself does not request UAC elevation. Final steps and the
Windows versions checked will be recorded after native release validation.

## Debian, Ubuntu, and RPM-based Linux

After verifying the checksum, install the package with the normal package
manager for your distribution:

```sh
sudo apt install ./skillglass-v1.0.0-linux-x64.deb
sudo dnf install ./skillglass-v1.0.0-linux-x64.rpm
```

Run only the command for the package manager you use. System package
installation may request its standard authorization; Skillglass itself does
not request root and writes skill data only inside user-approved, user-writable
roots.

## Arch Linux and Omarchy

After verifying the Pacman package checksum:

```sh
sudo pacman -U ./skillglass-v1.0.0-linux-x64.pkg.tar.zst
```

The package installs the application below `/opt/skillglass`, exposes the
`skillglass` launcher, adds a desktop entry, and preserves the root-owned `4755`
Chromium sandbox helper. The DEB, RPM, and Pacman files come from the same x64
Electron bundle in one Linux release job. The Pacman package builder runs in the
digest-pinned Arch Linux image and records its Node, Pacman, and makepkg versions.
Omarchy will remain marked as unverified until the exact public artifact passes
[the native Hyprland/Wayland checklist](../packaging/arch/OMARCHY-VALIDATION.md).

## Build from source

Use Git, Node.js 24.19.x, and pnpm 11.5.x:

```sh
git clone https://github.com/r-bart/skillglass.git
cd skillglass
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm make
```

`pnpm make` builds only for the current operating system. Local output is
written below `apps/desktop/out/make/`; it is a self-built artifact and must not
be redistributed as an official Skillglass download.
