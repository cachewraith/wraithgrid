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
- 2026-09-30 | New-release OS notification, once per version, state in `userData/update-notified.json` | config.json is owned and rewritten whole by the renderer, so main can't keep state there safely | Notify every launch (nags); store in config.json (lost on the next renderer save)
