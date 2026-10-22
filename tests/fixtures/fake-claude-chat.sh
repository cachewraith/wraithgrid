#!/usr/bin/env bash
# Stand-in for `claude -p --input-format stream-json --output-format stream-json …` in E2E
# tests of the chat view: the protocol shapes of tests/fixtures/claude-chat.ndjson, scripted.
# "run it" asks to run a Bash tool and waits for the approval; "in background" starts a Bash
# job that outlives the turn and reports back 2s later (claude-background.ndjson's shapes);
# anything else is echoed back.
sid=fake-new
model=default
effort=auto
mode=default
bypass=no
prev=
for a in "$@"; do
  [ "$a" = "--allow-dangerously-skip-permissions" ] && bypass=yes
  [ "$prev" = "--resume" ] && sid="resumed-$a"
  [ "$prev" = "--model" ] && model="$a"
  [ "$prev" = "--effort" ] && effort="$a"
  [ "$prev" = "--permission-mode" ] && mode="$a"
  prev="$a"
done
# The initialize answer's shape, from real claude output (models trimmed to three).
efforts='["low","medium","high","xhigh","max"]'
models="[{\"value\":\"default\",\"displayName\":\"Default (recommended)\",\"description\":\"Opus 5.5 · Best for everyday, complex tasks\",\"supportsAutoMode\":true,\"supportsEffort\":true,\"supportedEffortLevels\":$efforts},{\"value\":\"sonnet\",\"displayName\":\"Sonnet 5.5\",\"description\":\"Most efficient for simpler tasks\",\"supportsEffort\":true,\"supportedEffortLevels\":$efforts},{\"value\":\"haiku\",\"displayName\":\"Haiku 5.5\",\"description\":\"Fastest for quick answers\",\"supportsEffort\":true,\"supportedEffortLevels\":$efforts}]"
# Commands: a few of the initialize answer's real entries (claude 2.1.306), descriptions cut.
commands='[{"name":"product-management:brainstorm","description":"(product-management) Brainstorm a product idea, problem space, or strategic question with a sharp thinking partner","argumentHint":"<topic, problem, or idea to explore>"},{"name":"postman:api-testing","description":"(Postman) Use when testing an endpoint, running collection assertions, or checking real application traffic against an API contract. Reus...","argumentHint":"","aliases":["api-testing"]},{"name":"postman:api-mocking","description":"(Postman) Use when creating a stand-in backend from a collection or OpenAPI spec, testing failure scenarios, or sharing a Code Mock throu...","argumentHint":"","aliases":["api-mocking"]},{"name":"compact","description":"Free up context by summarizing the conversation so far","argumentHint":"<optional custom summarization instructions>","builtin":true},{"name":"clear","description":"Start a new session with empty context; previous session stays on disk (resumable with /resume)","argumentHint":"[name]","aliases":["reset","new"],"builtin":true},{"name":"doctor","description":"Health-check the user'\''s Claude Code setup and fix issues: diagnose installation health \u2014 what the `claude doctor` terminal diagnostics co...","argumentHint":"[prompt-audit [<path>]]","aliases":["checkup"],"builtin":true},{"name":"init","description":"Initialize a new CLAUDE.md file with codebase documentation","argumentHint":"","builtin":true},{"name":"model","description":"Set the AI model for Claude Code","argumentHint":"<model>","builtin":true},{"name":"security-review","description":"Complete a security review of the pending changes on the current branch","argumentHint":"","builtin":true}]'
n=0
say() { printf '%s\n' "$1"; }
field() { sed -E "s/.*\"$1\":\"([^\"]*)\".*/\\1/" <<<"$2"; }
# Limits and usage in the shapes real claude 2.1.306 sends (tests/fixtures/claude-usage.ndjson).
result() {
  local now; now=$(date +%s)
  say "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"allowed\",\"unifiedWindows\":{\"five_hour\":{\"utilization\":0.42,\"resetsAt\":$((now + 7800))},\"seven_day\":{\"utilization\":0.75,\"resetsAt\":$((now + 259200))}}},\"session_id\":\"$sid\"}"
  say "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"duration_ms\":1200,\"total_cost_usd\":0.0042,\"usage\":{\"input_tokens\":12,\"output_tokens\":340,\"cache_read_input_tokens\":9000,\"cache_creation_input_tokens\":1200},\"modelUsage\":{\"claude-opus-5-5\":{\"costUSD\":0.0042}},\"result\":\"\",\"session_id\":\"$sid\"}"
}
text() {
  n=$((n + 1))
  say "{\"type\":\"stream_event\",\"event\":{\"type\":\"message_start\",\"message\":{\"id\":\"m$n\"}},\"parent_tool_use_id\":null}"
  for part in "$@"; do
    say "{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"$part\"}},\"parent_tool_use_id\":null}"
    sleep 0.05
  done
  say "{\"type\":\"assistant\",\"message\":{\"id\":\"m$n\",\"content\":[{\"type\":\"text\",\"text\":\"(full copy)\"}]},\"parent_tool_use_id\":null}"
}
while IFS= read -r line; do
  case "$line" in
    *'"subtype":"initialize"'*)
      say "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$(field request_id "$line")\",\"response\":{\"commands\":$commands,\"models\":$models,\"account\":{\"email\":\"me@example.com\",\"subscriptionType\":\"Claude Pro\"}}}}"
      say "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"$sid\",\"model\":\"fake-model\",\"permissionMode\":\"$mode\",\"terminal_slash_commands\":[\"doctor\"],\"cwd\":\"$(pwd)\"}" ;;
    *'"subtype":"set_model"'*)
      model=$(field model "$line")
      say "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$(field request_id "$line")\"}}" ;;
    # As real claude 2.1.306: bypass is refused unless the session was allowed it.
    *'"subtype":"set_permission_mode"'*'"bypassPermissions"'*)
      if [ "$bypass" = no ]; then
        say "{\"type\":\"control_response\",\"response\":{\"subtype\":\"error\",\"request_id\":\"$(field request_id "$line")\",\"error\":\"Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions\",\"error_code\":\"bypass_not_launched\"}}"
      else
        mode=bypassPermissions
        say "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$(field request_id "$line")\",\"response\":{\"mode\":\"$mode\"}}}"
        say "{\"type\":\"system\",\"subtype\":\"status\",\"status\":null,\"permissionMode\":\"$mode\",\"session_id\":\"$sid\"}"
      fi ;;
    # As real claude 2.1.306: an answer, then a status line with the mode in force.
    *'"subtype":"set_permission_mode"'*)
      mode=$(field mode "$line")
      say "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$(field request_id "$line")\",\"response\":{\"mode\":\"$mode\"}}}"
      say "{\"type\":\"system\",\"subtype\":\"status\",\"status\":null,\"permissionMode\":\"$mode\",\"session_id\":\"$sid\"}" ;;
    *'"subtype":"interrupt"'*)
      say "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"[Request interrupted by user]\"}]},\"parent_tool_use_id\":null}"
      say "{\"type\":\"result\",\"subtype\":\"error_during_execution\",\"is_error\":true,\"session_id\":\"$sid\"}" ;;
    *'"behavior":"allow"'*)
      say '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"build removed"}]},"parent_tool_use_id":null}'
      text "Ran it." && result ;;
    *'"behavior":"deny"'*)
      say '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"denied","is_error":true}]},"parent_tool_use_id":null}'
      text "Skipped it." && result ;;
    *'"type":"user"'*'run it'*)
      say '{"type":"assistant","message":{"id":"mt","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"rm -rf build","description":"Remove build"}}]},"parent_tool_use_id":null}'
      say '{"type":"control_request","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash","input":{"command":"rm -rf build","description":"Remove build"},"permission_suggestions":[],"tool_use_id":"toolu_1"}}' ;;
    *'"type":"user"'*'in background'*)
      say '{"type":"assistant","message":{"id":"mb","content":[{"type":"tool_use","id":"toolu_bg","name":"Bash","input":{"command":"sleep 2 && echo done","description":"Wait two seconds","run_in_background":true}}]},"parent_tool_use_id":null}'
      say "{\"type\":\"system\",\"subtype\":\"background_tasks_changed\",\"tasks\":[{\"task_id\":\"bg1\",\"task_type\":\"local_bash\",\"description\":\"Wait two seconds\"}],\"session_id\":\"$sid\"}"
      say '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_bg","content":"Command running in background with ID: bg1."}]},"parent_tool_use_id":null}'
      text "Started it." && result
      (
        sleep 2
        say "{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"bg1\",\"tool_use_id\":\"toolu_bg\",\"status\":\"completed\",\"summary\":\"Background command \\\"Wait two seconds\\\" completed (exit code 0)\",\"session_id\":\"$sid\"}"
        say "{\"type\":\"system\",\"subtype\":\"background_tasks_changed\",\"tasks\":[],\"session_id\":\"$sid\"}"
        text "It finished." && result
      ) & ;;
    *'"type":"user"'*'slow'*)
      text "Working" "." "." "." "." "." "." "." "." "." "." "." "." "." "." "." "." "." "." "." ;;
    *'"type":"user"'*)
      # Like real claude: the conversation is kept in the account's dir, per folder.
      if [ -n "$CLAUDE_CONFIG_DIR" ]; then
        tdir="$CLAUDE_CONFIG_DIR/projects/$(pwd | sed 's/[^A-Za-z0-9]/-/g')"
        mkdir -p "$tdir" && printf '%s\n' "$line" >> "$tdir/$sid.jsonl"
      fi
      text "Hello from **fake** claude: " "$(field content "$line")" " (config ${CLAUDE_CONFIG_DIR}, session ${sid}, model ${model}, effort ${effort}, mode ${mode})" && result ;;
  esac
done
