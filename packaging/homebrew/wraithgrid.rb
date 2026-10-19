# Homebrew cask for Wraithgrid. Version and hashes are written by scripts/update-packaging.sh
# from the release's SHA256SUMS.txt; publish by copying this file into a tap
# (e.g. cachewraith/homebrew-tap: Casks/wraithgrid.rb), then: brew install --cask cachewraith/tap/wraithgrid
cask "wraithgrid" do
  arch arm: "arm64", intel: "x64"

  version "1.8.0"
  sha256 arm:   "bc6b04eb3cb844c5da37fd087d8ac80b8197f25521df6fcfc174da8bf9787ba4",
         intel: "c1cfaa03e6d7b794adaffa2f599236a1d6b367f61add9580a1efdc8370f4007b"

  url "https://github.com/cachewraith/wraithgrid/releases/download/v#{version}/Wraithgrid-#{version}-mac-#{arch}.dmg"
  name "Wraithgrid"
  desc "Run many agent CLI sessions side by side, each with its own account"
  homepage "https://github.com/cachewraith/wraithgrid"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "Wraithgrid.app"

  zap trash: [
    "~/Library/Application Support/Wraithgrid",
    "~/Library/Logs/Wraithgrid",
    "~/Library/Preferences/dev.cachewraith.wraithgrid.plist",
  ]

  caveats <<~EOS
    Wraithgrid is ad-hoc signed and not notarized yet: the first launch asks for confirmation
    in System Settings → Privacy & Security. Accounts live in ~/.wraithgrid (not removed by zap).
  EOS
end
