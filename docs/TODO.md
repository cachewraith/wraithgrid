# TODO

## Now
- #41 (2026-10-22): agy in the chat UI (`src/main/chat/agy.ts`, `chat: true`); agy 1.4.4 has `-p --input-format/--output-format stream-json`, `--model/--effort/--mode`, `--continue/--conversation`; also set its `resumeArgs`
- #40 (2026-10-22): Codex CLI in the chat UI (`src/main/chat/codex.ts` adapter, `chat: true`; `codex exec --json` vs `app-server` to decide) + codex sign-in dialog (`codex login --device-auth`/`status`; login.ts per-CLI)
- #39 (2026-10-22): chat looks stopped while claude runs background work (release, push, `run_in_background` Bash/Agent); `result` in chat/claude.ts sets busy false. Track background tool_use ids → a separate "Running in background" state in chat + pane/sidebar; capture real stream-json fixture first
- Plan (2026-10-22): attach files from the local machine in chat panes. Today the message box only takes pasted images (Composer `onPaste`; PNG/JPEG/GIF/WebP, max 4, ~5 MB each, `CHAT_IMAGE_*` in shared/chat.ts). To decide: an attach button with a native file picker (main `dialog.showOpenDialog` behind a new IPC channel + zod contract; main reads the file, never trusts a renderer path), drag and drop, which file types (images as image parts; text/code inlined or passed as a path for claude to read; PDFs?), size limits
- Issue (2026-10-22): improve desktop app performance. Needs specifics from the user first: what feels slow (startup, switching projects/panes, typing, long chat threads, many panes, memory use) and on which OS. Then measure before changing (DevTools Performance profile, `process.getProcessMemoryInfo`); overlaps with the NFR-1 8-pane check above
- Issue (2026-10-22): no visible way to delete a chat on the project screen (ProjectView). Open chats have no delete at all; History rows have a trash button (`.pj-del`) but it is invisible until hover (opacity 0, polish.css), and it deletes at once with no confirm. Want: a visible delete for chats (open and History), and clicking it opens a "Delete this chat?" confirm dialog (build on `Dialog.tsx`, like `RemoveWorktreeDialog`) before `deleteHistory` / stopping an open chat. To decide: show the button always or on hover + in a right-click menu; what deleting an open chat does (stop + forget the session?)
- Plan (2026-10-22): sign in from a UI dialog, not a terminal. Today the account Login action opens a terminal pane running claude's own `/login` (store.ts `loginAccount`, `loginFlow` ~640). Want: a Wraithgrid dialog (steps: open browser → paste code if asked → "Signed in as …"), with claude still doing the OAuth itself in the account's config dir (never handle tokens ourselves). To check with the real CLI: is there a non-interactive login command (e.g. `claude auth login`) whose URL/code prompt main can drive over pipes; else drive `/login` in a hidden pty and parse the URL. Then the same for other CLIs (codex/gemini…) or keep the terminal for them
- Herdr parity (released in v1.10.0): verify on Windows (named pipe host, ConPTY in a detached ELECTRON_RUN_AS_NODE process, NSIS update closing the host) and macOS (host from the .app, tray, ⌘Q asks); a real ssh machine for H5; NFR-1: memory/CPU of the host with 8 busy panes (headless xterm per pane)
- Windows: `wraithgrid` CLI prints nothing in a console (GUI-subsystem exe); needs AttachConsole or a `wraithgrid.cmd` shim
- H5 follow-ups: a machine's own `wraithgrid` path (AppImage/macOS remote), remote sign-in state per machine (login banner uses the local flag), remote Mods/Changes panel (local only today)
- H6 follow-up: a prompt sent with `wraithgrid send` does not set `hasConversation` (resume on restore skips it)
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
- Mods: mark which catalog entries change claude's screen (the catalog doesn't say); try Update on a real downloaded mod and a real multi-mod claudemod.com repo
- Mods (2026-10-19): try Update/Uninstall/marketplace add-remove and a claudemod.com Download with real accounts (fake CLI only so far); `plugin update` of a command-source mod needs `--accept-command`, shown as claude's error
- macOS: try a CI-built dmg on a real Mac (Apple Silicon + Intel): first launch via Gatekeeper, ⌘ shortcuts, ⌘C/V in panes, claude found from the Dock, notifications
- macOS: Developer ID signing + notarization when an Apple developer account exists (CSC_LINK, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID secrets), then enable in-app updates there
- Test an in-app update 1.3.0 → 1.3.1 (1.3.0 is the first release with it; install 1.3.0 by hand once)

## Herdr parity
H1–H7 released in v1.10.0; H8 publishing needs the accounts (Now).

## Later
- `agy`/opencode per-account isolation if they gain a config-dir variable

## Done (2026-10-24)
- v1.19.1: #83/#84 merged, #75/#78 closed; replace unpublished v1.19.0 attempt after fixing the capped-history About e2e fixture.
- #75 footer: remove duplicate status-bar counts and place the shortcut/update bar inside main; sidebar footer ends at the window bottom.
- #75 correction: empty-project CSS collision fixed; exact sidebar-v3 row rhythm and eight-project alignment/height covered; Scheduled navigation is disabled pending #77.
- #75: remaining whole-app v3.4 pass implemented across pages/chrome/panes/controls/dialogs/menus; complete sidebar identity/rail/footer, theme references and screen audit (docs/UI-75.md); five built-ins plus community theme and reduced motion covered. Scheduled remains #77.
- #78: all-provider account picker, offline marks/fallbacks, confirmed cross-CLI visible-text handoff with source in History, collapsed row, larger flat chips and folder/branch below; fake-CLI e2e in dark/light, same-CLI/shared-login and terminal flows

## Done (2026-10-22)
- #36: ghost buttons broken app-wide by the commit-graph's bare `.gh` CSS rule; scoped to `ol.gh`
- #26: New project screen (folder → suggested name, account, machine, first chat); switcher no longer creates, says "project"
- Chat diagrams draw whole (no per-line border, tight lines for box drawing); mermaid stays code (DECISIONS)
- Mode switches mid-chat incl. Bypass (allow flag at start), refused switches show claude's reason, bypass confirm resets on close

## Done (2026-10-21)
- account-folders e2e flake fixed (wait for the drop target)
- Mods: Update button for downloaded mods; every mod of a multi-mod claudemod.com repo listed
- README screenshots retaken (repeatable: readme-shots.spec.ts)

## Done (2026-10-19)
- Switch branch from the pane chip, Changes panel, pane menu and palette (branch picker)
- H1 background pty host (ADR 0001 reviewed + accepted): keep/stop on close, tray, reattach with screen, renderer-crash reattach, update stops after asking
- H6 `wraithgrid` CLI (opt-in), H7 `wraithgrid attach`, H5 workspaces on other machines over ssh
- H8 files: install.sh (checked: dry run all Linux formats vs v1.8.0), cask, winget, PKGBUILD (makepkg ok)
- Configurable shortcuts (Settings → Keyboard shortcuts)
- Mods: update/uninstall, marketplaces add/remove, merged catalog, Download for bare-plugin community repos
- Changes panel Commit all / Push / Pull request (with confirm); remove a worktree when its last pane closes (asks, names uncommitted files)
- H2 resume on restore, H3 CLI registry (+ codex, opencode, cursor, copilot), H4 per-CLI approval + `done` status, binary path setting for non-claude CLIs

## Blocked
- (none)
