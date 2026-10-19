# Packaging

Install channels beyond the release page. Every file here is filled in from a release's
`SHA256SUMS.txt`, never by hand:

```sh
scripts/update-packaging.sh 1.8.0   # after the v1.8.0 release is published
```

| Channel         | File                     | Publish                                                                                                                                                                                               |
| --------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One-line script | `scripts/install.sh`     | Nothing to publish: it reads the latest release and checks the download against `SHA256SUMS.txt`. `curl -fsSL https://raw.githubusercontent.com/cachewraith/wraithgrid/main/scripts/install.sh \| sh` |
| Homebrew        | `homebrew/wraithgrid.rb` | Copy to a tap repo (`cachewraith/homebrew-tap`, `Casks/wraithgrid.rb`). Users: `brew install --cask cachewraith/tap/wraithgrid`                                                                       |
| winget          | `winget/*.yaml`          | Open a PR to `microsoft/winget-pkgs` with the three files under `manifests/c/cachewraith/Wraithgrid/<version>/` (`wingetcreate submit`). Users: `winget install cachewraith.Wraithgrid`               |
| AUR             | `aur/PKGBUILD`           | `makepkg --printsrcinfo > .SRCINFO`, then push both to `ssh://aur@aur.archlinux.org/wraithgrid-bin.git`. Users: `yay -S wraithgrid-bin`                                                               |

Checked on 2026-10-19 against v1.8.0: the install script's download and checksum for every
Linux format (dry run), `makepkg` of the PKGBUILD on Arch, and `ruby -c` of the cask. The
Homebrew cask and winget manifests have not been installed on a Mac or Windows machine yet.
