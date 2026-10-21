#!/usr/bin/env bash
# Stand-in for `claude -p --input-format stream-json --output-format stream-json …` in E2E
# tests of the chat view: the protocol shapes of tests/fixtures/claude-chat.ndjson, scripted.
# "run it" asks to run a Bash tool and waits for the approval; anything else is echoed back.
sid=fake-new
model=default
effort=auto
prev=
for a in "$@"; do
  [ "$prev" = "--resume" ] && sid="resumed-$a"
  [ "$prev" = "--model" ] && model="$a"
  [ "$prev" = "--effort" ] && effort="$a"
  prev="$a"
done
# The initialize answer's shape, from real claude output (models trimmed to three).
efforts='["low","medium","high","xhigh","max"]'
models="[{\"value\":\"default\",\"displayName\":\"Default (recommended)\",\"description\":\"Opus 5.5 · Best for everyday, complex tasks\",\"supportsEffort\":true,\"supportedEffortLevels\":$efforts},{\"value\":\"sonnet\",\"displayName\":\"Sonnet 5.5\",\"description\":\"Most efficient for simpler tasks\",\"supportsEffort\":true,\"supportedEffortLevels\":$efforts},{\"value\":\"haiku\",\"displayName\":\"Haiku 5.5\",\"description\":\"Fastest for quick answers\",\"supportsEffort\":true,\"supportedEffortLevels\":$efforts}]"
n=0
say() { printf '%s\n' "$1"; }
field() { sed -E "s/.*\"$1\":\"([^\"]*)\".*/\\1/" <<<"$2"; }
result() { say "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"duration_ms\":1200,\"total_cost_usd\":0.0042,\"result\":\"\",\"session_id\":\"$sid\"}"; }
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
      say "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$(field request_id "$line")\",\"response\":{\"models\":$models,\"account\":{\"email\":\"me@example.com\",\"subscriptionType\":\"Claude Pro\"}}}}"
      say "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"$sid\",\"model\":\"fake-model\",\"cwd\":\"$(pwd)\"}" ;;
    *'"subtype":"set_model"'*)
      model=$(field model "$line")
      say "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$(field request_id "$line")\"}}" ;;
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
    *'"type":"user"'*'slow'*)
      text "Working" "." "." "." "." "." "." "." "." "." "." "." "." "." "." "." "." "." "." "." ;;
    *'"type":"user"'*)
      text "Hello from **fake** claude: " "$(field content "$line")" " (config ${CLAUDE_CONFIG_DIR}, session ${sid}, model ${model}, effort ${effort})" && result ;;
  esac
done
