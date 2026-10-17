# TODO

## Now
- Mods as one list (2026-10-13): try Install / Add to all accounts with the real accounts (only the fake CLI and a throwaway config dir so far); confirm the repo link target for in-marketplace mods
- Mods (2026-10-13): try with a real mod in a pane (pane/band drawing, `$.ui.copy`, `$.ui.notify` with a channel set, GPU rendering with many panes)
- Mods: pane status with a mod that animates all the time (reads `running` forever, no "done" notification); needs a signal other than output
- Mods: mascot ("pet") animation report below may be fixed by GPU rendering; ask the user to retry
- Verify on Hyprland: screenshot → Ctrl+V in a claude pane attaches the image; same in a gemini/agy pane (`@path`)
- Gemini/agy panes: status detection (running/idle/approval) uses claude's patterns; check against real gemini/agy output
- Sidebar resize shipped (2026-10-05): drag edge, double-click resets; confirm with user it feels right
- Icons: library picker shipped (2026-10-05); still open: a default icon for new accounts/workspaces? (user to confirm)
- Shift+Enter "no new line" report: bytes (ESC CR) verified end to end on Hyprland and claude 2.1.285 accepts them; needs a repro (what happens: submits or nothing?)
- Claude mascot ("pet") not animating in panes: needs a repro from the user (which animation, when)

## Next
- Mods from claudemod.com: repos with only `.claude-plugin/plugin.json` (no marketplace file, e.g. effort-cycle) are left out; could clone them into a mod folder. Only the listed mod of a multi-mod repo is shown.
- Mods: catalog comes from the first claude account that answers; merge when accounts have different marketplaces
- Mods: uninstall and update from the Mods screen; add/remove marketplaces; mark which catalog entries change claude's screen (the catalog doesn't say)
- macOS: try a CI-built dmg on a real Mac (Apple Silicon + Intel): first launch via Gatekeeper, ⌘ shortcuts, ⌘C/V in panes, claude found from the Dock, notifications
- macOS: Developer ID signing + notarization when an Apple developer account exists (CSC_LINK, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID secrets), then enable in-app updates there
- Test an in-app update 1.3.0 → 1.3.1 (1.3.0 is the first release with it; install 1.3.0 by hand once)
- Refresh README screenshots for the neutral restyle (screens from `WRAITHGRID_E2E_SHOTS`)
- Changes panel: commit / push / open PR actions (T3's one-button flow), with a confirm step
- Worktrees: remove one when its pane closes (ask first; it may hold uncommitted work)

## Herdr parity (planned 2026-10-17)
Gaps vs herdr.dev, in build order. Keep our edge (many accounts per CLI, GUI, git review); these close theirs.
- H1 Agents survive quitting: move node-pty into a background pty host process; the GUI attaches over a local socket and replays scrollback on reconnect. Quit menu: "Close window (agents keep running)" vs "Quit and stop agents"; tray icon while detached. ADR first (process model, socket auth, upgrade with live panes). Blocks H5–H7
- H2 Resume conversations on restart: restored panes start the CLI with its resume flag (claude `--continue`) when the pane had one; per-pane toggle
- H3 More agent CLIs: per-CLI registry (binary, config-dir env var, image paste format, status patterns, new-line key) replacing the claude/gemini/agy branches; add Codex (`CODEX_HOME`), opencode, Cursor agent, Copilot CLI; check each one's per-account isolation before promising multi-account
- H4 Status for every CLI: working / blocked / done / idle (add "done"), patterns per registry entry, fixtures from real output; covers the gemini/agy item in Now
- H5 Remote machines over SSH: run the pty host on another machine, add it in Settings (host from `~/.ssh/config`), its workspaces and panes in the sidebar; panes keep running when disconnected. Needs H1
- H6 CLI + local API: `wraithgrid list | read <pane> | send <pane> <text> | wait <pane> --until blocked|idle | split | new`; opt-in, user-only socket permissions, no network listener; lets agents start and prompt each other. Needs H1
- H7 Attach one pane from any terminal: `wraithgrid attach <pane>` (plain tty, works over SSH). Needs H1 + H6
- H8 Easier install: Homebrew cask, winget, AUR, one-line install script with checksum check

## Later
- Settings path overrides for gemini/agy binaries (claude has one); `agy` per-account isolation if it gains a config-dir variable
- Chat-style pane (`claude -p --output-format stream-json`): rejected for now (2026-10-05), revisit if asked
- Configurable shortcuts (REQUIREMENTS §7.5 "configurable later")

## Blocked
- (none)
