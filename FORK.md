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

- By default it builds `origin/main`. It skips the build when the installed app, or a build staged to replace it, already carries that commit (`T3ForkCommit` in its `Info.plist`), so a deleted or replaced app gets rebuilt. `--ref <commit-ish>` builds another commit, and `--force` rebuilds.
- It refuses a commit that does not contain the commit completing the isolation code (`isolation_commit` in the script), and checks the built `app.asar` for `T3CODE_DESKTOP_STAGE_LABEL` and `desktop-env.json`. If the branch that added that code is rebased or squashed before it reaches `main`, update `isolation_commit`, or every build is refused.
- It builds in a detached `t3code-release` worktree next to the main checkout. It marks a worktree it creates with a `t3-fork-release` file in that worktree's git dir, and refuses any existing worktree without the marker or with a branch checked out, so it never resets someone else's work. Before it resets the worktree, it exits 73 if any process still has its working directory there.
- It patches the bundle: its own bundle ID, no URL schemes or document types, and `Contents/Resources/desktop-env.json`, which sets the T3 home, turns off updates and sets `T3CODE_DESKTOP_STAGE_LABEL=Fork`. The packaged app reads that file at startup however it is launched, even when its executable is run directly. Its three values replace inherited ones, and it ignores any other name. If the file cannot be read or parsed, the app shows an error and quits rather than start with the official app's home and keychain item. The build itself uses the product name T3 Code Fork, so the bundle, its helpers and the menu bar carry that name.
- While T3 Code Fork runs, the new build waits in `~/.t3-fork/releases` and the script exits 75. Quit the app and run `scripts/fork/release-desktop.sh --install-staged`, or let the next run install it. The bundle it replaced stays in `~/.t3-fork/releases/previous`. While a copy runs from there, the script fails before building, because that copy blocks the swap.
- One run at a time: the script runs itself under `lockf` on `~/.t3-fork/releases/.release.lock`, which the kernel releases when the run ends or dies.
- Exit 0 means installed or already up to date, 64 bad arguments, 73 another run holds the lock or a process still works in the release worktree, and 75 staged. Any other code is a failure and posts a notification; `~/.t3-fork/releases/build.log` has the build output.

Run it on a schedule, such as a T3 Code scheduled task after the morning upstream sync. Each run fetches `origin/main` and posts a macOS notification when it installs or stages a build, or fails.

### Signing

By default each build gets a new ad-hoc signature, so macOS treats every rebuild as a new app: it asks again for the "T3 Code Fork Safe Storage" keychain item and for privacy permissions. To stop that, run `scripts/fork/create-signing-identity.sh` once. It makes a self-signed code-signing identity in its own keychain under `~/.t3-fork/signing`, and later builds sign with it, so their designated requirement stays the same. It needs no admin rights and leaves the login keychain and the keychain search list alone. The first build signed this way asks for the keychain item one last time; choose Always Allow.

The keychain's random password sits beside it in `keychain-password`, readable only by you (mode 0600). The release script unlocks the keychain to sign and locks it again straight after. If a run dies mid-sign, the keychain stays unlocked until you log out. Delete `~/.t3-fork/signing` to go back to ad-hoc signatures.

What to expect:

- Without the signing identity, macOS may ask for permissions again after each rebuild.
- `t3code://` links and sign-in callbacks open the official app, so cloud sign-in does not work in the fork app.
- SSH remote environments may fail. The remote side downloads the T3 server archive for the app's version, and the fork's preview versions have no published archive.
- It never updates itself. New builds come only from this script.
- Settings > About shows the official app's `t3` command as another app's and leaves it alone. The fork's own launcher is `~/.t3-fork/bin/t3`.
- Never run `t3 service install` from the fork. The background service shares the official app's launchd label, `com.t3tools.t3code.service`, so it would replace the official service.
- `open` passes your shell's environment to the app. From a shell inside T3 Code that includes `ELECTRON_RUN_AS_NODE`, so the app runs as plain Node and quits at once. Launch it from the Dock or Finder, or with `env -i HOME="$HOME" open -a "T3 Code Fork"`.

## Keeping conflicts rare

Every line the fork changes in an upstream file can conflict later. So:

- Put styling in new files where you can. For the web app, override the design tokens from `apps/web/src/index.css` in a fork-only stylesheet imported right after it in `apps/web/src/main.tsx`, rather than editing `index.css` in place.
- When you must edit an upstream component, keep the diff small and focused on the UI.
- Leave upstream docs such as `AGENTS.md` alone. Fork notes go here.
