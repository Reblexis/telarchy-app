# Docs

These documents govern the code. Where a doc and the code disagree, the code is
wrong (`CONTRIBUTING.md` says how a change moves through both). Start at the top.

| Doc | What it owns |
|---|---|
| `vision.md` | What Telarchy is, every mechanism (metrics, markets, proposals, time preference, credits, settlement), the business model, self-hosting |
| `formulas.md` | The metric formula language: grammar, rejections, arithmetic |
| `agent-economy.md` | Participants, identity, authentication paths, credits, attribution |
| `agent-telemetry-protocol.md` | How an AI participant reports its cycles into `/admin` |
| `guides/` | The in-app guides served at `/api/guides`, one file per section |
| `limit-orders.md` | Limit orders on the market ladder |
| `market-integrity.md` | The three integrity rules for a live season |
| `seasons.md` | Seasons: bounded cash tournaments for traders |
| `otto.md` | Otto, the in-app assistant |
| `data-room.md` | The public data room: what telarchy.com publishes about itself |
| `metrics.md` | The metrics Telarchy tracks about Telarchy |
| `ui-conventions.md` | The one frontend design doc |
| `about-page.md` | Copy for `/about` and `/contact` |
| `legal/` | Terms, privacy, season rules, as served at `/terms`, `/privacy`, `/legal/season-0` |
| `infra/deploy.md` | Deploying the managed instance (Cloud Run), key rotation, cron |

Code-facing maps live beside the code: `../ARCHITECTURE.md` (modules, request
flow, the auth and formula rules), `../README.md` (running and developing).
