#!/usr/bin/env bash
# Stand-in for the claude CLI in E2E tests: prints what Wraithgrid gave it, then waits.
if [ "$1" = "--version" ]; then
  echo "0.0.0 (fake claude)"
  exit 0
fi
echo "CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR}"
echo "PWD=$(pwd)"
echo "ARGS=$*"
echo "TERM=${TERM} COLORTERM=${COLORTERM}"
while IFS= read -r line; do
  case "${line}" in
    exit) echo "Error: simulated failure"; exit 3 ;;
    spin) while true; do printf '.'; sleep 0.2; done ;;
    ask) printf 'Bash command\n  rm -rf build\nDo you want to proceed?\n' ;;
    login) echo "Login successful. Press Enter to continue" ;;
    *) echo "got: ${line}" ;;
  esac
done
