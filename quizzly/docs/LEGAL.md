# Legal and compliance notes

**This is engineering documentation, not legal advice.** It explains what the
software does with data and flags the risks specific to this product category so
you can brief a lawyer efficiently. If you are going to charge money, operate at
scale, or deploy into schools, get proper advice.

---

## 1. The data-minimisation decision that shapes everything

The single most important compliance property of this codebase:

> **Players are not users. Joining a game stores a nickname and nothing else.**

No email, no account, no IP address logged against a play session, no device
fingerprint, no analytics cookie. A `Player` row is a nickname, a score, and the
answers given.

This is deliberate, and it is why a class of eleven-year-olds can play without
anyone processing children's personal data. Under UK/EU GDPR, if you never
collect identifying data you avoid most of the obligations that make
education-technology products expensive and risky. The alternative design —
"players sign in so we can track them across games" — pulls the entire live-game
path into scope for parental consent, age assurance, and children's-data
risk assessments.

**Preserve this property.** The tempting features that break it:

| Tempting feature | What it costs you |
|---|---|
| Player accounts / cross-game history | Full GDPR scope for every player, including children |
| Logging IPs against players | IP is personal data. Brings you into scope |
| Analytics on the play pages | Consent banners, and likely children's-data obligations |
| "Sign in with Google to play" | Everything above, plus a third-party transfer |

If you add any of them, revisit this whole document.

The one thing that can identify a player is **a nickname they choose
themselves**. That is disclosed in the privacy notice and on the join screen.

---

## 2. GDPR obligations you still have

Even with minimal player data, you have obligations for **account holders**
(quiz authors).

### Lawful basis
- **Account holders:** performance of a contract (Art. 6(1)(b)) — they signed up
  for the service.
- **Players:** pick one and state it in your privacy notice. Legitimate
  interests (Art. 6(1)(f)) is usually the right fit for running a game someone
  chose to join. If a school or employer is the one deploying it, you may be a
  **processor** for them rather than a controller — which changes your paperwork
  substantially and usually requires a Data Processing Agreement.

### Rights, and where they're implemented
| Right | Status |
|---|---|
| Erasure (Art. 17) | **Implemented.** Settings → Delete account. A hard delete; quizzes, games, players and answers cascade |
| Access (Art. 15) | **Not implemented.** You must handle requests manually, or build an export |
| Rectification (Art. 16) | Partially — users can edit their own content |
| Portability (Art. 20) | **Not implemented.** Add a quiz-export endpoint if you need it |

### Retention
The schema has **no automatic retention policy**. Game records live until the
quiz or account is deleted. Decide a retention period, put it in your privacy
notice, and enforce it — a scheduled job deleting `Game` rows older than N days
is the straightforward implementation. Keeping nicknames and answers forever with
no stated purpose is a compliance problem you will not notice until someone asks.

### Records and assessments
- **Art. 30 record of processing:** required for most operators. Write one.
- **DPIA (Art. 35):** likely required if you deploy at scale into schools, since
  that involves children's data and systematic monitoring. The minimal-data
  design makes it a much easier document to write, not an unnecessary one.

---

## 3. Children

Regulators have moved decisively on children's data — the EU tightened its
approach through 2025–26 with private-by-default settings, stricter age
assurance, and risk assessments for services minors can access. The UK's
Age Appropriate Design Code already imposes similar duties.

**How this software is positioned:**

- **Playing** involves no personal data, which is the strongest position
  available. This is the path children actually use.
- **Creating an account** is where age matters. The GDPR digital-age-of-consent
  default is 16, and member states may lower it to 13 — so the threshold depends
  on your country. The signup form does **not** currently ask for age or verify
  it. If your users may include children, you must add an age gate and set the
  threshold for your jurisdiction.

**If you deploy into schools**, expect to need:
- A Data Processing Agreement with the school (they are usually the controller;
  you are the processor).
- Clear documentation of what you store and for how long.
- Sensible defaults on anything user-generated.

**Nickname moderation is your problem, not the framework's.** A nickname field
in a classroom will eventually be used to bully someone. The host can remove a
player mid-game, and group-quiz submissions can be moderated, but there is **no
automated profanity filter** — adding a deny-list is a small change and worth
doing before a school deployment.

---

## 4. Patent risk — read this before commercialising

This is the item most likely to surprise you, and it is specific to this product
category rather than to this codebase.

**Kahoot! is itself the defendant in active US patent litigation.** Interstellar
Inc. sued Kahoot!'s Norwegian parent and its US subsidiary in June 2024,
asserting **US Patent No. 10,339,825**, "System and Method for On-Line Academic
Competition". The representative claim covers a system with a question database
and a processor that assembles teams and leagues, delivers timed quiz questions,
and displays a *real-time scoreboard with a time clock* tallying individual and
team scores. The complaint points at features like team mode and podium scoring.
The patent was filed in 2012 and granted in 2019; as of July 2026 Kahoot! has
petitioned the US Supreme Court for review.

**Why this matters to you:** "timed questions plus a live scoreboard" is the core
mechanic of this entire genre, and it is what a live quiz platform necessarily
does. You should understand:

- Patents are **jurisdictional**. This is a US patent. It is not automatically
  enforceable in the UK or EU, and software-implemented business methods face a
  higher bar to patentability in Europe.
- Litigation risk scales with **commercial visibility**. Running this internally
  or for a club is a very different risk profile from launching a funded US
  competitor.
- The features most exposed to this specific claim are **team/league play** and
  **real-time scoreboards**. This codebase has a real-time scoreboard. It does
  not currently implement teams or leagues — if you add them, you are moving
  toward the claim, not away from it.

**Recommendation:** if you intend to commercialise this in the US, get a
freedom-to-operate opinion before you launch. If you are self-hosting for a
school, a workplace, or friends, this is background context rather than an
action item.

### Trade marks and trade dress
Separately from patents: do not name your deployment anything resembling
"Kahoot", do not copy its distinctive purple-and-shapes visual identity, and do
not use its marks in marketing. The four-colour answer grid is a widespread
genre convention; the specific look of a competitor's product is not. Trade mark
infringement is far easier for a rights-holder to act on than patent
infringement, and far easier for you to avoid.

---

## 5. AI-generated content

When AI drafting is enabled:

- **Data leaves your infrastructure.** Topic and source text are sent to
  Anthropic. Player data never is. This is disclosed in the privacy notice
  template; if you enable AI, that disclosure must stay.
- **Tell users not to paste confidential material** into the source field. The
  UI does; keep it.
- **Accuracy is your responsibility.** Language models get facts wrong. The UI
  presents generated questions as *drafts* and says so. Do not remove that
  framing — a confidently wrong question in front of a class is worse than no
  question.
- **Copyright.** Generating questions *from* source text the user doesn't own
  may raise issues depending on what they paste. The terms template places that
  responsibility on the user, which is the normal approach.
- **EU AI Act.** A quiz-question generator is not a high-risk system under the
  Act's Annex III. But if you use it to generate assessments that materially
  determine educational outcomes, look again — assessment of students is an
  enumerated high-risk area.

---

## 6. Before you go live: checklist

- [ ] Fill in every `[BRACKETED]` field in `/privacy` and `/terms`, and delete
      the operator banners.
- [ ] Decide and document a retention period for game data; implement deletion.
- [ ] Add an age gate to signup if children may create accounts.
- [ ] Write your Art. 30 record of processing.
- [ ] Do a DPIA if deploying into schools or at scale.
- [ ] Put DPAs in place with your hosting and database providers.
- [ ] Add nickname moderation if deploying to schools.
- [ ] If commercialising in the US: freedom-to-operate opinion (§4).
- [ ] Confirm you are not using another company's marks or trade dress.

---

## Sources

- Interstellar Inc. v. Kahoot! — analysis of US Patent 10,339,825 and the
  Supreme Court petition: <https://patentlyo.com/patent/2026/07/a-cleaner-test-case-why-kahoot-adds-fire-to-the-supreme-courts-settled-expectations-docket.html>
- EDPB, children's data protection: <https://www.edpb.europa.eu/news/news/2026/data-protection-day-2026-keeping-childrens-personal-data-safe-online_en>
- EU children's data rules, 2025 changes: <https://www.gdprregister.eu/gdpr/eu-childrens-data-privacy-2025-7-changes/>
- Protecting children online, 2026 outlook: <https://www.reedsmith.com/our-insights/blogs/technology-law-dispatch/102mela/protecting-children-online-what-to-expect-in-2026/>
- COPPA / GDPR-K / age verification overview: <https://pandectes.io/blog/childrens-online-privacy-rules-around-coppa-gdpr-k-and-age-verification/>
