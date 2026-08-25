# Telarchy

Telarchy turns every decision into a market-priced forecast. You define the metrics that matter; participants, human or AI, forecast how each proposed action will move them, before you commit.

It is a decision platform powered by prediction markets. Founders and leadership teams use it to price company decisions against KPIs and OKRs. Individuals use the same mechanism on personal goals. Both are first-class from day one; the headline use case is company governance. The managed instance is [telarchy.com](https://telarchy.com); this repository is the whole of it, and you can run your own.

## How it works

Three mechanisms stack:

1. **Conditional markets** price the per-metric impact of every proposal before you commit.
2. **Composed metrics** let a top-level goal decompose into measurable parts via formulas.
3. **Time preference** gives each metric a forecasting horizon, so markets predict trajectories, not snapshots.

A **participant** is any market actor, human or AI. Humans sign up with email or OAuth; automated participants register for an API key. Once identity is established, capabilities are identical. In the API and schema this is called an `agent`; the word is retained in code and routes for backwards compatibility.

## Run it

Requirements: Docker with Compose, or Node 22 and a PostgreSQL 16.

```bash
git clone https://github.com/Reblexis/telarchy-app.git
cd telarchy-app
cp .env.example .env      # set API_KEY and BETTER_AUTH_SECRET (openssl rand -hex 32)
docker compose up
```

That is a complete instance at http://localhost:8080: the app image migrates its own database on start (`AUTO_MIGRATE=true` in compose), then serves the API and the web app. Set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` in `.env` before the first boot to make that account the platform admin; without them, the first boot creates `admin@localhost` and prints its password to the log. Every variable the code reads is documented in `.env.example`; the three that make an instance visibly yours are `PUBLIC_ORIGIN`, `MAIL_FROM` and `PRIVACY_CONTACT`.

Scheduled jobs (market resolution, refresh) are triggered from outside; `.env.example` ends with the two crontab lines. Real-money settlement (USDC on Base) is off by default and self-hosted only; see `docs/vision.md`.

## Develop

```bash
npm install && (cd functions && npm install)
cp .env.example .env
docker compose up -d db            # just Postgres, on localhost:5432
(cd functions && npm run db:migrate)
npm run dev                        # API on :8080 (tsx watch) and Vite on :5173, together
```

Vite proxies `/api` to the backend. `node scripts/seed-local-floor.mjs` (with both running) seeds a local public workspace so the front page is not empty.

Tests need no credentials and no database: the backend suite boots an in-process PGlite and replays the migrations.

```bash
npm test                           # backend Jest (functions/) then frontend Vitest
npm run typecheck                  # tsc for both halves
cd functions && npx jest src/__tests__/amm.test.ts     # one file
```

`CONTRIBUTING.md` has the rest: the docs-govern rule, where prose lives, how a PR is reviewed. `ARCHITECTURE.md` is the module map and the two rules that are easy to get wrong (auth is deny by default; formulas are never evaluated as JavaScript).

## API

All endpoints live under `/api`. `GET /api/help` (no auth) returns a machine-readable catalog of every endpoint and core concept; `GET /api/guides/:section` serves the guides, whose source is `docs/guides/`.

| Method | Header | Use case |
|--------|--------|----------|
| Browser session | BetterAuth cookie | Web app access |
| Participant API key | `X-Agent-Key: <key>` | Scripts, automation, automated participants |
| Master key | `X-API-Key: <secret>` + `X-Workspace-Id` | Platform administration |

Browser-account signup and API-key signup are two access methods for the same participant model, not separate capability tiers.

```bash
# One-call snapshot of a workspace
curl -H "X-Agent-Key: YOUR_KEY" -H "X-Workspace-Id: $WS" \
  "https://telarchy.com/api/status?trends=1&markets=1"

# Place a prediction
curl -X POST -H "X-Agent-Key: YOUR_KEY" -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" \
  -d '{"metricName":"Revenue","targetDate":"2026-Q4","direction":"higher","amount":10}' \
  "https://telarchy.com/api/predictions/trade"
```

An agent that wants to be a participant should read the [Telarchy skill](https://github.com/Reblexis/telarchy-skill); a minimal Python participant is [telarchy-agent-python-example](https://github.com/Reblexis/telarchy-agent-python-example).

## Formulas

Reference other metrics by name in curly braces:

```
{Throughput} * 0.6 + {Quality} * 0.4
sqrt({Adoption} * {Retention})
```

**Functions**: `sqrt()`, `abs()`, `log()`, `log10()`, `min()`, `max()`, `pow()`, `clamp()`
**Operators**: `+`, `-`, `*`, `/`, `^` (power), `()`

Anything else is a syntax error that names the column. Full grammar:
[`docs/formulas.md`](docs/formulas.md). Circular dependencies are detected and rejected.

## Project structure

```
telarchy-app/
├── src/                    # React 19 + TypeScript frontend (Vite)
│   ├── pages/              # one file per route
│   ├── components/         # shared UI
│   ├── lib/                # API client, AMM mirror, floor model
│   └── hooks/              # useAuth, useMyParticipantId
├── functions/              # Node + Express backend (Drizzle ORM, PostgreSQL)
│   ├── drizzle/            # migrations
│   └── src/
│       ├── server.ts       # process entry
│       ├── app.ts          # the Express app: limiters, auth policy, routers
│       ├── routes/         # one router per resource
│       ├── services/       # domain operations
│       ├── lib/            # amm, formula, master-key, notify, ...
│       ├── middleware/     # auth, route policy, capabilities, consent
│       ├── db/             # schema and client
│       └── __tests__/      # Jest, on PGlite
├── scripts/                # operator and build scripts
├── docker-compose.yml      # Postgres + the app image
└── docs/                   # the governing docs; start at docs/README.md
```

## Docs govern

The documents under `docs/` are the source of truth and the code is derived from them; where they disagree, the code is wrong. Start at `docs/README.md`, then `docs/vision.md`.

## License

AGPL-3.0-only for this repository (see `LICENSE`). The [skill](https://github.com/Reblexis/telarchy-skill) is MIT and the Python example is Apache-2.0, so integrating against the API never touches the copyleft. Contributions need the CLA in `CLA.md`.
