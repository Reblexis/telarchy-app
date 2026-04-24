# Agent telemetry protocol

How third-party trading agents make themselves visible in the
`/admin → Bot agents` panel. The protocol is open: any agent that follows
the contract below appears in the panel exactly like the platform's
first-party bots, with the same heartbeats, traces, filters, and
expandable per-market reasoning.

This is the only way an agent earns a place in the admin observability
view. There is no allowlist, no per-agent code in the UI, no opt-in
beyond the protocol itself.

## When to use this

Use this protocol if you operate a bot or agent that:

- Trades against Telarchy markets on a recurring schedule (the heartbeat
  story is built around polling cycles); and
- Wants its activity to be inspectable by workspace admins (so they can
  understand why it traded or didn't).

If your agent only trades occasionally on user demand — e.g. a CLI a human
runs by hand — heartbeats are still useful but per-cycle traces probably
aren't a fit.

## Identity and authorization

Telemetry endpoints accept either:

- **The platform master key** (`X-API-Key: $ADMIN_KEY`) for first-party
  bots run by the platform operator. This is what
  `~/src/telarchy-agents` uses today.
- **A workspace-trusted agent key** (`X-Agent-Key: <key>`) for any
  registered agent. The endpoint requires the `manage` capability in
  the target workspace. Workspaces grant `manage` via the Public or
  Trader group capabilities (`PUT /api/groups/:id`), so an agent that
  belongs to a workspace whose Public group has `manage` can self-report
  immediately. For private workspaces, an admin must add `manage` to the
  group the agent belongs to before its telemetry will be accepted.

Both paths must include `X-Workspace-Id` on every request. For traces,
`workspaceId` in the body is authoritative; for heartbeats, the
`workspaceId` in the body identifies the workspace the most recent cycle
visited (may be omitted for service-level heartbeats).

There is no separate "telemetry token" — telemetry is an admin write,
gated by the same capability check as every other admin endpoint.

## Endpoints

Two endpoints, both under `/api/admin/`:

### POST `/api/admin/agent-heartbeat`

One row per agent identifier (upserted). Tells the panel "this agent
exists, here's its current state".

**Body** (all fields except `agentId` are optional):

```json
{
  "agentId": "string (required, your stable bot id, e.g. 'bot-momentum')",
  "status": "'idle' | 'running' | 'error'",
  "workspaceId": "string (workspace this cycle visited)",
  "strategy": "string (free-form label of your strategy, e.g. 'momentum')",
  "lastCycleStartedAt": "ISO 8601 timestamp",
  "lastCycleEndedAt": "ISO 8601 timestamp",
  "nextCycleAt": "ISO 8601 timestamp (used for the live countdown)",
  "pollIntervalSeconds": 300,
  "workspacesVisited": 1,
  "lastTraded": 0,
  "lastSkipped": 27,
  "lastErrors": 0,
  "lastError": "string (optional human-readable error from last cycle)",
  "balance": 999.55
}
```

**Cadence:** push at cycle start with `status: 'running'` and again at
cycle end with the final counts. The panel renders the most recent row.
Stale rows (no update within `2 × pollIntervalSeconds`) are visible but
the next-cycle countdown will read `overdue`.

**Response:** `204 No Content` on success.

### POST `/api/admin/agent-traces`

One trace per session (a session is whatever unit of work makes sense
for your strategy; for polling bots it's typically one cycle per
workspace). Each trace carries a list of `entries`, one per market the
strategy considered.

**Body:**

```json
{
  "workspaceId": "string (required)",
  "agentId": "string (required, must match the agentId you use for heartbeats)",
  "strategy": "string (required, free-form label)",
  "startedAt": "ISO 8601 timestamp (required)",
  "endedAt": "ISO 8601 timestamp",
  "model": "string (LLM model id if applicable, else null)",
  "tokensIn": 0,
  "tokensOut": 0,
  "cacheRead": 0,
  "cacheWrite": 0,
  "candidates": 27,
  "traded": 0,
  "skipped": 27,
  "errors": 0,
  "costUsd": 0.0,
  "entries": [
    {
      "marketId": "string (required)",
      "metric": "string (metric name shown in UI)",
      "targetDate": "ISO 8601 date (market resolution date)",
      "rangeMin": 0,
      "rangeMax": 1000,
      "consensus": 500,
      "estimate": 650,
      "confidence": 0.74,
      "distance": 150,
      "threshold": 80,
      "outcome": "string (see vocabulary below)",
      "reasoning": "string (one sentence explaining the call)",
      "cost": 0.05,
      "resultingConsensus": 540,
      "error": "string (only for trade-error)"
    }
  ]
}
```

**Cap:** keep `entries` to ~25 most-informative rows. The platform's own
helper (`telarchy-agents/src/strategies/_trace.ts`) sorts by outcome
priority (trade and trade-error first, then biggest-distance skips). If
you push 1000 entries per trace, the DB will hold them but the panel
will be slow to render and noisy to read.

**Response:** `201 Created` with `{ id }`.

## The `outcome` vocabulary

The five **canonical outcomes** are surfaced as filter chips with stable
colors:

| Outcome | Meaning | Color |
| --- | --- | --- |
| `trade` | Strategy placed a trade. `cost` and `resultingConsensus` should be set. | green |
| `trade-error` | Strategy attempted to trade but the API returned an error. `error` should be set. | red |
| `trade-too-small` | Edge present but below LMSR minimum trade size. | amber |
| `skip-under-threshold` | Considered the market but `distance < threshold`, so no trade. | grey |
| `unknown-market` | Market id appeared but couldn't be resolved against status. | purple |

You may emit **additional outcome strings** if your strategy has
distinctions the canonical vocabulary doesn't capture. They will appear
as chips with a deterministic color picked from a fallback palette. Keep
them short (one or two hyphenated words) and reuse the same string
across cycles so the chip stays stable across renders.

If you can map your situation onto a canonical outcome, prefer that —
the canonical chips have a hand-picked color and an established meaning
operators already understand.

## The `reasoning` field

This is what makes the panel useful, so spend the few cycles needed to
write it well. Operators read it to answer "why did this agent not bet
on this metric?". Good reasoning strings are:

- **One sentence**, ≤ 200 chars.
- **Quantitative** where possible — include the inputs your decision was
  computed from, not just the conclusion. "Distance 150 < threshold 200"
  beats "consensus close enough".
- **Strategy-attributed** — start with your strategy name so the entry
  reads top-down. The first-party `anchor` strategy uses
  `"Anchor: future ≈ today. Current metric=X, Y mo out → confidence=Z. ..."`.
- **Lossy is fine** — if the strategy's output is a 20-line proof, summarise
  it. The operator wants the gist.

## Minimal example: a Python heartbeat

```python
import os, requests, datetime

requests.post(
    "https://telarchy.com/api/admin/agent-heartbeat",
    headers={
        "X-Agent-Key": os.environ["MY_AGENT_KEY"],
        "X-Workspace-Id": os.environ["MY_WORKSPACE_ID"],
        "Content-Type": "application/json",
    },
    json={
        "agentId": "bot-vector-similarity",
        "strategy": "vector-similarity",
        "status": "idle",
        "lastCycleEndedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "nextCycleAt": (datetime.datetime.utcnow() + datetime.timedelta(minutes=5)).isoformat() + "Z",
        "pollIntervalSeconds": 300,
        "lastTraded": 2,
        "lastSkipped": 25,
        "lastErrors": 0,
    },
)
```

Within 5 seconds, this agent appears in `/admin → Bot agents` for any
workspace admin who has it as a member of a `manage`-capable group.

## Display rules (what the UI does with your data)

- **Heartbeat row**: agentId + strategy chip + status chip + relative-time
  for last cycle + countdown for next cycle + last result counters
  (`<traded>t <skipped>s [<errors>e]`) + balance.
- **Trace row**: collapsed → agentId + timestamp + strategy + model +
  short workspace id (only in cross-workspace view) + counter line + cost.
  Expanded → tokens line + per-entry list.
- **Per-entry row**: outcome chip + clickable metric name + target date +
  monospace numeric line (`consensus → estimate · conf · dist vs thresh
  · cost · post`) + reasoning quote on its own line + error in red if any.
- **Filters**: outcome chips, strategy chips, metric/market search,
  hide-empty toggle, all-workspaces toggle (platform admins only). Chips
  are derived from observed data: any new strategy or outcome string in
  a fresh trace shows up as a chip on the next refresh.

## What this protocol does NOT cover

- **Per-agent UI customisation.** There is no way to add a custom widget,
  custom column, or branded badge for your agent. The point of the
  protocol is uniformity — every agent is rendered the same way.
- **Bidirectional control.** The platform doesn't push commands back to
  your agent. Telemetry is one-way (agent → platform).
- **Retention guarantees.** Traces and heartbeats live in the same DB
  as everything else; old traces may eventually be pruned by a retention
  job (TBD). Don't store anything here that you couldn't reconstruct.
- **Real-time streaming.** The panel polls every 5 s. Sub-second
  visibility is not in scope.
