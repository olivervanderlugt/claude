# Percentile

**Consent-first analytics and a benchmark data network for AI-built apps.**

One line of SDK. Your AI coding agent reads the metrics back through MCP. And every app
that opts in earns a share of the revenue from the anonymous benchmark datasets it helps
create.

```html
<script type="module">
  import { init } from 'https://cdn.percentile.dev/v1/sdk.js';
  init('pk_live_xxx');
</script>
```

---

## The idea in one paragraph

Millions of apps now get built by people who cannot read the code they shipped. They have
no idea whether 14% activation is good or terrible, and no way to find out. Percentile
answers that question — *"you are in the 21st percentile for AI-built B2B SaaS at your
size, and closing to median is worth about 340 activated users a month"* — by aggregating
across the network. The aggregate is the product twice over: developers pay for the
comparison, and investors, tool vendors and market researchers pay for the anonymised
cohort data. Contributors get 30% of that second revenue stream back.

## What makes it defensible

Anyone can build a dashboard; three open-source projects give one away free. Nobody can
build the comparison without a network, and the network compounds — every new app makes
every existing benchmark tighter, which makes the product more valuable, which attracts
more apps.

The unusual part is that the privacy architecture is the *business* architecture. Data
that has genuinely been anonymised sits outside the GDPR's scope and is not a "sale of
personal information" under US state law, which is what makes a resale business possible
at all. So anonymisation is not a compliance tax bolted on at the end — it is the single
choke point every number passes through, and it is the thing buyers' compliance teams
actually pay a premium for.

## What this repository contains

A working core, not a slide deck.

| Path | What it is |
|---|---|
| `src/core/privacy/release-gate.ts` | The only code path from private data to public aggregate |
| `src/core/consent.ts` | Hash-chained, append-only consent ledger |
| `src/core/identity.ts` | Per-workspace pseudonymisation with epoch rotation |
| `src/core/redaction.ts` | Ingest-time PII scrubbing |
| `src/core/monetization/revenue-share.ts` | Co-op settlement, reconciling to the cent |
| `src/api/` | HTTP surface — six endpoints total |
| `src/sdk/browser.ts` | One-line browser SDK with auto-instrumentation |
| `src/mcp/server.ts` | MCP server so coding agents can query the analytics |
| `scripts/model.ts` | The financial model every number in the docs comes from |
| `docs/` | Strategy, business model, architecture, governance, GTM, risks |

## Read the plan

1. **[Strategy](docs/01-strategy.md)** — the wedge, why now, why this is defensible
2. **[Business model](docs/02-business-model.md)** — three revenue layers, pricing, unit economics
3. **[Architecture](docs/03-architecture.md)** — two data planes and the gate between them
4. **[Data governance](docs/04-data-governance.md)** — the legal design the business rests on
5. **[Competitive landscape](docs/05-competitive-landscape.md)** — who else is here
6. **[Go-to-market](docs/06-go-to-market.md)** — how the first 1,000 apps arrive
7. **[Roadmap](docs/07-roadmap.md)** — 90 days, then 12 months
8. **[Risks](docs/08-risks.md)** — including the ones that kill it
9. **[Research sources](docs/09-research-sources.md)** — where the market numbers came from

## Running it

```bash
npm install
npm test                  # 43 tests, privacy invariants included
npm run typecheck
npm run model -- all      # bear / base / bull side by side
PERCENTILE_ROOT_SECRET=$(openssl rand -hex 32) npm start
```

## The honest version

Read [docs/08-risks.md](docs/08-risks.md) before anything else. The short form:

- The bear case is a thin analytics tool competing with free open-source alternatives, and
  it is a real possibility. The whole thesis rests on cohorts reaching k-anonymity at
  scale — which needs roughly 10 comparable apps and 500 end users **per cohort**, not in
  total. That is the number to watch.
- Reselling row-level customer data — the obvious version of this idea — is not something
  this project does, because it converts a defensible asset into an uninsurable liability.
  The reasoning is in [docs/04-data-governance.md](docs/04-data-governance.md).
- Revenue is back-loaded. Data licensing cannot start until the network exists, which in
  the base case is month 14.

## Moving this to its own repository

This was built inside an existing repo because the session that created it did not have
permission to create new GitHub repositories. The project is self-contained and the full
history moves across:

```bash
# 1. Create an empty repo at https://github.com/new — no README, no .gitignore
# 2. Then:
./scripts/split-out-repo.sh git@github.com:<you>/percentile.git
```

## Status

Early. The privacy core, ingest pipeline, benchmark maths and settlement logic are
implemented and tested. Storage is an in-memory stand-in with the interface ClickHouse
would satisfy. Nothing here has been through external legal review — see the roadmap for
where that sits.

## License

MIT — see [LICENSE](LICENSE).
