# ADR 0001: Agents keep running after Wraithgrid closes (background pty host)

- Status: **Accepted with amendments** (reviewed 2026-10-19; see "Review" at the end, which
  overrides the sections above where they differ)
- Plan item: H1 in `docs/TODO.md`; H5 (SSH machines), H6 (CLI + local API) and H7 (attach
  from a terminal) build on it

## Context

Every pane process is a node-pty child of the Electron main process (`src/main/pty-manager.ts`).
Quitting, closing the window (`window-all-closed`), a renderer crash (`render-process-gone`)
or an in-app update kills them all (`cleanup()` in `src/main/index.ts`). That rule is
deliberate today ("no orphan processes", smoke e2e), but it means a long agent run dies with
the window. herdr.dev keeps agents alive and lets you reattach.

Constraints that stay:

- No network listener and no telemetry (README "Privacy and security"). Local only, one user.
- Main resolves accounts and paths from its own config; nothing trusts renderer paths (IPC
  contract in `src/shared/ipc-contract.ts`).
- Windows, Linux and macOS. node-pty is built against Electron's ABI.
- A pane must still never outlive Wraithgrid by accident: keeping agents running is a choice
  the user makes, and there is always a way to stop all of them.

## Decision (proposed)

### 1. A separate pty host process owns the panes

- `src/host/` builds to `out/host/index.js`. The GUI starts it with its own Electron binary
  and `ELECTRON_RUN_AS_NODE=1`, so node-pty's Electron build loads unchanged and no separate
  Node install is needed.
- Started detached (POSIX `setsid`, Windows `detached` + `windowsHide`), so it survives the GUI.
- One host per user per machine. A second start finds the live socket and exits.
- `PtyManager`, `buildPaneEnv`, spawn resolution and the kill policies move into the host,
  unchanged. Main keeps config, accounts, IPC validation and git. It sends the host a fully
  resolved spawn request (file, args, cwd, env), the same shape `ptys.create` takes today.
- The host exits on "Quit and stop agents", or after 10 minutes with no panes and no client.

### 2. Transport: a local socket, plus a token

- POSIX: a Unix socket at `$XDG_RUNTIME_DIR/wraithgrid/host.sock`. Without that variable, or
  on macOS, it lives under the user-data dir (`run/host.sock`), kept short for the 104-byte
  path limit. Directory mode `0700`, socket `0600`.
- Windows: a named pipe `\\.\pipe\wraithgrid-host-<hash of user SID>`. Node can't set a pipe
  ACL, and the default one lets other local users read, so the token below is what actually
  gates access there.
- A random 256-bit token in a `0600` file next to the socket (`%APPDATA%` on Windows) has to
  open every connection. It is rewritten when the host starts.
- Messages are newline-delimited JSON, each one checked with zod as IPC payloads are today.
  The first frame is `hello {protocol, appVersion, token}`. Pane output stays as UTF-8
  strings, as node-pty gives them. The protocol runs over any duplex stream, so H5 can use
  `ssh host wraithgrid --host-stdio` without changes.

### 3. Reattach shows the real screen, not a replayed byte stream

- The host runs one `@xterm/headless` terminal per pane, fed with the same output, and keeps
  its own scrollback (default 5,000 lines, from the terminal setting).
- On attach it sends `@xterm/addon-serialize` output first: the screen, scrollback, alternate
  screen and cursor. Then it streams live output. Replaying a cut raw buffer can start in the
  middle of an escape sequence or miss an alternate-screen switch, which garbles claude's
  full-screen UI.
- Cost: memory roughly proportional to scrollback per pane, plus parsing in the host. A
  measurement with 8 busy panes is a gate before release (NFR-1).

### 4. Quitting has two meanings

- The app menu, the tray and the close button offer **Close window (agents keep running)**
  and **Quit and stop agents**. The close button asks once, with "remember my choice";
  **Settings → When the window closes** changes it later.
- While the window is closed, a tray icon shows the running count, **Open Wraithgrid** and
  **Stop all agents**. On Linux desktops without a tray (GNOME without the AppIndicator
  extension), the agents keep running anyway and the next launch reattaches. The README
  says so.
- The next launch reattaches every pane the host still has. A pane whose process ended while
  detached shows the exit bar as usual. Restore and resume (H2) only start panes the host
  does not have.
- A renderer crash no longer kills panes: the reloaded window reattaches.

### 5. Upgrading with live panes

- `hello` carries the protocol version. A new GUI with the same protocol keeps using the
  running host. A different protocol shows "N agents are running in an older background host"
  with **Restart them now** (resume where possible) or **Keep them** (the panes stay, the GUI
  waits).
- In-app updates stop the host only after the user agrees. Windows has to, because the NSIS
  installer cannot replace the locked Electron binary the host runs from.

### 6. Off by default for the first release

- The first release ships with the close button set to "Quit and stop agents" and the choice
  offered on first close. Agents left running use CPU, memory and API spend, so the user
  should opt in. (Open question 1.)

## Consequences

- Main stops being the parent of every pane: the "no process outlives the app" e2e becomes
  two tests, "stop" leaves nothing running and "keep" reattaches with the screen intact.
- The pty and spawn logic gets a second entry point and its own build output
  (electron-vite gets a third `host` target). `asarUnpack` already covers node-pty.
- H6 (`wraithgrid list/send/wait`) becomes a second client of the same socket with the same
  token, and H7 (`wraithgrid attach`) a third that renders the serialized screen to a plain tty.
- A new place for bugs: socket cleanup after a crash (a stale `host.sock` is removed when
  nothing answers), two GUIs racing to start a host (an exclusive lock file decides), and
  clock or idle-exit edge cases.

## Alternatives considered

- **Hide the window, keep main alive (tray only).** Smallest change, with no protocol and no
  second process. Agents survive closing the window, but not a quit, a crash, an update or a
  logout, and other terminals can't attach (H6/H7). Worth shipping first as phase 0 if H1
  takes long.
- **tmux / screen / dtach as the backend.** Mature reattach, but not on Windows, one more
  dependency, its own keybindings and terminal-detection quirks (the `TMUX` variable is
  already stripped because it changes claude's screen), and the output path gets harder to
  control.
- **A raw output ring buffer instead of a headless terminal.** Less memory, but the replay
  breaks full-screen UIs (section 3).
- **TCP on localhost with a token.** Reachable by every local user and process, and a
  "network listener" in the README's sense. Rejected.

## Rollout

1. Phase 0 (optional, small): close-to-tray while main stays alive.
2. Host package + protocol + unit tests over an in-memory duplex; the GUI uses the host for
   every pane, but still stops it on quit (no behaviour change).
3. Headless screen + serialize on reattach; renderer-crash reattach.
4. Quit choices, tray, Settings, reattach on launch; e2e: keep → relaunch → same screen; stop → no pids.
5. Upgrade handling; Windows installer stop; README and privacy notes.

## Open questions for review

1. Default for the close button: ask on first close (proposed), or keep running from the start?
2. Is phase 0 (close to tray) wanted on its own, before the host lands?
3. Scrollback kept by the host: 5,000 lines per pane (proposed), or a setting?
4. Should "Stop all agents" also be reachable without the GUI (H6 `wraithgrid stop`) in the
   first host release?

## Review (2026-10-19)

Checked against `src/main/{pty-manager,index,ipc}.ts`, `src/renderer/app/store.ts` and
`src/renderer/lib/pty-bus.ts`. Verified: node-pty loads and spawns under the app's own
Electron with `ELECTRON_RUN_AS_NODE=1` (Linux); `@xterm/headless@6.0.0` and
`@xterm/addon-serialize@0.14.0` match `@xterm/xterm@6.0.0` and pass `minimumReleaseAge`.
The process model, transport, token and headless-screen choices stand. Amendments:

1. **Only `PtyManager` and the kill policies move to the host.** §1 says `buildPaneEnv` and
   spawn resolution move too, but also that main sends a fully resolved request; the second
   is right. Env, PATH probing, binary lookup and config stay in main; the host never reads
   config and spawns exactly what it is given.
2. **Socket per user-data dir, not per user.** Tests (`WRAITHGRID_USER_DATA_DIR`) and a real
   install must not share a host. POSIX: `${XDG_RUNTIME_DIR or os.tmpdir()}/wraithgrid-<uid>-<hash of userData>/host.sock`;
   the dir is created `0700` and refused if it exists with another owner or group/other
   bits (matters in `/tmp`). This also replaces the macOS user-data path (length limit).
   Windows: `\\.\pipe\wraithgrid-host-<hash of userData + user name>`, token and lock in
   `userData/run`.
3. **Exited-while-detached panes are kept** (screen + exit code) until a client attaches,
   then dropped. Idle exit counts only live panes and clients.
4. **Attach is explicit.** The renderer passes `attach: true` on a pane's first start after
   launch (the same condition as `restored`); a restart always kills and creates. The
   attach reply carries the exit, if any, so the renderer never races an exit event against
   its own `started` update.
5. **The snapshot bypasses status detection.** It reaches the renderer as a `replay` data
   event: written to the screen, but not counted as output, approval or a login prompt,
   or every reattach would read `running` → `done` and notify.
6. **Size before snapshot.** Attach carries the pane's current cols/rows; the host resizes
   the pty and headless terminal first, then serializes.
7. **Quitting from code vs from the user.** Only user actions ask (close button, window
   manager close, the macOS Quit menu item, the tray). `app.quit()` from code, signals and
   Playwright's `app.close()` follow the setting with `ask` treated as `stop`, so a quit
   can never hang on a dialog and the existing "no orphans" e2e still holds.
8. **The tray lives in main.** The host runs as plain Node and has no tray API, so "Close
   window (agents keep running)" keeps the GUI process alive, windowless, with the tray;
   **Quit, keep agents running** (tray) or a crash leaves only the host. Pane notifications
   come from the renderer, so none fire while the window is closed (noted in the README).
9. **Build output.** The host is a second input of the `main` build (`out/main/host.js`),
   not a third electron-vite target; it must never import `electron`.
10. **Fuses.** The host depends on Electron's `RunAsNode` fuse staying on; never flip it in
    electron-builder's `electronFuses`.
11. **Updates.** An in-app update with live panes asks first and stops them on every OS
    (Windows must; elsewhere a new GUI and an old host would only meet on the mismatch
    path). The NSIS installer run by hand closes every `Wraithgrid.exe`, the host included.
12. **Dev builds.** A host started by an older dev build keeps running its old code while
    the protocol matches; after changing `src/host/`, stop it (Quit and stop agents).

Open questions, decided:

1. Default: **ask on first close**, with "remember my choice" (`settings.onWindowClose`:
   `ask` | `stop` | `keep`, default `ask`).
2. **No phase 0.** Phase 2 already changes nothing visible, and close-to-tray arrives with
   phase 4.
3. Scrollback: **5,000 lines**, the same fixed value the renderer's xterm uses; no setting.
4. `wraithgrid stop` ships with **H6**; the first host release has the tray and the GUI.
