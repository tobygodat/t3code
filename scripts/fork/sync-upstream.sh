#!/bin/sh
# Merges pingdotgg/t3code main into this fork's main on GitHub. Works on refs
# only, so it never touches the working tree or the branch you have checked out.
#
#   scripts/fork/sync-upstream.sh
#
# Exit codes:
#   0  already up to date, or upstream merged and pushed to origin/main
#   2  the merge conflicts; the conflicted paths go to stderr and nothing is pushed
#   other non-zero  git failed, for example a fetch error or a push rejected
#                   because origin/main moved during the run; retry
set -eu

upstream_url="https://github.com/pingdotgg/t3code.git"

cd "$(git rev-parse --show-toplevel)"

if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream "$upstream_url"
  git config remote.upstream.fetch "+refs/heads/main:refs/remotes/upstream/main"
fi

git fetch --quiet origin main
git fetch --quiet upstream main

ours=$(git rev-parse origin/main)
theirs=$(git rev-parse upstream/main)
theirs_short=$(git rev-parse --short "$theirs")

if git merge-base --is-ancestor "$theirs" "$ours"; then
  echo "Already up to date with upstream ($theirs_short)."
  exit 0
fi

count=$(git rev-list --count "$ours..$theirs")

if git merge-base --is-ancestor "$ours" "$theirs"; then
  # The fork has no commits of its own past upstream, so fast-forward.
  merged=$theirs
else
  # merge-tree exits 1 on conflicts and above 1 on errors.
  status=0
  result=$(git merge-tree --write-tree --name-only --no-messages "$ours" "$theirs") || status=$?
  if [ "$status" -eq 1 ]; then
    echo "Merging upstream $theirs_short conflicts in:" >&2
    echo "$result" | tail -n +2 >&2
    exit 2
  elif [ "$status" -ne 0 ]; then
    exit "$status"
  fi
  merged=$(git commit-tree "$result" -p "$ours" -p "$theirs" \
    -m "Merge upstream pingdotgg/t3code main ($theirs_short)")
fi

# A plain push, so this fails instead of clobbering origin/main if it moved.
git push --quiet origin "$merged:refs/heads/main"
echo "Pulled $count upstream commits into origin/main ($(git rev-parse --short "$merged"))."
