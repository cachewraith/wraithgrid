#!/usr/bin/env bash
# Stand-in for the claude CLI in E2E tests: prints what Wraithgrid gave it, then waits.
if [ "$1" = "--version" ]; then
  echo "0.0.0 (fake claude)"
  exit 0
fi
# `claude plugin …`: one mod that toggles (state kept in the config dir) and one that fails.
if [ "$1" = "plugin" ]; then
  mkdir -p "${CLAUDE_CONFIG_DIR}"
  echo "$*" >> "${CLAUDE_CONFIG_DIR}/plugin-calls.log"
  case "$2 $3" in
    "list --available")
      echo '{"installed":[],"available":['
      echo ' {"pluginId":"clock@acme","name":"clock","description":"A clock above the prompt","marketplaceName":"acme","version":"1.1.0","installCount":4520,"source":{"source":"url","url":"https://example.com/clock.git"}},'
      echo ' {"pluginId":"clock@mirror","name":"clock","description":"A clock above the prompt","marketplaceName":"mirror","source":"./clock"},'
      echo ' {"pluginId":"weather@acme","name":"weather","description":"Forecast in the status line","marketplaceName":"acme","installCount":12,"source":"./weather"}]}' ;;
    "install clock@acme") touch "${CLAUDE_CONFIG_DIR}/clock.on" ;;
    "list --json")
      on=true; [ -e "${CLAUDE_CONFIG_DIR}/tally.off" ] && on=false
      clock=; [ -e "${CLAUDE_CONFIG_DIR}/clock.on" ] && clock='{"id":"clock@acme","version":"1.1.0","scope":"user","enabled":true},'
      echo "[${clock}{\"id\":\"tally@acme\",\"version\":\"0.2.0\",\"scope\":\"user\",\"enabled\":${on}},"
      echo " {\"id\":\"broken@acme\",\"version\":\"1.0.0\",\"scope\":\"user\",\"enabled\":false}]" ;;
    "disable tally@acme") touch "${CLAUDE_CONFIG_DIR}/tally.off" ;;
    "enable tally@acme") rm -f "${CLAUDE_CONFIG_DIR}/tally.off" ;;
    *) echo "Plugin $3 could not be loaded" >&2; exit 1 ;;
  esac
  exit 0
fi
echo "CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR}"
echo "PLUGIN_DIRS=${CLAUDE_CODE_PLUGIN_DIRS}"
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
