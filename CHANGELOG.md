# Changelog

## 2026-10-06

- [tests] Sidebar-resize e2e reads config.json tolerantly; the file wasn't written yet on the Linux runner, failing v1.5.0's build (files: tests/e2e/sidebar-resize.spec.ts, docs/CONTEXT.md)
- [release] v1.5.0: flush terminal-split panes, resizable sidebar (files: package.json, docs/CONTEXT.md, docs/WHATS-NEW.md)

## 2026-10-05

- [ui] Panes look like terminal splits, not floating cards: flush to each other with 1px dividers (accent while dragging), square corners, no account-color stripe or sheen, no glow ring; focus = lifted header, bright title, accent underline; compact 30px header; top bar gets a bottom rule (files: src/renderer/styles/base.css, src/renderer/components/Pane.tsx)
- [sidebar] Drag the sidebar's right edge to resize it (180–480 px), saved as `settings.sidebarWidth`; double-click the edge resets to 236 px; out-of-range values reset (files: src/shared/{types,schema}.ts, src/renderer/components/Sidebar.tsx, src/renderer/styles/base.css, tests/unit/config.test.ts, tests/e2e/sidebar-resize.spec.ts)
- [release] v1.4.1: first published 1.4 release; v1.4.0's tag stays but its build failed on Windows (files: package.json)
- [tests] Real-repo git test uses an empty temp gitconfig instead of os.devNull, which git can't open on Windows (`\\.\nul`); v1.4.0's Windows build failed on it (files: tests/unit/git.test.ts)
- [release] v1.4.0 (files: package.json)
- [icons] Icon library picker: search ~4,600 Material Symbols (one style: filled, rounded) and ~1,900 Lucide icons, filter by set, starter grid, Emoji tab, color tints; for accounts, workspaces and now account folders (right-click → Change icon). Icon data is trimmed at build time (`virtual:icon-sets`) and loads lazily as its own chunk; icons are stored as ids like `material:rocket-launch` and looked up, never rendered from config (files: scripts/icon-sets.ts, electron.vite.config.ts, tsconfig.node.json, src/shared/icons.ts, src/renderer/lib/{icon-search,icon-sets}.ts, src/renderer/virtual-modules.d.ts, src/renderer/components/{IconPicker,AccountIcon,SidebarAccounts,Sidebar,WorkspaceSwitcher,AccountsView,CommandPalette}.tsx, src/renderer/styles/base.css, package.json)
- [config] Workspaces get `color`; folders get `icon` + `color`; icon values up to 64 chars; bad icons/tints reset instead of failing the file (files: src/shared/{types,schema}.ts, src/renderer/app/store.ts)
- [tests] Icon parsing, data trimming, aliases, search ranking, starter icons; config defaults/resets; e2e picks a Material icon + tint for a workspace and a Lucide icon for a folder (files: tests/unit/{icons,config}.test.ts, tests/e2e/{account-folders,sidebar-menus}.spec.ts)
- [macos] macOS support: traffic lights inset in our title bar (`chrome: 'mac'`), an app menu (About/Hide/Quit, Edit with copy/paste, Window; no ⌘W), Homebrew bin dirs, zsh as the fallback shell, `en_US.UTF-8` locale fallback; in-app update opens the release page (ad-hoc signed apps can't replace themselves) (files: src/main/{index,platform,pane-env}.ts, src/shared/ipc-contract.ts, src/renderer/components/{TitleBar,SettingsView}.tsx, src/renderer/styles/base.css)
- [macos] App shortcuts use ⌘ on macOS (⌘⇧N, ⌘⇧P, ⌘⌥+arrows, ⌘=/-/0…); every Ctrl chord goes to the terminal; ⌘C/⌘V copy and paste; hints show ⌘⇧ glyphs (files: src/renderer/app/shortcuts.ts, src/renderer/components/{Terminal,ShortcutsSheet,WorkspaceSwitcher,Sidebar,CommandPalette}.tsx)
- [shells] Login PATH probe uses `printenv PATH` (macOS's BSD `env` may lack `-0`); parser reads both formats (files: src/main/platform.ts)
- [build] macOS dmg + zip for arm64 and x64, ad-hoc signed, not notarized; `pnpm dist:mac`; CI builds them on macos-latest for releases and runs checks there (files: electron-builder.yml, package.json, .github/workflows/build.yml)
- [docs] README: macOS install, Gatekeeper first launch, keys, file locations, build (files: README.md)
- [tests] macOS shortcuts, chord hints, darwin desktop/bin dirs/shell, printenv probe parsing, mac locale (files: tests/unit/{shortcuts,platform,shells}.test.ts)
- [shells] Settings → General "Shell for plain panes": Automatic, any detected shell (/etc/shells + PATH: bash, zsh, fish, nu, pwsh, xonsh, elvish, tcsh, ksh, dash; Windows: PowerShell 7/5, cmd, Git Bash with --login -i, WSL, nushell) or a custom path/name with arguments; a missing pick is reported, not swapped (files: src/main/{platform,ipc}.ts, src/shared/{types,schema,ipc-channels,ipc-contract}.ts, src/preload/index.ts, src/renderer/components/{SettingsView,NewPaneDialog}.tsx, src/renderer/styles/base.css)
- [shells] Login-shell PATH probe uses each shell's own flags (csh/tcsh plain -c, nushell externals, pwsh -Login) and falls back to `/bin/sh -l` (files: src/main/platform.ts)
- [terminal] Panes drop variables of the terminal Wraithgrid was started from (COLUMNS/LINES, TERM_PROGRAM, VSCODE__, TMUX, KITTY__, WT_SESSION, CLAUDECODE, …) so claude's screen keeps its real size and terminal type; LANG=C.UTF-8 when no locale is set (POSIX) (files: src/main/pane-env.ts)
- [tests] Shell flags, detection, fallback, real bash/fish probes, pane env; e2e for a custom shell and leaked variables (files: tests/unit/shells.test.ts, tests/e2e/shells.spec.ts, tests/fixtures/fake-shell.sh)
- [docs] User-facing notes for the T3 Code–inspired update (files: docs/WHATS-NEW.md)
- [ui] Neutral restyle in the spirit of Claude/ChatGPT: grey surfaces with no violet tint, monochrome primary buttons, quieter borders, no glows, sentence-case section labels, 12px pane corners; the accent now marks only focus, cursor and controls. Terminal "match" palette and window/caption colors follow (files: src/renderer/styles/{tokens,base}.css, src/renderer/lib/term-theme.ts, src/main/{index,platform}.ts)
- [sidebar] ChatGPT-style layout: New pane + Search at the top, each workspace expands to its panes (status dot, account, loud states like "needs approval"); click a pane to jump to it (files: src/renderer/components/Sidebar.tsx, src/renderer/components/icons.tsx)
- [palette] Ctrl+Shift+P search: jump to any pane in any workspace, switch workspace, open a claude pane as an account, run app commands (files: src/renderer/components/CommandPalette.tsx, src/renderer/lib/search.ts, src/renderer/app/{App.tsx,shortcuts.ts}, src/renderer/components/ShortcutsSheet.tsx)
- [git] Pane header shows the folder's branch and change count (polled every 5 s, active workspace); clicking it or Ctrl+Shift+D opens a Changes panel with the folder's `git diff HEAD` and untracked files (files: src/main/git.ts, src/main/{ipc,index,paths}.ts, src/shared/{ipc-channels,ipc-contract}.ts, src/preload/index.ts, src/renderer/app/store.ts, src/renderer/components/{DiffPanel,PaneHeader,Pane}.tsx, src/renderer/lib/diff.ts)
- [panes] New pane can create a git worktree on a new branch (`~/.wraithgrid/worktrees/<repo>/<branch>`) and open the pane there (files: src/renderer/components/NewPaneDialog.tsx, src/main/git.ts)
- [notify] OS notification when a claude pane you aren't looking at needs approval or finishes (ran ≥ 8 s, then went quiet); click jumps to the pane; Settings → Notifications toggle (files: src/renderer/app/store.ts, src/main/{index,ipc}.ts, src/shared/{types,schema}.ts, src/renderer/components/SettingsView.tsx)
- [tests] Unit tests for git status/diff/worktree (incl. a real repo), diff parsing and palette matching; e2e for the sidebar pane list, palette, git chip, diff panel and worktree panes (files: tests/unit/git.test.ts, tests/unit/shortcuts.test.ts, tests/e2e/git-palette.spec.ts)

## 2026-09-30

- [release] v1.3.0 (files: package.json)
- [sidebar] Collapse/expand animates the width (220 ms; content is revealed/clipped, not reflowed, and fades in; off under reduced motion) (files: src/renderer/components/Sidebar.tsx, src/renderer/styles/base.css)
- [sidebar] Right-click a folder (rename, collapse, new folder, delete) or a workspace (rename, change icon, two-step delete) via a new keyboard-accessible `ContextMenu`; icon popover split out as `IconPopover`; both portal to <body> (files: src/renderer/components/{ContextMenu,IconPicker,Sidebar,SidebarAccounts}.tsx, src/renderer/styles/base.css, tests/e2e/sidebar-menus.spec.ts)
- [updates] Settings "Update & restart" downloads the new release, installs it over this one (pacman/deb/rpm via pkexec, AppImage, silent NSIS) and relaunches; the new-release notification opens Settings instead of the browser. Works from v1.3.0 on (files: src/main/update-install.ts, src/main/{index,ipc,update-notify}.ts, src/shared/{ipc-channels,ipc-contract}.ts, src/preload/index.ts, src/renderer/app/store.ts, src/renderer/components/SettingsView.tsx, electron-builder.yml, package.json, .github/workflows/build.yml, tests/unit/update-install.test.ts)
- [tests] E2E check that Shift+Enter sends ESC CR and Enter a bare CR to claude panes (files: tests/e2e/keys.spec.ts, tests/fixtures/raw-keys.sh)
- [release] v1.2.0 (files: package.json)
- [docs] Refresh README screenshots and text for sharing, folders, icons, shortcuts and update alerts (files: README.md, docs/screenshots/)
- [ui] Shorter per-account sharing note; font options stay on one row (files: src/renderer/components/AccountsView.tsx, src/renderer/styles/base.css)
- [ui] Clean-up pass: letter/emoji badges (`Avatar`) for every account and workspace, one header per sidebar section, workspace shortcut digits on hover, only "login needed" shown as account status, balanced Accounts table, wrapped claude version, untruncated font names, shorter sharing copy; icon picker returns focus after a pick (files: src/renderer/components/{AccountIcon,IconPicker,Sidebar,SidebarAccounts,AccountsView,SettingsView,NewPaneDialog,PaneHeader}.tsx, src/renderer/styles/base.css)
- [workspaces] Custom emoji icon per workspace, set from the workspace switcher (files: src/shared/{types,schema}.ts, src/renderer/app/store.ts, src/renderer/components/WorkspaceSwitcher.tsx, tests/e2e/account-folders.spec.ts)
- [updates] A new release raises an OS notification once per version (launch check + every 6 h while open, packaged builds only); click opens the release page (files: src/main/update-notify.ts, src/main/index.ts, src/main/ipc.ts, tests/unit/update-notify.test.ts)
- [sidebar] Account folders (create, rename, collapse, delete) with drag-and-drop of accounts into/out of them (files: src/renderer/components/{SidebarAccounts,Sidebar}.tsx, src/shared/{types,schema}.ts, src/renderer/app/store.ts, tests/e2e/account-folders.spec.ts, tests/unit/config.test.ts)
- [accounts] Custom emoji icon per account, picked on the Accounts page, shown in the sidebar and pane header (files: src/renderer/components/{AccountIcon,AccountsView,PaneHeader,Pane}.tsx)
- [panes] Running panes animate: spinner status dot and a sheen on the account strip; off under reduced motion (files: src/renderer/components/Pane.tsx, src/renderer/styles/base.css)
- [shared] Sharing is now two modes, "Overall (~/.claude)" (default) and "Each account its own". Overall links CLAUDE.md, settings.json, skills/, plugins/, agents/ and commands/ from ~/.claude into every account, including ones added later. Adds a "Restart claude panes" button (files: src/main/shared-config.ts, src/main/ipc.ts, src/shared/{types,schema,ipc-contract}.ts, src/preload/index.ts, src/renderer/app/store.ts, src/renderer/components/{SettingsView,AccountsView}.tsx, tests/unit/shared-config.test.ts, tests/e2e/shared.spec.ts)
- [terminal] Shift+Enter inserts a new line in claude panes (sends ESC CR) (files: src/renderer/components/Terminal.tsx)
- [shortcuts] Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 change the terminal font size (files: src/renderer/app/{shortcuts.ts,App.tsx}, src/renderer/components/ShortcutsSheet.tsx, tests/unit/shortcuts.test.ts)

- [ci] Build installers only on release tags; push/PR runs checks only, docs-only changes skip CI (files: .github/workflows/build.yml, .github/workflows/release.yml)
- [docs] Add the AI Working Agreement and context files (files: CLAUDE.md, CHANGELOG.md, docs/CONTEXT.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/TODO.md)

## 2026-09-29

- [docs] Add README screenshots and restructure the README (files: README.md, docs/screenshots/)
- [release] v1.1.0 (files: package.json)
- [ci] Fix the Windows lint and Linux e2e failures; publish a GitHub release on version tags (files: .github/workflows/)
- [settings] Add appearance options (theme, accent, palette, font) and the update check (files: src/main/update-check.ts, src/renderer/components/SettingsView.tsx)
- [platform] Add Windows, Linux distro packages, tiling compositors, and shared CLAUDE.md/skills (files: src/main/platform.ts, src/main/shared-config.ts, electron-builder.yml)
- [m5] Add packaging, the README, and shutdown hardening
- [m1-m4] Add the PTY grid with accounts, layouts, and persistence
