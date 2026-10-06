# TODO

## Now
- Sidebar resize shipped (2026-10-05): drag edge, double-click resets; confirm with user it feels right
- Icons: library picker shipped (2026-10-05); still open: a default icon for new accounts/workspaces? (user to confirm)
- Shift+Enter "no new line" report: bytes (ESC CR) verified end to end on Hyprland and claude 2.1.285 accepts them; needs a repro (what happens: submits or nothing?)
- Claude mascot ("pet") not animating in panes: needs a repro from the user (which animation, when)

## Next
- macOS: try a CI-built dmg on a real Mac (Apple Silicon + Intel): first launch via Gatekeeper, ⌘ shortcuts, ⌘C/V in panes, claude found from the Dock, notifications
- macOS: Developer ID signing + notarization when an Apple developer account exists (CSC_LINK, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID secrets), then enable in-app updates there
- Test an in-app update 1.3.0 → 1.3.1 (1.3.0 is the first release with it; install 1.3.0 by hand once)
- Refresh README screenshots for the neutral restyle (screens from `WRAITHGRID_E2E_SHOTS`)
- Changes panel: commit / push / open PR actions (T3's one-button flow), with a confirm step
- Worktrees: remove one when its pane closes (ask first; it may hold uncommitted work)

## Later
- Chat-style pane (`claude -p --output-format stream-json`): rejected for now (2026-10-05), revisit if asked
- Configurable shortcuts (REQUIREMENTS §7.5 "configurable later")

## Blocked
- (none)
