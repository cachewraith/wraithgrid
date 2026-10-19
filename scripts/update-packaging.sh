#!/usr/bin/env bash
# Writes a release's version and SHA-256 hashes (from its SHA256SUMS.txt) into the Homebrew
# cask, the winget manifests and the AUR PKGBUILD under packaging/. Publishing them stays a
# manual step (see packaging/README.md).
#   scripts/update-packaging.sh 1.8.0
set -euo pipefail

version="${1:?usage: update-packaging.sh <version>}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "not a version: $version" >&2; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd)"
pkg="$root/packaging"
sums="$(curl -fsSL "https://github.com/cachewraith/wraithgrid/releases/download/v$version/SHA256SUMS.txt")"

sha() {
  local h
  h="$(awk -v f="$1" '$2 == f || $2 == "*" f { print $1 }' <<<"$sums")"
  [[ "$h" =~ ^[0-9a-f]{64}$ ]] || { echo "no hash for $1 in v$version" >&2; exit 1; }
  printf '%s' "$h"
}
mac_arm="$(sha "Wraithgrid-$version-mac-arm64.dmg")"
mac_x64="$(sha "Wraithgrid-$version-mac-x64.dmg")"
win="$(sha "Wraithgrid-Setup-$version-x64.exe")"
pac="$(sha "wraithgrid-$version-x64.pacman")"
hash='(@[A-Z0-9_]+@|[0-9a-f]{64})'

sed -E -i.bak \
  -e "s/^(  version )\"[^\"]*\"/\1\"$version\"/" \
  -e "s/^(  sha256 arm: +)\"$hash\"/\1\"$mac_arm\"/" \
  -e "s/^( +intel: )\"$hash\"/\1\"$mac_x64\"/" \
  "$pkg/homebrew/wraithgrid.rb"

for f in "$pkg"/winget/*.yaml; do
  sed -E -i.bak -e "s/^PackageVersion: .*/PackageVersion: $version/" "$f"
done
sed -E -i.bak \
  -e "s#releases/download/v[^/]+/Wraithgrid-Setup-[^/]+-x64\.exe#releases/download/v$version/Wraithgrid-Setup-$version-x64.exe#" \
  -e "s/^(    InstallerSha256: )'$hash'/\1'$win'/" \
  "$pkg/winget/cachewraith.Wraithgrid.installer.yaml"

sed -E -i.bak \
  -e "s/^pkgver=.*/pkgver=$version/" \
  -e "s/^pkgrel=.*/pkgrel=1/" \
  -e "s/^sha256sums=\('$hash'\)/sha256sums=('$pac')/" \
  "$pkg/aur/PKGBUILD"

find "$pkg" -name '*.bak' -delete
if grep -rnE '@[A-Z0-9_]+@' "$pkg" --include='*.rb' --include='*.yaml' --include=PKGBUILD; then
  echo "placeholders left above" >&2
  exit 1
fi
echo "packaging/ updated to $version"
