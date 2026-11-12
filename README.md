<div align="center">

<img src="icon.png" alt="Wraithgrid logo" width="96" height="96" />

# Wraithgrid

**Run many agent CLI sessions (`claude`, `gemini`, `agy`, `codex`, `opencode`, `cursor-agent`, `copilot`) side by side, each with its own account and project folder, as a chat or a terminal.**

[![Latest release](https://img.shields.io/github/v/release/cachewraith/wraithgrid?style=flat-square&color=7c5cff)](https://github.com/cachewraith/wraithgrid/releases/latest)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-2dd4bf?style=flat-square)](#install)

[Install](#install) · [Updates](#updates) · [Verify a download](#verify-a-download) · [Report a bug](#report-a-bug)

</div>

This repository holds Wraithgrid's **releases only**: installers, update files and release
notes. There is no source code here. The desktop app checks this repository for new versions.

## Install

Download the package for your system from the
[latest release](https://github.com/cachewraith/wraithgrid/releases/latest).

| System                          | Package                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| Ubuntu 22.04+, Debian 12+, Kali | `sudo apt install ./wraithgrid-<version>-amd64.deb`          |
| Fedora                          | `sudo dnf install ./wraithgrid-<version>-x86_64.rpm`         |
| Arch (and Hyprland on Arch)     | `sudo pacman -U ./wraithgrid-<version>-x64.pacman`           |
| Any Linux distro                | `chmod +x Wraithgrid-<version>-x86_64.AppImage`, then run it |
| Windows 10 (1809+) and 11       | `Wraithgrid-Setup-<version>-x64.exe`                         |
| macOS 12+, Apple Silicon        | `Wraithgrid-<version>-mac-arm64.dmg`, drag to Applications   |
| macOS 12+, Intel                | `Wraithgrid-<version>-mac-x64.dmg`, drag to Applications     |

On Linux or macOS, one line picks the right package, checks it against `SHA256SUMS.txt` and
installs it (`WRAITHGRID_DRY_RUN=1` only downloads and checks):

```sh
curl -fsSL https://raw.githubusercontent.com/cachewraith/wraithgrid/main/scripts/install.sh | sh
```

`WRAITHGRID_VERSION=1.26.0` installs a given release; `WRAITHGRID_FORMAT=appimage|deb|rpm|pacman`
forces a package type.

> [!NOTE]
> You also need the [`claude` CLI](https://docs.claude.com/en/docs/claude-code), or the CLI of
> any other agent you add (`gemini`, `agy`, `codex`, `opencode`, `cursor-agent`, `copilot`).
> Wraithgrid finds them on your `PATH`, or you can set their paths in **Settings**.

<details>
<summary><b>Platform notes</b></summary>

<br />

- **macOS, first launch.** The app is ad-hoc signed but not notarized, so Gatekeeper stops the
  first launch. Right-click **Wraithgrid** in Applications → **Open** → **Open**, or run
  `xattr -dr com.apple.quarantine /Applications/Wraithgrid.app`.
- **AppImage on Ubuntu 24.04+ and Kali.** AppArmor blocks the Chromium sandbox of unpackaged
  apps, so prefer the `.deb`. The AppImage also needs FUSE 2 (`libfuse2t64` on Ubuntu 24.04,
  `libfuse2` on Debian/Kali, `fuse-libs` on Fedora, `fuse2` on Arch).
- **Don't run it as root.** Chromium refuses to start as root without turning off its sandbox.
- **Windows.** Also available with `winget install cachewraith.Wraithgrid`.

</details>

## Updates

Wraithgrid tells you once when a new version is out. **Settings → About** downloads it, restarts
into it and keeps each version's release notes. On macOS it opens the release page instead,
since only Developer ID signed apps may replace themselves. You can turn the release check off
in Settings.

## Verify a download

Every release includes `SHA256SUMS.txt`:

```sh
sha256sum --ignore-missing -c SHA256SUMS.txt          # Linux
shasum -a 256 --ignore-missing -c SHA256SUMS.txt      # macOS
```

On Windows: `Get-FileHash .\Wraithgrid-Setup-<version>-x64.exe` and compare with the line in
`SHA256SUMS.txt`.

## Report a bug

[Open an issue](https://github.com/cachewraith/wraithgrid/issues/new/choose) here. Include
your Wraithgrid version (**Settings → About**), your system, and the steps that lead to the
problem. Please leave out tokens, keys and private paths.

## Privacy

No telemetry. The only network activity is links you open, the optional release check against
this repository, and features you turn on yourself.
