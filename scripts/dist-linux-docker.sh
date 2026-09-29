#!/usr/bin/env bash
# Builds every Linux package inside Ubuntu 22.04. node-pty's native module links against
# the build machine's glibc; building on 2.35 keeps the packages working on Ubuntu 22.04+,
# Debian 12+, Kali, Fedora and Arch. A build on a rolling distro only runs on that distro.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${WRAITHGRID_BUILD_IMAGE:-ubuntu:22.04}"
NODE_VERSION="${WRAITHGRID_NODE_VERSION:-24.19.0}"
PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")"
mkdir -p dist

tar --exclude=./node_modules --exclude=./dist --exclude=./out --exclude=./.git \
  --exclude=./test-results --exclude=./playwright-report -czf - . |
  docker run --rm -i -v "$PWD/dist:/out" \
    -e NODE_VERSION="$NODE_VERSION" -e PNPM_VERSION="$PNPM_VERSION" \
    -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
    "$IMAGE" bash -euo pipefail -c '
      export DEBIAN_FRONTEND=noninteractive CI=true
      apt-get update -qq
      apt-get install -y -qq --no-install-recommends \
        ca-certificates curl xz-utils git python3 make g++ rpm libarchive-tools fakeroot >/dev/null
      curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" |
        tar -xJ -C /usr/local --strip-components=1
      npm install -g --silent "pnpm@${PNPM_VERSION}"
      mkdir /src && cd /src && tar -xzf -
      pnpm install --frozen-lockfile
      pnpm dist:linux
      cp dist/*.AppImage dist/*.deb dist/*.rpm dist/*.pacman /out/
      chown "${HOST_UID}:${HOST_GID}" /out/*
    '
ls -la dist
