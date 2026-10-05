#!/usr/bin/env bash
# Stand-in for a user's shell in E2E tests: prints how it was started and what leaked in.
echo "SHELL-ARGS=$*"
echo "LEAK=${COLUMNS-}${TERM_PROGRAM-}${TMUX-} LANG-SET=${LANG:+yes}"
while IFS= read -r line; do echo "sh: ${line}"; done
