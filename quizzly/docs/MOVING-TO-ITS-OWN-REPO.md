# Move Quizzly into its own repo

Follow these five steps in order. Copy each block, paste, press enter.

Total time: about five minutes, most of it waiting for Docker.

---

## 1. Create the empty repo

Go to <https://github.com/new>.

- **Repository name:** `quizzly`
- Leave **Add a README**, **.gitignore** and **licence** all **unticked**

This folder already has all three. Ticking them creates a conflict on your
first push.

Click **Create repository**, then come back here.

---

## 2. Copy the folder out

```bash
git clone https://github.com/olivervanderlugt/claude.git /tmp/claude-src
cd /tmp/claude-src
git checkout claude/kahoot-quiz-platform-mvp-uol97e
cp -r quizzly ~/quizzly
```

You now have a complete, standalone copy at `~/quizzly`. The original repo is
untouched.

---

## 3. Push it

```bash
cd ~/quizzly
git init -b main
git add .
git commit -m "Initial commit: Quizzly"
git remote add origin git@github.com:olivervanderlugt/quizzly.git
git push -u origin main
```

If `git push` asks for a password, you don't have SSH keys set up. Run this
instead and try the push again:

```bash
git remote set-url origin https://github.com/olivervanderlugt/quizzly.git
```

---

## 4. Create your secrets

```bash
cd ~/quizzly
grep -v '^SESSION_SECRET=\|^ENCRYPTION_KEY=' .env.example > .env
printf 'SESSION_SECRET=%s\nENCRYPTION_KEY=%s\n' \
  "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" >> .env
```

`.env` is gitignored and never gets committed, which is why you generate your
own. The app checks these at startup and refuses to boot if they're missing or
still set to the placeholder — that's deliberate.

---

## 5. Run it

Needs Docker Desktop running. Install from <https://docker.com> if you haven't.

```bash
cd ~/quizzly
docker compose up --build
```

Wait for `Quizzly ready on http://localhost:3000`, then in a **second terminal**:

```bash
cd ~/quizzly
docker compose exec app node_modules/.bin/tsx prisma/seed.ts
```

Open <http://localhost:3000> and sign in:

- **Email:** `demo@quizzly.local`
- **Password:** `demo-password-123`

You'll have a quiz with all ten question types. Click **Host**, then open the
site on your phone and enter the PIN.

To stop: `Ctrl-C`, then `docker compose down`.

---

## Done. What's next

Open the folder in VS Code and start a Claude Code session there:

```bash
code ~/quizzly
```

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

---

## One thing not to do

The repo you cloned from in step 2 also contains an unrelated project under
`percentile/`. Step 2 only copies `quizzly/` out and changes nothing, so you're
safe by default.

If you later want to tidy that repo, delete **only** the `quizzly/` directory.
Don't delete the repo, `percentile/`, or `.github/`.
