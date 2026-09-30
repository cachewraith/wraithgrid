# Wraithgrid: Context

## Purpose
Electron desktop app that runs many official `claude` CLI sessions side by side, one per pane,
each with its own account (`CLAUDE_CONFIG_DIR`) and project folder. Windows + Linux. v1.1.0.

## Stack
Electron 44, electron-vite 5, React 19, TypeScript 6, zustand, zod 4, @xterm/xterm 6, node-pty,
react-resizable-panels, @dnd-kit. Tests: Vitest (unit), Playwright (Electron e2e). pnpm 11, Node ≥22.12.

## Commands
- `pnpm i` — install; rebuilds node-pty for Electron (allow electron/esbuild/node-pty builds)
- `pnpm dev` — run with hot reload
- `pnpm typecheck` — tsc over node + web projects
- `pnpm lint` — ESLint + Prettier check (`pnpm format` to fix)
- `pnpm test` — Vitest unit tests (`tests/unit`)
- `pnpm test:e2e` — build, then Playwright (`tests/e2e`; needs a display, CI uses xvfb-run)
- `pnpm build` — production build into `out/`
- `pnpm dist:linux:portable` — Linux packages in Ubuntu 22.04 Docker; `pnpm dist:win` on Windows
- Release: `npm version <patch|minor|major> -m "chore: release %s" && git push --follow-tags`

## Directory map
- `src/main/index.ts`: app entry; window, PATH resolution, wires ConfigStore/PtyManager/IPC
- `src/main/ipc.ts`: all IPC handlers; validates every payload with zod contracts
- `src/main/pty-manager.ts`: spawns/kills pane processes; per-OS KillPolicy
- `src/main/pane-env.ts`: builds a pane's env (sets `CLAUDE_CONFIG_DIR` for claude panes)
- `src/main/config-store.ts`: config.json load/save, atomic write, bad-file quarantine
- `src/main/claude-detect.ts`: finds the `claude` binary and version
- `src/main/platform.ts`: OS/desktop differences as pure functions (chrome, shell, PATH, spawn)
- `src/main/shared-config.ts`: link one CLAUDE.md + skills/ into every account
- `src/main/update-check.ts`: GitHub Releases check (fixed URL, report only)
- `src/main/paths.ts`: config/account paths, `isStrictlyInside` guard
- `src/preload/index.ts`: typed bridge; renderer never sees ipcRenderer
- `src/shared/ipc-channels.ts`: the complete IPC channel list
- `src/shared/ipc-contract.ts`: zod schemas for IPC args/events
- `src/shared/schema.ts`: persisted config schema, migrate/sanitize/parse
- `src/shared/types.ts`: domain types, themes, accents, palettes, fonts
- `src/shared/args.ts`, `src/shared/paths.ts`: launch-args parsing, pure path helpers
- `src/renderer/main.tsx`: composition root (builds Services)
- `src/renderer/app/store.ts`: zustand store, all app actions (largest file)
- `src/renderer/app/{App,services,shortcuts}`: root view, DI context, key matching
- `src/renderer/components/`: UI (PaneGrid, Pane, Terminal, dialogs, Settings/Accounts views)
- `src/renderer/layout/`: pure split-tree ops, presets, directional focus
- `src/renderer/lib/`: PtyBus, status detection, terminal themes, ANSI strip, scheduling
- `src/renderer/styles/`: design tokens + base CSS
- `tests/unit/`, `tests/e2e/`, `tests/fixtures/fake-claude.sh`: tests + fake CLI
- `scripts/`: Docker Linux build, multi-distro package smoke test
- `build/`: icons; `.github/workflows/`: build.yml (CI), release.yml (tag → release)
- `docs/REQUIREMENTS.md`: original requirements (FR-*/NFR-* IDs); `docs/screenshots/`

## Conventions
- Conventional commits: `type(scope): summary`.
- Prettier + ESLint; no semicolons, single quotes (see existing files).
- `@shared` alias → `src/shared` (vite, vitest).
- Main-process logic as pure functions of `(platform, env)` / injected deps so it's unit-testable.
- Every IPC channel listed in `ipc-channels.ts` with a zod schema in `ipc-contract.ts`; main
  resolves accounts from its own config, never trusts renderer paths.
- Dependencies pinned to exact versions; GitHub Actions pinned by SHA.
- Short file-top comment explaining *why* a module exists.

## Stable / don't reopen
- `docs/REQUIREMENTS.md`, `docs/ui-prototype.dc.html`, `docs/screenshots/`
- `electron-builder.yml`, `scripts/*.sh`, `build/`
- `src/renderer/lib/{ansi,ids,scheduling}.ts`, `src/renderer/layout/presets.ts`

## Known gotchas
- node-pty compiles against the host glibc: ship Linux builds from Ubuntu 22.04 (portable script / CI).
- Launcher-started app lacks shell PATH: main asks the login shell once (skipped when `TERM` set).
- Windows `claude.cmd` runs through cmd.exe: args with `& | < > ^ % "` are refused.
- Sandboxed preload can't require node_modules: preload is bundled (`externalizeDeps: false`).
- Single-instance lock: a second launch exits.
- Tests use `WRAITHGRID_USER_DATA_DIR` for a throwaway config dir.
- AppImage on Ubuntu 24.04+/Kali blocked by AppArmor; prefer .deb.

## Current focus
v1.1.0 released (appearance settings, update check, Windows + distro packages). No active task.
