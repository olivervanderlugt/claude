# Moving this into its own repository

This folder is fully self-contained — its own `package.json`, `.gitignore`,
`LICENSE`, `Dockerfile` and docs. Nothing outside `quizzly/` is referenced, so
lifting it out is a copy, not a refactor.

It lives inside another repository only because the automation that generated it
could not create a new GitHub repository on your behalf (the GitHub App returned
`403 Resource not accessible by integration` — it can push to existing repos but
not create new ones).

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

That's it. Then delete the `quizzly/` folder from the original repo if you don't
want it duplicated.

## If you want to keep the commit history

The commits for this folder live in the parent repository's history. To carry
them across, `git-filter-repo` rewrites history so `quizzly/` becomes the root:

```bash
git clone <parent-repo-url> quizzly-extract
cd quizzly-extract

# pip install git-filter-repo
git filter-repo --subdirectory-filter quizzly

git remote add origin git@github.com:olivervanderlugt/quizzly.git
git push -u origin main
```

`git filter-repo` refuses to run on a repo with a remote still attached, which
is why the clone is fresh and the remote is added afterwards.

## After the move

1. Copy `.env.example` to `.env` and generate the two secrets — see the README.
2. Set the security contact placeholder at the top of `SECURITY.md`.
3. Fill in the `[BRACKETED]` fields in `src/app/privacy/page.tsx` and
   `src/app/terms/page.tsx` before running it publicly, and delete the operator
   banners.
4. Read `docs/LEGAL.md` §4 if you plan to commercialise this in the US.
