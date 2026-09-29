# Wraithgrid

Run many `claude` CLI sessions side by side in one window. Each pane has its own
account and its own project folder, and all of them run at the same time: no logging
out and back in to switch accounts.

Wraithgrid runs the official `claude` CLI as-is. For each pane it sets
`CLAUDE_CONFIG_DIR` to that account's folder, so every account keeps its own login,
settings and history. Wraithgrid never reads, copies or proxies anything inside those
folders.

Linux first (Arch, Ubuntu). The code avoids OS-specific paths, so macOS and Windows can
follow.

## Install

Download a release from
[github.com/cachewraith-labs/wraithgrid](https://github.com/cachewraith-labs/wraithgrid),
or build one yourself (see below).

- **AppImage** (any distro): `chmod +x Wraithgrid-*.AppImage && ./Wraithgrid-*.AppImage`.
  It needs FUSE 2 (`fuse2` on Arch, `libfuse2` on Ubuntu).
- **Debian/Ubuntu**: `sudo apt install ./wraithgrid-*-amd64.deb`

You also need the `claude` CLI on your `PATH`, or its path set in **Settings**.

## Build from source

Requirements:

- Node.js 22.12 or newer, and pnpm 10 or newer
- A C++ toolchain for the `node-pty` native module: `python3`, `make` and `g++`
  - Arch: `sudo pacman -S --needed python make gcc`
  - Ubuntu: `sudo apt install python3 make g++`
- For `.deb` builds on a non-Debian host, electron-builder downloads its own `fpm`.

```sh
pnpm i          # installs deps and rebuilds node-pty for Electron (postinstall)
pnpm dev        # run with hot reload
pnpm dist       # build dist/Wraithgrid-<version>-x86_64.AppImage and dist/wraithgrid-<version>-amd64.deb
```

If `pnpm i` asks you to approve build scripts, allow `electron`, `esbuild` and
`node-pty`. The repository's `pnpm-workspace.yaml` already lists them under
`allowBuilds`.

| Script           | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `pnpm dev`       | electron-vite dev server with the app                |
| `pnpm build`     | production build into `out/`                         |
| `pnpm typecheck` | `tsc` over the main/preload and renderer projects    |
| `pnpm lint`      | ESLint and a Prettier check                          |
| `pnpm test`      | Vitest unit tests                                    |
| `pnpm test:e2e`  | builds, then runs the Playwright Electron smoke test |
| `pnpm dist`      | AppImage and .deb via electron-builder               |

## Usage

1. **Add accounts.** Open **Accounts** (sidebar, **Manage**).
   - **Add account** creates `~/.wraithgrid/accounts/<name>` for a fresh login.
   - **Import ~/.claude** points an account at an existing config dir so you keep that
     login. Nothing is copied.
2. **Sign in.** Press **Login** on an account. A pane opens running `claude` under that
   account. Press **Run /login** and finish in your browser. The account shows as signed
   in once the pane prints a successful login, or when you press **Mark as signed in**.
3. **Open panes.** Press **New pane** (`Ctrl+Shift+N`) and pick an account, a folder and
   optional launch args (`--resume`, `-c`). You can also open a plain shell in a folder.
4. **Arrange them.**
   - Drag the dividers to resize.
   - Pick a preset: 1, 2 side by side, 2×2, or 3 columns.
   - Drag a pane by its header onto another pane to swap them.
   - Zoom a pane with `Ctrl+Shift+Z`.
   - Panes that don't fit a preset stay open but hidden. The **+N hidden** chip brings
     them back.
5. **Workspaces.** Keep separate sets of panes (the sidebar, or **Manage** to create,
   rename and delete them) and switch with `Ctrl+Shift+1…9`.

When `claude` exits, the pane stays open with the exit code and last error line, and a
**Restart** button. Quitting Wraithgrid ends every pane's processes. On the next launch
your workspaces, layouts, accounts and folders come back and each pane starts `claude`
again. Conversation history belongs to `claude` itself: add `-c` to a pane's launch
args to continue where you left off.

### Shortcuts

| Action                              | Keys                 |
| ----------------------------------- | -------------------- |
| New pane                            | `Ctrl+Shift+N`       |
| Close pane                          | `Ctrl+Shift+W`       |
| Zoom pane / back to grid            | `Ctrl+Shift+Z`       |
| Move focus left / up / right / down | `Ctrl+Alt+Arrow`     |
| Switch workspace                    | `Ctrl+Shift+1` … `9` |
| Copy / paste in a terminal          | `Ctrl+Shift+C` / `V` |
| All shortcuts                       | `Ctrl+Shift+/`       |
| Close a dialog                      | `Esc`                |

Every other key, including `Ctrl+C`, `Esc` and the arrow keys, goes to the terminal.

## Configuration

Settings, accounts and workspaces live in `~/.config/wraithgrid/config.json`. Changes
are saved automatically. If the file is ever unreadable, Wraithgrid moves it to
`config.bad-<timestamp>.json` and starts fresh. Wraithgrid never saves terminal content.

**Settings** covers:

- the `claude` binary: auto-detected from `PATH`, with an optional override
- the terminal font and size
- dark or light theme
- the default account
- the default working directory

## Privacy and security

- No telemetry. The only network activity is opening links you click, in your browser
  (http and https only).
- The renderer runs sandboxed with context isolation. It reaches the system only through
  a fixed, validated IPC surface.
- Deleting an account's config dir is opt-in, needs confirmation, and only works on the
  folder that account points to inside your home directory.

## License

[MIT](LICENSE)
