#!/usr/bin/env bash
# The Rust host for the macOS app (ADR 0004 phase 3): one universal binary (Apple Silicon and
# Intel) at host-rs/target/release/wraithgrid-host, where electron-builder takes it from for
# both the arm64 and the x64 app. Run on a Mac.
set -euo pipefail
cd "$(dirname "$0")/../host-rs"
targets=(aarch64-apple-darwin x86_64-apple-darwin)
for t in "${targets[@]}"; do
  if command -v rustup >/dev/null; then rustup target add "$t" >/dev/null 2>&1 || true; fi
  cargo build --release --locked --target "$t"
done
mkdir -p target/release
lipo -create -output target/release/wraithgrid-host \
  "target/${targets[0]}/release/wraithgrid-host" "target/${targets[1]}/release/wraithgrid-host"
lipo -info target/release/wraithgrid-host
