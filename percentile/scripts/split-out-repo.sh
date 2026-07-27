#!/usr/bin/env bash
#
# Extract this project into its own GitHub repository.
#
# It was built inside an existing repo because the session that created it could not
# create new repositories (the GitHub app lacked the scope). That repo hosts more than
# one project, so this script uses `git subtree split` to extract ONLY the percentile/
# directory and its history — nothing belonging to any other project is carried across.
#
# Usage:
#   1. Create an empty repo at https://github.com/new  (suggested name: percentile)
#      Do NOT initialise it with a README, licence or .gitignore.
#   2. From the repository root:
#        ./percentile/scripts/split-out-repo.sh git@github.com:<you>/percentile.git
#
set -euo pipefail

REMOTE="${1:-}"
BRANCH="${2:-main}"
PREFIX="percentile"
TEMP_BRANCH="percentile-split-$$"

if [[ -z "$REMOTE" ]]; then
  echo "usage: $0 <git-remote-url> [branch]" >&2
  echo "example: $0 git@github.com:olivervanderlugt/percentile.git" >&2
  exit 1
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [[ ! -d "$PREFIX" ]]; then
  echo "error: no '$PREFIX' directory at repository root ($REPO_ROOT)" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty. Commit or stash first — subtree split needs a" >&2
  echo "       clean tree, and this repo may contain another project's work." >&2
  exit 1
fi

cleanup() {
  git branch -D "$TEMP_BRANCH" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Extracting '$PREFIX/' history into a standalone branch..."
git subtree split --prefix="$PREFIX" -b "$TEMP_BRANCH"

echo
echo "Extracted commits: $(git rev-list --count "$TEMP_BRANCH")"
echo "Top-level files in the extracted tree:"
git ls-tree --name-only "$TEMP_BRANCH" | sed 's/^/  /'
echo
read -r -p "Push this to $REMOTE as '$BRANCH'? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted. Nothing was pushed."
  exit 0
fi

if git remote | grep -qx percentile; then
  git remote set-url percentile "$REMOTE"
else
  git remote add percentile "$REMOTE"
fi

git push percentile "$TEMP_BRANCH:$BRANCH"

cat <<EOF

Done. The project now lives at:
  $REMOTE

Only percentile/ was pushed. Nothing from any other project in this repository was
included — verify with the file listing above.

Next steps:
  - Clone it fresh: git clone $REMOTE
  - Set the new repo's default branch to '$BRANCH'
  - git remote remove percentile   # tidy up this repo's remotes
EOF
