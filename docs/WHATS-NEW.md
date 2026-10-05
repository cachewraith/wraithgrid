# What's new: the T3 Code–inspired update

*Unreleased, after v1.3.0 · 2026-10-05*

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

## Keyboard shortcuts added

| Shortcut | Action |
|---|---|
| Ctrl+Shift+P | Search panes and commands |
| Ctrl+Shift+D | Show or hide the Changes panel |

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
