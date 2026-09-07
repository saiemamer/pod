cask "pod" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  # Why no_check for now: Pod's Homebrew tap and checksum bump land in Phase 4;
  # until then install from the DMG on the releases page.
  sha256 :no_check

  url "https://github.com/saiemamer/pod/releases/download/v#{version}/pod-macos-#{arch}.dmg",
      verified: "github.com/saiemamer/pod/"
  name "Pod"
  desc "Analytics-engineering IDE (dbt, Omni, cross-repo agent initiatives) forked from Orca"
  homepage "https://github.com/saiemamer/pod"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Why: electron-updater replaces Pod.app in place; brew upgrade must not compete.
  auto_updates true
  conflicts_with cask: ["orca", "orca@rc"]
  depends_on macos: :big_sur

  app "Pod.app"
  binary "#{appdir}/Pod.app/Contents/Resources/bin/orca"

  zap trash: [
    "~/.orca",
    "~/Library/Application Support/Pod",
    "~/Library/Caches/io.github.saiemamer.pod",
    "~/Library/Caches/io.github.saiemamer.pod.ShipIt",
    "~/Library/HTTPStorages/io.github.saiemamer.pod",
    "~/Library/Preferences/io.github.saiemamer.pod.plist",
    "~/Library/Saved Application State/io.github.saiemamer.pod.savedState",
  ]
end
