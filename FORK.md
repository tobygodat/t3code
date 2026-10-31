# Fork notes

This is Toby's fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code), kept for UI changes. Upstream features keep flowing in; the fork's own commits sit on top.

## Branches and remotes

- `origin` is `tobygodat/t3code`. `upstream` is `pingdotgg/t3code`, fetching only `main`.
- `main` is upstream `main` plus the fork's changes. Upstream is merged in, never rebased, so `main` is never force-pushed.
- Fork changes land on `main` through PRs within this repo. Open them with `--repo tobygodat/t3code` so they never target upstream.
- GitHub Actions are off for this fork. Upstream's workflows are built for pingdotgg, so they would only fail or spam here. Run `vp run check:changed` before you push.

## Syncing with upstream

`scripts/fork/sync-upstream.sh` fetches upstream and merges it into `origin/main`. It works on refs only, so your checkout and current branch stay as they are. A T3 Code scheduled task runs it every morning.

- Exit 0: already up to date, or the merge was pushed. Run `git pull` on your local `main` to catch up.
- Exit 2: the merge conflicts. It lists the conflicted files and pushes nothing. To resolve by hand:

  ```sh
  git fetch upstream main
  git switch -c sync/upstream origin/main
  git merge upstream/main
  # fix conflicts, keeping upstream's behavior and the fork's look
  vp run check:changed
  git push -u origin sync/upstream
  gh pr create --repo tobygodat/t3code --base main
  ```

- Any other non-zero exit: git itself failed, such as a fetch error or a push rejected because `origin/main` moved mid-run. Run it again.

## The fork as a desktop app

The fork installs as **T3 Code Fork** (`~/Applications/T3 Code Fork.app`, bundle ID `com.tobygodat.t3code.fork`) and runs beside the official app. It keeps its T3 home in `~/.t3-fork` and its Electron profile in `~/Library/Application Support/t3code-fork`, so it shares no threads, settings or keychain item with the official install.

`scripts/fork/release-desktop.sh` builds and installs it. It needs Rust, which the desktop build compiles its resource monitor with: `brew install rustup`, then `rustup default stable`.

- By default it builds `origin/main`, and skips the build when that commit was already built. `--ref <commit-ish>` builds another commit, and `--force` rebuilds.
- It builds in a detached `t3code-release` worktree next to the main checkout, then patches the bundle: its own bundle ID, no URL schemes, `LSEnvironment` that sets the data folder, turns off updates and sets `T3CODE_DESKTOP_STAGE_LABEL=Fork`, then an ad-hoc signature.
- While T3 Code Fork runs, the new build waits in `~/.t3-fork/releases` and the script exits 75. Quit the app and run `scripts/fork/release-desktop.sh --install-staged`, or let the next run install it. The bundle it replaced stays in `~/.t3-fork/releases/previous`.
- Exit 0 means installed or already up to date. Any other code is a failure; `~/.t3-fork/releases/build.log` has the build output.

Run it on a schedule, such as a T3 Code scheduled task after the morning upstream sync. Each run fetches `origin/main` and posts a macOS notification when it installs or stages a build.

What to expect:

- macOS may ask for permissions again after each rebuild, because each ad-hoc signature is new.
- `t3code://` links and sign-in callbacks open the official app, so cloud sign-in does not work in the fork app.
- It never updates itself. New builds come only from this script.

## Keeping conflicts rare

Every line the fork changes in an upstream file can conflict later. So:

- Put styling in new files where you can. For the web app, override the design tokens from `apps/web/src/index.css` in a fork-only stylesheet imported right after it in `apps/web/src/main.tsx`, rather than editing `index.css` in place.
- When you must edit an upstream component, keep the diff small and focused on the UI.
- Leave upstream docs such as `AGENTS.md` alone. Fork notes go here.
