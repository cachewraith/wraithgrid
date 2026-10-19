# Homebrew cask for Wraithgrid. Version and hashes are written by scripts/update-packaging.sh
# from the release's SHA256SUMS.txt; publish by copying this file into a tap
# (e.g. cachewraith/homebrew-tap: Casks/wraithgrid.rb), then: brew install --cask cachewraith/tap/wraithgrid
cask "wraithgrid" do
  arch arm: "arm64", intel: "x64"

  version "1.9.0"
  sha256 arm:   "563fd6d535ebd86579e621f223b4d024d99406becc830871e78d136c47860ee4",
         intel: "e5b3c2e97608f3df895d03cae495c503e92eddada9013527894ec53bc403f801"

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
