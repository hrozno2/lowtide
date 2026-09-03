# Drafted here as source-of-truth; meant to be copied into a *separate*
# personal tap repo (e.g. github.com/hrozno2/homebrew-lowtide, as
# Casks/lowtide.rb) rather than submitted to the official homebrew-cask
# repo — that repo's audit bar generally expects a signed/notarized app,
# which this build isn't (see build/after-pack.js). Creating the tap repo
# is a manual step; this file is ready to drop in once it exists.
#
# Bumping a release: update version and both sha256s (`shasum -a 256 <file>`
# against the arm64 and x64 dmg's actually uploaded to that release).

cask "lowtide" do
  arch arm: "arm64", intel: "x64"

  version "1.0.7"
  # TODO: replace with `shasum -a 256` of the actual released dmg for each
  # arch before this cask is installable — left as an obvious placeholder
  # rather than :no_check, which would silently skip integrity verification.
  sha256 arm:   "0000000000000000000000000000000000000000000000000000000000000000",
         intel: "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/hrozno2/lowtide/releases/download/v#{version}/LowTide-#{version}-mac-#{arch}.dmg"
  name "Low Tide"
  desc "A fast, minimal novel writing app"
  homepage "https://github.com/hrozno2/lowtide"

  app "Low Tide.app"

  # Not notarized: without this, Gatekeeper quarantines the app and the first
  # launch just silently refuses to open instead of showing the usual
  # right-click-Open prompt caveat callers expect from an unsigned app.
  postflight do
    system_command "/usr/bin/xattr",
                    args: ["-dr", "com.apple.quarantine", "#{appdir}/Low Tide.app"],
                    sudo: false
  end

  caveats <<~EOS
    Low Tide isn't notarized by Apple. This cask clears the quarantine flag
    for you, but if macOS still refuses to open it, right-click the app in
    Applications and choose Open once.
  EOS

  zap trash: [
    "~/Library/Application Support/Low Tide",
    "~/Library/Preferences/com.lowtide.writer.plist",
    "~/Library/Saved Application State/com.lowtide.writer.savedState"
  ]
end
