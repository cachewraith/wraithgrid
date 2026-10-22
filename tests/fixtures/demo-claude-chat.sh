#!/usr/bin/env bash
# Stand-in for headless claude (stream-json) in the README screenshots (readme-shots.spec.ts):
# scripted turns in the shapes of tests/fixtures/claude-chat.ndjson, so a chat pane shows
# real-looking work: tool cards, a diff, a task list, an answer, and an approval waiting.
# A prompt with "orders" gets the fix turn, "ship" the release turn, anything else a short reply.
sid=demo-session
efforts='["low","medium","high","xhigh","max"]'
models="[{\"value\":\"default\",\"displayName\":\"Default (recommended)\",\"description\":\"Opus 5.5 · Best for everyday, complex tasks\",\"supportsAutoMode\":true,\"supportsEffort\":true,\"supportedEffortLevels\":$efforts},{\"value\":\"sonnet\",\"displayName\":\"Sonnet 5.5\",\"description\":\"Most efficient for simpler tasks\",\"supportsEffort\":true,\"supportedEffortLevels\":$efforts},{\"value\":\"haiku\",\"displayName\":\"Haiku 5.5\",\"description\":\"Fastest for quick answers\",\"supportsEffort\":true,\"supportedEffortLevels\":$efforts}]"
n=0
say() { printf '%s\n' "$1"; }
field() { sed -E "s/.*\"$1\":\"([^\"]*)\".*/\\1/" <<<"$2"; }
# One assistant message, streamed in parts ($@ are JSON string bodies, already escaped).
text() {
  n=$((n + 1))
  say "{\"type\":\"stream_event\",\"event\":{\"type\":\"message_start\",\"message\":{\"id\":\"m$n\"}},\"parent_tool_use_id\":null}"
  for part in "$@"; do
    say "{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"$part\"}},\"parent_tool_use_id\":null}"
    sleep 0.03
  done
  say "{\"type\":\"assistant\",\"message\":{\"id\":\"m$n\",\"content\":[{\"type\":\"text\",\"text\":\"(full copy)\"}]},\"parent_tool_use_id\":null}"
}
# A tool call ($1 id, $2 name, $3 input JSON) and, when given, its result ($4 text).
tool() {
  say "{\"type\":\"assistant\",\"message\":{\"id\":\"t$1\",\"content\":[{\"type\":\"tool_use\",\"id\":\"$1\",\"name\":\"$2\",\"input\":$3}]},\"parent_tool_use_id\":null}"
  [ -n "$4" ] && say "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"$1\",\"content\":\"$4\"}]},\"parent_tool_use_id\":null}"
  sleep 0.03
}
result() {
  local now; now=$(date +%s)
  say "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"allowed\",\"unifiedWindows\":{\"five_hour\":{\"utilization\":0.38,\"resetsAt\":$((now + 9000))},\"seven_day\":{\"utilization\":0.61,\"resetsAt\":$((now + 302400))}}},\"session_id\":\"$sid\"}"
  say "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"duration_ms\":$1,\"total_cost_usd\":$2,\"usage\":{\"input_tokens\":48,\"output_tokens\":2140,\"cache_read_input_tokens\":81000,\"cache_creation_input_tokens\":6200},\"modelUsage\":{\"claude-opus-5-5\":{\"costUSD\":$2}},\"result\":\"\",\"session_id\":\"$sid\"}"
}

orders() {
  text "I'll start with the orders route and how it loads each order's items."
  tool t1 Read '{"file_path":"src/routes/orders.ts"}' 'Read 86 lines'
  tool t2 Grep '{"pattern":"orderItems.findMany","path":"src"}' 'src/routes/orders.ts:31'
  text "Found it: every order loads its items with its own query, so 200 orders make **201** round trips (an N+1). " \
    "I'll load all the items in one query and group them in memory."
  tool t3 Edit '{"file_path":"src/routes/orders.ts","old_string":"for (const order of orders) {\n  order.items = await db.orderItems.findMany({\n    where: { orderId: order.id }\n  })\n}","new_string":"const items = await db.orderItems.findMany({\n  where: { orderId: { in: orders.map((o) => o.id) } }\n})\nconst byOrder = Map.groupBy(items, (i) => i.orderId)\nfor (const order of orders) order.items = byOrder.get(order.id) ?? []"}' 'Updated src/routes/orders.ts'
  tool t4 Bash '{"command":"bun test tests/orders.test.ts","description":"Run the orders tests"}' '12 pass, 0 fail (412ms)'
  text "**Fixed.** \`GET /orders\` now runs 2 queries instead of 1 + n:\n\n" \
    "- items load with one \`WHERE order_id IN (…)\`\n" \
    "- grouped per order with \`Map.groupBy\`, so the response shape is unchanged\n\n" \
    "| 200 orders | before | after |\n| --- | --- | --- |\n| queries | 201 | 2 |\n| p95 | 4.8 s | 140 ms |\n\n" \
    "All 12 orders tests pass. Want me to add an index on \`order_items.order_id\` too?"
  result 48200 0.4180
}

ship() {
  tool s1 TodoWrite '{"todos":[{"content":"Run the test suite","status":"completed","activeForm":"Running tests"},{"content":"Commit the dark mode toggle","status":"completed","activeForm":"Committing"},{"content":"Push feat/dark-mode","status":"in_progress","activeForm":"Pushing"},{"content":"Open the pull request","status":"pending","activeForm":"Opening the PR"}]}' 'Todos updated'
  tool s2 Bash '{"command":"bun run test","description":"Run the test suite"}' '84 pass, 0 fail (2.1s)'
  tool s3 Bash '{"command":"git commit -am \"feat(ui): dark mode toggle in Settings\"","description":"Commit the toggle"}' '[feat/dark-mode 3f9c2a1] feat(ui): dark mode toggle in Settings'
  text "Tests pass and the toggle is committed. Pushing the branch next."
  tool s4 Bash '{"command":"git push -u origin feat/dark-mode","description":"Push feat/dark-mode"}'
  say '{"type":"control_request","request_id":"req-ship","request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash","input":{"command":"git push -u origin feat/dark-mode","description":"Push feat/dark-mode"},"permission_suggestions":[],"tool_use_id":"s4"}}'
}

while IFS= read -r line; do
  case "$line" in
    *'"subtype":"initialize"'*)
      say "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$(field request_id "$line")\",\"response\":{\"commands\":[],\"models\":$models,\"account\":{\"email\":\"me@example.com\",\"subscriptionType\":\"Claude Max\"}}}}"
      say "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"$sid\",\"model\":\"claude-opus-5-5\",\"permissionMode\":\"default\",\"terminal_slash_commands\":[],\"cwd\":\"$(pwd)\"}" ;;
    *'"subtype":"set_model"'* | *'"subtype":"set_permission_mode"'*)
      say "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$(field request_id "$line")\"}}" ;;
    *'"behavior":"allow"'*)
      say '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"s4","content":"branch feat/dark-mode set up to track origin/feat/dark-mode"}]},"parent_tool_use_id":null}'
      text "Pushed." && result 9000 0.0610 ;;
    *'"type":"user"'*orders*) orders ;;
    *'"type":"user"'*[Ss]hip*) ship ;;
    *'"type":"user"'*)
      text "On it." && result 1200 0.0042 ;;
  esac
done
