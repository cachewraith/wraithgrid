# Decisions

`YYYY-MM-DD | Decision | Why | Alternatives rejected`

Entries dated 2026-09-29 are reconstructed from the code and commit history during the 2026-09-30 bootstrap.

- 2026-09-29 | Run the official `claude` CLI in a PTY, one `CLAUDE_CONFIG_DIR` per account | Separate logins without touching credentials | Custom client; proxying or copying tokens
- 2026-09-29 | Electron + React + xterm.js + node-pty | Full terminal fidelity, cross-platform | Native per-OS apps; web-only terminal
- 2026-09-29 | Sandboxed renderer; fixed IPC list with zod-validated payloads; main resolves accounts itself | Renderer can't reach the FS/processes except through checked calls | Exposing ipcRenderer; trusting renderer-supplied paths
- 2026-09-29 | Config as one JSON file, atomic writes, corrupt file quarantined to `config.bad-<ts>.json` | Simple, inspectable, crash-safe | SQLite; electron-store
- 2026-09-29 | Build Linux packages on Ubuntu 22.04 (Docker/CI) | node-pty links host glibc; 2.35 covers target distros | Building on Arch/Fedora
- 2026-09-29 | Shared CLAUDE.md/skills via links; conflicting files renamed to `.wraithgrid-backup` | Opt-in sharing without data loss or reading account files | Copying files; deleting conflicts
- 2026-09-29 | Update check reports only, from a hardcoded GitHub URL | Works for every package type; no SSRF from config | Auto-updater (electron-updater)
- 2026-09-29 | Platform logic as pure functions of `(platform, env)` | Unit-testable on any OS | Branching on `process.platform` inline
- 2026-09-30 | Adopt the AI Working Agreement (`CLAUDE.md`) + docs context files | Cut per-session re-exploration | None
- 2026-09-30 | CI builds installers only for release tags; docs-only pushes skip CI | Avoid rebuilding downloads on every push/doc edit | Separate package workflow (more files); manual workflow_dispatch packaging (not needed)
- 2026-09-30 | Sharing is two modes: "overall" links ~/.claude into every account (default), "per-account" unlinks | Users want their normal CLAUDE.md, skills and plugins in every account without picking a source account | Picking a source account (old design); copying files into each account (drifts)
- 2026-09-30 | Share settings.json and plugins/ too, not only CLAUDE.md and skills/ | Installed plugins only load when enabled in settings.json | Sharing only plugins/ (plugins stay disabled)
- 2026-09-30 | A link in the way that points elsewhere is removed, not backed up | Links hold no data; lets old source-account links move to ~/.claude | Backing up links (restores stale links later)
- 2026-09-30 | Sharing changes offer a "Restart claude panes" button instead of restarting automatically | A restart ends the running conversation | Auto-restart on change
- 2026-09-30 | Account folders are one level deep, stored as `accountFolders` + `Account.folderId` | Enough to group accounts; sanitize drops dangling refs; old configs default to [] / null | Nested folders (tree ops, more UI for little gain); folders owning account lists (two sources of truth)
- 2026-09-30 | Account icon is an emoji string rendered as text | No asset storage or upload path; React escapes it | Uploaded images (file handling, size limits); fixed SVG icon set only
- 2026-09-30 | In-app updates via electron-updater (reverses "update check reports only") | Users want one click, not picking a package from the release page; electron-updater already handles NSIS, AppImage, deb, rpm and pacman, and sha512-checks downloads against latest*.yml; source stays fixed (app-update.yml, this repo) | Own per-package installer (re-implements pkexec/NSIS handling); keep report-only (user rejected it)
- 2026-09-30 | Updates download only on the button, never auto-install on quit | On Linux an install needs a pkexec password prompt; one appearing on quit would be a surprise | autoDownload + autoInstallOnAppQuit (electron-updater defaults)
- 2026-09-30 | Sidebar animates `width`, with content fixed-width only while moving (`.moving`) | Content is revealed/clipped instead of reflowing mid-animation; at rest it must still fit beside a scrollbar; terminal refit is already debounced (50 ms) so panes resize once | Transform/overlay slide (main area would jump at the end); permanent min-width (clips under a scrollbar)
- 2026-09-30 | Workspace delete from the right-click menu is two-step inside the menu | Deleting closes the workspace's panes; no extra dialog | Confirm dialog (heavier); one-click delete (loses running panes)
- 2026-09-30 | New-release OS notification, once per version, state in `userData/update-notified.json` | config.json is owned and rewritten whole by the renderer, so main can't keep state there safely | Notify every launch (nags); store in config.json (lost on the next renderer save)
- 2026-10-05 | Keep the claude TUI in panes; take T3 Code's ideas as chrome (pane list, palette, git chip, diff panel, worktrees, notifications), not a chat renderer | Full CLI fidelity and the PTY design stay; user picked "restyle chrome only" | Own chat pane over `claude -p --output-format stream-json` (large, reverses the PTY decision)
- 2026-10-05 | Neutral grey tokens, monochrome primary button; accent kept for focus ring, cursor, switches and state | Calmer Claude/ChatGPT look; color then means something | Accent-tinted surfaces and selections (the old prototype look)
- 2026-10-05 | Palette on Ctrl+Shift+P, diff on Ctrl+Shift+D | App shortcuts are all Ctrl+Shift; Ctrl+K is kill-line in terminals | Ctrl+K (steals a terminal key)
- 2026-10-05 | git IPC takes a paneId and main resolves the folder from its own config | Same rule as accounts: no renderer paths for reads | Passing cwd from the renderer
- 2026-10-05 | Worktrees under `~/.wraithgrid/worktrees/<repo>/<branch>` | Outside the repo, so they never show as untracked; next to the account dirs | Inside the repo (pollutes status); sibling of the repo (writes beside user projects)
- 2026-10-05 | Pane notifications from the renderer's status transitions, shown by main | Status is derived in the renderer; main owns Notification and window focus | Notification API in the renderer (needs a new permission; click can't focus the window)
- 2026-10-05 | Shell for plain panes is a setting (path or PATH name + args); detected list offered; a missing pick fails the pane with a message | Users run fish, nu, Git Bash, WSL…; silently swapping shells hides the problem | Always $SHELL / PowerShell; falling back silently
- 2026-10-05 | claude keeps starting directly (not via the user's shell); robustness comes from a clean env | No shell rc can then break claude's TUI; only inherited terminal vars could | Launching claude through `$SHELL -c` (rc output, aliases, slower, per-shell quoting)
- 2026-10-05 | Login probe flags chosen per shell kind, then `/bin/sh -l` fallback | csh/tcsh reject `-l -c`, nushell lacks printf/env -0 | One argv for all shells (silently fails for some)
