# Wraithgrid: Context

## Purpose
Electron desktop app that runs many official agent CLI sessions side by side, one per pane,
each with its own account and project folder: `claude`, `gemini`, `agy`, `codex`, `opencode`,
`cursor-agent`, `copilot` (config-dir variables and sign-in isolation in `src/shared/agent-clis.ts`). Windows, Linux and macOS. v1.9.0.

## Stack
Electron 44, electron-vite 5, React 19, TypeScript 6, zustand, zod 4, @xterm/xterm 6, node-pty,
react-resizable-panels, @dnd-kit. Tests: Vitest (unit), Playwright (Electron e2e). Bun 1.4 (package manager/script runner; tools run on Node), Node ≥22.12.

## Commands
- `bun install` — install; rebuilds node-pty for Electron (`trustedDependencies`: electron/esbuild/node-pty; `bunfig.toml`: hoisted linker, 1-day minimumReleaseAge)
- `bun run dev` — run with hot reload
- `bun run typecheck` — tsc over node + web projects
- `bun run lint` — ESLint + Prettier check (`bun run format` to fix)
- `bun run test` — Vitest unit tests (`tests/unit`)
- `bun run test:e2e` — build, then Playwright (`tests/e2e`; needs a display, CI uses xvfb-run)
- `bun run build` — production build into `out/`
- `bun run dist:linux:portable` — Linux packages in Ubuntu 22.04 Docker; `bun run dist:win` on Windows; `bun run dist:mac` on a Mac
- Release: `bun pm version <patch|minor|major> -m "chore: release %s" && git push --follow-tags`

## Directory map
- `src/main/index.ts`: app entry; window, PATH resolution, wires ConfigStore/PtyManager/IPC
- `src/main/ipc.ts`: all IPC handlers; validates every payload with zod contracts
- `src/main/pty-manager.ts`: spawns/kills pane processes; per-OS KillPolicy
- `src/main/clipboard-image.ts`: clipboard image → temp file → text to paste (path, or `@path` for gemini/agy)
- `src/main/pane-env.ts`: builds a pane's env (per-CLI config dir var for agent panes; mod folders as `CLAUDE_CODE_PLUGIN_DIRS` for claude; strips the launching terminal's vars; UTF-8 locale fallback)
- `src/main/config-store.ts`: config.json load/save, atomic write, bad-file quarantine
- `src/main/claude-detect.ts`: finds the `claude` binary and version
- `src/main/platform.ts`: OS/desktop differences as pure functions (chrome, shell pick/detection, login-shell PATH probe per shell, spawn)
- `src/main/shared-config.ts`: link ~/.claude's CLAUDE.md, settings.json, skills/, plugins/, agents/, commands/ into every account ("overall" mode)
- `src/main/mods.ts`: mods (claude plugins) through each account's own `claude plugin` CLI: `list --json`, `enable`/`disable`, the catalog, `install`, `marketplace list`/`add`; repo links for mods
- `src/main/mod-community.ts`: the claudemod.com mod list (fixed URL, page scrape + each repo's marketplace.json from raw.githubusercontent.com), validated into catalog rows
- `src/main/update-check.ts`: GitHub Releases check (fixed URL) for the Settings/status-bar notice
- `src/main/update-install.ts`: in-app update facade over electron-updater (check → download → install + relaunch)
- `src/main/update-notify.ts`: OS notification for a new release, once per version (`update-notified.json` in userData)
- `src/main/paths.ts`: config/account/worktree paths, `isStrictlyInside` guard
- `src/main/git.ts`: git status/diff for a pane's folder and worktree creation (execFile via injected runner)
- `src/preload/index.ts`: typed bridge; renderer never sees ipcRenderer
- `src/shared/ipc-channels.ts`: the complete IPC channel list
- `src/shared/ipc-contract.ts`: zod schemas for IPC args/events
- `src/shared/schema.ts`: persisted config schema, migrate/sanitize/parse
- `src/shared/agent-clis.ts`: agent CLI registry (bin, config-dir var, sign-in isolation, image paste, new-line key, resume args, approval prompt); add a CLI here
- `src/shared/types.ts`: domain types, themes, accents, palettes, fonts
- `src/shared/icons.ts`: icon value format (`''` letter, `material:x`/`lucide:x`, else emoji), tints
- `src/shared/args.ts`, `src/shared/paths.ts`: launch-args parsing, pure path helpers
- `src/shared/mods.ts`: split a mod id (`name@marketplace`)
- `src/renderer/main.tsx`: composition root (builds Services)
- `src/renderer/app/store.ts`: zustand store, all app actions (largest file)
- `src/renderer/app/{App,services,shortcuts}`: root view, DI context, key matching
- `src/renderer/components/`: UI (PaneGrid, Pane, Terminal, dialogs, Settings/Accounts views; Sidebar = nav + workspaces with their panes; EdgeResizer = drag handle for sidebar/Changes panel width; SidebarAccounts = folders + drag-drop; AccountIcon/Avatar = badges (letter, emoji or library icon); IconPicker/IconPopover = searchable icon library + tints; ContextMenu = right-click menus; CommandPalette = Ctrl+Shift+P search; DiffPanel = git changes beside the grid; ModsView = one mod list for all claude accounts, catalog search + install to every account, mod folders, GPU toggle)
- `src/renderer/layout/`: pure split-tree ops, presets, directional focus
- `src/renderer/lib/`: PtyBus, status detection, terminal themes, ANSI strip, scheduling, diff parsing, palette search, term-osc (OSC 52 copy, OSC 9/777/99 notifications), mod-catalog (catalog search, merging the accounts' mod lists)
- `src/renderer/styles/`: design tokens (neutral greys; accent only for focus/state) + base CSS
- `tests/unit/`, `tests/e2e/`, `tests/fixtures/{fake-claude,raw-keys,fake-shell}.sh`: tests + fake CLIs (raw-keys prints input bytes as hex; fake-shell prints its args and leaked vars)
- `scripts/`: Docker Linux build, multi-distro package smoke test; `icon-sets.ts` = Vite plugin building `virtual:icon-sets` (trimmed Material + Lucide); `install.sh` = one-line installer (SHA256SUMS check); `update-packaging.sh <ver>` = fill packaging/ from a release
- `packaging/`: Homebrew cask, winget manifests, AUR PKGBUILD (publish steps in its README)
- `build/`: icons; `.github/workflows/`: build.yml (CI checks; packages only when release.yml calls it), release.yml (tag → release)
- `.claude/agents/`: project subagents: wraithgrid-engineer (build), wraithgrid-reviewer (read-only review), wraithgrid-bug-hunter (diagnose reports)
- `docs/adr/`: longer ADRs (0001 background pty host, proposed)
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
- Use `bun run <script>`, never bare `bun test` (that is Bun's own test runner, not Vitest). For one-off tools call `./node_modules/.bin/<tool>` directly.
- git runs with `GIT_OPTIONAL_LOCKS=0` so status polling never takes index.lock while claude commits; git errors may start with progress lines, so the `fatal:`/`error:` line is reported.
- Icons: SVG bodies only come from bundled data via `iconBody` (own keys); never render an icon string from config as HTML. New icon packages must respect `minimumReleaseAge` in bunfig.toml (pin an older version rather than adding an exclude).
- Tests: never pass `os.devNull` to git (Windows `\\.\nul` is refused); use a temp file.
- Tests under the node tsconfig can't import `.tsx`: keep testable logic in `src/renderer/lib/`.
- Env `WRAITHGRID_E2E_SHOTS=<dir>` makes `git-palette.spec.ts` and `mods.spec.ts` save screenshots.
- Electron 44's main `clipboard` is the async web-style API (`read()` → ClipboardItem, `getType`); no `readImage`.
- Image paste: claude's own Ctrl+V clipboard read misses some screenshots; Wraithgrid intercepts Ctrl+V in agent panes (not on macOS) and pastes a saved file path instead.
- `agy` and opencode have no per-account dir (shared sign-in); codex/cursor/copilot may keep the sign-in in the keyring (`dir-unchecked`). Non-claude binaries: `settings.cliPaths`, else PATH.
- Resume: only a pane's first start after launch, only with `hasConversation` (set on the first Enter); "continue latest" args pick the folder's newest conversation, so two panes on one folder + account resume the same one.
- Approval patterns for non-claude CLIs come from docs, not real output: replace with fixtures when available.
- Drag handles listen on `window`, not the handle: Chromium can drop pointer capture mid-drag. Reproduce timing flakes with all cores busy (`while :; do :; done` per core).
- e2e: config.json is written after a debounce and can be missing on a fast CI runner; read it inside `expect.poll` with a try/catch, never a bare `readFileSync`.
- Mods: xterm.js has no kitty graphics, so a mod's `Image` shows its `alt`; claude sends mod notifications only when `preferredNotifChannel` is set (auto finds no channel in our panes), and then its own notices arrive too, next to ours.
- Mods are one list for all claude accounts: install runs per account in sequence (overall mode shares the plugin files) and adds a missing marketplace first; installed mods are not in `--available`, so their link is the marketplace's repo. `claude plugin install` of an installed mod exits 0; an unknown one exits 1.
- claudemod.com has no API: `parseCommunityPage` matches the `{…"githubUrl"…,"slug"…}` objects in the page's escaped script data; a site redesign empties the list (the view then says so). Never fetch it in e2e; unit tests inject `fetch`.
- `gpuTerminal` on removes `.xterm-rows` (WebGL draws to a canvas): e2e specs that read terminal text must leave it off. Chromium keeps ~16 WebGL contexts; only visible panes hold one.
- `useActions()` returns the whole state (new object per update): never put `actions` in an effect's deps, destructure the action.
- A mod that redraws all the time (animated band, clock) is output, so its pane reads `running` and never notifies "done".
- Unit tests run on Windows CI too: `path.resolve` gives `D:\…` there, so never force `platform: 'linux'` on a test that resolves paths.

## Current focus
v1.9.0 released (seven agent CLIs via the registry, resume on restore, `done` status, Changes panel commit/push/PR, worktree cleanup, mods update/uninstall/marketplaces/download, configurable shortcuts, install.sh + packaging files). Next: H1 ADR review (docs/adr/0001), then H1 → H6 → H7 → H5; publish packaging (needs accounts). To verify by hand: codex/cursor/copilot/opencode with real accounts (sign-in isolation, approval prompts), mods actions on real accounts, screenshot paste on Hyprland, macOS on real hardware.
