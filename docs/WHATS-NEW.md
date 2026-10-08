# What's new in 1.6: Gemini, Antigravity and screenshot paste

*v1.6.0 · 2026-10-08*

Wraithgrid is no longer claude-only: an account can now run Gemini CLI or Antigravity CLI.
Screenshots paste straight into a pane, the git Changes panel can be resized, and the
Accounts and New pane screens are simpler.

---

## At a glance

| Feature | How to use it |
|---|---|
| Gemini or Antigravity account | **Accounts → Add account** → pick the **CLI** |
| Paste a screenshot or image | **Ctrl+V** (or **Ctrl+Shift+V**) in a pane |
| Resize the Changes panel | Drag its left edge; double-click the edge to reset |

---

## 1. Gemini CLI and Antigravity CLI accounts

When you add an account, pick which CLI its panes run:

- **Claude Code** (`claude`): as before. Every existing account stays a Claude account.
- **Gemini CLI** (`gemini`): each account gets its own config folder through
  `GEMINI_CLI_HOME`, so logins and history stay separate, like Claude accounts.
- **Antigravity CLI** (`agy`), Google's successor to Gemini CLI: `agy` keeps its sign-in in
  your system keyring, so **all Antigravity accounts on one computer share the same Google
  login**. That is a limit of `agy` itself.

Install `gemini` or `agy` yourself; Wraithgrid finds them on your `PATH`. Gemini and
Antigravity ask you to sign in the first time a pane starts. You can mix all three CLIs in one
grid.

Not there yet: the running / idle / needs-approval label is tuned for `claude` and may be off
in Gemini and Antigravity panes.

## 2. Paste screenshots

Take a screenshot (or copy any image) and press **Ctrl+V** in a pane. Wraithgrid saves the
image to a temp file and pastes its path: `claude` attaches it as an image, `gemini` and `agy`
get an `@path` reference. This fixes screenshots that could not be pasted before, notably on
Wayland desktops such as Hyprland.

- With no image on the clipboard, **Ctrl+V** works exactly as before.
- Saved images are only readable by you and are deleted after a day.
- On macOS nothing changes: `claude` reads the Mac clipboard itself.

## 3. Resizable Changes panel

The git diff panel (**Ctrl+Shift+D**) had a fixed width. Drag its left edge to make it wider
or narrower; the width is remembered. Double-click the edge to go back to the default. The
terminal grid always keeps some room.

## 4. Simpler screens

- **Accounts** is a plain list. Each account shows which CLI it runs, and the **Login**
  button only appears on accounts that still need to sign in.
- **New pane** lists accounts in a compact list, and its **Create pane** button stays visible
  while you scroll. The *Will run* line now shows the real command for Gemini and Antigravity
  accounts.
- Settings section titles and the shell picker are calmer, without capital-letter headings
  or card grids.
- The status bar reads "2 panes on 1 account" (accounts used in this workspace).

## Fixes

- A Gemini or Antigravity pane no longer inherits a Claude config folder from the terminal
  that started Wraithgrid.
