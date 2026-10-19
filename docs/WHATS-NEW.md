# What's new in 1.9: more agents, pick up where you left off

*v1.9.0 · 2026-10-19*

Wraithgrid now runs seven agent CLIs, continues your conversations when it restarts, tells you
which pane finished while you were away, commits and pushes from the Changes panel, and lets
you rebind its shortcuts. The Mods screen can update, uninstall and manage marketplaces.

---

## At a glance

| Feature | How to use it |
|---|---|
| Add a Codex, opencode, Cursor or Copilot account | **Accounts → Add account**, pick the **CLI** |
| Continue a conversation after a restart | Automatic for panes you prompted; right-click a pane's header to turn it off |
| See which pane finished | A **done** status and notification |
| Commit, push, open a pull request | **Ctrl+Shift+D**, then the buttons under the diff |
| Clean up a worktree | Close its last pane, then **Remove worktree** |
| Update or uninstall a mod | **Mods → Installed**, **Update** / **Uninstall** |
| Add or remove a marketplace | **Mods → Marketplaces** |
| Rebind a shortcut | **Settings → Keyboard shortcuts → Change** |
| Install with one line | `curl -fsSL https://raw.githubusercontent.com/cachewraith/wraithgrid/main/scripts/install.sh \| sh` |

---

## 1. Seven agent CLIs

Besides Claude Code, Gemini CLI and Antigravity, an account can now run **Codex**
(`codex`), **opencode**, **Cursor Agent** (`cursor-agent`) or **Copilot CLI** (`copilot`).
Each pane gets its account's folder through the CLI's own variable: `CODEX_HOME`,
`CURSOR_CONFIG_DIR` or `COPILOT_HOME`.

- Codex, Cursor and Copilot keep settings and history per account, but may keep the sign-in
  in your system keyring, so their accounts can share one login. The account form says so.
- opencode, like Antigravity, has no per-account folder: its accounts share one login.
- A CLI that isn't on your `PATH` can be given a path under **Settings → Other agent CLIs**.

## 2. Pick up where you left off

When Wraithgrid starts again, a pane you sent a prompt to continues its last conversation
(`claude --continue`, `codex resume --last`, `gemini --resume latest`…). A pane you never
prompted, a new pane and a restarted pane start fresh. Right-click a pane's header to switch
**Continue conversation on restore** off for that pane.

## 3. "Done" means done

A pane that worked for a while and finished while you were looking elsewhere now shows
**done**, and the desktop notification fires then. It turns back to idle once you look at it
or type into it. Each CLI's "needs approval" prompt is recognized on its own terms.

## 4. Commit, push and pull request from the Changes panel

Under the diff (**Ctrl+Shift+D**): write a message and press **Commit all** (or
**Ctrl+Enter**), then **Push** and **Pull request**. The pull request opens the GitHub or
GitLab page for the branch in your browser. Push and pull request ask before anything leaves
your machine.

Closing the last pane on a worktree now asks whether to remove its folder. It names any files
that are not committed; the branch and its commits always stay.

## 5. More from the Mods screen

- **Update** and **Uninstall** (asks twice) for every account that has the mod.
- **Marketplaces**: see where Browse finds mods, add one (`owner/repo` or an https address)
  to all accounts, or remove one from all of them.
- **Browse** now merges the marketplaces of all your claude accounts.
- claudemod.com mods that are a single plugin, with no marketplace file, have **Download**:
  they are cloned into `~/.wraithgrid/mods` and added to your mod folders.

## 6. Your own shortcuts

**Settings → Keyboard shortcuts** rebinds search, new pane, close pane, zoom, git changes and
the shortcuts sheet. Press **Change**, then the new keys. A shortcut needs Ctrl (⌘ on macOS)
with Shift or Alt, so the terminal keeps its own keys.

## Not there yet

- Codex, opencode, Cursor and Copilot have not been tried with real accounts yet; their
  approval prompts are matched from their documentation.
- Agents still stop when Wraithgrid quits. Keeping them running in the background is the
  next big step (see `docs/adr/0001-background-pty-host.md`).
- Homebrew, winget and AUR packages are prepared but not published yet.
