# Telarchy

A self-hostable metrics governance platform with prediction markets, formulas, dependency graphs, and an API for AI-agent automation. Built with React, TypeScript, and Firebase.

## Features

- **Formula-Based Metrics** - Create derived metrics using expressions like `{Deep Work} * 2 + {Exercise}`
- **Dependency Tracking** - Metrics recalculate automatically in topological order when values change
- **XP/Rank System** - Unified score from a "Utility" metric (ranks S through E)
- **REST API** - Full CRUD over HTTP; authenticate with an API key (AI agents) or Firebase token (browser)
- **Progress Graphs** - Visualize metric history over day/week/month/year intervals
- **Focus Mode** - Filter the dashboard to a single metric and its dependency chain

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Chart.js
- **Backend**: Firebase Cloud Functions (v2) with Express
- **Database**: Firestore (accessed via Admin SDK)
- **Auth**: Firebase Authentication (email/password)

## Quick Start

### 1. Firebase Project Setup

1. Create a project at [Firebase Console](https://console.firebase.google.com)
2. Enable **Authentication** → **Email/Password**
3. Create a **Firestore Database** in production mode
4. Register a **Web app** and copy the config JSON
5. Upgrade to **Blaze plan** (required for Cloud Functions; free tier still applies)

### 2. Install and Configure

```bash
# Install dependencies
npm install
cd functions && npm install && cd ..

# Set your API key for the AI agent
cp functions/.env.example functions/.env
# Edit functions/.env and set API_KEY=<your-secret>
```

### 3. Deploy

```bash
firebase login
firebase use <your-project-id>
firebase deploy
```

Your app will be at `https://<project-id>.web.app`. The API is served from the same origin via hosting rewrites.

### 4. First Run

1. Open the app → paste your Firebase config JSON on the setup page
2. Sign up with email/password
3. Start creating metrics

## API Reference

All endpoints live under `/api`. Hit `GET /api/help` (no auth required) for a machine-readable description of every endpoint, the app's purpose, and its core concepts.

### Authentication

| Method | Header | Use Case |
|--------|--------|----------|
| API Key | `X-API-Key: <secret>` | AI agents, scripts, CLI tools |
| Firebase Token | `Authorization: Bearer <id-token>` | Browser frontend |

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

### Example: AI Agent Usage

```bash
# Get a summary of everything
curl -H "X-API-Key: YOUR_KEY" https://your-project.web.app/api/status

# Create a metric
curl -X POST -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Deep Work","value":5}' \
  https://your-project.web.app/api/metrics

# Update a metric's value
curl -X PUT -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
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

All Firestore access goes through the API (Admin SDK). Direct client access is denied by security rules.

## Project Structure

```
metrics-tracker/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # useAuth, useMetrics, useDarkMode
│   ├── lib/                # api client, metrics engine, firebase config
│   └── pages/              # Login, Setup, Metrics pages
├── functions/              # Firebase Cloud Functions (API)
│   └── src/
│       ├── index.ts        # Express app entry point
│       ├── middleware/      # Auth (API key + Firebase token)
│       ├── routes/          # metrics, updates, system endpoints
│       ├── services/        # Firestore operations
│       └── lib/             # Formula engine, async handler
├── firebase.json           # Hosting + Functions config
└── firestore.rules         # Deny-all (Admin SDK bypasses)
```

## License

MIT
