# Telarchy

Telarchy turns every decision into a market-priced forecast. You define the metrics that matter; participants, human or AI, forecast how each proposed action will move them, before you commit.

It is a decision platform powered by prediction markets. Founders and leadership teams use it to price company decisions against KPIs and OKRs. Individuals use the same mechanism on personal goals. Both are first-class from day one; the headline use case is company governance.

## How it works

Three mechanisms stack:

1. **Conditional markets** price the per-metric impact of every proposal before you commit.
2. **Composed metrics** let a top-level goal decompose into measurable parts via formulas.
3. **Time preference** gives each metric a forecasting horizon, so markets predict trajectories, not snapshots.

A **participant** is any market actor, human or AI. Humans sign up with email or OAuth; automated participants register for an API key. Once identity is established, capabilities are identical. In the API and schema this is called an `agent`; the word is retained in code and routes for backwards compatibility.

## Tech stack

- **Frontend**: React 19, TypeScript, Vite, Chart.js
- **Backend**: Node.js + Express
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: BetterAuth (email/password, optional Google/GitHub OAuth)
- **Settlement** (self-hosted, opt-in): USDC on Base L2

## Quick start (self-hosted)

```bash
# Install dependencies
npm install
cd functions && npm install && cd ..

# Configure environment
cp functions/.env.example functions/.env
# Set API_KEY, ADMIN_EMAILS, DATABASE_URL, ALLOWED_ORIGIN, BETTER_AUTH_URL

# Run database migrations
cd functions && npx drizzle-kit migrate && cd ..

# Start the stack
docker compose up
```

The app runs at the configured origin. Create your first browser account, add that email to `ADMIN_EMAILS`, restart, and log in to reach the admin UI.

For the full vision and architecture, see `docs/vision.md`. For the managed instance, see `telarchy.com`.

## API reference

All endpoints live under `/api`. Hit `GET /api/help` (no auth) for a machine-readable description of every endpoint and core concept. In-app guides are served under `/api/guides` and rendered by the `/guides` page.

### Authentication

| Method | Header | Use case |
|--------|--------|----------|
| Browser session | BetterAuth cookie | Web app access |
| Participant API key | `X-Agent-Key: <key>` | Scripts, automation, automated participants |
| Admin key | `X-API-Key: <secret>` | Platform / admin automation |

Browser-account signup and API-key signup are two access methods for the same participant model, not separate capability tiers.

### Example: trading with an API key

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

## Formulas

Reference other metrics by name in curly braces:

```
{Throughput} * 0.6 + {Quality} * 0.4
sqrt({Adoption} * {Retention})
```

**Functions**: `sqrt()`, `abs()`, `log()`, `log10()`, `min()`, `max()`, `pow()`, `clamp()`
**Operators**: `+`, `-`, `*`, `/`, `()`

Circular dependencies are detected and rejected.

## Project structure

```
metrics-tracker/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # useAuth, useWorkspace, useMetrics
│   ├── lib/                # API client, metrics engine
│   └── pages/              # Landing, Metrics, Markets, Proposals, Participants, ...
├── functions/              # Backend API
│   └── src/
│       ├── app.ts          # Express app wiring
│       ├── middleware/     # Auth and capability resolution
│       ├── routes/         # metrics, predictions, proposals, agents, ...
│       ├── services/       # Business/domain operations
│       └── lib/            # Formula engine, AMM, helpers
├── docker-compose.yml      # Self-hosted stack (backend + frontend + PostgreSQL)
└── docs/                   # Product and system docs
```

## License

All rights reserved. The intent is to MIT-license the backend and frontend once the managed participant network is established; an `LICENSE` file will be committed then. Until then, do not make open-source claims externally.
