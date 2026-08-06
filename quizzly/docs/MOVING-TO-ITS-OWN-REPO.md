# Move Quizzly into its own repo

Quizzly was built inside a shared repository, in a `quizzly/` subdirectory
alongside an unrelated project. This is how it was moved out — with its history
intact, and without carrying anything belonging to the other project.

Copy each block, paste it into Terminal, press enter.

---

## 1. Create the empty repo

Go to <https://github.com/new>.

- **Repository name:** `quizzly`
- Leave **Add a README**, **.gitignore** and **licence** all **unticked**

This project already has all three. Ticking them creates a conflict on the first
push.

---

## 2. Make sure GitHub will accept the push

The clone you are working from may be authenticated with a *deploy key* — a key
scoped to one repository. It will refuse to push to a different one:

```
ERROR: Permission to olivervanderlugt/quizzly.git denied to deploy key
```

Check what GitHub thinks you are:

```bash
ssh -T git@github.com
```

If it greets a **repository** (`Hi olivervanderlugt/claude!`) rather than your
**account** (`Hi olivervanderlugt!`), fix it with an account-level key:

```bash
ssh-keygen -t ed25519 -C "your@email.com" -f ~/.ssh/id_ed25519_github -N ""
cat >> ~/.ssh/config <<'EOF'

Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
pbcopy < ~/.ssh/id_ed25519_github.pub
```

`IdentitiesOnly yes` is the line that actually fixes it. Without it SSH keeps
offering the deploy key first and GitHub keeps rejecting it.

The public key is now on your clipboard. Paste it at
<https://github.com/settings/ssh/new>, give it any title, click **Add SSH key**.

Verify before going further — this must name your account:

```bash
ssh -T git@github.com
```

---

## 3. Split the subdirectory out, with its history

`git subtree split` rewrites the commits that touched `quizzly/` into a new
branch where `quizzly/` is the root. Commits that never touched it — including
every commit belonging to the other project — are not carried across.

```bash
git clone https://github.com/olivervanderlugt/claude.git /tmp/quizzly-migrate
cd /tmp/quizzly-migrate
git checkout claude/kahoot-quiz-platform-mvp-uol97e
git subtree split --prefix=quizzly -b quizzly-main
git checkout quizzly-main
```

Look before you push:

```bash
ls -A
git rev-list --count HEAD
```

You should see this project's files at the top level — `package.json`, `src`,
`server`, `prisma`, `CLAUDE.md`, `.github` — and **no** other project's
directory. If anything unexpected is there, stop.

---

## 4. Push it

```bash
git remote add quizzly git@github.com:olivervanderlugt/quizzly.git
git push quizzly quizzly-main:main
```

`quizzly-main:main` names the destination branch explicitly, so the local
working name doesn't matter.

---

## 5. Check it from a fresh clone

Not the folder you just pushed from — a clean one, the way a new collaborator
gets it:

```bash
git clone git@github.com:olivervanderlugt/quizzly.git ~/quizzly
cd ~/quizzly
npm ci && npm run typecheck && npm test && npm run build
```

Then open the repo's **Actions** tab. CI runs automatically on the push:
`.github/workflows/ci.yml` is now at the repository root, which is the only
place GitHub reads workflows from.

---

## 6. Create your secrets and run it

```bash
cd ~/quizzly
grep -v '^SESSION_SECRET=\|^ENCRYPTION_KEY=' .env.example > .env
printf 'SESSION_SECRET=%s\nENCRYPTION_KEY=%s\n' \
  "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" >> .env
```

`.env` is gitignored and never committed, which is why you generate your own.
The app checks these at startup and refuses to boot if they are missing or still
set to the placeholder — that is deliberate.

Needs Docker Desktop running (<https://docker.com>):

```bash
docker compose up --build
```

Wait for `Quizzly ready on http://localhost:3000`, then in a **second terminal**:

```bash
cd ~/quizzly
docker compose exec app npm run db:seed
```

Open <http://localhost:3000> and sign in:

- **Email:** `demo@quizzly.local`
- **Password:** `demo-password-123`

You get a quiz using all ten question types. Click **Host**, then open the site
on your phone and enter the PIN.

To stop: `Ctrl-C`, then `docker compose down`.

---

## 7. Remove the original — only once the new repo works

The old copy stays where it is until you have confirmed the new repo builds and
runs. When you have:

```bash
cd /tmp/quizzly-migrate
git checkout claude/kahoot-quiz-platform-mvp-uol97e
git rm -r --quiet quizzly
git commit -m "Remove quizzly — migrated to its own repository"
git push origin claude/kahoot-quiz-platform-mvp-uol97e
```

This deletes **only** the `quizzly/` directory. The other project and the shared
repository's own `.github/` are untouched. Do not delete the repository itself.

---

## What's next

Open the folder in VS Code and start a Claude Code session there:

```bash
code ~/quizzly
```

`CLAUDE.md` at the root tells Claude how to run the project and which invariants
not to break, so a fresh session starts oriented.

Three things are worth doing before anyone else uses this, in priority order:

1. **Add a password reset flow.** There isn't one — a forgotten password
   currently means a lost account. Needs an email provider.
2. **Add a nickname filter.** A nickname box in a classroom gets misused. Hosts
   can remove players mid-game, but nothing is filtered automatically.
3. **Fill in the legal pages.** `src/app/privacy/page.tsx` and
   `src/app/terms/page.tsx` have `[BRACKETED]` placeholders and an orange
   banner. Replace the placeholders, delete the banners.

The full list of known gaps is in `SECURITY.md` under *Known limitations*.

To switch on AI question drafting, add your key to `.env` and restart:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Nothing else depends on it — every other feature works without it.
