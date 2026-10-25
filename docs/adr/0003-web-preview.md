# ADR 0003: Web preview panes

- Status: **Accepted** (2026-10-25), issue #74.

## Context

Agents build websites, but neither they nor the user could see the result inside Wraithgrid.
The ask: run a project's dev server and show its page next to the chat, with only what a
preview needs (no full browser), safely.

## Decision

1. **A preview is a pane** (`pane.view = 'preview'`, `shell: true`, no account), so layouts,
   drag, zoom and focus work as for chats. One per project; local projects only.
2. **The page is an Electron `<webview>`**, not a `WebContentsView`. A `WebContentsView` is
   drawn above the page, so every menu, dialog and the palette would sit behind the preview
   and its bounds would need syncing on every layout change; a `<webview>` is part of the DOM.
   The main window enables `webviewTag`, and main locks every webview down in
   `will-attach-webview`: no preload, no node, sandbox, context isolation, partition
   `wraithgrid-preview` (no app cookies or storage), `src` on this computer only. In the guest,
   `will-navigate`/`will-redirect` keep it on localhost, 127.0.0.1, [::1] or `*.localhost`;
   anything else and `window.open` go to the system browser; its session denies every
   permission. The renderer CSP allows `frame-src` for those hosts only.
3. **The dev server runs in main over pipes** (`DevServers`, the chat children's spawn: a
   process group on POSIX, `taskkill /T` on Windows), not in the pty host: it needs no
   terminal, only lines for a Log drawer and its address. `BROWSER=none` keeps it from opening
   a tab. It stops with its pane and on quit.
4. **The command is the project's** (`workspace.preview.command`, edited once in the pane),
   proposed from package.json `dev`/`start` with the lockfile's package manager, or
   `php artisan serve`. The address is the first local one the server prints, unless the
   project fixes one (`workspace.preview.url`).

## Consequences

- A preview does not survive a quit (the server is a child of main); it restarts on launch.
- Projects on other machines have no preview until the server can be reached through ssh.
- PR B adds "Attach to chat": screenshot, console errors and failed requests into a chat.
