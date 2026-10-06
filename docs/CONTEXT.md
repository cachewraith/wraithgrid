# Wraithgrid: Context

## Purpose
Electron desktop app that runs many official `claude` CLI sessions side by side, one per pane,
each with its own account (`CLAUDE_CONFIG_DIR`) and project folder. Windows, Linux and macOS. v1.5.0.

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
- `pnpm dist:linux:portable` — Linux packages in Ubuntu 22.04 Docker; `pnpm dist:win` on Windows; `pnpm dist:mac` on a Mac
- Release: `npm version <patch|minor|major> -m "chore: release %s" && git push --follow-tags`

## Directory map
- `src/main/index.ts`: app entry; window, PATH resolution, wires ConfigStore/PtyManager/IPC
- `src/main/ipc.ts`: all IPC handlers; validates every payload with zod contracts
- `src/main/pty-manager.ts`: spawns/kills pane processes; per-OS KillPolicy
- `src/main/pane-env.ts`: builds a pane's env (`CLAUDE_CONFIG_DIR` for claude panes; strips the launching terminal's vars; UTF-8 locale fallback)
- `src/main/config-store.ts`: config.json load/save, atomic write, bad-file quarantine
- `src/main/claude-detect.ts`: finds the `claude` binary and version
- `src/main/platform.ts`: OS/desktop differences as pure functions (chrome, shell pick/detection, login-shell PATH probe per shell, spawn)
- `src/main/shared-config.ts`: link ~/.claude's CLAUDE.md, settings.json, skills/, plugins/, agents/, commands/ into every account ("overall" mode)
- `src/main/update-check.ts`: GitHub Releases check (fixed URL) for the Settings/status-bar notice
- `src/main/update-install.ts`: in-app update facade over electron-updater (check → download → install + relaunch)
- `src/main/update-notify.ts`: OS notification for a new release, once per version (`update-notified.json` in userData)
- `src/main/paths.ts`: config/account/worktree paths, `isStrictlyInside` guard
- `src/main/git.ts`: git status/diff for a pane's folder and worktree creation (execFile via injected runner)
- `src/preload/index.ts`: typed bridge; renderer never sees ipcRenderer
- `src/shared/ipc-channels.ts`: the complete IPC channel list
- `src/shared/ipc-contract.ts`: zod schemas for IPC args/events
- `src/shared/schema.ts`: persisted config schema, migrate/sanitize/parse
- `src/shared/types.ts`: domain types, themes, accents, palettes, fonts
- `src/shared/icons.ts`: icon value format (`''` letter, `material:x`/`lucide:x`, else emoji), tints
- `src/shared/args.ts`, `src/shared/paths.ts`: launch-args parsing, pure path helpers
- `src/renderer/main.tsx`: composition root (builds Services)
- `src/renderer/app/store.ts`: zustand store, all app actions (largest file)
- `src/renderer/app/{App,services,shortcuts}`: root view, DI context, key matching
- `src/renderer/components/`: UI (PaneGrid, Pane, Terminal, dialogs, Settings/Accounts views; Sidebar = nav + workspaces with their panes; SidebarAccounts = folders + drag-drop; AccountIcon/Avatar = badges (letter, emoji or library icon); IconPicker/IconPopover = searchable icon library + tints; ContextMenu = right-click menus; CommandPalette = Ctrl+Shift+P search; DiffPanel = git changes beside the grid)
- `src/renderer/layout/`: pure split-tree ops, presets, directional focus
- `src/renderer/lib/`: PtyBus, status detection, terminal themes, ANSI strip, scheduling, diff parsing, palette search
- `src/renderer/styles/`: design tokens (neutral greys; accent only for focus/state) + base CSS
- `tests/unit/`, `tests/e2e/`, `tests/fixtures/{fake-claude,raw-keys,fake-shell}.sh`: tests + fake CLIs (raw-keys prints input bytes as hex; fake-shell prints its args and leaked vars)
- `scripts/`: Docker Linux build, multi-distro package smoke test; `icon-sets.ts` = Vite plugin building `virtual:icon-sets` (trimmed Material + Lucide)
- `build/`: icons; `.github/workflows/`: build.yml (CI checks; packages only when release.yml calls it), release.yml (tag → release)
- `docs/WHATS-NEW.md`: user-facing notes for the unreleased update
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
- Launcher-started app lacks shell PATH: main asks the login shell once with flags per shell kind (csh/tcsh can't take `-l -c`), then `/bin/sh -l` (skipped when `TERM` set).
- claude panes never go through the user's shell; their screen breaks only via inherited env (COLUMNS, TERM_PROGRAM, TMUX…): add new terminal vars to `TERMINAL_VARS` in pane-env.ts.
- Windows `claude.cmd` runs through cmd.exe: args with `& | < > ^ % "` are refused.
- Sandboxed preload can't require node_modules: preload is bundled (`externalizeDeps: false`).
- Single-instance lock: a second launch exits.
- Tests use `WRAITHGRID_USER_DATA_DIR` for a throwaway config dir.
- dnd-kit measures drop zones async after drag start: e2e drags must move in paced steps.
- CI skips pushes touching only `*.md`/`docs/**`; installers build only on a `v*.*.*` tag.
- AppImage on Ubuntu 24.04+/Kali blocked by AppArmor; prefer .deb.
- macOS: app shortcuts are ⌘ (`matchShortcut(e, mac)`; tests must pass `mac` explicitly since Node on a Mac reports a Mac platform); Ctrl always goes to the terminal; ⌘C/V work through the app menu's Edit roles, so never drop that menu on darwin.
- macOS builds are ad-hoc signed (`identity: '-'`, hardened runtime off) and not notarized: Gatekeeper asks on first launch; in-app update falls back to the release page until a Developer ID exists.
- claude only has a "new line" key via ESC CR; the terminal maps Shift+Enter to it for claude panes.
- Running claude reads CLAUDE.md/skills/plugins at start: a sharing change needs a pane restart.
- In-app update needs `latest*.yml` in the release (CI uploads them from v1.3.0); 1.2.0 and older must be updated by hand once. Local `dist` scripts pass `--publish never`.
- Popovers/menus must portal to <body>: sidebar sections animate opacity (own stacking context) and the sidebar clips.
- e2e/manual tests: `pgrep -f 'out/main/index.js'` also matches your own shell command; match the electron binary path instead.
- `pnpm exec …` can hang in this environment; call `./node_modules/.bin/<tool>` directly.
- git runs with `GIT_OPTIONAL_LOCKS=0` so status polling never takes index.lock while claude commits; git errors may start with progress lines, so the `fatal:`/`error:` line is reported.
- Icons: SVG bodies only come from bundled data via `iconBody` (own keys); never render an icon string from config as HTML. New icon packages must respect pnpm's minimumReleaseAge (pin an older version rather than adding an exclude).
- Tests: never pass `os.devNull` to git (Windows `\\.\nul` is refused); use a temp file.
- Tests under the node tsconfig can't import `.tsx`: keep testable logic in `src/renderer/lib/`.
- Env `WRAITHGRID_E2E_SHOTS=<dir>` makes `git-palette.spec.ts` save screenshots.
- e2e: config.json is written after a debounce and can be missing on a fast CI runner; read it inside `expect.poll` with a try/catch, never a bare `readFileSync`.

## Current focus
v1.5.0 released (panes restyled as flush terminal splits, resizable sidebar; 1.4: neutral restyle, sidebar pane list, Ctrl+Shift+P palette, git chip + Changes panel, worktree panes, pane notifications, any-shell support, macOS builds, icon library). macOS not yet tried on real hardware. Open: default icon for new accounts/workspaces (user to confirm); Shift+Enter report (needs repro); Claude mascot animation report (needs repro).
