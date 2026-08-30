# Decisions and records: docs/metrics.md

Records evicted from `docs/metrics.md` on 2026-08-25; the doc states the resulting rules in present tense.

## 2026-08-25: Money, Revenue, trailing 30 days (USD)

**Added 2026-08-25 (Viktor: "lets add revenue metric to telarchy").**

## 2026-08-25: Money, Implied valuation (USD)

**Added 2026-08-25 (Viktor: "another metric of telarchy should be valuation essentially if invested in what is the implied valuation.. if not invested.. it resovles N/A").**

## 2026-08-30: the self-sync moved into the app, and records a reading every hour

**Reported 2026-08-30 (Viktor: "Why I don't see the Telarchy revenue metric number still not being updated. Essentialy, it should be updated every hour to the latest metric number, but I just see one number there ... and when I hover over the graph, it's just [flat] and it's not even on the graph itself ... All the hierarchy metrics, not just the revenue.").**

Two causes, both real.

**The cadence was GitHub's, not ours.** `.github/workflows/telarchy-self-sync.yml`
ran the push on a GitHub Actions `schedule`. GitHub delivered that job about once
a day and hours late: the `40 23 * * *` cron fired at 23:54, 04:59, 07:03, 04:17
and 01:36 UTC on five consecutive days, and after the cron became `40 * * * *` at
09:17 UTC on 2026-08-30 no run fired in the following four and a half hours. Every
run that did fire reported success, so the failure was invisible from inside:
the job was green, the metric was a day stale. The sync now runs as
`POST /api/cron/self-sync` on the same Cloud Scheduler that resolves markets
(`telarchy-self-sync`, `40 * * * *`), with no agent key and no round trip through
the public route. The workflow and `scripts/telarchy-self-sync.js` are deleted.

**"Write only when it changed" is what emptied the chart.** The old script skipped
an unchanged number so the public reading log would not fill with identical rows.
Revenue has been $0 every hour since the metric was created on 2026-08-25, so it
held exactly one reading, five days old: one dot, no line, nothing under the
cursor. A number that was genuinely re-measured on the hour is a measurement, so
the sync now records one on every run. What stays gated on an actual change is the
updates-feed row and the `metric:updated` event, which are notifications - the
fleet does not need waking 24 times a day to hear that revenue is still zero.
`metric-log-is-a-measurement.test.ts` is untouched and still passes: what it
forbids is a reading written by an EDIT (a rename stamping last week's total
inside this week), which is a different thing from a re-measurement.

**Three of the floor's four metrics are synced, not four.** `Active traders`,
`Weekly active verified traders` and `Telarchy revenue (USD)` all come from
`GET /api/marketplace/stats`. `Implied valuation (USD)` is deliberately left
alone: it carries `resolvesNaUntilMeasured`, and that state ends for good at its
first reading, so an hourly $0 would settle every market on it against a number
no investment has ever produced. It stays a number the owner logs on the day an
investment closes.
