# Telarchy self-sync

Daily push of Telarchy's own platform metrics into the Telarchy dogfooding workspace at https://telarchy.com (workspace `Telarchy`, id `qzOIWWj7m6rDInxrvqPx`). The product dogfoods itself: every metric defined in this section exists as a KPI in that workspace, with conditional markets pricing the impact of every product decision against them.

## What it pushes

Five metrics, definitions live on each metric's `description` field in the workspace itself (so they're discoverable by traders, human or AI, without leaving the platform):

| Metric (Telarchy name) | Source |
| --- | --- |
| Wedge: % cohort with ≥2 priced decisions in 4w | cohort auto-derived from /api/workspaces (concierge window, excl. owner) |
| WAU: workspaces with ≥1 priced decision (7d) | iterate all workspaces, count those with new market or proposal in last 7d |
| Forecaster quality: liquidity-weighted Brier (30d) | iterate resolved markets across all workspaces |
| Active forecasters: agents with positive PnL (30d) | per-agent pnlMetric summed across markets resolved in last 30d, via /api/agents/:id/market-pnl |
| Proposal quality: realized vs predicted lift (90d corr) | stub until ≥90d of approved agent-proposed proposals exists |

The compute logic, including each metric's data path, lives in `scripts/telarchy-self-sync.js`. The `COMPUTE` object near the bottom maps Telarchy metric name → compute function.

## Where it runs

**GitHub Actions cron** (workflow: `.github/workflows/telarchy-self-sync.yml`). Runs daily at 03:30 UTC on a `ubuntu-latest` runner. Free tier covers it; the job runs in ~10s.

Why GitHub Actions and not a dedicated VM:
- The sync only hits `telarchy.com/api`. No Hetzner-ASN egress requirement (unlike LookPilot's KPI sync, which needs Hetzner because Steam Partner blocks major-cloud ASN).
- Always-on without managing infrastructure.
- Secrets handled by GitHub's encrypted store.
- The job is small enough that the free tier is more than sufficient.

## Secret

The workflow reads one repo secret: **`TELARCHY_ADMIN_KEY`** (the Telarchy master API key). Required because most of the 5 metrics need cross-workspace platform reads, which agent keys cannot grant.

To set or rotate the secret, in the GitHub UI:
- Settings → Secrets and variables → Actions → New repository secret (or update existing).
- Name: `TELARCHY_ADMIN_KEY`
- Value: the master API key (in `metrics-tracker/AGENTS.md` § "Debugging with the API").

## Operating it

**Manually trigger a run** without waiting for the next 03:30 UTC fire — in the GitHub UI: Actions → "Telarchy self-sync" → Run workflow → main → Run workflow. Or via `gh`:

```bash
gh workflow run telarchy-self-sync.yml -R Reblexis/metrics-tracker
```

**View the latest run logs:**

```bash
gh run list -w telarchy-self-sync.yml -R Reblexis/metrics-tracker --limit 5
gh run view --log -R Reblexis/metrics-tracker
```

**Disable the schedule** (e.g. while debugging) — in `.github/workflows/telarchy-self-sync.yml`, comment out the `schedule:` block and push. The `workflow_dispatch:` keeps manual runs available.

## Monitoring

Two surfaces:

1. **Telarchy `/admin` page** — the script pushes a heartbeat (`agentId: telarchy-self-sync`, `status: running` / `idle` / `error`) at the start and end of each cycle. Missing or stale heartbeat is the primary sign that the sync stopped.
2. **GitHub Actions run history** — `https://github.com/Reblexis/metrics-tracker/actions/workflows/telarchy-self-sync.yml`. Failures show up as red runs.

## Cohort auto-derivation

The Wedge metric's cohort is auto-derived from `/api/workspaces` on each run:

- All workspaces with `createdAt` in `[2026-04-29, 2026-06-03)` (concierge window + 1-week buffer for late joiners).
- Excluding workspaces whose `createdBy` matches the platform owner's user ID (constant in `scripts/telarchy-self-sync.js`).

Zero manual input required. As concierge founders create workspaces, they enter the cohort automatically; the metric updates daily.

If the auto-derivation needs correction (e.g. a non-concierge workspace happens to be created in the window), set the `COHORT_WORKSPACE_IDS` env var in the workflow to comma-separated workspace UUIDs. The override replaces the auto-derived list entirely.

## Editing the metric set

1. Edit `scripts/telarchy-self-sync.js`. Add a `computeFoo()` function and wire it into `COMPUTE` with a name that exactly matches the Telarchy metric.
2. Test locally:
   ```bash
   TELARCHY_ADMIN_KEY=<key> node scripts/telarchy-self-sync.js --dry-run --metric "Foo"
   ```
3. Commit + push. The next scheduled run picks it up automatically.

If you add a new metric in the Telarchy workspace, do that first via the API (see `telarchy:telarchy` skill or `metrics-tracker/AGENTS.md`) so the sync's `metrics` GET picks it up by name. Otherwise the run logs `SKIP <name>: not in workspace` and continues.

## Things this doc deliberately does not cover

- Telarchy market mechanics (LMSR, conditional markets, time preference) — see `docs/vision.md` and `https://telarchy.com/api/guides/...`.
- Why each metric is shaped the way it is — that lives on the metric's `description` field on telarchy.com, so traders see it in-product.
- LookPilot's parallel sync — see the LookPilot repo's `docs/infra/telarchy-kpi-sync.md`.
