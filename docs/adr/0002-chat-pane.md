# ADR 0002: Chat panes over the CLI's headless mode

- Status: **Accepted** (2026-10-21). Supersedes the 2026-10-05 decision "keep the claude TUI
  in panes, no chat renderer".

## Context

Every pane showed its CLI's own terminal UI. The user asked for a chat interface like T3 Code,
ChatGPT and Claude Desktop, with the official CLI still doing the work underneath (accounts,
tools, CLAUDE.md, mods unchanged). The chat UI must not be tied to one CLI.

claude 2.1.306 runs headless with `-p --input-format stream-json --output-format stream-json
--verbose --include-partial-messages --permission-prompt-tool stdio`. One process takes many
turns over stdin and answers an `initialize` control request. It streams text deltas and
reports tool calls and results. It asks the host before running a tool (`control_request`
`can_use_tool`; the reply carries the decision) and stops a turn on a `control_request`
`interrupt`. All of this was checked against real output, kept in
`tests/fixtures/claude-chat.ndjson`.

## Decision

1. **One event language, one adapter per CLI.**
   - `src/shared/chat.ts` defines `ChatEvent`: session, busy, text/thinking deltas, tool,
     toolResult, approval, turnEnd, notice and exit.
   - `src/main/chat/<cli>.ts` maps a CLI's output to it and builds the CLI's headless args
     and input lines.
   - The renderer (`components/chat/`, `lib/chat-thread.ts`) never branches on the CLI.
   - `AgentCliSpec.chat` says which CLIs have an adapter. Only claude has one so far; the
     others stay terminals until an adapter is checked against real output.
2. **Processes run in main, not the pty host** (`ChatSessions`).
   - They use plain pipes, masked fds and their own process group.
   - They stop when Wraithgrid quits, even with "Keep running".
   - The next start resumes the conversation by session id (`--resume`). The view's own
     transcript is saved to `userData/chats/<paneId>.json`, capped at 400 items.
3. **Approvals belong to main.**
   - Main keeps what the CLI asked to run.
   - The renderer only sends `allow | always | deny` for a request id, never the input.
   - "Always" passes the CLI's own `permission_suggestions` back.
4. **Chat or terminal is a per-pane choice** (`pane.view`).
   - New agent panes follow `settings.newPaneView` (default chat).
   - Panes saved before this change, login panes, signed-out accounts, panes on another
     machine and `wraithgrid new` panes are terminals.
   - Switching stops the old process. The other view continues the conversation: the
     terminal with `--continue`, chat with the saved session id.
   - Amended 2026-10-25 (#110): no longer a user choice. Chat-capable agent panes here are
     always chats; the header switch, menu item, `/terminal`, terminal-only `/` commands and
     `settings.newPaneView` are gone. Saved terminal views were turned into chats once
     (`settings.chatOnlyMigrated`). Terminals remain for shells, CLIs without a chat adapter,
     other machines, `wraithgrid new` and signing in (a sign-in terminal becomes a chat once
     the account is signed in).

## Consequences

- Chat panes are not visible to the `wraithgrid` CLI (they are not in the host) and do not
  survive a quit. Moving them into the host is the follow-up if that matters.
- Some features only exist in the TUI: interactive slash commands like `/config`, `/login`,
  and a mod's TUI-only UI. Those stay one click away in the terminal view.
- Turns run in the terminal view are not in the chat transcript (claude has them; the view
  does not).
- New CLIs need an adapter and a recorded fixture: codex (`exec --json`), gemini and
  cursor-agent (stream-json), opencode (`run --format json`).

## Alternatives rejected

- **Parse the TUI's screen into chat bubbles.** Fragile; every claude release would break it.
- **Claude Agent SDK.** It brings its own CLI build and JS dependency, while the pane should
  run the user's installed `claude` with the account's config dir. The stream-json protocol
  is the same one the SDK uses.
- **Run chat processes in the pty host now.** The host is built around ptys and screen
  replay. Pipes plus a transcript resume are enough for a first version.
