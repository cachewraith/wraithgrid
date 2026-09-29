#!/usr/bin/env bash
# Installs the built packages in clean distro containers and checks that
#   1. the package manager resolves the declared dependencies,
#   2. the packaged node-pty opens a pty and passes CLAUDE_CONFIG_DIR through,
#   3. the app starts and its window loads (under Xvfb).
# Usage: scripts/test-linux-packages.sh [distro...]   (default: all)
set -uo pipefail
cd "$(dirname "$0")/.."
DIST="$PWD/dist"
deb=$(basename "$(ls "$DIST"/*.deb | head -1)")
rpm=$(basename "$(ls "$DIST"/*.rpm | head -1)")
pac=$(basename "$(ls "$DIST"/*.pacman | head -1)")
appimage=$(basename "$(ls "$DIST"/*.AppImage | head -1)")

# The checks, run inside each container after installation. $1 is the binary to start.
read -r -d '' CHECK <<'EOS' || true
set -u
BIN="$1"
RES="$(dirname "$BIN")/resources"
[ -d "$RES" ] || RES="$(dirname "$BIN")/../resources"
PTY_JS="const pty = require('$RES/app.asar.unpacked/node_modules/node-pty');
const p = pty.spawn('/bin/sh', ['-c', 'echo PTY_OK CFG=\$CLAUDE_CONFIG_DIR'], { env: { ...process.env, CLAUDE_CONFIG_DIR: '/tmp/acct' } });
let out = ''; p.onData((d) => (out += d)); p.onExit(() => { console.log(out.trim()); process.exit(out.includes('PTY_OK CFG=/tmp/acct') ? 0 : 1) });"
if ELECTRON_RUN_AS_NODE=1 "$BIN" -e "$PTY_JS"; then echo "CHECK pty: ok"; else echo "CHECK pty: FAILED"; fi

Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 &
sleep 1
export DISPLAY=:99 WRAITHGRID_USER_DATA_DIR=/tmp/wg-test
# Containers run as root, and Chromium's sandbox refuses root; see the README.
"$BIN" --no-sandbox --disable-gpu --remote-debugging-port=9222 >/tmp/app.log 2>&1 &
title=""
for _ in $(seq 1 30); do
  title=$(curl -s 127.0.0.1:9222/json | grep -o '"title": *"Wraithgrid[^"]*"' | head -1)
  [ -n "$title" ] && break
  sleep 1
done
if [ -n "$title" ]; then echo "CHECK window: ok ($title)"; else echo "CHECK window: FAILED"; tail -20 /tmp/app.log; fi
EOS
export CHECK

run() {
  local name="$1" image="$2"
  echo "=== $name ($image)"
  docker run --rm -v "$DIST:/dist:ro" -e CHECK -e INSTALL="$3" -e BIN="$4" "$image" bash -c '
    bash -c "$INSTALL" >/tmp/install.log 2>&1 || { echo "CHECK install: FAILED"; tail -30 /tmp/install.log; exit 1; }
    echo "CHECK install: ok"
    bash -c "$CHECK" _ "$BIN"
  ' 2>&1 | grep -E '^(CHECK|PTY_OK|===)|FAILED|rror' | head -40
}

APT="export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq xvfb curl /dist/$deb"
# Kali's http.kali.org redirector sometimes hands out a mirror mid-sync; use its CDN (http: apt checks signatures; the image has no CA bundle yet).
APT_KALI="sed -i 's#http://http.kali.org#http://kali.download#' /etc/apt/sources.list /etc/apt/sources.list.d/* 2>/dev/null; $APT"
DNF="dnf install -y -q xorg-x11-server-Xvfb curl /dist/$rpm"
PACMAN="pacman -Syu --noconfirm -q xorg-server-xvfb curl && pacman -U --noconfirm /dist/$pac"
APPIMAGE="dnf install -y -q xorg-x11-server-Xvfb curl gtk3 nss libXScrnSaver libXtst at-spi2-core alsa-lib libdrm mesa-libgbm && cd /tmp && /dist/$appimage --appimage-extract >/dev/null"

declare -A CASES=(
  [ubuntu-22.04]="ubuntu:22.04|$APT|/opt/Wraithgrid/wraithgrid"
  [ubuntu-24.04]="ubuntu:24.04|$APT|/opt/Wraithgrid/wraithgrid"
  [debian-12]="debian:12|$APT|/opt/Wraithgrid/wraithgrid"
  [debian-13]="debian:13|$APT|/opt/Wraithgrid/wraithgrid"
  [kali]="kalilinux/kali-rolling|$APT_KALI|/opt/Wraithgrid/wraithgrid"
  [fedora]="fedora:latest|$DNF|/opt/Wraithgrid/wraithgrid"
  [arch]="archlinux:latest|$PACMAN|/opt/Wraithgrid/wraithgrid"
  [appimage-fedora]="fedora:latest|$APPIMAGE|/tmp/squashfs-root/wraithgrid"
)
ORDER=(ubuntu-22.04 ubuntu-24.04 debian-12 debian-13 kali fedora arch appimage-fedora)

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=("${ORDER[@]}")
for t in "${targets[@]}"; do
  IFS='|' read -r image install bin <<<"${CASES[$t]}"
  run "$t" "$image" "$install" "$bin"
done
