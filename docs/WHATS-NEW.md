# What's new in 1.11: chat, themes and usage

*v1.11.1 · 2026-10-22*

Agent panes can now be a chat, like ChatGPT, Claude Desktop or T3 Code, with the official CLI
still doing the work in the background: same account, same folder, same CLAUDE.md, skills and
mods.

| Feature | How to use it |
|---|---|
| Chat with an agent | New panes open as chat (**Settings → New panes open as**) |
| Switch a pane | The Chat / Terminal switch in the pane header, or right-click the header |
| Approve a tool | **Allow**, **Always allow** or **Deny** above the message box |
| Stop a turn | **Stop** or Esc |
| Start over | The new-conversation button in the header |
| Paste a screenshot | Ctrl+V in the message box |
| Find a chat | Click a project in the sidebar: its open chats and History, with search |
| Pick up an old chat | Project → History → click it: it carries on where it stopped |
| Switch account | The account button at the bottom of the sidebar (new chats use it) |
| Group accounts in folders | Accounts page (from the account button → Manage accounts) |
| Change the model | The model button in the message box (Opus, Sonnet, Haiku…, and effort) |
| Defaults for new chats | **Settings → Chat** |
| Change the look | **Settings → Appearance**: Wraith, Midnight, Clay, Daylight, Paper |
| See your usage | **Usage** in the sidebar, the account menu, the top-bar gauge, or `/usage`: session and weekly limits per account, cost per day, project and chat |
| Plan, accept edits, auto… | The Mode button under the message box, or Shift+Tab |
| Effort | The Effort button under the message box (low to max) |
| Run a skill or command | Type `/` in the message box: pick with ↑/↓ and Enter |
| Make everything bigger or smaller | `Ctrl+=` / `Ctrl+-` (`Ctrl+0` resets), or **Settings → Appearance → Interface size** |
| Use a small window | The window now goes down to 640×420: the sidebar folds to a rail (open it as a drawer), pane headers and Settings compact |
| Make or share a theme | **Import theme…**, or right-click a theme → Export ([format](THEMES.md)) |

- Answers stream in as formatted text, with code blocks you can copy. Commands, file edits
  (as a diff), searches and task lists show as small cards that open to show their output.
- The sidebar and the whole app are text first, like Claude and Codex desktop: no icons or emoji, Settings in tabs.
- Quit and come back: the conversation is still there and carries on.
- Chat is for Claude Code for now; other CLIs open as terminals. Signing in, `/config` and
  other interactive commands are in the terminal view. Chat agents stop when Wraithgrid quits
  (terminal panes can keep running), and the `wraithgrid` command sees terminal panes only.

---

## Previously, in 1.10: agents that keep running

*v1.10.0 · 2026-10-20*

Agents no longer stop when you close Wraithgrid. A new `wraithgrid` command lets scripts, and
agents in other panes, drive your panes, and a workspace can run its panes on another
computer over ssh.

---

## At a glance

| Feature | How to use it |
|---|---|
| Keep agents running after closing | Close the window, pick **Keep running** (or **Settings → When the window closes**) |
| Stop them later | Tray icon → **Stop all agents and quit**, or open Wraithgrid and quit with **Stop** |
| Drive panes from a terminal | **Settings → Command line**, then `wraithgrid list`, `send`, `wait`, `read`, `new`, `split` |
| Watch one pane in a terminal | `wraithgrid attach <pane>`; Ctrl+] leaves it running |
| Run a workspace on another computer | **Settings → Machines → Add machine**, then right-click an empty workspace → **Run on …** |

---

## 1. Agents keep running

Panes now run in a small background process instead of the window. Close the window (or quit)
and choose **Keep running**: the agents carry on, a tray icon shows how many, and the next
launch shows every pane exactly as it is, screen and all. A pane that ended meanwhile shows
its exit code. **Stop agents and quit** works as before. A crashed window no longer takes the
agents with it either.

## 2. The `wraithgrid` command

Off until you turn on **Settings → Command line**. Then:

```sh
wraithgrid list
wraithgrid send alpha "run the tests and fix what fails"
wraithgrid wait alpha --until idle
wraithgrid read alpha --lines 40
```

`wait --until blocked` returns when the agent asks for approval. Inside a pane,
`$WRAITHGRID_PANE` is its own id, so an agent can open a helper pane with `wraithgrid split`
and prompt it.

## 3. Attach from any terminal

`wraithgrid attach alpha` shows the pane in your terminal, keys go to it, and **Ctrl+]**
leaves it running. Over ssh, use `ssh -t`.

## 4. Other machines

Add a computer under **Settings → Machines** (a host from `~/.ssh/config`), then set an empty
workspace to **Run on** it. Its panes start there, with that computer's CLIs, folders and
logins, and keep running when you disconnect or quit. It needs Wraithgrid installed there
and ssh with a key or agent.
