# What's new in 1.24.0: a lighter background host, everywhere

*v1.24.0 · 2026-10-27*

| New | What changed |
|---|---|
| A lighter background host | Terminal panes run in a new background host written in Rust, on Windows, macOS and Linux: about 5 MB of memory while idle instead of about 110 MB. Panes keep running after you close the window, as before |
| SSH machines without an install | A Linux machine you reach over ssh no longer needs Wraithgrid installed: the host is copied there once per version, and versions unused for 30 days are removed |
| Prompt history | ↑ and ↓ in the chat box step through the prompts you sent in that chat, like a shell; your draft comes back past the newest |
| Claude's questions one at a time | When Claude asks several questions, they come as one card with a tab per question, number keys for the options, and Back/Next |

| Fix | What changed |
|---|---|
| Long chats | Long and streaming chats stay fast: a new word no longer redraws the message box or re-reads the whole answer |
| Last answer after quit | Quitting right after an answer, or while one streams, no longer loses it from the chat when you open Wraithgrid again |
| Closing with busy chats | Closing the window asks when a chat is still working, instead of stopping it; the tray no longer quits under a working chat |
| Big screens | A pane with a very large screen reattaches instead of making every pane look stopped |
| Updates on Linux | Cancelling the password prompt of an update no longer stops your terminal panes |
| Changes panel | Follows further edits to a file that was already changed, without Refresh |
| Working line | Comes back under an answer that paused while Claude keeps working (a big file write) |
| Approvals after Stop | A question or approval that was stopped no longer comes back on the next turn |
| Preview address | The dev server's address is read whole, so the preview opens the right port |
| Smaller fixes | Settings path fields keep the last edit when you leave the page; Usage counts days right across a clock change; `wraithgrid send` makes the pane resume after a restart; dragging a panel edge no longer redraws every pane |

---

## Previously, in 1.23.0: scheduled cards, working logos and a bigger About

*v1.23.0 · 2026-10-26*

| New | What changed |
|---|---|
| Scheduled as cards | The Scheduled page shows each job as a card: where it runs, the prompt, and its next and last run at a glance. Queued **Send later** messages are cards above the jobs, with Cancel and Send now |
| Working logos | While a chat thinks or runs a tool, its own logo (Claude, Codex, Antigravity…) pops and turns instead of three bouncing dots. Its row in the sidebar, a closed project that's working and the collapsed rail move the same way |
| Words blur in | Answers come in word by word from a slight blur, and nothing trails the last word |
| A bigger About | Updates shows the version large and each install step as it happens: Download, Verify, Ready, Restart. What's new lists every version beside its notes, with new features as cards and fixes as a list |

| Fix | What changed |
|---|---|
| "Scheduled run done" | No longer shows up for an ordinary chat when a scheduled run was left over from an earlier session; such a run is now closed quietly when Wraithgrid starts |

---

## Previously, in 1.22.1: web preview, and chats stay chats

*v1.22.1 · 2026-10-25*

Everything from 1.22.0 below, now with every download built.

| Fix | What changed |
|---|---|
| Linux downloads | 1.22.0's Linux build stopped on a test that failed by timing; with the test fixed, 1.22.1 ships the Linux packages too. Nothing changes in the app |

---

## Previously, in 1.22.0: web preview, and chats stay chats

*v1.22.0 · 2026-10-25*

| New | What changed |
|---|---|
| Web preview | **Preview** in a project's menu (or the command palette) runs the project's dev server and shows the site in a pane beside the chat. The command is found in package.json or Laravel's artisan and saved on the project; back, forward, reload, the address, open in browser and the server log are in its toolbar. Only addresses on this computer load, in the preview's own session; other links open in your browser |
| Attach to chat | The preview's **Attach to chat** puts a screenshot of the page and its console errors and failed requests into the project's chat, ready to send, so the agent can see what it built |
| Chats stay chats | Claude, Codex and Antigravity always open as chats: the Chat/Terminal switch and the terminal-only `/` commands are gone. Panes saved as terminals open as chats once; plain shells, other CLIs and remote panes stay terminals |
| Sign in from a chat | A chat whose account isn't signed in has a **Sign in** button |

| Fix | What changed |
|---|---|
| Scheduled chats and teams | A scheduled chat or a team starts in the project's folder (or the folder its chats use) instead of your home folder, so the agent no longer asks which project to work on |

---

## Previously, in 1.21.0: scheduled chats, project teams and one header row

*v1.21.0 · 2026-10-25*

| New | What changed |
|---|---|
| Scheduled chats | The Scheduled page starts chats on a schedule: once, daily, on chosen days, every few hours, or when an account's limit resets. Runs missed by over an hour are recorded, not run late; with jobs on, closing the window keeps the tray icon so they still run |
| Send later | A clock button in the message box queues the message for when your limit resets, in an hour, tomorrow morning or at a time you pick; queued messages show above the box with Cancel and Send now |
| Project team | Save a team of agents on a project (any providers, each with a role, model and first message, each on its own branch folder) and start them all with one click, laid out side by side; the editor shows each account's use and which agents share a limit |
| Claude's questions | When Claude asks you something, the chat shows the options to pick (or your own answer) instead of an Allow button |
| Codex skills | In a Codex chat, typing `$` or `/` suggests its skills |
| One header row | With one chat open, the window, project and chat bars are a single row; split chats get slim title rows whose buttons show on hover |
| Same corners in every theme | Switching themes changes colours, not the roundness of corners |

| Fix | What changed |
|---|---|
| Stuck "Thinking" | A chat no longer keeps thinking after an error like "You've hit your session limit", and Stop always ends the wait |
| Session limit | "Session limit" now counts as a usage limit for switching account and for scheduled chats |

---

## Previously, in 1.20.0: one brain per provider, rounded panels and a clearer sidebar

*v1.20.0 · 2026-10-24*

| New | What changed |
|---|---|
| One brain per provider | With sharing set to Overall, all Claude accounts share one CLAUDE.md, skills and plugins, and all Codex accounts share one AGENTS.md, skills and prompts, kept in ~/.wraithgrid/shared. Your ~/.claude and ~/.codex are left as they are |
| Codex reads CLAUDE.md | A project with only a CLAUDE.md is now read by Codex too; AGENTS.md still wins |
| Sidebar tree | Every project lines up on the left with its chevron; chats sit indented under a thin guide line; an empty project opens to New chat |
| Rounded panels | Sidebar, chat and Changes panel are rounded panels with a small gap instead of edge lines |
| Working icons | A running chat's logo, a closed project's icon and the collapsed rail's icon pop gently while they work |

| Fix | What changed |
|---|---|
| Chat follow | Clicking beside the messages, a sideways swipe over code or a growing message box no longer stops the chat from following new text |
| Account search | The account picker's search box no longer shows a square focus ring |

---

## Previously, in 1.19.5: instant chat scrolling

*v1.19.5 · 2026-10-24*

| Fix | What changed |
|---|---|
| Instant chat follow | New content follows immediately without a slow glide or catch-up animation |
| Read earlier messages | Scrolling up still pauses follow; reach the bottom or click the latest-message button to resume |

---

## Previously, in 1.19.4: chat and sidebar fixes

*v1.19.4 · 2026-10-24*

| Fix | What changed |
|---|---|
| Chat auto-scroll | Scrolling up immediately pauses follow while a reply streams. Reach the bottom or click the latest-message button to resume |
| Account identity | Codex uses the ChatGPT knot; the sidebar footer shows a single provider badge on the avatar |
| Account picker | Keyboard selection starts on the current account, and hovering rows does not scroll the list |

This patch also stabilizes the Windows release checks.

---

## Previously, in 1.19.3: one provider icon in the sidebar footer

*v1.19.3 · 2026-10-24*

| Fix | What changed |
|---|---|
| Sidebar account footer | Keep the provider badge on the avatar and remove the duplicate icon beside the account details |

---

## Previously, in 1.19.2: stop auto-scroll and identify Codex accounts

*v1.19.2 · 2026-10-24*

| Fix | What changed |
|---|---|
| Chat auto-scroll | Scrolling up pauses follow immediately, even with a small wheel movement during a streamed reply. Reach the bottom or click the latest-message button to resume |
| Codex identity | Codex accounts use the ChatGPT knot in account pickers, composer controls and provider badges |
| Account picker | Keyboard selection starts on the current account. Hovering rows no longer scrolls the list |

---

## Previously, in 1.19: a cleaner app, project icons, and chats across CLIs

*v1.19.1 · 2026-10-24*

| Feature | How to use it |
|---|---|
| A cleaner app | Flatter surfaces, more breathing room, consistent controls and smoother transitions across Settings, Usage, Projects, Accounts, chats, terminals, dialogs and menus. System and theme reduced-motion settings turn motion off |
| The new sidebar | Projects and chats form compact, left-aligned rows with provider marks and quiet times or state words. The icon rail keeps projects reachable when collapsed. Account, pane count and version stay in the footer |
| Limits at a glance | The sidebar shows the account new chats use, with separate **5h** and **week** meters, reset times and where auto-switch will go next. Amber starts at 80%, red at 95%; click the block to open Usage |
| Project icons | Right-click a project → **Change icon** to choose from the offline library. New projects can suggest icons from files in their folder, such as Laravel, Spring, React or Rust |
| Pick any account | The account button in the composer lists accounts grouped by provider. Search by typing, use ↑↓ and Enter to choose, or Esc to close |
| Continue in another CLI | Picking another chat CLI previews a text handoff before anything changes. Confirm to start the target CLI in the same pane position; the original chat stays reopenable in **History**. Picking a terminal-only CLI opens a fresh terminal pane |

- Switching between Claude accounts or between Codex accounts still copies and resumes the conversation. Antigravity accounts resume their shared conversation and explain that they use the same login.
- Cross-CLI handoffs carry recent visible user and assistant text, without tool output or thinking. Model, effort and permission mode reset to the target CLI's defaults.
- Composer controls are larger, long account names truncate, and the folder/branch appear below the box.
- Empty projects keep the same compact alignment as active projects. Pane/account counts appear once in the sidebar footer, without an extra row underneath.
- Theme-tool dropdowns follow the app's theme and support the keyboard. Settings sections support arrows, Home and End.
- **Scheduled** is visible in the sidebar but disabled; scheduling is not included in this release.

---

## Previously, in 1.18: switch accounts at the limit, Codex accounts, a tidier sidebar

*v1.18.1 · 2026-10-23*

| Feature | How to use it |
|---|---|
| Switch account at the limit | When a Claude or Codex chat's account reaches 95% of its 5-hour or weekly limit, the chat carries on as your next account of the same CLI, with the whole conversation. A message the limit refused is sent again there. **Settings → Chat → Switch account at limit** turns it off or sets 80/90/95/100% |
| Codex accounts | A Codex chat's account button now offers **Continue as…** like Claude: pick another Codex account and the conversation carries on there |
| Projects as dropdowns | Each project in the sidebar opens and closes its chats with the arrow beside it (or → ← on the row), and remembers it. The project of the chat you're in opens on its own. Chats are plain one-line rows with their time; hover one for its branch and account |
| Results under their row | When a background agent or command finishes, its result sits under its own row: one plain line, the whole answer formatted when you open it |

- The sidebar's account box at the bottom is never covered any more: only the list scrolls.
- A long account name in the sidebar's Usage row is cut short instead of wrapping; the % stays.
- 1.18.1: the sidebar is a clean list again: no boxes around chats, one line per project, and
  only the chat you're in is highlighted.

---

## Previously, in 1.17: chat cards in the sidebar, calmer streaming

*v1.17.0 · 2026-10-23*

| Feature | How to use it |
|---|---|
| Chat cards | The sidebar's **Chats** list shows every open chat as a card: project, how long ago, title, git branch and account. The most recent comes first; click one to go to it. **Projects** are still listed below |
| Rounder corners | Cards, buttons, menus and dialogs are a little rounder, in every theme |
| Calmer streaming | No more big blinking block while an answer comes in: a small dot pulses softly instead. Words appear whole and fade in, new paragraphs ease in, and the chat glides down as it grows |

- Your system's or theme's reduce-motion setting turns the fades and the glide off.
- A card's branch is updated for the project you have open; other projects' cards keep the
  last one seen.

---

## Previously, in 1.16: usage for every account, smoother chats, images you can see

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
