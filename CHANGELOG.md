# Changelog

## 2026-09-30

- [updates] Settings "Update & restart" downloads the new release, installs it over this one (pacman/deb/rpm via pkexec, AppImage, silent NSIS) and relaunches; the new-release notification opens Settings instead of the browser. Works from v1.3.0 on (files: src/main/update-install.ts, src/main/{index,ipc,update-notify}.ts, src/shared/{ipc-channels,ipc-contract}.ts, src/preload/index.ts, src/renderer/app/store.ts, src/renderer/components/SettingsView.tsx, electron-builder.yml, package.json, .github/workflows/build.yml, tests/unit/update-install.test.ts)
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
