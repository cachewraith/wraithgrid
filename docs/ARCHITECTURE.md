# Wraithgrid: Architecture

## Processes
- **Main** (`src/main`): owns the filesystem, child processes, and network. Sole writer of `config.json`.
- **Preload** (`src/preload`): exposes a fixed typed API over `contextBridge`; bundled into one file.
- **Renderer** (`src/renderer`): React UI, sandboxed, `contextIsolation` on, `nodeIntegration` off.
- **Shared** (`src/shared`): types, zod schemas, IPC channel names, pure helpers used by all three.

## Main modules
| Module | Role |
|---|---|
| `index.ts` | App lifecycle, BrowserWindow, single-instance lock, PATH merge, composition root |
| `ipc.ts` | `registerIpc(deps)`: one handler per channel, zod-validated input |
| `pty-manager.ts` | `PtyManager`: spawn/write/resize/kill; `KillPolicy` strategy (POSIX group signal vs Windows ConPTY list) |
| `pane-env.ts` | Pane environment; `CLAUDE_CONFIG_DIR` only for claude panes |
| `config-store.ts` | `ConfigStore`: parse/migrate/sanitize, atomic write, quarantine to `config.bad-<ts>.json` |
| `claude-detect.ts` | Locate `claude` on PATH or via override; read version |
| `platform.ts` | Desktop/window-chrome detection, default shell, extra bin dirs, spawn command, login-shell PATH |
| `shared-config.ts` | Symlink/junction/hardlink shared CLAUDE.md + skills; backups, never deletes |
| `update-check.ts` | `UpdateChecker`: GitHub Releases API, cached, report only |
| `paths.ts` | Config file path, accounts root, `~` resolution, `isStrictlyInside` guard |

## Renderer
- `main.tsx` builds `Services` (API bridge, PtyBus, store) and provides them via context.
- `app/store.ts` (zustand): config + runtime pane state, all actions; persists via `config:set`.
- `lib/pty-bus.ts`: fans out `pty:data`/`pty:exit` events to panes.
- `lib/status.ts`: derives running/idle/awaiting-approval/login from output (ANSI-stripped).
- `layout/tree.ts`: pure split-tree ops; `presets.ts`, `focus.ts` on top.
- `lib/scheduling.ts`: `StaggeredQueue` starts restored panes 150 ms apart (NFR-2).

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
shared apply, app info, update check.

## External services
- GitHub Releases API for `cachewraith/wraithgrid` (optional update check; fixed URL).
- Nothing else. No telemetry.

## Persistence
- `config.json` in userData: `~/.config/wraithgrid/` (Linux), `%APPDATA%\wraithgrid\` (Windows).
- Account config dirs default under `~/.wraithgrid/accounts/`. Wraithgrid does not read inside them.

## Env vars (names only)
- Read by app: `WRAITHGRID_USER_DATA_DIR` (override userData, tests), `WRAITHGRID_DEVTOOLS`
  (`1` opens devtools), `ELECTRON_RENDERER_URL` (dev server), `TERM`, `PATH`, `ComSpec`.
- Set by app: `CLAUDE_CONFIG_DIR` (per claude pane), `WRAITHGRID_RESOLVING_ENVIRONMENT=1`
  (during login-shell PATH probe).
- Build scripts: `WRAITHGRID_BUILD_IMAGE`, `WRAITHGRID_NODE_VERSION` (`scripts/dist-linux-docker.sh`).

## CI/CD
- `build.yml`: push/PR → typecheck, lint, unit, e2e (Linux, xvfb), package (Ubuntu 22.04 + Windows).
- `release.yml`: `v*.*.*` tag → verify tag = package.json → build → SHA256SUMS → `gh release create`.
