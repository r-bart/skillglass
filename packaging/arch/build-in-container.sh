#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_directory/../.." && pwd)"
node_arch="x64"
docker_platform="linux/amd64"
arch_image="archlinux:base-devel@sha256:68bfc3b0d277b08a99101dc9b94aaa03e5ae70cf1b4fb965c03b2b87b915760d"
node_version="24.19.0"
node_archive_sha256="14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647"
disable_pacman_sandbox="${SKILLGLASS_DISABLE_PACMAN_SANDBOX:-0}"
if [[ "$(uname -m)" != "x86_64" && "$(uname -m)" != "amd64" ]]; then
  # Docker Desktop emulation on Apple Silicon cannot currently expose the
  # seccomp support required by the pacman 7 download sandbox.
  disable_pacman_sandbox="1"
fi
if [[ "$disable_pacman_sandbox" != "0" && "$disable_pacman_sandbox" != "1" ]]; then
  echo "SKILLGLASS_DISABLE_PACMAN_SANDBOX must be 0 or 1." >&2
  exit 1
fi

if [[ ! -d "$repository_root/apps/desktop/out/Skillglass-linux-$node_arch" ]]; then
  echo "Missing packaged Linux application for $node_arch." >&2
  exit 1
fi

docker run --rm \
  --platform "$docker_platform" \
  --volume "$repository_root:/workspace" \
  --workdir /workspace \
  --env "HOST_UID=$(id -u)" \
  --env "SKILLGLASS_ARCH_IMAGE=$arch_image" \
  --env "SKILLGLASS_NODE_VERSION=$node_version" \
  --env "SKILLGLASS_NODE_ARCHIVE_SHA256=$node_archive_sha256" \
  --env "SKILLGLASS_NODE_ARCH=$node_arch" \
  --env "SKILLGLASS_DISABLE_PACMAN_SANDBOX=$disable_pacman_sandbox" \
  "$arch_image" \
  bash -lc '
    set -euo pipefail
    pacman_options=()
    if [[ "$SKILLGLASS_DISABLE_PACMAN_SANDBOX" == "1" ]]; then
      # This affects only downloads in the disposable emulated container;
      # package signatures remain mandatory and are still verified by pacman.
      pacman_options+=(--disable-sandbox)
    fi
    pacman "${pacman_options[@]}" -Syu --noconfirm curl desktop-file-utils xz
    node_archive="node-v$SKILLGLASS_NODE_VERSION-linux-x64.tar.xz"
    node_root="/opt/node-v$SKILLGLASS_NODE_VERSION-linux-x64"
    curl --fail --location --proto "=https" --tlsv1.2 \
      --output "/tmp/$node_archive" \
      "https://nodejs.org/dist/v$SKILLGLASS_NODE_VERSION/$node_archive"
    printf "%s  %s\n" "$SKILLGLASS_NODE_ARCHIVE_SHA256" "/tmp/$node_archive" | sha256sum --check --status
    tar -xJf "/tmp/$node_archive" -C /opt
    rm -f -- "/tmp/$node_archive"
    export PATH="$node_root/bin:$PATH"
    test "$(node --version)" = "v$SKILLGLASS_NODE_VERSION"
    if ! getent passwd "$HOST_UID" >/dev/null; then
      useradd --create-home --uid "$HOST_UID" builder
    fi
    build_user="$(getent passwd "$HOST_UID" | cut -d: -f1)"
    runuser -u "$build_user" -- env PATH="$PATH" /workspace/packaging/arch/build-package.sh
    node /workspace/packaging/arch/verify-package.mjs
    package_path="$(find "/workspace/apps/desktop/out/make/arch/$SKILLGLASS_NODE_ARCH" \
      -maxdepth 1 -type f -name "skillglass-*.pkg.tar.zst" -print -quit)"
    pacman "${pacman_options[@]}" -U --noconfirm "$package_path"
    pacman -Qk skillglass
    test -x /usr/bin/skillglass
    desktop-file-validate /usr/share/applications/skillglass.desktop
    pacman_version="$(pacman --version | sed -n "s/.*Pacman v\([^ ]*\).*/\1/p" | head -n 1)"
    makepkg_version="$(makepkg --version | sed -n "s/^makepkg (pacman) //p" | head -n 1)"
    test -n "$pacman_version"
    test -n "$makepkg_version"
    toolchain_path="/workspace/apps/desktop/out/make/arch/$SKILLGLASS_NODE_ARCH/arch-toolchain.json"
    printf "{\n  \"schemaVersion\": 1,\n  \"baseImage\": \"%s\",\n  \"node\": \"%s\",\n  \"pacman\": \"%s\",\n  \"makepkg\": \"%s\"\n}\n" \
      "$SKILLGLASS_ARCH_IMAGE" "$(node --version)" "$pacman_version" "$makepkg_version" > "$toolchain_path"
    chown "$HOST_UID" "$toolchain_path"
  '
