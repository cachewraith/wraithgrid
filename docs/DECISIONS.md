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
