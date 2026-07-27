# Strategy

## The problem, stated precisely

A person ships an app built by Lovable or Claude Code. It works. Users arrive. And then
they hit a wall that has nothing to do with code:

> 340 people signed up last month and 47 of them came back. Is that good?

They cannot answer this. Product analytics tools answer a different question — *what*
happened — and assume the operator already knows what a healthy number looks like. That
assumption held when the person shipping the app had spent five years in a product org.
It does not hold for the current generation of builders, who acquired the ability to ship
without acquiring the priors that make a dashboard meaningful.

This is a genuinely new gap. It was created by AI code generation, it is growing at the
rate AI code generation is growing, and the incumbents are structurally poorly placed to
close it because their answer requires a data network none of them has assembled for this
population.

## The wedge

**Benchmarks, delivered to the agent.**

Two decisions, and both matter more than they first appear.

### 1. The unit of value is a comparison, not a chart

A chart is a commodity. PostHog gives away a very good one, self-hostable, free forever.
Competing on chart quality against a well-funded open-source project is a losing game.

A comparison is not a commodity, because it requires a network:

> Your 7-day activation is 14%. Median for AI-built B2B SaaS at your size is 22%. You are
> in the 21st percentile. Closing to median is worth about 340 activated users a month.

That sentence cannot be produced by a competitor without assembling comparable data across
thousands of comparable apps. It gets better as the network grows, and it is the thing the
customer actually wanted when they opened the dashboard.

### 2. The buyer is the agent, not the human

For a vibe-coded app the agent *is* the developer. Claude Code, Cursor and Lovable write
the code; the human describes outcomes. This changes distribution completely:

- Installation is not a docs problem. It is a **one-line, zero-config** problem, because
  an agent pasting a snippet must get it right with no follow-up.
- Analytics an agent can *read* becomes part of the build loop. Ship a change, query the
  metrics, compare to cohort, iterate — without a human opening a dashboard.
- The MCP server is therefore not an integration. It is the primary interface, and the
  dashboard is the secondary one.

`check_pii_leaks` is the tool that spreads on its own: it tells a builder their generated
code is shipping user emails into event properties. That is an alarming, specific,
immediately actionable finding about their own app, discovered through us. It is also true
distressingly often.

## Why now

Four things had to be true at once, and as of 2026 they are.

**The population exists and is large.** The AI app-builder market is around $4.7B in 2026,
Lovable alone reached roughly $400M ARR by February 2026, and Bolt.new passed 5M users.
These are not prototypes any more; a meaningful share are apps with real users and real
revenue, operated by people with no analytics background.

**Agents can install and read tools.** MCP is a real standard with real adoption — Rybbit,
Databuddy and Seline all shipped MCP servers for analytics in 2026. The interface the wedge
depends on exists. It is also evidence others see the same opening, which is a good sign
about the market and a warning about the clock.

**The alternative-data market is large and hungry.** Around $29.6B in 2026, with hedge
funds taking the largest share and roughly 65-78% of US hedge funds using alternative
datasets. Critically, this market has matured past "any data will do" — buyers' compliance
teams now demand provenance, which advantages a provider that can prove lineage and
disadvantages incumbent brokers who cannot.

**Regulation has made the sloppy version unviable.** California's DROP began processing
deletion requests on 1 August 2026, at $200 per request per day for failures, against 600+
registered brokers and roughly 260,000 queued requests. GDPR enforcement against data
brokers continues to tighten. This is *good news* for a compliance-native entrant: the
moat is now partly regulatory, and the incumbents' architectures were not designed for it.

## Positioning

> Percentile is the analytics layer for apps built by AI — and the only one that tells you
> whether your numbers are any good.

Against the three groups we could be confused with:

| | Their answer | Ours |
|---|---|---|
| **PostHog, Mixpanel, Amplitude** | What happened in your app | Whether what happened is good |
| **Databuddy, Rybbit, Seline** | Lightweight, private, developer-friendly analytics | Same, plus the network nobody else has |
| **Data brokers** | Sell whatever they can collect | Sell only aggregates, and pay contributors |

## The flywheel

```
    more apps install
           |
           v
  cohorts clear k-anonymity
           |
           v
   benchmarks get tighter  ---->  product becomes more valuable
           |                              |
           v                              v
  datasets become sellable        conversion + retention rise
           |                              |
           v                              |
   contributors get paid  <---------------+
           |
           v
   opting out gets expensive  ----> more apps contribute
```

The load-bearing link is **cohorts clear k-anonymity**. Everything downstream is blocked
until it happens, and it happens per-cohort rather than globally. This is the single metric
that determines whether the business exists — see [risks](08-risks.md).

## What we are deliberately not building

- **Row-level data resale.** The obvious version of this idea. It is a liability, not an
  asset — [governance](04-data-governance.md) covers why in full.
- **Cross-app identity resolution.** Technically valuable, and structurally impossible
  here by design: pseudonyms are keyed per workspace, so the same person in two apps is two
  unlinkable subjects. We could not build a cross-app profile if a customer demanded it.
  That constraint is what makes the enterprise conversation short.
- **A better dashboard.** We will ship a competent one. We will not win on it.
- **Session replay.** High-value, extremely PII-dense, and it would compromise the
  positioning that everything else depends on.
