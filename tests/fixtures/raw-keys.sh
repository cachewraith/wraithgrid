#!/usr/bin/env bash
# Stand-in for claude in key tests: puts the TTY in raw mode and prints every input byte
# as hex, so a test sees exactly what a key press sends (ESC CR, not a bare CR). Also
# stands in for gemini; the config dir variables it got come first.
if [ "$1" = "--version" ]; then
  echo "0.0.0 (raw keys)"
  exit 0
fi
echo "GEMINI_HOME=${GEMINI_CLI_HOME-none} CLAUDE_DIR=${CLAUDE_CONFIG_DIR-none}"
stty raw -echo opost
echo "READY"
exec od -An -tx1 -v -w1
