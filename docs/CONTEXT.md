# Wraithgrid: Context

## Purpose
Electron desktop app that runs many official agent CLI sessions side by side, one per pane,
each with its own account and project folder: `claude`, `gemini`, `agy`, `codex`, `opencode`,
`cursor-agent`, `copilot` (config-dir variables and sign-in isolation in `src/shared/agent-clis.ts`). Windows, Linux and macOS. v1.15.0.

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
- `src/main/index.ts`: entry dispatcher: `wraithgrid <command>` → re-runs itself as Node on `cli.js` (spawnSync), else imports `app.ts`
- `src/main/app.ts`: the app; window, PATH resolution, host start, quit choices + tray, remote hosts, wires ConfigStore/PaneRouter/IPC
- `src/main/cli.ts` + `cli-entry.ts`: `wraithgrid list|read|send|wait|new|split|attach|stop` (pure, deps injected) and its Node entry (`out/main/cli.js`, never imports electron); `host-stdio` = remote bridge
- `src/main/host-bridge.ts`: `wraithgrid host-stdio` on a remote machine: starts/joins its host, injects its token, resolves `spawn` frames there
- `src/main/host-start.ts`: start a detached host (fd masking) + socket connect; used by app and bridge
- `src/main/pane-router.ts`: routes pane ops to the local host or a machine's (by workspace `machineId`)
- `src/main/spawn-resolve.ts`: pane spec → exact process (binary, args, cwd, env); local in ipc, remote in the bridge
- `src/main/ssh.ts`: `~/.ssh/config` hosts, ssh args, ssh child as a duplex stream
- `src/main/ipc.ts`: all IPC handlers; validates every payload with zod contracts
- `src/main/pane-host.ts`: GUI side of the pty host: find/start it, hello + token, create/attach/write/kill, version mismatch
- `src/host/`: background pty host (ADR 0001), built as `out/main/host.js`, never imports electron: `index.ts` entry (lock, token, socket), `server.ts` panes + clients, `protocol.ts` NDJSON frames (zod), `paths.ts` socket/token paths per user-data dir, `screen.ts` headless xterm + serialize, `fds.ts` inherited-fd masking, `pty-manager.ts` spawns/kills pane processes (per-OS KillPolicy)
- `src/main/chat/`: chat panes (ADR 0002): `sessions.ts` runs one headless CLI per pane (pipes, JSON lines), `adapter.ts` registry, `claude.ts` stream-json ↔ ChatEvent (+ approvals), `agy.ts` agy's stream-json (no approvals/interrupt: `controls` event → the view restarts it), `codex.ts` `codex app-server` JSON-RPC, `images.ts` pasted images → temp files, `spawn.ts` masked fds/process group, `attach.ts` files from the attach picker, `transcript.ts` copies a conversation to another account's dir (switch account, #29); add a CLI = one adapter + `chat: true` in agent-clis
- `src/main/login.ts`: sign-in dialog backend, per CLI (`LOGIN_FLOWS`): claude `auth login` + `auth status --json`; codex `login --device-auth` (one-time code) + `login status`; `DIALOG_LOGIN_CLIS` in agent-clis says who gets the dialog
- `src/main/clipboard-image.ts`: clipboard image → temp file → text to paste (path, or `@path` for gemini/agy)
- `src/main/pane-env.ts`: builds a pane's env (per-CLI config dir var for agent panes; mod folders as `CLAUDE_CODE_PLUGIN_DIRS` for claude; strips the launching terminal's vars; UTF-8 locale fallback)
- `src/main/config-store.ts`: config.json load/save, atomic write, bad-file quarantine
- `src/main/claude-detect.ts`: finds the `claude` binary and version
- `src/main/platform.ts`: OS/desktop differences as pure functions (chrome, shell pick/detection, login-shell PATH probe per shell, spawn)
- `src/main/shared-config.ts`: link ~/.claude's CLAUDE.md, settings.json, skills/, plugins/, agents/, commands/ into every account ("overall" mode)
- `src/main/mods.ts`: mods (claude plugins) through each account's own `claude plugin` CLI: `list --json`, `enable`/`disable`, the catalog, `install`, `marketplace list`/`add`; repo links for mods
- `src/main/mod-community.ts`: the claudemod.com mod list (fixed URL, page scrape + each repo's marketplace.json from raw.githubusercontent.com), validated into catalog rows
- `src/main/update-check.ts`: GitHub Releases check (fixed URL) for the Settings/status-bar notice
- `src/main/update-install.ts`: in-app update facade over electron-updater (check → download (cancellable) → `ready` → Restart now installs + relaunches)
- `src/main/release-notes.ts`: release notes kept in userData/release-notes.json (capped) + the bundled WHATS-NEW.md, and "updated from" (last run version) for About
- `src/shared/whats-new.ts`: WHATS-NEW.md → per-version notes (app bundle via `?raw`, and `scripts/release-notes.ts` for the release body)
- `src/main/update-notify.ts`: OS notification for a new release, once per version (`update-notified.json` in userData)
- `src/main/paths.ts`: config/account/worktree paths, `isStrictlyInside` guard
- `src/main/folders.ts`: the folder picker's listing (one folder's subfolders, git marks, branch from `.git/HEAD`); `fs:listFolder`/`fs:reveal`
- `src/main/git.ts`: git status/diff for a pane's folder, worktrees, commit/push/pull, history pages (`gitLog`) and one commit's patch (`gitShow`) (execFile via injected runner)
- `src/preload/index.ts`: typed bridge; renderer never sees ipcRenderer
- `src/shared/ipc-channels.ts`: the complete IPC channel list
- `src/shared/ipc-contract.ts`: zod schemas for IPC args/events
- `src/shared/schema.ts`: persisted config schema, migrate/sanitize/parse
- `src/shared/agent-clis.ts`: agent CLI registry (bin, config-dir var, sign-in isolation, image paste, new-line key, resume args, approval prompt); add a CLI here
- `src/shared/types.ts`: domain types, themes, accents, palettes, fonts
- `src/shared/args.ts`, `src/shared/paths.ts`: launch-args parsing, pure path helpers
- `src/shared/mods.ts`: split a mod id (`name@marketplace`)
- `src/shared/themes.ts`: built-in themes (5, each with a `style`), theme-file schema (hex colors + fixed `style` options), theme → CSS vars (`themeVars` + `styleVars`), accent presets, terminal colors
- `src/renderer/lib/slash.ts` + `components/chat/SlashMenu.tsx`: the `/` menu (items from the CLI's commands, ranking, Wraithgrid's own commands)
- `src/renderer/components/UsageView.tsx`: Usage screen (`view: 'usage'`) and the top-bar pill
- `src/shared/usage.ts` + `src/main/usage-store.ts`: chat-turn usage buckets, plan limits, summaries; recorded in main from chat events into userData/usage.json
- `src/main/themes.ts`: list/import/save (editor)/delete theme files in `~/.wraithgrid/themes`
- `src/main/community-themes.ts` + `components/CommunityThemes.tsx`: the community gallery (fixed list cachewraith/wraithgrid-themes, raw.githubusercontent.com only; fetch injected — `themeFetch` in IpcDeps; e2e never opens it)
- `src/renderer/components/ThemeEditor.tsx` + `src/shared/contrast.ts`: the theme editor (draft = `themeDraft` in the store, drawn by `drawnTheme` over the whole app) and WCAG contrast checks
- `src/shared/chat.ts`: CLI-agnostic `ChatEvent` model, image/text limits, session id schema
- `src/renderer/main.tsx`: composition root (builds Services)
- `src/renderer/app/store.ts`: zustand store, all app actions (largest file)
- `src/renderer/app/{App,services,shortcuts}`: root view, DI context, key matching
- `src/renderer/components/`: UI (PaneGrid, Pane, Terminal, dialogs, BranchPicker = switch/create branch of a pane's folder, Settings (tabs: General, Chat, Appearance, Agents & CLIs, Advanced, Keyboard, About)/Accounts views; Sidebar = nav + Projects (workspaces) only, two-line rows (chat count · status/last active), sliding highlight + bar, footer account switcher (two-line account menu with plans), icon rail when collapsed; ProjectView = a project's screen (Open chats, History, search; `view: 'project'`); EdgeResizer = drag handle for sidebar/Changes panel width; SidebarAccounts = account folders + drag-drop (on the Accounts page); AccountIcon = `Initial` (a name's letter in a circle); DeleteChatDialog = confirm before deleting a chat (open or History); LoginDialog = claude sign-in without a terminal; ContextMenu = right-click menus (also the account menu: sub lines, checks, headings, dividers, opens above); CommandPalette = Ctrl+Shift+P search; DiffPanel = Changes card beside `.main` (in `.row`): Changes/History tabs, commit graph via `lib/commit-graph.ts`, Commit/Pull/Push/PR; ModsView = one mod list for all claude accounts, catalog search + install to every account, mod folders, GPU toggle)
- `src/renderer/components/{NewPaneDialog,FolderPicker}.tsx` + `lib/folder-path.ts`: New chat (Account → Folder → Start, More options; prefers the project's folder/account) and its in-app folder picker; e2e pick with `getByRole('button', { name: /^Folder / })` → type the path → Ctrl+Enter
- `src/renderer/components/NewProjectDialog.tsx`: New project (#26): Folder (suggests the name), Name, Account, Runs on, Start with (first chat/empty); sidebar + and palette open it; the switcher only switches (workspace `folder`/`accountId` in schema)
- `src/renderer/components/chat/`: ChatView (pane body: messages, working indicator, approval/exit bars), Composer (autogrow, image paste, Stop), ModelPicker (model list from the CLI, effort), ToolCard + ApprovalBar, Markdown (AST → React, never HTML)
- `src/renderer/layout/`: pure split-tree ops, presets, directional focus
- `src/renderer/lib/`: PtyBus, status detection, terminal themes, ANSI strip, scheduling, diff parsing, palette search, term-osc (OSC 52 copy, OSC 9/777/99 notifications), mod-catalog (catalog search, merging the accounts' mod lists), chat-thread (pure ChatEvent reducer + save format), chat-bus (per-pane threads outside React; sent images full size in memory only), chat-images (sent-image thumbnails, browser canvas; injected into ChatBus in main.tsx), stream-pace (paced reveal of streamed text, #52; markdown `settledLength` lets the view re-parse only the tail), markdown (parser), time (`ago`)
- `src/renderer/styles/`: design tokens (neutral greys; accent only for focus/state) + base CSS + `chat.css` (chat view and its motion) + `sidebar.css` (sidebar; calm motion via `--side-t`/`--side-ease`, own inset focus ring) + `polish.css` (app-wide refinements, settings tabs, model picker; loaded last)
- `tests/unit/`, `tests/e2e/`, `tests/fixtures/{fake-claude,raw-keys,fake-shell,demo-claude,fake-claude-chat}.sh`, `claude-chat.ndjson`: tests + fake CLIs (fake-claude execs fake-claude-chat for `--input-format stream-json`; the ndjson is real claude 2.1.306 output, cleaned) (raw-keys prints input bytes as hex; fake-shell prints its args and leaked vars; demo-claude = scripted sessions for README shots)
- `scripts/`: Docker Linux build, multi-distro package smoke test; `install.sh` = one-line installer (SHA256SUMS check); `update-packaging.sh <ver>` = fill packaging/ from a release
- `packaging/`: Homebrew cask, winget manifests, AUR PKGBUILD (publish steps in its README)
- `build/`: icons; `.github/workflows/`: build.yml (CI checks; packages only when release.yml calls it), release.yml (tag → release)
- `.claude/agents/`: project subagents: wraithgrid-engineer (build), wraithgrid-reviewer (read-only review), wraithgrid-bug-hunter (diagnose reports)
- `docs/adr/`: longer ADRs (0001 background pty host, accepted + review)
- `docs/THEMES.md`: theme file format for users
- `docs/WHATS-NEW.md`: user-facing notes for the latest/next release
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
- Panes live in the host, not main: it renames itself `wraithgrid-host` (pgrep for `host.js` finds nothing); socket dir `$XDG_RUNTIME_DIR/wraithgrid-<uid>-<hash of userData>` (or tmpdir), removed on clean exit, kept with `host.log` after a failure. A dev host keeps running old `src/host` code while the protocol matches: stop it (Quit and stop agents, or SIGTERM) after host changes. Unix socket paths max ~104 bytes.
- Never spawn a long-lived child from main without masking fds (`stdioMasking`): Chromium fds lack CLOEXEC.
- Playwright: a crashed page object stays dead; read the reloaded page via `app.evaluate(... executeJavaScript)`. Launch crash tests with `cwd` in a temp dir (core dumps). Wait for a fake CLI's last banner line before typing (echo races its output).
- Quits from code/signals/`app.close()` never ask (`ask` = stop); only the close button, WM close, the macOS Quit item and the tray ask.
- Never run long work in Electron main without a window system: it aborts without a display (SIGTRAP) once JS yields. CLI = `spawnSync` + ELECTRON_RUN_AS_NODE. Crash experiments leave multi-GB `core.*` files in the cwd: delete them.
- `WRAITHGRID_SSH` replaces `ssh` (tests: `tests/fixtures/fake-ssh.sh` runs "the remote" with WG_REMOTE_HOME/DATA/PATH). A remote agent's cmdline is its own PATH's `claude`, not the fixture path.
- `wraithgrid` CLI is refused until `settings.cliAccess`; the GUI pushes it to the host on connect/change (the host keeps the last value while detached). Windows: GUI-subsystem binary, CLI output not shown in a console yet.
- node-pty compiles against the host glibc: ship Linux builds from Ubuntu 22.04 (portable script / CI).
- Launcher-started app lacks shell PATH: main asks the login shell once with flags per shell kind (csh/tcsh can't take `-l -c`), then `/bin/sh -l` (skipped when `TERM` set).
- claude panes never go through the user's shell; their screen breaks only via inherited env (COLUMNS, TERM_PROGRAM, TMUX…): add new terminal vars to `TERMINAL_VARS` in pane-env.ts.
- Windows `claude.cmd` runs through cmd.exe: args with `& | < > ^ % "` are refused.
- Sandboxed preload can't require node_modules: preload is bundled (`externalizeDeps: false`).
- Single-instance lock: a second launch exits. Tests use `WRAITHGRID_USER_DATA_DIR` for a throwaway config dir.
- dnd-kit measures drop zones async after drag start: e2e drags must move in paced steps and release only once the target shows its `over` class.
- CI skips pushes touching only `*.md`/`docs/**`; installers build only on a `v*.*.*` tag.
- AppImage on Ubuntu 24.04+/Kali blocked by AppArmor; prefer .deb.
- macOS: app shortcuts are ⌘ (`matchShortcut(e, mac)`; tests must pass `mac` explicitly since Node on a Mac reports a Mac platform); Ctrl always goes to the terminal; ⌘C/V work through the app menu's Edit roles, so never drop that menu on darwin.
- macOS builds are ad-hoc signed (`identity: '-'`, hardened runtime off) and not notarized: Gatekeeper asks on first launch; in-app update falls back to the release page until a Developer ID exists.
- claude only has a "new line" key via ESC CR; the terminal maps Shift+Enter to it for claude panes.
- Running claude reads CLAUDE.md/skills/plugins at start: a sharing change needs a pane restart.
- In-app update needs `latest*.yml` in the release (CI uploads them from v1.3.0); 1.2.0 and older must be updated by hand once. Local `dist` scripts pass `--publish never`.
- Popovers/menus must portal to <body>: sidebar sections animate opacity (own stacking context) and the sidebar clips.
- e2e/manual tests: `pgrep -f 'out/main/index.js'` also matches your own shell command; match the electron binary path instead.
- Unpackaged (dev, e2e) `app.getVersion()` is Electron's version (44.x), not package.json's: e2e must read it via `app.evaluate`. WHATS-NEW.md section headings need a `*vX.Y.Z · YYYY-MM-DD*` line under them to count as a version.
- e2e without a window on the desktop (no Xvfb here): a dir with an `electron` script that runs `node_modules/electron/dist/electron`, adding `--ozone-platform=headless --ozone-override-screen-size=1920,1080` only when the args include `--remote-debugging-port=0` (Playwright's launch; it strips argv up to there; the CLI spec's own runs must pass through), then `env -u DISPLAY -u WAYLAND_DISPLAY ELECTRON_OVERRIDE_DIST_PATH=<dir> ./node_modules/.bin/playwright test` after `bun run build`. Without the screen size the window is <900px (sidebar = rail).
- Use `bun run <script>`, never bare `bun test` (Bun's runner, not Vitest); one-off tools: `./node_modules/.bin/<tool>`.
- git runs with `GIT_OPTIONAL_LOCKS=0` so status polling never takes index.lock while claude commits; git errors may start with progress lines, so the `fatal:`/`error:` line is reported.
- No icons or emoji for accounts/projects/folders (removed 2026-10-21): `icon`/`color` fields stay in the schema so old configs load, and are ignored; accounts show `<Initial>`.
- Tests: never pass `os.devNull` to git (Windows `\\.\nul` is refused); use a temp file.
- Tests under the node tsconfig can't import `.tsx`: keep testable logic in `src/renderer/lib/`.
- Env `WRAITHGRID_E2E_SHOTS=<dir>` makes `git-palette.spec.ts` and `mods.spec.ts` save screenshots. README images: `bun run build`, then `WRAITHGRID_README_SHOTS=docs/screenshots ./node_modules/.bin/playwright test readme-shots` (skipped without the env); chat shots come from `tests/fixtures/demo-claude-chat.sh` (prompts with "orders"/"ship"), Usage from a seeded `usage.json`.
- Electron 44's main `clipboard` is the async web-style API (no `readImage`). Image paste in agent panes: Wraithgrid intercepts Ctrl+V (not macOS) and pastes a saved file path (claude's own read misses some screenshots).
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
- Closing a pane with `hasConversation` archives it to `workspace.history` (saved chat view kept, `chat:stop` without forget); reopening reuses the same pane id so the view and session come back. Deleting from History or the project deletes the view.
- Chat panes (ADR 0002) run in main, not the host: they stop on quit (resume by session id), and `wraithgrid list/read/send` can't see them; CLI-made panes are terminals. A pane's view is `paneView()` in store.ts, never `pane.view` directly (shell/machine/CLI rules).
- Background work (#39): claude 2.1.306 sends `system/background_tasks_changed` (whole list), `task_started`/`task_updated`, then `task_notification` and runs a turn of its own (its own `init`, no user message). A foreground command running a few seconds is a task too (`task_started` `is_backgrounded: false`, `task_notification` summary = its description, `output_file: ''`): only backgrounded tasks (in the list, `is_backgrounded: true`, or with an output file) make a notice + `busy: true` (#51); sessions.ts counts that busy only when no turn runs. Real `init` comes at each turn start, never at startup (the fake sends one after `initialize`). Fixture: `tests/fixtures/claude-background.ndjson`; fake: say "in background".
- codex chat (#40): `codex app-server` (experimental) is JSON-RPC 2.0 lines; codex's own request ids (approvals) start at 0 and overlap ours: a line with `method` + `id` is its request, without `method` an answer. A `turn/start` while a turn runs steers that turn (one `turn/completed`). Mode = approvalPolicy + sandbox per turn (default untrusted/workspace-write, acceptEdits on-request/workspace-write, plan on-request/read-only, bypass never/danger-full-access). `codex login status` prints to stderr; exit code 0 = signed in. Device login prints the link, then the code (ANSI-coloured). Protocol types: `codex app-server generate-ts --out <dir>`. Fake: `tests/fixtures/fake-codex.mjs` (Node) via `settings.cliPaths.codex`.
- agy 1.4.4 chat (#41): `--print=` needs the `=` (a bare `-p` eats the next flag); input `{"event":"user","message":{"role":"user","content":…}}` (text only; images as `@path`). Out: `init` (at start, before input), `step_update` (`step_type` user_input/agent_response `text_delta`/tool `tool_info`), `result` (`denied_actions`). No approvals (refused), no interrupt event, SIGINT ignored, no live model/mode: restart + `--conversation <id>`. `--effort` only on base ids (`gemini-3.8-flash`), not `-low` ids or claude models; `--mode auto` depends on the plan (falls back with a warning). Fake: `tests/fixtures/fake-agy.sh` via `settings.cliPaths.agy`.
- claude headless needs the `initialize` control request first and `--permission-prompt-tool stdio`, or every tool needing approval is auto-denied (`permission_denied`). An interrupt ends with `is_error: true` (`error_during_execution`): not a failure.
- In dev/e2e (`out/main/index.js`), `app.getVersion()` is not the package version, so community `minAppVersion` checks only mean something in a packaged app. The example theme Ember needs 1.15.0.
- Theme style (#24): corners use `calc(Npx * var(--rs, 1))` — write new 4–24px radii that way so themes can reshape them; cards use `--shadow-card`/`--bw`; motion off/reduced is `:root[data-motion]` in base.css.
- Themes are inline CSS vars on `<html>` (`themeVars`), so they beat any stylesheet rule: change colors in `src/shared/themes.ts`, not tokens.css (its values are first paint only). `settings.theme` is the mode (dark/light/system); `themeDark`/`themeLight` pick the theme; `accent: 'theme'` keeps the theme's own. Read a theme via `drawnTheme(s)` (cached object).
- Responsive = container queries on `.main` (`main`) and `.pane` (`pane`); both are containing blocks for `position: fixed` inside them, so popups must keep portaling to <body>. Sidebar folds to the rail below 900 CSS px (`NARROW_PX`, zoom counts) without touching `sidebarCollapsed`; expanding then opens `.side.drawer`.
- Usage limits come only from claude's `rate_limit_event` (`unifiedWindows.five_hour/seven_day`, utilization 0–1, resetsAt in seconds), sent per turn: an account shows limits after its first chat turn. The pill/sidebar row show the focused pane's claude account (`limitAccountId`; `limitIsFocused` says if it is, else the new-chat account), named when 2+ claude accounts. The footer account and the menu's tick are only who *new* chats use (`defaultAccountId`); `panesPerAccount` counts open panes per account for the menu and Usage (#49). Cost is API list price (`costBasis: list`), not what Pro/Max pays.
- Chat mode = claude's permission mode: live via `set_permission_mode` (values `default|acceptEdits|plan|auto|dontAsk|bypassPermissions`; the start flag takes the same except `default`, which is omitted); claude reports the mode in force in `system` init/status, and `pane.chatMode` follows it. Auto only where the model says `supportsAutoMode`. Live switch to bypass needs `--allow-dangerously-skip-permissions` at start (always passed), else claude answers `bypass_not_launched`. Fast mode is not offered: headless claude needs an SDK opt-in.
- The message box is a combobox once the CLI lists commands: e2e find it with `getByLabel('Message', { exact: true })`, not the textbox role. Commands come from claude's `initialize` answer (no tokens); terminal-only names from its first `system/init`, so they show after the first turn.
- Ctrl+=/-/0 zoom the whole app (`uiZoom`, `webFrame.setZoomFactor` in preload), not the terminal font.
- Top bar has no Settings/Mods/Shortcuts buttons: e2e click `More` then the menuitem. Sidebar and `.main` are cards inside `.row` (8px padding, `--frame` behind).
- Login button: claude accounts get LoginDialog (`login:*` IPC, fake claude handles `auth login`/`auth status`, code `good-code`); other CLIs and "Use a terminal instead" = `loginInTerminal` (the old pane). Chat attachments: picked/dropped non-images are sent as an "Attached files:" path list for claude's Read tool; drag-drop paths come from preload `webUtils.getPathForFile`.
- Fake claude (`fake-claude-chat.sh`) appends each user turn to `$CLAUDE_CONFIG_DIR/projects/<cwd with non-alnum → ->/<sid>.jsonl`, like real claude; `--resume X` answers as session `resumed-X`.
- CSS: `.cm*` is ContextMenu's prefix; chat markdown uses `.md*`, chat parts `.c*`/`.chat-*`. Never style a bare two-letter class: `.gh` (commit graph) also matched the ghost button `.btn.gh` and broke every Cancel (#36) — scope to the element (`ol.gh`).

## Current focus
Released v1.15.0 (2026-10-22): Codex chats + sign-in (#40), agy chats (#41), background work (#39), chat redesign (#21), full theming incl. editor and community gallery (#24; repos cachewraith/wraithgrid-theme-template and wraithgrid-themes). To verify by hand: codex sign-in dialog with a real login, the gallery in a packaged 1.15.0 (Ember needs 1.15.0), drag-and-drop attach. Still open from v1.10/1.11: host + CLI on Windows/macOS, a real ssh machine, NFR-1 (8 busy panes), H8 publishing, cursor/copilot/opencode chat adapters, mods with real accounts.
