# TODO

## Now
- Account/workspace icons: picker (click the letter badge) is not discoverable; user wants a default icon. Awaiting which default + where to pick
- Shift+Enter "no new line" report: bytes (ESC CR) verified end to end on Hyprland and claude 2.1.285 accepts them; needs a repro (what happens: submits or nothing?)
- Claude mascot ("pet") not animating in panes: needs a repro from the user (which animation, when)

## Next
- Test an in-app update 1.3.0 → 1.3.1 (1.3.0 is the first release with it; install 1.3.0 by hand once)
- Refresh README screenshots for the neutral restyle (screens from `WRAITHGRID_E2E_SHOTS`), then release
- Changes panel: commit / push / open PR actions (T3's one-button flow), with a confirm step
- Worktrees: remove one when its pane closes (ask first; it may hold uncommitted work)

## Later
- macOS support (REQUIREMENTS §4 lists it; only Windows + Linux ship today)
- Chat-style pane (`claude -p --output-format stream-json`): rejected for now (2026-10-05), revisit if asked
- Configurable shortcuts (REQUIREMENTS §7.5 "configurable later")

## Blocked
- (none)
