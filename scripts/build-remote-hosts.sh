#!/usr/bin/env bash
# Static Rust host binaries that the window copies to Linux machines over ssh (ADR 0004
# phase 5), into host-rs/target/remote/wraithgrid-host-<target>. x64 always; arm64 when an
# aarch64 linker is installed (CI: gcc-aarch64-linux-gnu). Neither needs musl on this machine:
# Rust ships the musl C runtime for both targets.
set -euo pipefail
cd "$(dirname "$0")/../host-rs"
out=target/remote
mkdir -p "$out"
build() {
  local target=$1
  if command -v rustup >/dev/null; then rustup target add "$target" >/dev/null 2>&1 || true; fi
  cargo build --release --locked --target "$target"
  cp "target/$target/release/wraithgrid-host" "$out/wraithgrid-host-$target"
}
build x86_64-unknown-linux-musl
if command -v aarch64-linux-gnu-gcc >/dev/null; then
  CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=aarch64-linux-gnu-gcc build aarch64-unknown-linux-musl
else
  echo "build-remote-hosts: no aarch64-linux-gnu-gcc; skipping the arm64 remote host" >&2
fi
ls -la "$out"
