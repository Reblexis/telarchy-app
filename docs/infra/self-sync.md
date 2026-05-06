# Telarchy self-sync

Daily push of Telarchy's own platform metrics into Telarchy's dogfooding workspace at https://telarchy.com (workspace `Telarchy`, id `qzOIWWj7m6rDInxrvqPx`). Mirrors `docs/metrics.md` into a live KPI tree so prediction markets price every product decision against the metrics that matter.

## What it pushes

Five metrics, defined in `docs/metrics.md` and created in the workspace:

| Metric (Telarchy name) | Source | Cadence |
| --- | --- | --- |
| Wedge: % cohort with ≥2 priced decisions in 4w | cohort auto-derived from /api/workspaces (concierge window, excl. owner) | daily, transient until 2026-05-27 |
| WAU: workspaces with ≥1 priced decision (7d) | iterate all workspaces | daily |
| Forecaster quality: liquidity-weighted Brier (30d) | iterate resolved markets across all workspaces | daily |
| Active forecasters: agents with positive PnL (30d) | per-agent pnlMetric summed across markets resolved in last 30d, via /api/agents/:id/market-pnl | daily |
| Proposal quality: realized vs predicted lift (90d corr) | stub until ≥90d of approved agent-proposed proposals exists | daily (will skip while stubbed) |

The compute logic, including each metric's data path, lives in `scripts/telarchy-self-sync.js`. The `COMPUTE` object near the bottom maps Telarchy metric name → compute function.

## Why this is on Hetzner (and why on the same box as LookPilot)

The sync is a small Node.js oneshot that hits `telarchy.com/api`. It does not strictly need Hetzner egress (no Steam Partner, no GCP-blocked source). It runs on Hetzner because:

1. **Co-tenancy with LookPilot KPI sync** (`5.75.140.10`, `cax11`, ~€4.59/month). Both syncs are tiny daily jobs against `telarchy.com`. One box is cheaper than two and easier to monitor.
2. **Same hardening pattern.** Same systemd unit shape, same `NoNewPrivileges` / `ProtectSystem=strict` / `ProtectHome=read-only` / `PrivateTmp` posture.
3. **No conflict.** Different system user (`telarchy-self-sync`), different `/opt` and `/etc` directories, different log file, different timer (03:30 UTC offset from LookPilot's 03:00).

## Layout on the box

```
/opt/telarchy-self-sync/                   (telarchy-self-sync:telarchy-self-sync 0750)
  telarchy-self-sync.js                    sync script (copy of repo file)

/etc/telarchy-self-sync/                   (root:telarchy-self-sync 0750)
  secrets.env                              mode 0640, root:telarchy-self-sync
                                           TELARCHY_ADMIN_KEY (master API key)
                                           COHORT_WORKSPACE_IDS (optional, comma-separated)

/var/log/telarchy-self-sync.log

/etc/systemd/system/telarchy-self-sync.service    oneshot
/etc/systemd/system/telarchy-self-sync.timer      OnCalendar=*-*-* 03:30:00 UTC
```

## Auth

The sync uses the **master API key** (`TELARCHY_ADMIN_KEY`) rather than an agent key. Reason: every metric except the Wedge needs cross-workspace platform reads (all workspaces' markets, all workspaces' agents). Agent keys are scoped to a single workspace and cannot satisfy that. Master key access is hardened by:

- Env file is `0640 root:telarchy-self-sync`. Unreadable by other users.
- Systemd `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp`. Service can't escalate or escape its sandbox.
- The Hetzner box itself is single-purpose with restricted SSH access.

If a future change reduces all 5 metrics to a single-workspace read, switch to an agent key with `keyScopes: account:agents` and the appropriate workspace `manage` capability.

## Connecting to the box

Same SSH key as LookPilot KPI sync: `~/.ssh/lookpilot_kpi_sync_ed25519`.

```bash
ssh -i ~/.ssh/lookpilot_kpi_sync_ed25519 root@5.75.140.10
```

`telarchy-self-sync` is a system user with `/usr/sbin/nologin`. Use `root` and `sudo -u telarchy-self-sync` for service-identity ops.

## Operating it

Trigger one sync immediately (oneshot, finishes when done):

```bash
ssh -i ~/.ssh/lookpilot_kpi_sync_ed25519 root@5.75.140.10 \
  systemctl start telarchy-self-sync.service
```

Tail the log:

```bash
ssh -i ~/.ssh/lookpilot_kpi_sync_ed25519 root@5.75.140.10 \
  tail -100 /var/log/telarchy-self-sync.log
```

Inspect the next scheduled fire:

```bash
ssh -i ~/.ssh/lookpilot_kpi_sync_ed25519 root@5.75.140.10 \
  systemctl list-timers telarchy-self-sync.timer
```

Disable the timer (e.g. while debugging):

```bash
ssh -i ~/.ssh/lookpilot_kpi_sync_ed25519 root@5.75.140.10 \
  systemctl disable --now telarchy-self-sync.timer
```

## Monitoring

1. **Telarchy `/admin` page.** The sync pushes a heartbeat (`agentId: telarchy-self-sync`, `status: running` / `idle` / `error`) at the start and end of each cycle. A missing or stale heartbeat is the primary sign that the sync stopped.
2. **`/var/log/telarchy-self-sync.log`.** Per-metric output from each run. Read this when a heartbeat shows `error`.

## Editing the metric set

1. Edit `scripts/telarchy-self-sync.js`. Add a `computeFoo()` function and wire it into `COMPUTE` with a name that matches the Telarchy metric exactly.
2. Test locally:
   ```bash
   TELARCHY_ADMIN_KEY=<key> node scripts/telarchy-self-sync.js --dry-run --metric "Foo"
   ```
3. Push to GitHub. Then ship to the box:
   ```bash
   scp -i ~/.ssh/lookpilot_kpi_sync_ed25519 \
     scripts/telarchy-self-sync.js \
     root@5.75.140.10:/opt/telarchy-self-sync/
   ssh -i ~/.ssh/lookpilot_kpi_sync_ed25519 root@5.75.140.10 \
     'chown telarchy-self-sync:telarchy-self-sync /opt/telarchy-self-sync/telarchy-self-sync.js && \
      systemctl start telarchy-self-sync.service && \
      tail -30 /var/log/telarchy-self-sync.log'
   ```
   Or re-run the deploy script — it overwrites in place.

If you also added a metric in the Telarchy workspace, do that first via the API (see the `telarchy:telarchy` skill or this repo's `docs/metrics.md`) so the sync's `metrics` GET picks it up by name. Otherwise the run will log `SKIP <name>: not in workspace` and continue.

## First-time deploy

```bash
bash scripts/hetzner-self-sync-deploy.sh 5.75.140.10
```

The deploy script expects:
- `~/keyring/secrets/hcloud.token` (already present from LookPilot)
- `~/keyring/secrets/telarchy-master.apikey` (Telarchy master API key — paste from `metrics-tracker/AGENTS.md`)
- `~/.ssh/lookpilot_kpi_sync_ed25519`
- Optional: `~/keyring/secrets/telarchy-self-sync.cohort` with comma-separated cohort workspace UUIDs

## Cohort auto-derivation

The Wedge metric's cohort is auto-derived from `/api/workspaces` on each run:

- All workspaces with `createdAt` in `[2026-04-29, 2026-06-03)` (concierge window + 1-week buffer for late joiners).
- Excluding any workspace whose `createdBy` matches the platform owner's user ID (constant in `scripts/telarchy-self-sync.js`).

So the metric requires zero manual input. As concierge founders create workspaces, they enter the cohort automatically; the metric updates daily.

If the auto-derivation needs correction (e.g. a non-concierge workspace happens to be created in the window), drop a `~/keyring/secrets/telarchy-self-sync.cohort` file with comma-separated workspace UUIDs and re-run the deploy. The override replaces the auto-derived list entirely.

## Things this doc deliberately does not cover

- Telarchy market mechanics (LMSR, conditional markets, time preference) — see `docs/vision.md` and `https://telarchy.com/api/guides/...`.
- Why each metric is shaped the way it is — see `docs/metrics.md` for the canonical definitions and computation rules.
- LookPilot's parallel sync — see the LookPilot repo's `docs/infra/telarchy-kpi-sync.md`.
