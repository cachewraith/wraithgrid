#!/bin/sh
# One-line install of the latest Wraithgrid release, checked against the release's SHA256SUMS:
#   curl -fsSL https://raw.githubusercontent.com/cachewraith/wraithgrid/main/scripts/install.sh | sh
# Linux: the .deb (apt), .rpm (dnf/zypper), .pacman (pacman) or else the AppImage into
# ~/.local/bin. macOS: the dmg's app into /Applications. Windows: use the Setup .exe or winget.
# Env: WRAITHGRID_VERSION=1.8.0 picks a release; WRAITHGRID_FORMAT=appimage|deb|rpm|pacman
# forces a package; WRAITHGRID_DRY_RUN=1 downloads and checks without installing.
set -eu

REPO="cachewraith/wraithgrid"
BASE="https://github.com/$REPO/releases"

say() { printf '%s\n' "wraithgrid: $*" >&2; }
die() {
  say "$*"
  exit 1
}
need() { command -v "$1" >/dev/null 2>&1 || die "needs $1"; }

need curl
need uname

version="${WRAITHGRID_VERSION:-}"
if [ -z "$version" ]; then
  # The latest release page redirects to .../tag/vX.Y.Z.
  url="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$BASE/latest")" ||
    die "could not reach GitHub"
  version="${url##*/v}"
fi
case "$version" in
  *[!0-9A-Za-z.-]* | '') die "not a version: $version" ;;
esac

os="$(uname -s)"
arch="$(uname -m)"
format="${WRAITHGRID_FORMAT:-}"
case "$os" in
  Linux)
    [ "$arch" = x86_64 ] || die "Linux builds are x86_64 only (this is $arch)"
    if [ -z "$format" ]; then
      if command -v apt-get >/dev/null 2>&1; then format=deb
      elif command -v dnf >/dev/null 2>&1 || command -v zypper >/dev/null 2>&1; then format=rpm
      elif command -v pacman >/dev/null 2>&1; then format=pacman
      else format=appimage
      fi
    fi
    case "$format" in
      deb) file="wraithgrid-$version-amd64.deb" ;;
      rpm) file="wraithgrid-$version-x86_64.rpm" ;;
      pacman) file="wraithgrid-$version-x64.pacman" ;;
      appimage) file="Wraithgrid-$version-x86_64.AppImage" ;;
      *) die "unknown WRAITHGRID_FORMAT: $format" ;;
    esac
    ;;
  Darwin)
    case "$arch" in
      arm64) file="Wraithgrid-$version-mac-arm64.dmg" ;;
      x86_64) file="Wraithgrid-$version-mac-x64.dmg" ;;
      *) die "unsupported Mac CPU: $arch" ;;
    esac
    format=dmg
    ;;
  *) die "unsupported system: $os (on Windows use the Setup .exe or: winget install cachewraith.Wraithgrid)" ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "downloading $file ($version)"
curl -fsSL --proto '=https' -o "$tmp/$file" "$BASE/download/v$version/$file" ||
  die "no $file in release v$version"
curl -fsSL --proto '=https' -o "$tmp/SHA256SUMS.txt" "$BASE/download/v$version/SHA256SUMS.txt" ||
  die "release v$version has no SHA256SUMS.txt"

expected="$(awk -v f="$file" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS.txt")"
[ -n "$expected" ] || die "$file is not in SHA256SUMS.txt"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$file" | awk '{ print $1 }')"
else
  need shasum
  actual="$(shasum -a 256 "$tmp/$file" | awk '{ print $1 }')"
fi
[ "$actual" = "$expected" ] || die "checksum mismatch for $file: refusing to install"
say "checksum ok"

if [ "${WRAITHGRID_DRY_RUN:-}" = 1 ]; then
  say "dry run: not installing"
  exit 0
fi

sudo_() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

case "$format" in
  deb) sudo_ apt-get install -y "$tmp/$file" ;;
  rpm)
    if command -v dnf >/dev/null 2>&1; then sudo_ dnf install -y "$tmp/$file"
    else sudo_ zypper --non-interactive install --allow-unsigned-rpm "$tmp/$file"
    fi
    ;;
  pacman) sudo_ pacman -U --noconfirm "$tmp/$file" ;;
  appimage)
    dest="$HOME/.local/bin"
    mkdir -p "$dest"
    install -m 755 "$tmp/$file" "$dest/wraithgrid"
    say "installed $dest/wraithgrid"
    case ":$PATH:" in *":$dest:"*) ;; *) say "add $dest to your PATH" ;; esac
    ;;
  dmg)
    mnt="$tmp/mnt"
    mkdir -p "$mnt"
    hdiutil attach -nobrowse -quiet -mountpoint "$mnt" "$tmp/$file"
    rm -rf /Applications/Wraithgrid.app
    cp -R "$mnt/Wraithgrid.app" /Applications/
    hdiutil detach -quiet "$mnt"
    say "installed /Applications/Wraithgrid.app"
    ;;
esac
say "done: Wraithgrid $version"
