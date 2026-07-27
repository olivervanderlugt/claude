# Moving this into its own repository

This folder is fully self-contained — its own `package.json`, `.gitignore`,
`LICENSE`, `Dockerfile` and docs. Nothing outside `quizzly/` is referenced, so
lifting it out is a copy, not a refactor.

It lives inside another repository only because the automation that generated it
could not create a new GitHub repository on your behalf (the GitHub App returned
`403 Resource not accessible by integration` — it can push to existing repos but
not create new ones).

## ⚠️ This repository hosts more than one project

`quizzly/` is **not** the only thing here. There is a sibling project under
`percentile/` (a consent-first analytics data network) on its own branch, built
independently.

The two are fully isolated — different directories, different ports, different
CI, no shared files — and it must stay that way. Concretely:

- **Everything Quizzly owns is under `quizzly/`.** There are no Quizzly files at
  the repository root.
- **Do not delete the repository root, `percentile/`, or `.github/`** when
  extracting. The commands below only ever touch `quizzly/`.
- If you extract Quizzly and then want to tidy up, delete **only** the
  `quizzly/` directory — never the whole repo.

See "Staying out of each other's way" at the end for the details worth knowing
if you keep both here.

## The one-minute version

Create an empty repo on GitHub called `quizzly` — **without** a README,
`.gitignore` or licence, so there's nothing to merge — then:

```bash
# From the parent of this folder
cp -r quizzly ~/quizzly && cd ~/quizzly

git init
git add .
git commit -m "Initial commit: Quizzly"
git branch -M main
git remote add origin git@github.com:olivervanderlugt/quizzly.git
git push -u origin main
```

That's it. If you then want to tidy the parent repo, delete **only** the
`quizzly/` directory — `percentile/` and `.github/` belong to the other project.

## If you want to keep the commit history

The commits for this folder live on the branch
`claude/kahoot-quiz-platform-mvp-uol97e`. `git-filter-repo` can rewrite history
so `quizzly/` becomes the root:

```bash
git clone <parent-repo-url> quizzly-extract
cd quizzly-extract

# The Quizzly commits are NOT on the default branch — check the branch out first,
# or filter-repo will find nothing to keep and hand you an empty repository.
git checkout claude/kahoot-quiz-platform-mvp-uol97e

# pip install git-filter-repo
git filter-repo --subdirectory-filter quizzly

git remote add origin git@github.com:olivervanderlugt/quizzly.git
git push -u origin main
```

Two things to be careful about:

- **Work in a throwaway clone, and never push the rewritten history back to the
  parent repository.** `filter-repo` discards every commit that does not touch
  `quizzly/` — run against the parent's own remote, it would erase the other
  project's history.
- `filter-repo` refuses to run while a remote is still attached, which is why the
  clone is fresh and `origin` is re-added only at the end. That safety check is
  the thing standing between you and the previous bullet, so don't work around it.

## Staying out of each other's way

If you keep both projects in this repository, this is the current state — worth
preserving:

| | Quizzly | percentile |
|---|---|---|
| Directory | `quizzly/` | `percentile/` |
| Default port | 3000 | 8787 |
| Datastore | PostgreSQL (database `quizzly`) | in-memory |
| CI workflow | none | `.github/workflows/percentile-ci.yml`, scoped to `percentile/**` |
| Root-level files | none | none besides its own workflow |

The branches have **unrelated histories** (each starts from its own root commit),
so merging both into a default branch needs
`git merge --allow-unrelated-histories`. Because the two touch entirely disjoint
paths, that merge produces no content conflicts.

If you ever add CI for Quizzly, path-scope it the way `percentile-ci.yml` does
(`paths: ['quizzly/**']`) and give the file a distinct name. An unfiltered
workflow would fire on the other project's commits and report failures against
code it doesn't own.

The one environment variable both projects read is `PORT`. That is correct
behaviour — hosting platforms inject it — but it means you should not export a
single `PORT` into a shell where you intend to run both at once. Each project's
own `.env` lives in its own directory, so the normal path is unaffected.

## After the move

1. Copy `.env.example` to `.env` and generate the two secrets — see the README.
2. Set the security contact placeholder at the top of `SECURITY.md`.
3. Fill in the `[BRACKETED]` fields in `src/app/privacy/page.tsx` and
   `src/app/terms/page.tsx` before running it publicly, and delete the operator
   banners.
4. Read `docs/LEGAL.md` §4 if you plan to commercialise this in the US.
