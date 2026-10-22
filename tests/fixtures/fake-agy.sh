#!/usr/bin/env bash
# Stand-in for agy in E2E tests: `agy models`, and `agy --print= --input-format stream-json
# --output-format stream-json …` with the shapes of tests/fixtures/agy-chat.ndjson (agy 1.4.4).
# "read it" runs a read_file tool, "run it" is refused like a command needing approval,
# "slow" streams until stopped; anything else is echoed back with the flags it got.
if [ "$1" = models ]; then
  printf 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n'
  printf 'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n'
  printf 'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n'
  printf 'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n'
  exit 0
fi
cid=agy-new
model=gemini-3.8-flash-medium
effort=none
mode=default
prev=
for a in "$@"; do
  [ "$prev" = "--conversation" ] && cid="$a"
  [ "$prev" = "--model" ] && model="$a"
  [ "$prev" = "--effort" ] && effort="$a"
  [ "$prev" = "--mode" ] && mode="$a"
  [ "$a" = "--dangerously-skip-permissions" ] && mode=bypass
  prev="$a"
done
case " $* " in *" --input-format stream-json "*) ;; *)
  echo "fake agy terminal: $*"
  exec cat ;;
esac
say() { printf '%s\n' "$1"; }
step=0
up() { say "{\"event\":\"step_update\",\"step_update\":{\"conversation_id\":\"$cid\",\"step_index\":$step,$1}}"; }
result() {
  say "{\"event\":\"result\",\"result\":{\"conversation_id\":\"$cid\",\"status\":\"SUCCESS\",\"response\":\"\",\"duration_seconds\":1.5,\"num_turns\":1,\"usage\":{\"input_tokens\":10,\"output_tokens\":5,\"thinking_tokens\":0,\"cache_read_tokens\":0,\"total_tokens\":15}$1}}"
}
text() {
  step=$((step + 1))
  for part in "$@"; do
    up "\"state\":\"ACTIVE\",\"step_type\":\"agent_response\",\"text_delta\":\"$part\""
    sleep 0.05
  done
  up '"state":"DONE","step_type":"agent_response","text_delta":"\n","duration_seconds":1'
}
say "{\"event\":\"init\",\"conversation_id\":\"$cid\",\"init\":{\"model\":\"$model\",\"cwd\":\"$(pwd)\",\"permission_mode\":\"request-review\"}}"
while IFS= read -r line; do
  content=$(sed -E 's/.*"content":"([^"]*)".*/\1/' <<<"$line")
  step=$((step + 1))
  up '"state":"DONE","step_type":"user_input"'
  case "$content" in
    *'read it'*)
      step=$((step + 1))
      up '"state":"ACTIVE","step_type":"tool","tool_name":"read_file","tool_info":{"name":"read_file","parameters":{"Path":"/tmp/notes.txt"}}'
      up '"state":"DONE","step_type":"tool","tool_name":"read_file","tool_info":{"name":"read_file","parameters":{"Path":"/tmp/notes.txt"},"output":"1 lines, 6 bytes"}'
      text "It says hello." && result ;;
    *'run it'*)
      step=$((step + 1))
      up '"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"rm -rf build"}}'
      up '"state":"DONE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"rm -rf build"}}'
      result ',"denied_actions":[{"action":"command","display_name":"RunCommand"}]' ;;
    *slow*)
      step=$((step + 1))
      while true; do
        up '"state":"ACTIVE","step_type":"agent_response","text_delta":"."'
        sleep 0.2
      done ;;
    *)
      text "Hello from **fake** agy: " "$content" " (conversation $cid, model $model, effort $effort, mode $mode)" && result ;;
  esac
done
