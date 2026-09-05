#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_directory/../.." && pwd)"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "The Arch package must be assembled on Linux." >&2
  exit 1
fi
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  echo "makepkg refuses to build as root; run this script as a regular user." >&2
  exit 1
fi

node_arch="$(node -p 'process.arch')"
if [[ "$node_arch" != "x64" ]]; then
  echo "The Arch and Omarchy Pacman release candidate supports x86-64 only; received: $node_arch" >&2
  exit 1
fi

package_version="$(cd -- "$repository_root" && node -p "require('./apps/desktop/package.json').version")"
if [[ ! "$package_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Desktop package version is not valid semver: $package_version" >&2
  exit 1
fi
arch_version="${package_version//-/_}"

unpacked_root="$repository_root/apps/desktop/out/Skillglass-linux-$node_arch"
work_root="$repository_root/apps/desktop/out/arch-work/$node_arch"
make_root="$repository_root/apps/desktop/out/make/arch/$node_arch"
if [[ ! -x "$unpacked_root/skillglass" ]]; then
  echo "Missing packaged Linux application: $unpacked_root/skillglass" >&2
  echo "Run pnpm package on Linux before building the Arch package." >&2
  exit 1
fi

rm -rf -- "$work_root"
mkdir -p -- "$work_root" "$make_root"
rm -f -- "$make_root"/skillglass-*.pkg.tar.zst

bundle="$work_root/skillglass-bundle.tar.zst"
tar --zstd -cf "$bundle" -C "$(dirname -- "$unpacked_root")" "$(basename -- "$unpacked_root")"
cp -- "$script_directory/skillglass.desktop" "$work_root/skillglass.desktop"
cp -- "$repository_root/branding/Skillglass.png" "$work_root/skillglass.png"
cp -- "$repository_root/LICENSE" "$work_root/LICENSE"

desktop_file="$work_root/skillglass.desktop"
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$desktop_file"
fi

checksum() {
  sha256sum "$1" | cut -d ' ' -f 1
}

sed \
  -e "s/@PKGVER@/$arch_version/g" \
  -e "s/@BUNDLE_SHA256@/$(checksum "$bundle")/g" \
  -e "s/@DESKTOP_SHA256@/$(checksum "$desktop_file")/g" \
  -e "s/@ICON_SHA256@/$(checksum "$work_root/skillglass.png")/g" \
  -e "s/@LICENSE_SHA256@/$(checksum "$work_root/LICENSE")/g" \
  "$script_directory/PKGBUILD.template" > "$work_root/PKGBUILD"

(
  cd -- "$work_root"
  PKGDEST="$make_root" makepkg --cleanbuild --force --nodeps --noconfirm
)

package_path="$(find "$make_root" -maxdepth 1 -type f -name 'skillglass-*.pkg.tar.zst' -print -quit)"
if [[ -z "$package_path" ]]; then
  echo "makepkg did not produce an Arch package." >&2
  exit 1
fi
printf '%s\n' "$package_path"
