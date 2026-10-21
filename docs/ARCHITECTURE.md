# Wraithgrid: Architecture

## Processes
- **Main** (`src/main`): owns the filesystem, child processes, and network. Sole writer of `config.json`.
- **Preload** (`src/preload`): exposes a fixed typed API over `contextBridge`; bundled into one file.
- **Renderer** (`src/renderer`): React UI, sandboxed, `contextIsolation` on, `nodeIntegration` off.
- **Shared** (`src/shared`): types, zod schemas, IPC channel names, pure helpers used by all three.

## Main modules
| Module | Role |
|---|---|
| `index.ts` | App lifecycle, BrowserWindow (frameless / Windows overlay / macOS inset traffic lights), macOS app menu, single-instance lock, PATH merge, composition root |
| `ipc.ts` | `registerIpc(deps)`: one handler per channel, zod-validated input |
| `pty-manager.ts` | `PtyManager`: spawn/write/resize/kill; `KillPolicy` strategy (POSIX group signal vs Windows ConPTY list) |
| `pane-env.ts` | Pane environment; `CLAUDE_CONFIG_DIR` only for claude panes; drops the launching terminal's vars (COLUMNS/LINES, TERM_PROGRAM, VSCODE_*, TMUX, KITTY_*, WT_SESSION, CLAUDECODE…); `LANG=C.UTF-8` if no locale |
| `config-store.ts` | `ConfigStore`: parse/migrate/sanitize, atomic write, quarantine to `config.bad-<ts>.json` |
| `claude-detect.ts` | Locate `claude` on PATH or via override; read version |
| `platform.ts` | Desktop/window-chrome detection, default/picked shell (`resolvePaneShell`), installed shells (`listShells`), extra bin dirs, spawn command, login-shell PATH (`loginProbeArgs` per shell, `/bin/sh -l` fallback) |
| `shared-config.ts` | Symlink/junction/hardlink ~/.claude's CLAUDE.md, settings.json, skills, plugins, agents, commands into accounts; backs up real files, replaces stale links |
| `update-check.ts` | `UpdateChecker`: GitHub Releases API, cached, report only |
| `update-notify.ts` | `notifyIfNew`: native Notification for a newer release, once per version; click opens Settings → Updates |
| `update-install.ts` | `UpdateInstaller`: facade over electron-updater; check, download (progress events), install and relaunch |
| `paths.ts` | Config file path, accounts root, worktrees root, `~` resolution, `isStrictlyInside` guard |
| `chat/` | Chat panes (ADR 0002): `sessions.ts` `ChatSessions` runs one headless CLI per pane on pipes (JSON lines in/out, quiet stop, crash = exit event with last stderr line); `adapter.ts` registry; `claude.ts` stream-json ↔ `ChatEvent`, keeps pending approvals; `spawn.ts` masked fds + own process group |
| `git.ts` | `gitStatus`/`gitDiff` for a pane's folder (resolved from main's config by paneId), `addWorktree` on a validated new branch; git via an injected `execFile` runner, no shell |

## Renderer
- `main.tsx` builds `Services` (API bridge, PtyBus, store) and provides them via context.
- `app/store.ts` (zustand): config + runtime pane state, all actions; persists via `config:set`.
- `lib/pty-bus.ts`: fans out `pty:data`/`pty:exit` events to panes.
- `lib/chat-bus.ts` + `lib/chat-thread.ts`: chat panes' conversations folded from `chat:event`
  (pure reducer), saved debounced via `chat:save`; `components/chat/` draws them (markdown via
  `lib/markdown.ts`, no HTML); `store.paneView()` decides chat vs terminal.
- `lib/status.ts`: derives running/idle/awaiting-approval/login from output (ANSI-stripped).
- `layout/tree.ts`: pure split-tree ops; `presets.ts`, `focus.ts` on top.
- `lib/scheduling.ts`: `StaggeredQueue` starts restored panes 150 ms apart (NFR-2).
- Store polls `git:status` every 5 s for the active workspace (one call per folder) into `git[paneId]`;
  status transitions (→ approval, running ≥ 8 s → idle) raise `notify:pane` when the pane isn't in view.
- No icon library: accounts show their initial (`AccountIcon.tsx` `Initial`), projects and chats are text.
- `lib/diff.ts` parses `git diff` for `DiffPanel`; `lib/search.ts` matches palette queries.

## Data flow
1. Launch → main loads `config.json` → renderer `config:get` → store hydrates.
2. Pane start → `pty:create {paneId, accountId, cwd, args}` → main resolves account from its own
   config → `buildPaneEnv` → `PtyManager.spawn` → `pty:data`/`pty:exit` events back.
3. Keystrokes → `pty:write`; resize → `pty:resize`; close → `pty:kill` (process tree).
3b. Chat pane → `chat:start {paneId, accountId, cwd, args, sessionId}` → main resolves the
   spawn like a pty pane, adds the adapter's headless args → `chat:event` stream back;
   `chat:send` / `chat:approve` / `chat:interrupt` / `chat:stop`.
4. Any config change → store → `config:set` (validated) → atomic write.
5. Quit → pty panes stop or stay in the host (ADR 0001); chat processes always stop.

## IPC surface
Full list in `src/shared/ipc-channels.ts`; schemas in `src/shared/ipc-contract.ts`. Groups: pty,
config, dialog, window, claude detect, account dir create/delete, openExternal (http/https only),
shared apply, app info, update check/install (+ `update:progress`, `update:show` events),
git status/diff/worktreeAdd, chat start/send/approve/interrupt/setModel/stop/load/save (+ `chat:event`), `shell:list`, `notify:pane` (+ `pane:reveal` event on notification click).

## External services
- GitHub Releases API for `cachewraith/wraithgrid` (optional update check; fixed URL).
- GitHub release assets `latest.yml` / `latest-linux.yml` + installers, read by electron-updater (repo fixed in `resources/app-update.yml`).
- Nothing else. No telemetry.

## Persistence
- `config.json` in userData: `~/.config/wraithgrid/` (Linux), `~/Library/Application Support/wraithgrid/` (macOS), `%APPDATA%\wraithgrid\` (Windows).
- Account config dirs default under `~/.wraithgrid/accounts/`. Wraithgrid does not read inside them.
- Chat views: `userData/chats/<paneId>.json` (last 400 items); kept while the chat is open or in its project's History (`workspace.history` in config.json, last 100), deleted with the History entry.
- Worktrees made from New pane: `~/.wraithgrid/worktrees/<repo>/<branch with / → ->`.

## Env vars (names only)
- Read by app: `WRAITHGRID_USER_DATA_DIR` (override userData, tests), `WRAITHGRID_DEVTOOLS`
  (`1` opens devtools), `ELECTRON_RENDERER_URL` (dev server), `TERM`, `PATH`, `ComSpec`.
- Set by app: `CLAUDE_CONFIG_DIR` (per claude pane), `WRAITHGRID_RESOLVING_ENVIRONMENT=1`
  (during login-shell PATH probe), `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C` (git calls).
- Tests: `WRAITHGRID_E2E_SHOTS` (optional screenshot dir for `git-palette.spec.ts`).
- Build scripts: `WRAITHGRID_BUILD_IMAGE`, `WRAITHGRID_NODE_VERSION` (`scripts/dist-linux-docker.sh`); CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false` for the mac build.

## CI/CD
- `build.yml`: push/PR → typecheck, lint, unit on Ubuntu 22.04, Windows and macOS; e2e on Linux (xvfb); release → package (Linux, Windows NSIS, macOS dmg/zip arm64+x64).
- `release.yml`: `v*.*.*` tag → verify tag = package.json → build → SHA256SUMS → `gh release create`.
