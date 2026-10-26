# ADR 0004: A Rust pty host

- Status: **Proposed** (2026-10-26), issue #76. Phase 1 added the Rust host next to the Node
  one; phase 2 (Settings → Advanced, Linux bundle) lets a user turn it on. Off by default.

## Context

The background pty host (ADR 0001) is a Node process (`out/main/host.js`, started with the
app's Electron binary as plain Node). It works, but:

- `node-pty` is a native module rebuilt for every Electron version (`trustedDependencies`,
  the Ubuntu 22.04 Docker build for glibc), and it is the only reason `bun install` builds C++.
- A long-running Node process per host costs tens of MB before any pane exists.
- A remote host (`wraithgrid host-stdio`, H5) needs Wraithgrid installed on the ssh machine.

A full move to Tauri was considered and rejected for now (#76): system webviews (WebKitGTK)
are risky for xterm's WebGL renderer, the Electron e2e suite would need rewriting, and
multi-webview (needed for the web preview, ADR 0003) is still unstable in Tauri v2.

## Decision

1. **Only the pty host moves to Rust**: a `host-rs/` crate building one `wraithgrid-host`
   binary. The Electron app, the React UI and the rest of `src/main` stay TypeScript.
2. **Same contract, so clients don't change.** The Rust host is started the same way
   (`WRAITHGRID_HOST` JSON: `paths`, `appVersion`, `maskedFds`), takes the same lock, writes
   the same token file, listens on the same socket, and speaks the same NDJSON frames as
   `src/host/protocol.ts` (`PROTOCOL_VERSION` 1): `hello` / `welcome` / `refused`, `create`,
   `spawn`, `attach`, `list`, `write`, `resize`, `kill`, `shutdown`, `read`, `wait`, `gui`,
   `guiReply`, `config`; replies, `data` (with `replay` for a snapshot), `exit`, relayed `gui`.
   Frames are validated with the same limits as the zod schemas. `pane-host.ts`,
   `pane-router.ts` and the CLI talk to either host.
3. **Panes** run through `portable-pty` (its own session and process group, inherited fds
   closed). The environment is exactly the GUI's (`pane-env.ts` already strips the terminal's
   own variables) with `TERM=xterm-256color`, as node-pty does with an explicit env. The host
   reaps each pane itself (`waitpid`) to report exits as node-pty does: a normal exit is
   `{ exitCode, signal: 0 }`, a signal `{ exitCode: 0, signal: N }`. Output is coalesced per pane (16 ms, 256 KB) and decoded as
   UTF-8 across reads; the kill policy is node-pty's: SIGHUP to the group, SIGKILL after 2 s,
   then a sweep of the group.
4. **The reattach screen uses the `vt100` crate** (5000 lines of scrollback, like
   `HOST_SCROLLBACK`). A snapshot is every row of the active buffer, scrollback included, each
   written from a reset pen and reset before its line break (a line break that scrolls fills
   the new row with the current background in xterm), then the cursor position, the pen and
   the input modes. Like the Node host's, it goes out in pieces under `MAX_FRAME` (#134)
   (application keys, bracketed paste, mouse). It does not have to match `@xterm/addon-serialize`
   byte for byte; it has to draw the same screen in xterm.js, which the parity tests check.
   `vt100` is the first choice because it already formats rows and keeps scrollback; if parity
   fails on fixtures that matter, `alacritty_terminal` is the fallback.
5. **Attach is atomic.** The Node host holds output that arrives while it takes a snapshot;
   the Rust host takes the snapshot and sends the replay and the reply while holding its state
   lock, so the order on the wire is the same: replay, then live output.
6. **Parity is tested against the Node host**, not described: `tests/host/` starts both hosts
   on temporary sockets and replays the same client sessions (handshake, refusals, create,
   list, read, write, resize, wait, gui relay, kill, exit codes, shutdown), comparing replies
   and frames. Screen fixtures (colours, attributes, wide characters, long wrapped lines,
   scroll regions, scrollback past the cap, the alternate screen, cursor and modes) are drawn
   from each host's replay into a fresh `@xterm/headless` and compared cell by cell with the
   fixture drawn directly. `bun run test:host` runs it (it needs `bun run build` and cargo).

## Known differences

- **Alternate screen.** `vt100` only exposes the active buffer, so while a full-screen program
  (vim, htop) is open a snapshot restores the alternate screen but not the normal buffer under
  it, which the Node host does restore. Agent CLIs draw in the normal buffer, so their panes
  are unaffected. The parity suite pins this case.
- **Resize.** `vt100` cuts rows at a new width; the host instead reflows the normal buffer
  itself (re-feeds its logical lines into a parser of the new size), so a pane made narrow and
  wide again keeps its text as xterm does. xterm also cuts the cursor's line when it reflows a
  much narrower width; the Rust host keeps that line whole. The parity suite pins both. The
  host's screen keeps at least 2 rows (vt100 marks no wraps on a 1-row screen).
- **Error texts** for a failed spawn come from the OS through `portable-pty`, not node-pty.

## Consequences

- A second toolchain in the repo and in CI (cargo; cross targets from phase 3).
- Until phase 4 both hosts exist and the parity suite must keep passing on every protocol
  change.
- Phase 2: Linux packages carry the binary in their resources (`bun run dist:linux` builds it
  with cargo first; the Docker build installs a minimal Rust toolchain). The app starts it
  instead of `host.js` when `settings.rustHost` is on (`WRAITHGRID_RUST_HOST=1` in tests) and
  the binary exists; otherwise the Node host, as before. The switch takes effect when a host
  next starts. Remote machines (`host-stdio`) keep the Node host until phase 5.

## Rollout

1. **Protocol + Linux** (this change): the crate, the parity suite, a Linux CI job.
2. **Behind a setting**: Settings → Advanced "Use the Rust host" (off), the binary in the
   Linux bundle; dogfood.
3. **macOS + Windows**: ConPTY, named pipe, signing/notarization; x64 + arm64 builds.
4. **Default on**, then remove the Node host and `node-pty`.
5. **Remote**: the static binary on ssh machines for `host-stdio`.

## Alternatives considered

- **Keep the Node host.** Works today; keeps the native rebuilds and the memory cost.
- **Move the whole app to Tauri.** Rejected for now (see Context).
- **`alacritty_terminal` for the screen.** More complete emulation, but no ready row
  formatting or scrollback capture; kept as the fallback if `vt100` fails parity.
