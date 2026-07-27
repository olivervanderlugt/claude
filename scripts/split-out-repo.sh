#!/usr/bin/env bash
#
# Move this project into its own GitHub repository.
#
# It was built inside an existing repo because the session that created it could not
# create new repositories (the GitHub app lacked the scope). The full history comes
# across — nothing is lost by having started here.
#
# Usage:
#   1. Create an empty repo at https://github.com/new  (suggested name: percentile)
#      Do NOT initialise it with a README, licence or .gitignore.
#   2. ./scripts/split-out-repo.sh git@github.com:<you>/percentile.git
#
set -euo pipefail

REMOTE="${1:-}"
BRANCH="${2:-main}"

if [[ -z "$REMOTE" ]]; then
  echo "usage: $0 <git-remote-url> [branch]" >&2
  echo "example: $0 git@github.com:olivervanderlugt/percentile.git" >&2
  exit 1
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

if git remote | grep -qx percentile; then
  echo "note: remote 'percentile' already exists, updating its URL"
  git remote set-url percentile "$REMOTE"
else
  git remote add percentile "$REMOTE"
fi

echo "Pushing $(git rev-parse --abbrev-ref HEAD) -> percentile/$BRANCH"
git push -u percentile "HEAD:$BRANCH"

cat <<EOF

Done. The project now lives at:
  $REMOTE

Next steps:
  - Set the new repo's default branch to '$BRANCH'
  - Add PERCENTILE_ROOT_SECRET to the repo's Actions secrets if CI ever needs it
  - git remote remove origin   # once you no longer want the original remote
EOF
