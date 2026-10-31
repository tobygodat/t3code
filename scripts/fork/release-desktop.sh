#!/bin/sh
# Builds the fork's desktop app from origin/main and installs it as
# "T3 Code Fork" in ~/Applications, beside the official app. The bundle gets
# its own ID, data folder and keychain item, no URL schemes and no updater.
#
#   scripts/fork/release-desktop.sh [--ref <commit-ish>] [--force]
#   scripts/fork/release-desktop.sh --install-staged
#
#   --ref             build this commit instead of origin/main
#   --force           build even if the installed or staged app is that commit
#   --install-staged  install a build left staged while the app ran; no build
#
# Builds run in a detached worktree, t3code-release, next to the main checkout
# (T3_FORK_RELEASE_WORKTREE overrides the path). State lives in
# ~/.t3-fork/releases: pending (a staged version waiting for the app to quit),
# previous (the bundle last replaced), build.log, and one folder per version.
# Each bundle records its commit as T3ForkCommit in Info.plist.
#
# Signing uses the identity from scripts/fork/create-signing-identity.sh when
# it exists, and an ad-hoc signature otherwise.
#
# Exit codes:
#   0   installed, or already up to date
#   64  bad arguments
#   73  another release run holds the lock, or a process still works in the
#       release worktree; nothing was done
#   75  built and staged, but the fork app is running; quit it and run again,
#       or wait for the next scheduled run
#   1   anything else failed; see build.log. Every exit other than 0, 73 and 75
#       posts a macOS notification.
set -eu

app_name="T3 Code Fork"
bundle_id="com.tobygodat.t3code.fork"
fork_home="$HOME/.t3-fork"
releases="$fork_home/releases"
install_path="$HOME/Applications/$app_name.app"
swap_old="$releases/.swap-old.app"
signing_dir="$fork_home/signing"
signing_identity="T3 Code Fork Local Signing"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
plist_buddy=/usr/libexec/PlistBuddy
exit_usage=64
exit_busy=73
exit_staged=75
# lockf exits 75 when the lock is busy, so the locked run reports staged as 76 and the wrapper maps it back.
exit_lock_busy=75
exit_staged_locked=76

notify() {
  osascript -e "display notification \"$1\" with title \"$app_name\"" >/dev/null 2>&1 || true
}

die() {
  echo "$1" >&2
  exit 1
}

on_exit() {
  status=$?
  case $status in
    0 | "$exit_busy" | "$exit_staged_locked") ;;
    *) notify "Release failed (exit $status). See $releases/build.log." ;;
  esac
}

# The kernel drops the lock when its holder exits or dies, so a killed run never blocks the next.
if [ "${T3_FORK_RELEASE_LOCKED:-}" != 1 ]; then
  mkdir -p "$releases"
  status=0
  T3_FORK_RELEASE_LOCKED=1 /usr/bin/lockf -s -k -t 0 "$releases/.release.lock" /bin/sh "$0" "$@" ||
    status=$?
  case $status in
    "$exit_lock_busy")
      echo "Another release run is in progress." >&2
      exit "$exit_busy"
      ;;
    "$exit_staged_locked") exit "$exit_staged" ;;
    *) exit "$status" ;;
  esac
fi

usage() {
  echo "Usage: $0 [--ref <commit-ish>] [--force] | --install-staged" >&2
  exit "$exit_usage"
}

ref=origin/main
force=0
install_only=0
while [ $# -gt 0 ]; do
  case $1 in
    --ref)
      [ $# -ge 2 ] && [ -n "$2" ] && [ "${2#-}" = "$2" ] || usage
      ref=$2
      shift 2
      ;;
    --force) force=1; shift ;;
    --install-staged) install_only=1; shift ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

trap on_exit EXIT
trap 'exit 130' INT TERM HUP

running_from() {
  ps -axo comm= | grep -qF "$1/"
}

fork_app_running() {
  running_from "$install_path" || running_from "$releases"
}

bundle_commit() {
  "$plist_buddy" -c "Print :T3ForkCommit" "$1/Contents/Info.plist" 2>/dev/null || true
}

# A swap that stopped between its two renames leaves the old bundle in swap_old.
recover_swap() {
  [ -d "$swap_old" ] || return 0
  if [ -d "$install_path" ]; then
    retire_to_previous
  else
    mv "$swap_old" "$install_path"
  fi
}

retire_to_previous() {
  if running_from "$releases/previous"; then
    echo "A copy of $app_name runs from $releases/previous; keeping the old bundle in $swap_old." >&2
    return 0
  fi
  rm -rf "$releases/previous"
  mkdir -p "$releases/previous"
  mv "$swap_old" "$releases/previous/$app_name.app"
}

install_pending() {
  if [ ! -f "$releases/pending" ]; then
    echo "Nothing staged to install."
    return 0
  fi
  version=$(cat "$releases/pending")
  staged="$releases/$version/$app_name.app"
  if [ ! -d "$staged" ]; then
    staged_commit=$(cat "$releases/$version/commit" 2>/dev/null || true)
    if [ -n "$staged_commit" ] && [ "$(bundle_commit "$install_path")" = "$staged_commit" ]; then
      rm -f "$releases/pending"
      echo "$app_name $version is already installed."
      return 0
    fi
    die "Staged bundle $staged is missing."
  fi
  if fork_app_running; then
    notify "$version is ready. Quit $app_name to install it."
    echo "Staged $app_name $version; it installs once every copy of $app_name quits."
    exit "$exit_staged_locked"
  fi
  [ ! -e "$swap_old" ] || die "$swap_old is still in use; leaving $version staged."
  mkdir -p "$(dirname "$install_path")"
  if [ -d "$install_path" ]; then
    mv "$install_path" "$swap_old"
  fi
  if ! mv "$staged" "$install_path"; then
    [ ! -d "$swap_old" ] || mv "$swap_old" "$install_path"
    die "Could not move $staged into place; restored the previous install."
  fi
  [ ! -d "$swap_old" ] || retire_to_previous
  "$lsregister" -f "$install_path"
  rm -f "$releases/pending"
  notify "Installed $version."
  echo "Installed $app_name $version to $install_path."
}

prune_releases() {
  pending=$(cat "$releases/pending" 2>/dev/null || true)
  ls -dt "$releases"/*-preview.* 2>/dev/null | tail -n +3 | while IFS= read -r old; do
    [ "$(basename "$old")" != "$pending" ] || continue
    running_from "$old" || rm -rf "$old"
  done
}

recover_swap

if [ "$install_only" -eq 1 ]; then
  install_pending
  exit 0
fi

script_dir=$(cd "$(dirname "$0")" && pwd -P)
common_dir=$(git -C "$script_dir" rev-parse --path-format=absolute --git-common-dir)
default_worktree="$(dirname "$(dirname "$common_dir")")/t3code-release"
worktree=${T3_FORK_RELEASE_WORKTREE:-$default_worktree}

# Marks a worktree this script created, so it never resets someone else's.
release_marker() {
  echo "$(git -C "$1" rev-parse --path-format=absolute --git-dir)/t3-fork-release"
}

refuse() {
  die "$1 Refusing to build."
}

if [ -e "$worktree" ]; then
  worktree=$(cd "$worktree" && pwd -P)
  case "$script_dir/" in
    "$worktree"/*) refuse "This script runs from inside the release worktree $worktree." ;;
  esac
  [ "$(git -C "$worktree" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" = "$common_dir" ] ||
    refuse "$worktree is not a worktree of $(dirname "$common_dir")."
  [ "$(git -C "$worktree" rev-parse --show-toplevel)" = "$worktree" ] ||
    refuse "$worktree is inside another checkout, not a worktree of its own."
  [ "$(git -C "$worktree" rev-parse --path-format=absolute --git-dir)" != "$common_dir" ] ||
    refuse "$worktree is the main checkout."
  ! git -C "$worktree" symbolic-ref -q HEAD >/dev/null ||
    refuse "$worktree has a branch checked out, and the release worktree is always detached."
  marker=$(release_marker "$worktree")
  if [ ! -f "$marker" ]; then
    # Release worktrees made before the marker existed sit at the default path, detached and clean.
    [ "$worktree" = "$(cd "$default_worktree" 2>/dev/null && pwd -P)" ] &&
      [ -z "$(git -C "$worktree" status --porcelain)" ] ||
      refuse "$worktree was not created by this script (no $marker)."
    echo "Marking $worktree as the release worktree." >&2
    : >"$marker"
  fi
fi

git -C "$script_dir" fetch --quiet origin main
commit=$(git -C "$script_dir" rev-parse --verify --quiet "$ref^{commit}") || refuse "Unknown ref $ref."
short=$(git -C "$script_dir" rev-parse --short "$commit")

# The commit that completes the fork's isolation code; without it, the build would share the
# official app's T3 home and keychain item. Update it if its branch is rebased or squashed
# before it reaches main.
isolation_commit=3952dc1910ffd5f7ee0d233f69fcf45742aade79
git -C "$script_dir" merge-base --is-ancestor "$isolation_commit" "$commit" ||
  refuse "$ref ($short) does not contain the fork's isolation code ($isolation_commit)."

if [ "$force" -eq 0 ]; then
  pending=$(cat "$releases/pending" 2>/dev/null || true)
  if [ -n "$pending" ] && [ "$(bundle_commit "$releases/$pending/$app_name.app")" = "$commit" ]; then
    install_pending
    exit 0
  fi
  if [ "$(bundle_commit "$install_path")" = "$commit" ]; then
    rm -f "$releases/pending"
    echo "$app_name is up to date with $ref ($short)."
    exit 0
  fi
fi

if [ -d "$worktree" ]; then
  # A build left running by a killed run still works here; resetting under it would break both.
  users=$(lsof -a -d cwd -Fpn 2>/dev/null | awk -v dir="$worktree" '
    /^p/ { pid = substr($0, 2) }
    /^n/ { path = substr($0, 2); if (path == dir || index(path, dir "/") == 1) print pid }')
  if [ -n "$users" ]; then
    echo "Processes $(echo $users) still work in $worktree. Let them finish, or stop them." >&2
    exit "$exit_busy"
  fi
  git -C "$worktree" reset --quiet --hard
  git -C "$worktree" checkout --quiet --detach "$commit"
else
  git -C "$script_dir" worktree prune
  git -C "$script_dir" worktree add --quiet --detach "$worktree" "$commit"
  : >"$(release_marker "$worktree")"
fi
# The desktop build's own lock. Nothing works in the worktree, so any left behind is stale.
rm -rf "$worktree/.desktop-build.lock"

base_version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$worktree/apps/server/package.json")
[ -n "$base_version" ] || refuse "No version in apps/server/package.json."
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
grep -qF "\"productName\": \"$app_name\"" "$desktop_package" ||
  refuse "Could not set productName in $desktop_package."

echo "Building $app_name $version from $short. Log: $releases/build.log"
started=$(date +%s)
rm -rf "$worktree/release"
# A caller's T3CODE_DESKTOP_* or GITHUB_REPOSITORY would leak into the build; without an update
# repository the build writes no app-update.yml.
if ! (
  for name in $(env | sed -n 's/^\(T3CODE_DESKTOP_[A-Za-z0-9_]*\)=.*/\1/p'); do
    unset "$name"
  done
  unset GITHUB_REPOSITORY
  cd "$worktree" &&
    vp i --frozen-lockfile &&
    vp run dist:desktop:artifact --platform mac --target zip --arch arm64 \
      --build-version "$version"
) >"$releases/build.log" 2>&1; then
  tail -n 40 "$releases/build.log" >&2
  echo "Build of $short failed." >&2
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
[ -d "$app" ] || refuse "The build did not produce $app_name.app."

[ ! -e "$app/Contents/Resources/app-update.yml" ] ||
  refuse "The build contains app-update.yml, so it would auto-update."
for marker in T3CODE_DESKTOP_STAGE_LABEL desktop-env.json; do
  grep -qaF "$marker" "$app/Contents/Resources/app.asar" ||
    refuse "The built app.asar lacks the fork's isolation code ($marker)."
done

# Read by apps/desktop/src/app/DesktopBundleEnvironment.ts on every launch, however it starts.
# plutil escapes the values, so any home path makes valid JSON.
env_plist="$tmp/desktop-env.plist"
plutil -create xml1 "$env_plist"
plutil -insert T3CODE_HOME -string "$fork_home" "$env_plist"
plutil -insert T3CODE_DISABLE_AUTO_UPDATE -string 1 "$env_plist"
plutil -insert T3CODE_DESKTOP_STAGE_LABEL -string Fork "$env_plist"
plutil -convert json -r -o "$app/Contents/Resources/desktop-env.json" "$env_plist"
rm "$env_plist"

plist="$app/Contents/Info.plist"
"$plist_buddy" -c "Set :CFBundleIdentifier $bundle_id" "$plist"
"$plist_buddy" -c "Delete :CFBundleDisplayName" "$plist" 2>/dev/null || true
"$plist_buddy" -c "Add :CFBundleDisplayName string $app_name" "$plist"
# Leave t3code:// links, web links and opening HTML files to the official app.
"$plist_buddy" -c "Delete :CFBundleURLTypes" "$plist" 2>/dev/null || true
"$plist_buddy" -c "Delete :CFBundleDocumentTypes" "$plist" 2>/dev/null || true
"$plist_buddy" -c "Delete :LSEnvironment" "$plist" 2>/dev/null || true
"$plist_buddy" -c "Add :T3ForkCommit string $commit" "$plist"

signing_keychain="$signing_dir/signing.keychain-db"
if [ -f "$signing_dir/keychain-password" ]; then
  security unlock-keychain -p "$(cat "$signing_dir/keychain-password")" "$signing_keychain"
  codesign --force --deep --keychain "$signing_keychain" --sign "$signing_identity" "$app" \
    2>>"$releases/build.log"
else
  codesign --force --deep --sign - "$app" 2>>"$releases/build.log"
fi
codesign --verify --deep --strict "$app"

echo "$commit" >"$tmp/commit"
rm -rf "${releases:?}/$version"
mv "$tmp" "$releases/$version"
echo "$version" >"$releases/pending"
echo "Built $version from $short in $(($(date +%s) - started))s ($(du -sh "$releases/$version/$app_name.app" | cut -f1))."

prune_releases
install_pending
