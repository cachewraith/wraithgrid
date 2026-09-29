# Wraithgrid: Requirements

Status: DRAFT, awaiting approval. No code is written until this is approved.

## 1. Overview

Wraithgrid is a desktop app that shows many Claude Code terminals in one window. Each terminal can run under a different Claude account and in a different project folder, all at the same time.

## 2. Goals

- Run multiple Claude Code sessions side by side in one window.
- Use different Claude accounts at the same time, with no logout/login switching.
- Work on many projects at once, one folder per pane.
- Restore the previous layout when the app is reopened.

## 3. Non-Goals (v1)

- No custom Claude client. Wraithgrid runs the official `claude` CLI as-is.
- No storing, reading, or proxying of Claude credentials or tokens.
- No cloud sync, no team features, no telemetry.
- No built-in code editor or git UI.
- No mobile version.

## 4. Users

Single developer running several projects and accounts on one machine. Linux first (Arch/Ubuntu), then macOS and Windows.

## 5. Tech Stack

| Layer              | Choice                                 |
| ------------------ | -------------------------------------- |
| Shell              | Electron                               |
| UI                 | React + TypeScript + Vite              |
| Terminal rendering | `@xterm/xterm` + `@xterm/addon-fit`    |
| PTY                | `node-pty`                             |
| Storage            | JSON config file in the app config dir |
| Packaging          | electron-builder (AppImage/deb first)  |

## 6. Core Concepts

- **Account**: `{ id, name, configDir }`. `configDir` is passed to the CLI as `CLAUDE_CONFIG_DIR`, so each account has its own login, settings, and history.
- **Pane**: one terminal. Has an account, a working directory, and a title.
- **Workspace**: a saved layout of panes (positions, sizes, account and cwd per pane).

## 7. Functional Requirements

### 7.1 Accounts

- FR-A1: Add an account by name; app creates `~/.wraithgrid/accounts/<name>` as its config dir.
- FR-A2: Rename and remove accounts. Removing an account never deletes its config dir without explicit confirmation.
- FR-A3: "Login" action opens a pane running `claude` under that account so the user can run `/login`.
- FR-A4: Each account has a color tag shown on its panes.
- FR-A5: Import an existing config dir (e.g. `~/.claude`) as an account.

### 7.2 Panes and Terminals

- FR-P1: New pane asks for account and working directory (folder picker).
- FR-P2: Pane spawns a PTY running `claude` with `cwd` set and `CLAUDE_CONFIG_DIR` set to the account's dir.
- FR-P3: Full interactive terminal support: colors, resize, copy/paste, scrollback, mouse, unicode.
- FR-P4: Pane header shows title, account name/color, and cwd.
- FR-P5: Close pane kills its PTY process. Confirm if the process is still running.
- FR-P6: If `claude` exits, the pane stays open showing exit status with a "Restart" button.
- FR-P7: Option to open a plain shell pane (no `claude`) in the same cwd.
- FR-P8: Optional launch args per pane (e.g. `--resume`, `-c`).

### 7.3 Layout

- FR-L1: Grid layout with resizable splits (horizontal and vertical).
- FR-L2: Preset layouts: 1, 2 side-by-side, 2x2, 3-column.
- FR-L3: Zoom a pane to full window and back.
- FR-L4: Drag to reorder panes.
- FR-L5: Keyboard focus navigation between panes.

### 7.4 Workspaces and Persistence

- FR-W1: Auto-save current layout on change.
- FR-W2: On launch, restore panes (account, cwd, size) and start their terminals.
- FR-W3: Named workspaces: save, switch, delete.
- FR-W4: Session content is not persisted by Wraithgrid; conversation history is handled by Claude Code itself (resume via `claude -c`).

### 7.5 Shortcuts (defaults, configurable later)

| Action               | Shortcut        |
| -------------------- | --------------- |
| New pane             | Ctrl+Shift+N    |
| Close pane           | Ctrl+Shift+W    |
| Zoom pane            | Ctrl+Shift+Z    |
| Focus next/prev pane | Ctrl+Alt+Arrow  |
| Switch workspace     | Ctrl+Shift+1..9 |

### 7.6 Settings

- FR-S1: Path to `claude` binary (auto-detected from PATH, overridable).
- FR-S2: Terminal font family and size, theme (dark/light).
- FR-S3: Default account and default working directory.

## 8. Non-Functional Requirements

- NFR-1 Performance: at least 8 panes open with no visible input lag.
- NFR-2 Startup: window shown in under 2 seconds; panes restore in the background.
- NFR-3 Security: `contextIsolation` on, `nodeIntegration` off, PTY access only through a preload bridge with a fixed IPC surface.
- NFR-4 Privacy: Wraithgrid never reads or copies files inside account config dirs. It only sets the env var.
- NFR-5 Reliability: a crashed pane must not affect other panes. Orphan PTY processes are killed on app quit.
- NFR-6 Portability: Linux first; code avoids OS-specific paths so macOS/Windows can follow.

## 9. Config File

`~/.config/wraithgrid/config.json`

```json
{
  "claudePath": "claude",
  "accounts": [
    { "id": "a1", "name": "personal", "configDir": "~/.wraithgrid/accounts/personal", "color": "#7c5cff" }
  ],
  "workspaces": [
    {
      "name": "default",
      "panes": [
        { "id": "p1", "accountId": "a1", "cwd": "~/proj1", "args": [] }
      ],
      "layout": {}
    }
  ],
  "settings": { "fontSize": 13, "theme": "dark" }
}
```

## 10. Architecture

```
Renderer (React)                Main (Electron)               OS
  Pane UI + xterm  <--IPC-->   PtyManager (node-pty)  <-->  claude process
  Layout state                  ConfigStore (JSON)          (env: CLAUDE_CONFIG_DIR)
  Account/Workspace UI          Window/menu/shortcuts
```

- PtyManager: create, write, resize, kill, and stream data per pane id.
- IPC channels: `pty:create`, `pty:write`, `pty:resize`, `pty:kill`, `pty:data`, `pty:exit`, `config:get`, `config:set`, `dialog:pickFolder`.

## 11. Milestones

1. **M1: Skeleton.** Electron + Vite + React window, single xterm pane running `claude`.
2. **M2: Accounts.** Account model, per-pane `CLAUDE_CONFIG_DIR`, login flow.
3. **M3: Grid.** Multiple panes, resizable splits, presets, zoom, focus shortcuts.
4. **M4: Persistence.** Config file, auto-restore, named workspaces.
5. **M5: Polish.** Settings, themes, packaging (AppImage/deb), crash handling.

## 12. Acceptance Criteria (v1)

- Two panes with two different accounts run at the same time and stay logged in independently.
- Four panes in four different project folders run without interfering.
- Quit and relaunch restores the same layout, accounts, and folders.
- Closing the app leaves no orphan `claude` processes.
- Terminal behaves correctly for `claude` UI: colors, resize, paste, arrow keys, Ctrl+C.

## 13. Risks

| Risk                                                         | Mitigation                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `node-pty` native build fails on some systems                | Use prebuilt binaries; document build deps                       |
| `CLAUDE_CONFIG_DIR` behavior changes in a future CLI version | Isolate in one function; check on each CLI update                |
| Login flow needs a browser                                   | Open URL in system default browser from the terminal link        |
| Many panes use lots of memory                                | Limit scrollback (default 5000 lines); lazy-start restored panes |

## 14. Open Questions

1. Platform priority: Linux only for v1, or Linux + macOS + Windows?
2. Tabs and grid, or grid only?
3. Should panes launch `claude` automatically on restore, or wait for a click?
4. Do you want a per-pane usage/status indicator later (out of scope for v1)?
5. License and repo: private or open source under `cachewraith-labs`?
