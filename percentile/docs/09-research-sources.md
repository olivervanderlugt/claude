# Research sources

Market inputs behind the strategy and the financial model, gathered July 2026. Figures from
commercial market-research firms vary widely and are treated as order-of-magnitude
indicators, not precision estimates.

## The AI app-builder market (the addressable population)

- **[Vibe Coding Tool Landscape: Replit, v0, Base44, Bolt, Lovable, Vercel — Luminix](https://www.useluminix.com/reports/industry-analysis/vibe-coding-tool-landscape-replit-v0-base44-bolt-lovable-vercel)**
  — market ≈ $4.7B in 2026, projected $12.3B by 2027 (~38% CAGR); AI-generated code ≈ 41%
  of all code written globally. Lovable ≈ $400M ARR by February 2026 with 146 employees;
  Bolt.new ≈ $40M ARR within six months and 5M+ users.
- **[Best Vibe Coding Tools in 2026 — Lovable](https://lovable.dev/guides/best-vibe-coding-tools-2026-build-apps-chatting)**
  — platform positioning and differentiation.

*Used for:* install ceiling, growth rates, and the segmentation dimension in `CohortKey`.

## Product analytics pricing (the Layer 1 price ceiling)

- **[Analytics Pricing Comparison, April 2026 — BuildMVPFast](https://www.buildmvpfast.com/api-costs/analytics)**
  — PostHog, Mixpanel, Amplitude side by side.
- **[Amplitude Pricing in 2026 — Userpilot](https://userpilot.com/blog/amplitude-pricing/)**
  — ~$0.00028/event above 1M; moved to volume-based pricing July 2026.
- **[Amplitude vs PostHog 2026 — IdeaPlan](https://www.ideaplan.io/compare/amplitude-vs-posthog)**
  — free tiers: PostHog 1M events/mo, Mixpanel 20M, Amplitude 1M.

*Used for:* tier pricing and ARPA. Mixpanel's 20M free tier is the binding constraint on
what Layer 1 can charge.

## Alternative data market (the Layer 3 buyers)

- **[Alternative Data Market Size and Growth Report 2026-2033 — Grand View Research](https://www.grandviewresearch.com/industry-analysis/alternative-data-market)**
  — ≈ $29.6B in 2026; hedge funds 67.66% revenue share (2025); card transactions the
  largest segment at 17.60%; North America 65.89%.
- **[Alternative Data Market Size and Forecast 2026-2035 — Precedence Research](https://www.precedenceresearch.com/alternative-data-market)**
  — ≈ $31.86B in 2026. The spread against Grand View is why these are treated as
  order-of-magnitude.
- **[Alternative Data Sources Hedge Funds Use in 2026 — Paradox Intelligence](https://www.paradoxintelligence.com/blog/alternative-data-sources-hedge-funds)**
  — 78% penetration among hedge funds; 65%+ of US hedge funds use alt data for alpha.

*Used for:* co-op ACV and licensee growth.

## Benchmark-as-a-product precedent

- **[SaaS Financial Benchmarks — Baremetrics](https://baremetrics.com/blog/saas-financial-benchmarks-by-baremetrics)**
  — anonymised aggregation across 881 companies / 6,566 plans, published openly.
- **[Baremetrics Benchmarks](https://baremetrics.com/features/benchmarks)**
- **[SaaS benchmarking data — Nomad Data](https://www.nomad-data.com/blog/saas-benchmarking-data-can-provide-insights-on-relative-performance-of-financial-performance-and-operating-metrics)**
  — 1,000+ private brands, 18,000 public firms, 300+ metrics.

*Used for:* validating that aggregate benchmarking is a real product with a real playbook,
and for the published-report GTM channel.

## Privacy and regulation

- **[Data analytics on online services under GDPR: legal basis — IAPP](https://iapp.org/news/a/data-analytics-on-online-services-under-gdpr-legal-basis)**
  — lawful basis analysis for analytics processing.
- **[Data Anonymization: A 2026 Guide — Ethyca](https://www.ethyca.com/guides/data-anonymization)**
  — properly anonymised data falls outside GDPR: no lawful basis, no DSARs, no purpose or
  storage limitation, no erasure right. **The load-bearing claim for the entire Layer 3
  thesis.**
- **[In the Shadows: Data Brokers and the Limits of the GDPR — Verfassungsblog](https://verfassungsblog.de/datatrade-eu-gdpr-privacy/)**
  — consent under Art. 6(1)(a)/7 is not obtained in practice for data trading because
  subjects are not party to the transaction. This is why the naive model fails.
- **[Data Broker Registration Explained 2026 — Secure Privacy](https://secureprivacy.ai/blog/data-broker-registration)**
- **[California DROP Enforcement Hits Aug 1 — TechTimes](https://www.techtimes.com/articles/319927/20260708/california-drop-enforcement-hits-aug-1-data-brokers-face-200-per-day-fines.htm)**
  — from 1 August 2026, 600+ brokers must process ~260,000 queued deletion requests or face
  $200/request/day.
- **[DROP for data brokers — CalPrivacy](https://privacy.ca.gov/drop-for-data-brokers/)** —
  primary source.
- **[Is Your Business a "Data Broker"? — Clark Hill](https://www.clarkhill.com/news-events/news/is-your-business-a-data-broker-californias-drop-goes-live-and-calprivacy-continues-to-enforce-delete-act/)**
  — the broker definition catches more businesses than expected.
- **[California Privacy Agency Launches Data Broker Strike Force — Crowell & Moring](https://www.crowell.com/en/insights/client-alerts/california-privacy-agency-launches-data-broker-strike-force-amid-delete-act-crackdown/)**
  — enforcement posture is active, not theoretical.

*Used for:* the entire governance design.

## Competitive — agent-native analytics

- **[Databuddy](https://www.databuddy.cc/)** — OpenAPI, `llms.txt`, streamable HTTP MCP.
- **[Rybbit](https://rybbit.com/)** and **[rybbit-mcp-server](https://github.com/daikazu/rybbit-mcp-server)**
- **[Seline MCP Server](https://seline.com/api/mcp)**
- **[8 MCP Servers for BI and Analytics in 2026 — Integrate.io](https://www.integrate.io/blog/mcp-servers-business-intelligence-analytics/)**

*Used for:* the competitive read. These confirm the agent-native thesis is correct and that
we are not first to it — which is why the roadmap prioritises network density over
interface polish.

## Data monetisation and consent models

- **[Rethinking the Economics of Panels in the Behavioral Data Era — Behavix](https://info.behavix.io/post/panel-economics)**
  — transparent incentives tied to long-term engagement outperform transactional
  compensation.
- **[Customer Data Monetization — Monda](https://www.monda.ai/blog/customer-data-monetization)**
- **[Data monetisation: how to do so while avoiding legal trouble — ITLawCo](https://itlawco.com/data-monetisation-how-to-do-so-while-avoiding-legal-trouble/)**
- **[Enterprise data monetization — Transcend](https://transcend.io/blog/enterprise-data-monetization)**
  — permission changes must propagate at the data-system level, not by manual process.

*Used for:* the revenue-share design and the consent-propagation requirement in the ledger.

---

## A caveat on these numbers

Market-sizing reports disagree by 10-20% on the same year and have an obvious incentive
toward large numbers. They are used here for order of magnitude and direction, never for
precision. The parts of the model that actually determine the outcome — cohort density,
conversion, ACV — are not in any of these reports and can only be learned by shipping. That
is what [the roadmap](07-roadmap.md) is sequenced to find out.
