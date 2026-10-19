# TODO

## Now
- H8 publish (needs your accounts): Homebrew tap repo, winget-pkgs PR, AUR `wraithgrid-bin` push; see packaging/README.md. Run scripts/update-packaging.sh after each release
- Mods as one list (2026-10-13): try Install / Add to all accounts with the real accounts (only the fake CLI and a throwaway config dir so far); confirm the repo link target for in-marketplace mods
- Mods (2026-10-13): try with a real mod in a pane (pane/band drawing, `$.ui.copy`, `$.ui.notify` with a channel set, GPU rendering with many panes)
- Mods: pane status with a mod that animates all the time (reads `running` forever, no "done" notification); needs a signal other than output
- Mods: mascot ("pet") animation report below may be fixed by GPU rendering; ask the user to retry
- Verify on Hyprland: screenshot → Ctrl+V in a claude pane attaches the image; same in a gemini/agy pane (`@path`)
- Non-claude panes: approval patterns are from docs (registry); check against real gemini/agy/codex/opencode/cursor/copilot output and save fixtures
- New CLIs (2026-10-19): try codex/cursor/copilot with two accounts each; if the sign-in is separate, mark the CLI `signIn: 'dir'` in agent-clis.ts
- Sidebar resize shipped (2026-10-05): drag edge, double-click resets; confirm with user it feels right
- Icons: library picker shipped (2026-10-05); still open: a default icon for new accounts/workspaces? (user to confirm)
- Shift+Enter "no new line" report: bytes (ESC CR) verified end to end on Hyprland and claude 2.1.285 accepts them; needs a repro (what happens: submits or nothing?)
- Claude mascot ("pet") not animating in panes: needs a repro from the user (which animation, when)

## Next
- Mods: only the listed mod of a multi-mod claudemod.com repo is shown; mark which catalog entries change claude's screen (the catalog doesn't say); downloaded mods (`~/.wraithgrid/mods`) have no update button yet (git pull)
- Mods (2026-10-19): try Update/Uninstall/marketplace add-remove and a claudemod.com Download with real accounts (fake CLI only so far); `plugin update` of a command-source mod needs `--accept-command`, shown as claude's error
- e2e flake: account-folders.spec.ts drag into a folder fails ~1 in 4 runs (also on main, 2026-10-19): dnd-kit drop timing; pace the drag more or wait for the drop zone
- macOS: try a CI-built dmg on a real Mac (Apple Silicon + Intel): first launch via Gatekeeper, ⌘ shortcuts, ⌘C/V in panes, claude found from the Dock, notifications
- macOS: Developer ID signing + notarization when an Apple developer account exists (CSC_LINK, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID secrets), then enable in-app updates there
- Test an in-app update 1.3.0 → 1.3.1 (1.3.0 is the first release with it; install 1.3.0 by hand once)
- Refresh README screenshots for the neutral restyle (screens from `WRAITHGRID_E2E_SHOTS`)

## Herdr parity (planned 2026-10-17)
Gaps vs herdr.dev, in build order. Keep our edge (many accounts per CLI, GUI, git review); these close theirs.
- H1 (ADR 0001 written 2026-10-19, waiting for review: docs/adr/0001-background-pty-host.md) Agents survive quitting: move node-pty into a background pty host process; the GUI attaches over a local socket and replays scrollback on reconnect. Quit menu: "Close window (agents keep running)" vs "Quit and stop agents"; tray icon while detached. ADR first (process model, socket auth, upgrade with live panes). Blocks H5–H7
- H5 Remote machines over SSH: run the pty host on another machine, add it in Settings (host from `~/.ssh/config`), its workspaces and panes in the sidebar; panes keep running when disconnected. Needs H1
- H6 CLI + local API: `wraithgrid list | read <pane> | send <pane> <text> | wait <pane> --until blocked|idle | split | new`; opt-in, user-only socket permissions, no network listener; lets agents start and prompt each other. Needs H1
- H7 Attach one pane from any terminal: `wraithgrid attach <pane>` (plain tty, works over SSH). Needs H1 + H6

## Later
- `agy`/opencode per-account isolation if they gain a config-dir variable
- Chat-style pane (`claude -p --output-format stream-json`): rejected for now (2026-10-05), revisit if asked

## Done (2026-10-19)
- H8 files: install.sh (checked: dry run all Linux formats vs v1.8.0), cask, winget, PKGBUILD (makepkg ok)
- Configurable shortcuts (Settings → Keyboard shortcuts)
- Mods: update/uninstall, marketplaces add/remove, merged catalog, Download for bare-plugin community repos
- Changes panel Commit all / Push / Pull request (with confirm); remove a worktree when its last pane closes (asks, names uncommitted files)
- H2 resume on restore, H3 CLI registry (+ codex, opencode, cursor, copilot), H4 per-CLI approval + `done` status, binary path setting for non-claude CLIs

## Blocked
- (none)
