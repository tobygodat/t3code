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
- Exit 1: the merge conflicts. It lists the conflicted files and pushes nothing. To resolve by hand:

  ```sh
  git fetch upstream main
  git switch -c sync/upstream origin/main
  git merge upstream/main
  # fix conflicts, keeping upstream's behavior and the fork's look
  vp run check:changed
  git push -u origin sync/upstream
  gh pr create --repo tobygodat/t3code --base main
  ```

## Keeping conflicts rare

Every line the fork changes in an upstream file can conflict later. So:

- Put styling in new files where you can. For the web app, override the design tokens from `apps/web/src/index.css` in a fork-only stylesheet imported right after it in `apps/web/src/main.tsx`, rather than editing `index.css` in place.
- When you must edit an upstream component, keep the diff small and focused on the UI.
- Leave upstream docs such as `AGENTS.md` alone. Fork notes go here.
