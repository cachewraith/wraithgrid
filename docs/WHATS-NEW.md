# What's new: the T3 Code–inspired update

*v1.4.1 · 2026-10-05*

Wraithgrid still runs the real `claude` CLI in every pane. This update borrows ideas from
[T3 Code](https://t3.codes/) for everything around the panes: a calmer look, a sidebar that
lists your panes like a chat history, a search palette, git status with a diff panel,
worktree panes and notifications.

---

## At a glance

| Feature | How to use it |
|---|---|
| Search palette | **Ctrl+Shift+P**, or **Search** in the sidebar |
| Changes (git diff) panel | **Ctrl+Shift+D**, or click the branch label in a pane's header |
| Pane on its own branch | **Ctrl+Shift+N** → turn on *Work on a new branch (git worktree)* |
| Jump to a pane | Expand a workspace in the sidebar → click the pane |
| Notifications | On by default; **Settings → Notifications** to turn off |
| Resize the sidebar | Drag its right edge; double-click the edge to reset |
| Shell for plain panes | **Settings → General → Shell for plain panes** |

---

## 1. A cleaner look

Inspired by the Claude and ChatGPT apps:

- **Neutral greys** instead of the purple-tinted backgrounds, in both dark and light themes.
- **Black or white main buttons** (*Create pane*, *Update & restart*) instead of purple.
- **Your accent color has one job:** it marks the focused pane, the terminal cursor and
  switches. Everything else stays neutral, so color always means something.
- **Quieter edges:** no glows, softer borders, rounder pane corners (12px) and lighter pane
  headers with no separate background band.
- The terminal's default colors and the window title bar match the new greys.

Your accent choice is kept. It now just shows up in fewer places.

## 2. Sidebar like a chat app

```
 ▣                      ✎        ← collapse · new pane
 ✎  New pane      Ctrl+Shift+N
 ⌕  Search        Ctrl+Shift+P

 Workspaces               Manage
 ▾ M main              ●  2
   │ ● api           work
   │ ● infra   needs approval
 ▸ S side                 0

 Accounts            +   Manage
 W work
```

- **New pane** and **Search** sit at the top, where ChatGPT puts *New chat* and *Search*.
- **Each workspace expands to show its panes**, much like chats in a history list. The
  active workspace opens on its own.
- Each pane row has a **status dot**: green for running, amber for waiting on you, red for
  exited, hollow for idle. Problems such as *needs approval* replace the account name so
  they stand out.
- **Click a pane to jump to it.** If it's in another workspace, Wraithgrid switches there
  first. If it was hidden from the grid, it's put back.
- Right-click menus, folders and drag-and-drop for accounts work as before.

## 3. Search palette: Ctrl+Shift+P

One search box for the whole app. Type a few words in any order:

- **Panes in every workspace.** For example `api work` finds the *api* pane that runs
  under the *work* account. Results also match the branch and the status.
- **Commands:** New pane, show or hide changes, manage workspaces, collapse the sidebar,
  switch between light and dark, Accounts, Settings, keyboard shortcuts.
- **Workspaces:** switch with Enter.
- **Accounts:** *New claude pane as <account>* opens a pane straight away, in your most
  recent folder.

↑ ↓ to move, **Enter** to run, **Esc** to close.

> Why not Ctrl+K? In terminals Ctrl+K deletes to the end of the line, and Wraithgrid's own
> shortcuts all use Ctrl+Shift, so the palette never takes a key from claude.

## 4. Git in every pane

### Branch label

When a pane's folder is inside a git repository, its header shows the **branch** and, when
files have changed, **how many** in amber:

```
 api   W work   ~/code/api        ⑂ feat/limit 3    ● running   ⤢  ✕
```

It refreshes every 5 seconds for the workspace you're looking at. Panes that share a folder
share one check.

### Changes panel: Ctrl+Shift+D

Opens beside the grid and shows the **focused pane's changes since its last commit**:

- The branch, plus lines added and removed in total.
- One section per file, which you can fold, with added and removed lines in green and red.
  New, deleted and renamed files are labelled.
- **Untracked files** (new files git doesn't know about yet) are listed at the bottom.
- It refreshes when the change count moves, and has a manual ↻ button.
- Very large diffs are cut at 1 MB, with a note that they were.

The panel only reads. Nothing is committed, staged or discarded from it.

## 5. A pane on its own branch (git worktree)

Several agents editing one checkout trip over each other. In **New pane**, turn on
**Work on a new branch (git worktree)** and type a branch name such as `feat/rate-limit`:

1. Wraithgrid creates the branch from the folder's current commit.
2. It checks the branch out into
   `~/.wraithgrid/worktrees/<repo>/<branch>` (slashes become dashes).
3. The new pane opens in that folder, so its edits don't touch your main checkout.

The checkout sits outside your repo, so it never shows up as an untracked file there. If
the branch already exists, or the name isn't valid, the dialog stays open and shows git's
error.

Worktrees aren't removed automatically. To clean one up:
`git worktree remove ~/.wraithgrid/worktrees/<repo>/<branch>`

## 6. Notifications

You get a desktop notification when a **claude** pane you aren't looking at:

- **needs approval** (claude asked *"Do you want to proceed?"*), or
- **is done**: it worked for at least 8 seconds, then went quiet.

"Not looking at it" means the Wraithgrid window isn't focused, or the pane isn't on screen
(another workspace, hidden, or behind a zoomed pane). **Click the notification to jump
straight to the pane.** Plain shell panes never send notifications.

Turn this off in **Settings → Notifications**.

---

## 7. Works with any shell

### Pick the shell for plain panes

**Settings → General → Shell for plain panes** offers:

- **Automatic**: your login shell (`$SHELL`) on Linux; PowerShell 7, then Windows
  PowerShell, then cmd on Windows.
- **The shells found on this machine**: anything in `/etc/shells`, plus bash, zsh, fish,
  nushell, PowerShell, xonsh, elvish, tcsh, ksh and dash if they're on your PATH. On
  Windows: PowerShell 7, Windows PowerShell, Command Prompt, **Git Bash** (started with
  `--login -i`), **WSL** and nushell.
- **Custom…**: any other shell, as a path or a name on your PATH, with arguments
  (for example `C:\msys64\usr\bin\zsh.exe` or `nu --no-history`).

If the shell you picked is removed later, the pane says *Shell not found* and points you
back to Settings, instead of quietly opening a different shell.

### claude's screen never breaks because of your shell

claude panes don't go through your shell at all: claude is started directly. What used to
be able to garble its screen was environment carried over from the terminal you started
Wraithgrid from. Panes now drop those variables:

| Variable | What it did to claude |
|---|---|
| `COLUMNS`, `LINES` | Fixed width and height: lines wrapped wrong, boxes broke |
| `TERM_PROGRAM`, `VSCODE_*` | claude acted as if it ran inside VS Code (IDE hooks, keys) |
| `TMUX`, `STY`, `KITTY_*`, `WEZTERM_*`, `WT_SESSION`… | Wrong terminal assumed for keys and graphics |
| `CLAUDECODE` | claude thought it was nested in another claude session |

Every pane gets `TERM=xterm-256color` and `COLORTERM=truecolor`, which is what the built-in
terminal really is. On Linux, `LANG=C.UTF-8` is set when no locale is set at all, so
spinners and box drawing in tools claude runs don't turn into `?`.

### Finding claude, whatever your login shell

When Wraithgrid is started from a launcher, it asks your login shell for `PATH` so it can
find `claude`. It now uses the right flags for each shell: bash, zsh, fish, ksh and dash
are started as interactive login shells; csh and tcsh get plain `-c` because they don't
allow `-l` with other flags; nushell and PowerShell get their own commands. If your shell
still can't answer, Wraithgrid asks `/bin/sh -l`, which reads `~/.profile`.

## 8. macOS

Wraithgrid now runs on macOS 12 and later, on Apple Silicon and Intel Macs.

- **Install:** open `Wraithgrid-<version>-mac-arm64.dmg` (Apple Silicon) or `-mac-x64.dmg`
  (Intel) and drag Wraithgrid to Applications.
- **First launch:** the app isn't notarized yet (that needs a paid Apple Developer ID), so
  macOS blocks the first launch. Right-click Wraithgrid in Applications → **Open** → **Open**.
  You only do this once. Or run:
  `xattr -dr com.apple.quarantine /Applications/Wraithgrid.app`
- **Window:** the usual red/yellow/green buttons sit in Wraithgrid's own title bar.
  Double-clicking the bar zooms the window, as in other Mac apps.
- **Menu:** Wraithgrid → About, Hide, Quit (⌘Q); Edit → copy, paste, select all; Window →
  minimize, zoom, full screen. There is no ⌘W, so a stray keystroke can't close every pane.
- **Keys:** app shortcuts use **⌘** where Linux and Windows use Ctrl:

  | Action | macOS | Linux / Windows |
  |---|---|---|
  | Search | ⌘⇧P | Ctrl+Shift+P |
  | New pane | ⌘⇧N | Ctrl+Shift+N |
  | Close pane | ⌘⇧W | Ctrl+Shift+W |
  | Zoom pane | ⌘⇧Z | Ctrl+Shift+Z |
  | Changes panel | ⌘⇧D | Ctrl+Shift+D |
  | Move focus | ⌘⌥ + arrows | Ctrl+Alt + arrows |
  | Workspace 1–9 | ⌘⇧1…9 | Ctrl+Shift+1…9 |
  | Text size | ⌘= / ⌘- / ⌘0 | Ctrl+= / Ctrl+- / Ctrl+0 |
  | Copy / paste in a pane | ⌘C / ⌘V | Ctrl+Shift+C / V |

  **Every Ctrl key goes to the terminal**, so Ctrl+C, Ctrl+R and Ctrl+_ reach claude the
  same way they do in Terminal.app. The shortcut hints in the app show ⌘⇧ symbols on a Mac.
- **Finding claude:** apps opened from the Dock or Finder don't get your shell's PATH, so
  Wraithgrid asks your login shell (zsh by default) once, and also looks in Homebrew
  (`/opt/homebrew/bin`, `/usr/local/bin`) and `~/.local/bin`.
- **Updates:** **Settings → Updates** still tells you when a new version is out, but on a Mac
  it opens the release page instead of installing in place. macOS only lets an app replace
  itself when it's signed with a Developer ID.
- **Files:** settings live in `~/Library/Application Support/wraithgrid/`; accounts stay in
  `~/.wraithgrid/accounts/`.

> The macOS build is new and has been checked by tests, not yet on a real Mac. If something
> looks wrong, please report which Mac (Apple Silicon or Intel) and macOS version.

## 9. Icons from a library

Accounts, workspaces and **account folders** can now use real icons, not only emoji.

- **Where:** click the badge next to an account (Accounts page) or a workspace (workspace
  switcher), or right-click a workspace or folder in the sidebar → **Change icon**.
- **Search** thousands of icons by name (`rocket`, `git branch`, `database`, `cat`…):
  - **Material**: Google's Material Symbols, about 4,600 icons in one consistent style
    (filled, rounded). Familiar names such as `smartphone` work too.
  - **Lucide**: about 1,900 clean outline icons.
  - Filter with **All / Material / Lucide**. Before you type, a starter grid shows common
    picks for projects and accounts.
- **Emoji** are still there in their own tab, and you can type any emoji.
- **Colors:** pick a tint for the icon. For workspaces and folders it only colors the icon
  (or choose neutral grey). For an account it sets the account's color, which also marks
  its panes.
- **Letter** goes back to the first letter of the name.

The icons ship with the app and work offline. They load the first time an icon is shown,
so startup isn't slowed down.

## Keyboard shortcuts added

| Shortcut | Action |
|---|---|
| Ctrl+Shift+P (⌘⇧P on macOS) | Search panes and commands |
| Ctrl+Shift+D (⌘⇧D on macOS) | Show or hide the Changes panel |

Every shortcut is listed in the app with **Ctrl+Shift+/**.

## Trying it while the installed app is open

Only one Wraithgrid can run per data folder. To run the dev build next to the installed
one:

```bash
mkdir -p ~/.config/wraithgrid-dev
cp ~/.config/wraithgrid/config.json ~/.config/wraithgrid-dev/   # optional: your accounts and layout
WRAITHGRID_USER_DATA_DIR=~/.config/wraithgrid-dev pnpm dev
```

## Not in this update

- **A chat-style pane** (messages drawn by Wraithgrid instead of the claude terminal). It
  was left out on purpose: panes keep the full claude CLI.
- **Commit, push or open a PR from the Changes panel** (T3's one-button flow). Planned next.
- **Removing a worktree when its pane closes.** Planned, with a confirm step.
