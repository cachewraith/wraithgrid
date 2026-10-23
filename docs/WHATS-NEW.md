# What's new in 1.16: usage for every account, smoother chats, images you can see

*v1.16.0 · 2026-10-23*

| Feature | How to use it |
|---|---|
| Usage for Codex and Antigravity | **Usage** lists every account, the ones with open panes first. Codex shows its current session and weekly limits (also in the top-bar pill); Antigravity says it reports no limits. Both show the tokens they used |
| Which account is in use | The account menu's tick is headed **New chats use**, and each account says how many panes run on it. Usage marks every account "N panes open" |
| Images in your messages | A sent image shows in the message instead of "1 image". Click it to see it full size; ← → step through several, Esc closes |
| Smoother answers | Answers stream in at a steady pace instead of in bursts, and the chat stays at the bottom while they grow, unless you scrolled up |

- Codex and Antigravity don't report what a turn costs, so their cost shows as "–", never a
  guessed number. Cost still comes from Claude accounts only.
- A long command no longer leaves a box under its "Ran …" row repeating its description.
  Chats you already have lose those boxes the next time they open.
- Your system's or theme's reduce-motion setting turns the paced streaming off.

---

## Previously, in 1.15: Codex and Antigravity chats, a new chat look, and full theming

*v1.15.0 · 2026-10-22*

| Feature | How to use it |
|---|---|
| Codex chats | A codex account's panes open as chats: streamed answers, tool cards, Allow / Always / Deny, Stop, and model, effort and mode that switch on the next message |
| Codex sign-in | **Login** on a codex account opens a dialog with ChatGPT's one-time code; enter it on the page and the dialog says when you're signed in |
| Antigravity chats | `agy` accounts open as chats too, with models, effort, modes and resume. agy can't ask before a tool in a chat, so it says what it skipped and how to allow it |
| Background work | When the agent leaves a command or agent running after its turn, the chat shows **Running in background** with how long, and the pane and sidebar say "in background" until it ends |
| New chat look | Your messages in an accent-tinted bubble, tool calls as a quiet timeline you can open, a clearer approval bar, a firmer message box and a welcome screen with starters |
| Theme editor | **Settings → Appearance → Customize…**: change colors, fonts, corners, depth, density and motion with the whole app as the live preview; hard-to-read text is flagged with a one-click fix; **Save as new theme** |
| Community themes | **Browse community…** in Appearance: install, update and remove themes others share on GitHub, or **Install from GitHub** by address. Make your own from the [theme template](https://github.com/cachewraith/wraithgrid-theme-template) |

- The five built-in themes now differ in shape too: Midnight is compact and flat, Clay round
  and deep with a soft glow on the frame, Paper flat with firmer borders.
- Theme files can set fonts, corner radius, borders, depth, density, motion and chat text size
  (all optional; old files look as before). See docs/THEMES.md.
- Your system's reduce-motion setting still wins over a theme's motion.

---

## Previously, in 1.14: a real New project screen and a sharper Usage screen

*v1.14.0 · 2026-10-22*

| Feature | How to use it |
|---|---|
| New project | The **+** next to Projects (or **New project…** in the palette): pick the folder (it fills in the name), the account its chats use, where it runs, and whether the first chat opens right away |
| Project defaults | New chats in a project start in its folder with its account, so Ctrl+Shift+N is usually just Enter |
| Limits at a glance | Usage now leads with each account's **Current session** and **Weekly** limits as big clear numbers with the reset time; color only appears as you near a limit |
| Sortable spend tables | Click any column header in the Project and Chat tables to sort, click again to flip |

- The daily cost chart gained a quiet grid, a "top" scale note and a precise hover readout.
- The project switcher (palette → **Switch project…**) only switches now; creating lives in
  the New project screen, and everything says "project" instead of "workspace".
- Cancel buttons across the app no longer lose their padding and overlap their neighbour
  (a History-graph style had leaked into them).

---

## Previously, in 1.13: git history, a better New chat, and switching accounts mid-chat

*v1.13.1 · 2026-10-22*

| Feature | How to use it |
|---|---|
| Pull | **Pull** next to Push in the Changes panel: fetches, then pulls with your git's own merge/rebase setting. It asks first if you have uncommitted changes |
| Browse history | The **History** tab in the Changes panel: every branch and tag as a commit graph; click a commit to see its files and diff, **Load more** for older ones |
| Continue a chat as another account | The account chip under the message box → **Continue as…**: the conversation moves to that account and carries on in place, with a divider marking the switch |
| New chat, faster | Ctrl+Shift+N: pick the account (plan and sign-in state shown), pick the folder, **Start**. Everything else is under More options |
| Pick a folder in-app | The folder button opens Wraithgrid's own picker: git repos marked with their branch, filter or paste a path to jump, pinned and recent on top. The system dialog is still there as a fallback |
| See what's new after an update | **Settings → About** keeps release notes per version, and the status bar shows a one-time "Updated to X · See what's new" |

- The Changes panel is now a rounded card on the frame, like the sidebar and main area.
- Updates in About show clear states: downloading with a progress bar and Cancel, ready →
  **Restart now**, failed → Retry or the release page.
- The usage pill follows the focused pane's claude account and names it when you have more
  than one.
- Sidebar motion is calmer: one timing, no overshoot, and the "needs you" dot pulses once.
- Picking a skill from the `/` menu no longer scrambles letters you had already typed.

---

## Previously, in 1.12: attach files, delete chats, sign in without a terminal

*v1.12.0 · 2026-10-22*

| Feature | How to use it |
|---|---|
| Attach files to a message | The paperclip under the message box, or drop files on it. Images go as images; other files are listed as paths and claude reads them itself (up to 20) |
| Delete a chat | The trash button on any chat in a project's Open or History list, or right-click it → **Delete chat…**. It always asks first |
| Sign in to Claude | **Login** on an account opens a dialog: open the sign-in page, paste the code if it shows one, done. **Use a terminal instead** is still there |
| Bypass permissions mid-chat | Mode button → **Bypass permissions**, click again to confirm. It now works in a chat that already started |

- Diagrams drawn with box characters in code blocks no longer break into stripes. Mermaid
  diagrams still show as code.
- The Mode button shows your pick straight away; if claude refuses a mode, the chat says why
  and the button goes back to the mode in force.
- Other CLIs (codex, gemini, cursor, copilot…) still sign in from a terminal.

---

## Previously, in 1.11: chat, themes and usage

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
