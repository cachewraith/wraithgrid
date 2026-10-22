#!/usr/bin/env bash
# Stand-in for claude in the README screenshots (readme-shots.spec.ts): a scripted session
# per project folder, so the grid shows real-looking work, a run in progress and an approval.
if [ "$1" = "--version" ]; then
  echo "0.0.0 (demo claude)"
  exit 0
fi
[ "$1" = "plugin" ] && { echo '[]'; exit 0; }
[ "$1 $2" = "auth status" ] && {
  echo "{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"email\":\"$(basename "$CLAUDE_CONFIG_DIR")@example.com\",\"subscriptionType\":\"max\"}"
  exit 0
}
# Chat panes run claude headless (stream-json): scripted turns.
case " $* " in
  *" --input-format stream-json "*) exec "$(dirname "$0")/demo-claude-chat.sh" "$@" ;;
esac

g=$'\e[32m' y=$'\e[33m' r=$'\e[31m' c=$'\e[36m' o=$'\e[38;5;209m' d=$'\e[2m' b=$'\e[1m' z=$'\e[0m'
ask() { printf '%s>%s %s\n\n' "$d" "$z" "$1"; }
tool() { printf '%s●%s %s%s%s(%s)\n' "$g" "$z" "$b" "$1" "$z" "$2"; printf '  %s⎿%s  %s\n\n' "$d" "$z" "$3"; }
say() { printf '%s●%s %s\n\n' "$o" "$z" "$1"; }
prompt() { printf '%s%s%s\n%s>%s ' "$d" '────────────────────────────────────────────────────' "$z" "$d" "$z"; }

case "$(basename "$PWD")" in
  api-server)
    ask 'Add rate limiting to the /login endpoint'
    tool Read src/routes/auth.ts 'Read 142 lines'
    printf '%s●%s %sUpdate%s(src/routes/auth.ts)\n' "$g" "$z" "$b" "$z"
    printf '  %s⎿%s  Updated with %s18 additions%s and %s2 removals%s\n\n' "$d" "$z" "$g" "$z" "$r" "$z"
    printf '      %s+ const loginLimiter = rateLimit({ windowMs: 60_000, max: 5 })%s\n' "$g" "$z"
    printf '      %s+ router.post('"'"'/login'"'"', loginLimiter, login)%s\n' "$g" "$z"
    printf '      %s- router.post('"'"'/login'"'"', login)%s\n\n' "$r" "$z"
    printf '%s●%s %sBash%s(pnpm test auth)\n\n' "$g" "$z" "$b" "$z"
    # Steady output keeps the pane "running".
    s=12
    while :; do
      printf '\r%s✻ Running the auth tests… %s(%ss · esc to interrupt)%s ' "$o" "$d" "$s" "$z"
      s=$((s + 1))
      sleep 0.5
    done
    ;;
  web-app)
    ask 'Why does the settings page flash on load?'
    tool Grep '"useTheme"' 'Found 6 files'
    tool Read src/app/providers.tsx 'Read 58 lines'
    say "The theme is read in ${c}useEffect${z}, so the first paint uses the default."
    printf '%s●%s %sUpdate%s(src/app/layout.tsx)\n  %s⎿%s  Updated with %s9 additions%s\n\n' \
      "$g" "$z" "$b" "$z" "$d" "$z" "$g" "$z"
    say 'Fixed: the theme is now set before first paint.'
    prompt
    ;;
  infra)
    ask 'Bump the staging cluster to the new node pool'
    tool Read terraform/staging/main.tf 'Read 211 lines'
    printf '%s●%s %sUpdate%s(terraform/staging/main.tf)\n' "$g" "$z" "$b" "$z"
    printf '  %s⎿%s  Updated with %s4 additions%s and %s4 removals%s\n\n' "$d" "$z" "$g" "$z" "$r" "$z"
    printf '%s●%s %sBash command%s\n\n    terraform plan -out=staging.plan\n\n' "$y" "$z" "$b" "$z"
    printf ' Do you want to proceed?\n %s❯ 1. Yes%s\n   2. No, and tell Claude what to do\n' "$c" "$z"
    ;;
  mobile)
    ask 'Write tests for the offline sync queue'
    tool Read lib/sync/queue.dart 'Read 96 lines'
    tool Write test/sync/queue_test.dart 'Wrote 74 lines'
    printf '%s●%s %sBash%s(flutter test test/sync)\n  %s⎿%s  %s✓ 11 passed%s\n\n' \
      "$g" "$z" "$b" "$z" "$d" "$z" "$g" "$z"
    say 'Added 11 tests covering retry, ordering and conflict handling.'
    prompt
    ;;
  *) prompt ;;
esac
while IFS= read -r _; do :; done
