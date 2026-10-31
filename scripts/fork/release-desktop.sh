#!/bin/sh
# Builds the fork's desktop app from origin/main and installs it as
# "T3 Code Fork" in ~/Applications, beside the official app. The bundle gets
# its own ID, data folder and keychain item, no URL schemes and no updater.
#
#   scripts/fork/release-desktop.sh [--ref <commit-ish>] [--force]
#   scripts/fork/release-desktop.sh --install-staged
#
#   --ref             build this commit instead of origin/main
#   --force           build even if the commit was already built
#   --install-staged  install a build left staged while the app ran; no build
#
# Builds run in a detached worktree, t3code-release, next to the main checkout.
# State lives in ~/.t3-fork/releases: last-built (commit), pending (a staged
# version waiting for the app to quit), previous (the bundle last replaced),
# build.log, and one folder per version.
#
# Exit codes:
#   0   installed, or already up to date
#   75  built and staged, but the fork app is running; quit it and run again,
#       or wait for the next scheduled run
#   other non-zero  the build, patch or install failed; see build.log
set -eu

app_name="T3 Code Fork"
bundle_id="com.tobygodat.t3code.fork"
fork_home="$HOME/.t3-fork"
releases="$fork_home/releases"
install_path="$HOME/Applications/$app_name.app"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
plist_buddy=/usr/libexec/PlistBuddy
staged_while_running=75

ref=origin/main
force=0
install_only=0
while [ $# -gt 0 ]; do
  case $1 in
    --ref) ref=$2; shift 2 ;;
    --force) force=1; shift ;;
    --install-staged) install_only=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 64 ;;
  esac
done

notify() {
  osascript -e "display notification \"$1\" with title \"$app_name\"" >/dev/null 2>&1 || true
}

fork_app_running() {
  ps -axo comm= | grep -qF "$install_path/"
}

mkdir -p "$releases"
if ! mkdir "$releases/.lock" 2>/dev/null; then
  holder=$(cat "$releases/.lock/pid" 2>/dev/null || echo "")
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    echo "Another release run ($holder) is in progress." >&2
    exit 1
  fi
  rm -rf "$releases/.lock"
  mkdir "$releases/.lock"
fi
echo $$ >"$releases/.lock/pid"
trap 'rm -rf "$releases/.lock"' EXIT

install_pending() {
  if [ ! -f "$releases/pending" ]; then
    echo "Nothing staged to install."
    return 0
  fi
  version=$(cat "$releases/pending")
  staged="$releases/$version/$app_name.app"
  if [ ! -d "$staged" ]; then
    # A run that stopped after moving the bundle into place.
    if [ -d "$install_path" ]; then
      rm -f "$releases/pending"
      echo "$app_name $version is already installed."
      return 0
    fi
    echo "Staged bundle $staged is missing." >&2
    exit 1
  fi
  if fork_app_running; then
    notify "$version is ready. Quit $app_name to install it."
    echo "Staged $app_name $version; it installs once $app_name quits."
    exit "$staged_while_running"
  fi
  rm -rf "$releases/previous"
  mkdir -p "$releases/previous" "$(dirname "$install_path")"
  if [ -d "$install_path" ]; then
    mv "$install_path" "$releases/previous/"
  fi
  mv "$staged" "$install_path"
  "$lsregister" -f "$install_path"
  rm -f "$releases/pending"
  notify "Installed $version."
  echo "Installed $app_name $version to $install_path."
}

prune_releases() {
  pending=$(cat "$releases/pending" 2>/dev/null || echo "")
  ls -dt "$releases"/*-preview.* 2>/dev/null | tail -n +3 | while IFS= read -r old; do
    [ "$(basename "$old")" = "$pending" ] || rm -rf "$old"
  done
}

if [ "$install_only" -eq 1 ]; then
  install_pending
  exit 0
fi

script_dir=$(cd "$(dirname "$0")" && pwd)
cd "$script_dir"
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
worktree="$(dirname "$(dirname "$common_dir")")/t3code-release"

git fetch --quiet origin main
commit=$(git rev-parse --verify "$ref^{commit}")
short=$(git rev-parse --short "$commit")

if [ "$force" -eq 0 ] && [ "$(cat "$releases/last-built" 2>/dev/null || echo "")" = "$commit" ]; then
  if [ -f "$releases/pending" ]; then
    install_pending
  else
    echo "$app_name is up to date with $ref ($short)."
  fi
  exit 0
fi

if [ -d "$worktree" ]; then
  git -C "$worktree" reset --quiet --hard
  git -C "$worktree" checkout --quiet --detach "$commit"
else
  git worktree add --quiet --detach "$worktree" "$commit"
fi

base_version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$worktree/apps/server/package.json")
[ -n "$base_version" ] || { echo "No version in apps/server/package.json." >&2; exit 1; }
today=$(date +%Y%m%d)
last_n=$(ls -d "$releases/$base_version-preview.$today."* 2>/dev/null | sed 's/.*\.//' | sort -n | tail -n 1)
version="$base_version-preview.$today.$((${last_n:-0} + 1))"

# vp comes from vite-plus; cargo from Homebrew's keg-only rustup.
[ -f "$HOME/.config/vite-plus/env" ] && . "$HOME/.config/vite-plus/env"
PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
export PATH

# The product name sets the bundle, executable and helper names, and the menu bar title.
desktop_package="$worktree/apps/desktop/package.json"
sed -i '' "s/^  \"productName\": \".*\"/  \"productName\": \"$app_name\"/" "$desktop_package"
grep -qF "\"productName\": \"$app_name\"" "$desktop_package" || {
  echo "Could not set productName in $desktop_package." >&2
  exit 1
}

echo "Building $app_name $version from $short. Log: $releases/build.log"
started=$(date +%s)
rm -rf "$worktree/release"
# Without an update repository the build writes no app-update.yml.
if ! (
  cd "$worktree" &&
    vp i --frozen-lockfile &&
    env -u GITHUB_REPOSITORY -u T3CODE_DESKTOP_UPDATE_REPOSITORY \
      vp run dist:desktop:artifact --platform mac --target zip --arch arm64 \
      --build-version "$version"
) >"$releases/build.log" 2>&1; then
  tail -n 40 "$releases/build.log" >&2
  notify "Build of $short failed. See $releases/build.log."
  exit 1
fi
# The build also rewrites package.json versions while it runs.
git -C "$worktree" reset --quiet --hard

zip=$(ls "$worktree"/release/*.zip)
tmp="$releases/.tmp-$version"
rm -rf "$releases"/.tmp-*
mkdir -p "$tmp"
ditto -x -k "$zip" "$tmp"
app="$tmp/$app_name.app"
[ -d "$app" ] || { echo "The build did not produce $app_name.app." >&2; exit 1; }

if [ -e "$app/Contents/Resources/app-update.yml" ]; then
  echo "The build contains app-update.yml, so it would auto-update. Refusing to install." >&2
  exit 1
fi

plist="$app/Contents/Info.plist"
"$plist_buddy" -c "Set :CFBundleIdentifier $bundle_id" "$plist"
"$plist_buddy" -c "Delete :CFBundleDisplayName" "$plist" 2>/dev/null || true
"$plist_buddy" -c "Add :CFBundleDisplayName string $app_name" "$plist"
# Leave t3code:// and web links to the official app.
"$plist_buddy" -c "Delete :CFBundleURLTypes" "$plist" 2>/dev/null || true
# Finder and Dock launches get no shell environment, only LSEnvironment.
"$plist_buddy" -c "Delete :LSEnvironment" "$plist" 2>/dev/null || true
"$plist_buddy" -c "Add :LSEnvironment dict" "$plist"
"$plist_buddy" -c "Add :LSEnvironment:T3CODE_HOME string $fork_home" "$plist"
"$plist_buddy" -c "Add :LSEnvironment:T3CODE_DISABLE_AUTO_UPDATE string 1" "$plist"
"$plist_buddy" -c "Add :LSEnvironment:T3CODE_DESKTOP_STAGE_LABEL string Fork" "$plist"

codesign --force --deep --sign - "$app" 2>>"$releases/build.log"
codesign --verify --deep --strict "$app"

echo "$commit" >"$tmp/commit"
rm -rf "${releases:?}/$version"
mv "$tmp" "$releases/$version"
echo "$version" >"$releases/pending"
echo "$commit" >"$releases/last-built"
echo "Built $version from $short in $(($(date +%s) - started))s ($(du -sh "$releases/$version/$app_name.app" | cut -f1))."

prune_releases
install_pending
