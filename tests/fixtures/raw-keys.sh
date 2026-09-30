#!/usr/bin/env bash
# Stand-in for claude in key tests: puts the TTY in raw mode and prints every input byte
# as hex, so a test sees exactly what a key press sends (ESC CR, not a bare CR).
if [ "$1" = "--version" ]; then
  echo "0.0.0 (raw keys)"
  exit 0
fi
stty raw -echo opost
echo "READY"
exec od -An -tx1 -v -w1
