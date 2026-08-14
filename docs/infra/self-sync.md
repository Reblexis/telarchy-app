# Telarchy self-sync

**Rebuilt 2026-08-14 (owner decision: resurrect the dogfooding workspace as
a public floor).** The 2025-era version of this sync pushed four platform
metrics into a Firestore-era workspace (`qzOIWWj7m6rDInxrvqPx`); that
workspace died in the Postgres migration and the sync zombie-failed daily
(stale master-key secret, 401 on every run) until this rebuild. The four
researcher metrics (liquidity-weighted Brier, proposal-quality correlation,
...) were dropped: a public floor follows the one-public-metric doctrine
(2026-08-08, see the LookPilot floor) - a stranger must understand the whole
workspace in one sentence.

## The workspace

Telarchy dogfoods itself: a public workspace named **Telarchy** (floor at
`telarchy.com/telarchy`) with **one metric**, priced by its own markets,
with its own jobs board. The workspace id and the sync identity are recorded
in the Provisioning section below.

## The metric

**Weekly active verified traders** (revised 2026-08-14, same day, before
meaningful trading; supersedes "Weekly active participants"): distinct
participants who (a) have a **Manifold account synced** and (b) placed
trades totalling **at least 100 credits** (abs cost, so sells count as
activity) in the trailing 7 days, across every workspace. Verified means
the participant claimed a public Manifold profile via the import flow, so
every counted trader maps to a real external record anyone can inspect
(linked profiles are visible on the leaderboard). The 100-credit floor
keeps a costless gesture from counting: signup credits are free and the
owner resolves a market on this number. It can go down, which is the
property that matters: registrations and import counts are stocks that
only ratchet up; this is a flow. Early weeks near zero mean nobody showed
up yet, and the charter says so plainly.

**Provenance is the point.** The number is computed server-side and served
on the public, unauthenticated `GET /api/marketplace/stats` route as
`weeklyActiveVerifiedTraders` - the same route that serves as resolution source
for the Manifold-import market, for the same reason: a resolution source has
to be readable by the people being asked to trust it. The sync adds no
computation of its own; anyone can check the number at any time. Its exact
definition is pinned by `functions/src/__tests__/marketplace-stats.test.ts`.

## The sync

`scripts/telarchy-self-sync.js`: reads `weeklyActiveVerifiedTraders` from the
public stats route, PUTs it into the workspace's metric, and heartbeats to
`/admin` as agent `telarchy-self-sync` (strategy `self-sync-v2`). Runs on a
**GitHub Actions cron** (`.github/workflows/telarchy-self-sync.yml`) daily
at **23:40 UTC** - pre-boundary, the same settlement discipline as
LookPilot's KPI sync: markets settle on the last value at-or-before the
next-day 00:00 UTC boundary.

Why GitHub Actions and not a VM: the sync only talks to `telarchy.com/api`
(no Hetzner-ASN egress requirement, unlike LookPilot's Steam reads), and the
job is a few seconds on the free tier.

## Secrets

Two repo secrets (Settings → Secrets and variables → Actions):

- **`TELARCHY_SELF_SYNC_KEY`** - the `telarchy-self-sync` agent's key. An
  admin member of the dogfooding workspace and nothing else; deliberately
  NOT the master key (the old design used the master key and its stale copy
  401'd for months - a scoped key caps both the blast radius and the
  rotation surface).
- **`TELARCHY_SELF_SYNC_WORKSPACE`** - the workspace id.

## Operating it

```bash
# Trigger a run now
gh workflow run telarchy-self-sync.yml -R Reblexis/telarchy-app

# Latest runs / logs
gh run list -w telarchy-self-sync.yml -R Reblexis/telarchy-app --limit 5

# Local dry run (no writes)
TELARCHY_SELF_SYNC_KEY=... TELARCHY_SELF_SYNC_WORKSPACE=... \
  node scripts/telarchy-self-sync.js --dry-run
```

## Monitoring

1. **Telarchy `/admin` page**: heartbeat from `telarchy-self-sync`
   (`running` / `idle` / `error`). Missing or stale heartbeat is the primary
   signal.
2. **GitHub Actions run history** for the workflow: failures are red runs.

## Provisioning record

Filled at creation time (2026-08-14); update on rotation or re-provisioning:

- Workspace: created via `POST /api/workspaces` (master key), name
  `Telarchy`, visibility `public`. Id: see `TELARCHY_SELF_SYNC_WORKSPACE`
  repo secret; also listed by `GET /api/marketplace/workspaces/public`.
- Metric: `Weekly active verified traders` (range 0-50), via `POST /api/metrics`,
  description carries the definition + provenance URL so traders can verify
  without leaving the platform.
- Market: month-end horizon (`targetDate: 2026-08`, resolves 1 September
  2026 on the value as of the boundary; owner decision 2026-08-14, revised
  from the initial year-end horizon before any trades), owner-seeded
  liquidity. On resolution, set the next horizon on the metric's
  `timePreference.customHorizons` and re-seed.
- Sync agent: `telarchy-self-sync`, registered via
  `POST /api/agents/register`, promoted to the workspace Admin group.
