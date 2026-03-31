# Telarchy

A self-hostable metrics governance platform with prediction markets, formulas, dependency graphs, and participant automation. Built with React, TypeScript, BetterAuth, PostgreSQL, and an Express API.

## Features

- **Formula-Based Metrics** - Create derived metrics using expressions like `{Deep Work} * 2 + {Exercise}`
- **Dependency Tracking** - Metrics recalculate automatically in topological order when values change
- **XP/Rank System** - Unified score from a "Utility" metric (ranks S through E)
- **REST API** - Full CRUD over HTTP; authenticate with a browser account session or an agent key
- **Progress Graphs** - Visualize metric history over day/week/month/year intervals
- **Focus Mode** - Filter the dashboard to a single metric and its dependency chain

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Chart.js
- **Backend**: Node.js + Express
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: BetterAuth (email/password, optional Google/GitHub OAuth)

## Quick Start

### 1. Environment Setup

1. Create your local or hosted deployment environment
2. Configure the environment variables from `functions/.env.example`
3. Provision PostgreSQL and run the database migrations
4. Configure BetterAuth providers if you want Google/GitHub OAuth

### 2. Install and Configure

```bash
# Install dependencies
npm install
cd functions && npm install && cd ..

# Set your API key and browser admin allowlist
cp functions/.env.example functions/.env
# Edit functions/.env and set API_KEY=<your-secret> and ADMIN_EMAILS=<your-email>
```

### 3. Deploy

```bash
firebase login
firebase use <your-project-id>
firebase deploy
```

For local/self-hosted setups, use the root `docker compose` / app scripts described in `docs/vision.md`.

### 4. First Run

1. Create your first browser account
2. Set `ADMIN_EMAILS` in `functions/.env` to that email and deploy
3. Log in with that account
4. Create a workspace
5. Start creating metrics and markets

## API Reference

All endpoints live under `/api`. Hit `GET /api/help` (no auth required) for a machine-readable description of every endpoint, the app's purpose, and its core concepts.

### Authentication

| Method | Header | Use Case |
|--------|--------|----------|
| Browser session | BetterAuth cookie | Web app access |
| Agent key | `X-Agent-Key: <agent-key>` | Scripts, automation, API-key sign-in |
| Admin key | `X-API-Key: <secret>` | Platform/admin automation |

Browser-account signup creates or attaches to the participant identity directly. Browser-account auth and agent-key auth are two access methods for the same participant model, not separate capability tiers.

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/help` | No | API documentation and app description |
| `GET` | `/api/status` | Yes | XP, rank, and compact summary of all metrics |
| `GET` | `/api/metrics` | Yes | List all metrics (computed totals and depths) |
| `GET` | `/api/metrics/:id` | Yes | Single metric by ID |
| `POST` | `/api/metrics` | Yes | Create a metric |
| `PUT` | `/api/metrics/:id` | Yes | Update a metric |
| `DELETE` | `/api/metrics/:id` | Yes | Delete a metric |
| `GET` | `/api/metrics/:id/logs` | Yes | Historical value logs for graphing |
| `GET` | `/api/updates` | Yes | Update history (`?limit=N`) |
| `GET` | `/api/tasks` | Yes | List tasks |
| `GET` | `/api/tasks/:id` | Yes | Task detail with `utilitySummary` and conditional market summaries including target date, liquidity, and baseline comparisons |

### Example: Agent-Key Usage

```bash
# Get a summary of everything
curl -H "X-Agent-Key: YOUR_AGENT_KEY" https://your-project.web.app/api/status

# Create a metric
curl -X POST -H "X-API-Key: YOUR_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Deep Work","value":5}' \
  https://your-project.web.app/api/metrics

# Update a metric's value
curl -X PUT -H "X-API-Key: YOUR_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Deep Work","description":"","value":8,"formula":"0","oldValue":5,"updateNote":"Good focus day"}' \
  https://your-project.web.app/api/metrics/METRIC_ID
```

## Formulas

Reference other metrics by name in curly braces:

```
{Deep Work} * 2 + {Exercise} * 1.5
sqrt({Consistency}) * ({Reading} + {Writing})
```

**Functions**: `sqrt()`, `abs()`, `min()`, `max()`, `pow()`
**Operators**: `+`, `-`, `*`, `/`, `()`

Circular dependencies are detected and rejected.

## Data Model

| Collection | Purpose |
|------------|---------|
| `metrics` | Name, base value, formula, display order |
| `metricLogs` | Historical total values (for graphs) |
| `updates` | Change history with timestamps and notes |

All database access goes through the API layer.

## Project Structure

```
metrics-tracker/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # useAuth, useMetrics, useDarkMode
│   ├── lib/                # api client, metrics engine, firebase config
│   └── pages/              # Login, Setup, Metrics pages
├── functions/              # Backend API
│   └── src/
│       ├── index.ts        # Express app entry point
│       ├── middleware/      # Auth and permission resolution
│       ├── routes/          # metrics, updates, system endpoints
│       ├── services/        # Business/domain operations
│       └── lib/             # Formula engine, async handler
├── docker-compose.yml      # Self-hosted stack
└── docs/                   # Product and system docs
```

## License

MIT
