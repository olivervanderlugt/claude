# Competitive landscape

## Four groups, three of them dangerous

### 1. Incumbent product analytics — PostHog, Mixpanel, Amplitude

| | Free tier | Paid entry | Position |
|---|---|---|---|
| PostHog | 1M events/mo (self-host unlimited) | $25/mo | Open source, engineering-led, bundles replay + flags |
| Mixpanel | 20M events/mo | usage-based | Generous free tier, event-based pricing |
| Amplitude | 1M events/mo | ~$0.00028/event | Enterprise product analytics; moved to volume pricing July 2026 |

**Threat: high, but indirect.** They will not lose to us on features and we should not try.
Their free tiers are genuinely generous — Mixpanel's 20M events/month covers most
vibe-coded apps forever, which caps what Layer 1 can ever charge.

Their weakness is the one we are built on: they tell you *what* happened and assume you
know what good looks like. They also cannot easily add cross-customer benchmarks, because
their contracts, DPAs and data architectures were written for single-tenant isolation.
Retrofitting a data co-op onto an installed base that never consented to one is a
multi-year legal project, not a feature.

**How we lose to them:** PostHog ships "industry benchmarks" as a free feature. They have
the data volume. Watch for it.

### 2. Lightweight privacy-first analytics — Databuddy, Rybbit, Seline, Plausible, Fathom

**Threat: high and immediate.** This is the same wedge. Rybbit, Databuddy and Seline all
shipped MCP servers in 2026 — the exact agent-native interface described in the strategy
doc. Databuddy explicitly ships OpenAPI + `llms.txt` + streamable HTTP MCP so agents can
self-serve.

They are ahead on the interface and behind on the network. None has a benchmark product,
and several are self-hostable — which is a feature for their users and a structural barrier
to ever building one, since self-hosted instances contribute nothing.

**How we lose to them:** one of them adds benchmarks before we reach k-anonymity. This is
the most likely way this business dies, and the reason the roadmap front-loads network
density over feature breadth.

### 3. Alternative data providers — Similarweb, YipitData, M Science, Consumer Edge

**Threat: low as competitors, high as acquirers or channel.**

They operate at a scale we will not approach for years, in a market worth roughly $29.6B in
2026, dominated by hedge fund buyers. They have the buyer relationships and the sales
motion. What they do not have is this dataset — nobody has visibility into the AI-built app
economy, because it did not exist when their collection infrastructure was designed.

The realistic path is partnership: they resell our cohort data into relationships we cannot
reach in year one. It also makes them the natural acquirer, which is worth saying out loud
in a strategy document rather than pretending otherwise.

### 4. The builders themselves — Lovable, Vercel, Replit, Bolt

**Threat: existential, and the one most likely to be underestimated.**

Lovable was at roughly $400M ARR by February 2026 with 146 employees. Bolt passed 5M users.
Each of them could ship built-in analytics with benchmarks tomorrow, with perfect
distribution and zero installation friction, and they already know which apps are theirs.

Two things work in our favour, and they are real but not permanent:

- **They only see their own apps.** A Lovable benchmark compares you to other Lovable apps.
  Cross-builder comparison is more valuable and only a neutral third party can produce it.
- **Analytics is not their roadmap.** They are competing on autonomous multi-agent
  reliability and deployment. Analytics is a distraction until it is not.

**Strategic response:** be the neutral layer, integrate with all of them, and make
cross-builder comparison the headline. If a builder wants it in-product, license it to them
— that is a Layer 3 customer, not a lost Layer 1 customer.

## Where we actually sit

| | Analytics depth | Benchmarks | Agent-native | Privacy architecture | Pays contributors |
|---|---|---|---|---|---|
| PostHog / Mixpanel / Amplitude | ●●●●● | ○ | ●● | ●● | ○ |
| Databuddy / Rybbit / Seline | ●●● | ○ | ●●●● | ●●●● | ○ |
| Similarweb / Yipit | ●● | ●●●● | ○ | ●● | ○ |
| Lovable / Replit built-ins | ●● | ●(own apps only) | ●●●● | ●● | ○ |
| **Percentile** | ●●● | ●●●●● | ●●●●● | ●●●●● | ●●●●● |

We are deliberately mid-table on analytics depth. Trying to beat PostHog on features is how
this becomes a worse PostHog.

## The honest competitive read

The wedge is real but narrow, and the window is measured in quarters. The privacy-first
analytics group has the same insight about agent-native interfaces and is shipping now. Our
advantage is not the interface — it is being the only one whose *architecture, contracts
and incentives* were designed from day one for cross-customer aggregation.

That advantage compounds if we reach network density first and evaporates if we do not.
Everything in the roadmap is subordinated to that race.
