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
| `git.ts` | `gitStatus`/`gitDiff` for a pane's folder (resolved from main's config by paneId), `addWorktree` on a validated new branch; git via an injected `execFile` runner, no shell |

## Renderer
- `main.tsx` builds `Services` (API bridge, PtyBus, store) and provides them via context.
- `app/store.ts` (zustand): config + runtime pane state, all actions; persists via `config:set`.
- `lib/pty-bus.ts`: fans out `pty:data`/`pty:exit` events to panes.
- `lib/status.ts`: derives running/idle/awaiting-approval/login from output (ANSI-stripped).
- `layout/tree.ts`: pure split-tree ops; `presets.ts`, `focus.ts` on top.
- `lib/scheduling.ts`: `StaggeredQueue` starts restored panes 150 ms apart (NFR-2).
- Store polls `git:status` every 5 s for the active workspace (one call per folder) into `git[paneId]`;
  status transitions (→ approval, running ≥ 8 s → idle) raise `notify:pane` when the pane isn't in view.
- Icons: `scripts/icon-sets.ts` (Vite plugin) builds `virtual:icon-sets` from `@iconify-json/material-symbols` (one style + aliases) and `@iconify-json/lucide`; `lib/icon-sets.ts` imports it lazily; `Avatar` looks names up with `iconBody`.
- `lib/diff.ts` parses `git diff` for `DiffPanel`; `lib/search.ts` matches palette queries.

## Data flow
1. Launch → main loads `config.json` → renderer `config:get` → store hydrates.
2. Pane start → `pty:create {paneId, accountId, cwd, args}` → main resolves account from its own
   config → `buildPaneEnv` → `PtyManager.spawn` → `pty:data`/`pty:exit` events back.
3. Keystrokes → `pty:write`; resize → `pty:resize`; close → `pty:kill` (process tree).
4. Any config change → store → `config:set` (validated) → atomic write.
5. Quit → every pane's process tree killed.

## IPC surface
Full list in `src/shared/ipc-channels.ts`; schemas in `src/shared/ipc-contract.ts`. Groups: pty,
config, dialog, window, claude detect, account dir create/delete, openExternal (http/https only),
shared apply, app info, update check/install (+ `update:progress`, `update:show` events),
git status/diff/worktreeAdd, `shell:list`, `notify:pane` (+ `pane:reveal` event on notification click).

## External services
- GitHub Releases API for `cachewraith/wraithgrid` (optional update check; fixed URL).
- GitHub release assets `latest.yml` / `latest-linux.yml` + installers, read by electron-updater (repo fixed in `resources/app-update.yml`).
- Nothing else. No telemetry.

## Persistence
- `config.json` in userData: `~/.config/wraithgrid/` (Linux), `~/Library/Application Support/wraithgrid/` (macOS), `%APPDATA%\wraithgrid\` (Windows).
- Account config dirs default under `~/.wraithgrid/accounts/`. Wraithgrid does not read inside them.
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
