# Agent telemetry protocol

How third-party trading agents report their cycles to the platform. The
protocol is open: any agent that follows the contract below is stored
exactly like the platform's first-party bots, with the same heartbeats and
traces, and is read back through the admin read endpoints
(`GET /api/admin/agent-heartbeats`, `GET /api/admin/agent-traces`, both
`manage`).

This is the only way an agent's activity becomes inspectable by workspace
admins. There is no allowlist and no opt-in beyond the protocol itself.

The wire contract (fields, caps, response codes) is carried by the
`/api/help` catalog; the served guide `agent-telemetry` is the human
summary. This document owns what the catalog cannot hold: the outcome
vocabulary, the reasoning contract, cadence and retention.

## When to use this

Use this protocol if you operate a bot or agent that:

- Trades against Telarchy markets on a recurring schedule (the heartbeat
  story is built around polling cycles); and
- Wants its activity to be inspectable by workspace admins (so they can
  understand why it traded or didn't).

If your agent only trades occasionally on user demand (e.g. a CLI a human
runs by hand), heartbeats are still useful but per-cycle traces probably
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

There is no separate "telemetry token": telemetry is an admin write,
gated by the same capability check as every other admin endpoint.

## Endpoints

Two endpoints, both under `/api/admin/`:

### POST `/api/admin/agent-heartbeat`

One row per agent identifier (upserted). Says "this agent exists, here is
its current state".

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
cycle end with the final counts. The most recent row is what a reader
sees. A row with no update within `2 x pollIntervalSeconds` is stale and
reads as overdue.

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
  "startedAt": "ISO 8601 timestamp (optional; defaults to the time of receipt)",
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

**Cap:** a trace carries at most 40 entries and 64 KB of JSON; more is
refused with 400. Send the most informative rows: the platform's own
helper (`telarchy-agents/src/strategies/_trace.ts`) sorts by outcome
priority (trade and trade-error first, then biggest-distance skips).

**Response:** `201 Created` with `{ id }`.

## The `outcome` vocabulary

The five **canonical outcomes** have stable colors:

| Outcome | Meaning | Color |
| --- | --- | --- |
| `trade` | Strategy placed a trade. `cost` and `resultingConsensus` should be set. | green |
| `trade-error` | Strategy attempted to trade but the API returned an error. `error` should be set. | red |
| `trade-too-small` | Edge present but below LMSR minimum trade size. | amber |
| `skip-under-threshold` | Considered the market but `distance < threshold`, so no trade. | grey |
| `unknown-market` | Market id appeared but couldn't be resolved against status. | purple |

You may emit **additional outcome strings** if your strategy has
distinctions the canonical vocabulary doesn't capture. They get a
deterministic color picked from a fallback palette. Keep them short (one
or two hyphenated words) and reuse the same string across cycles.

If you can map your situation onto a canonical outcome, prefer that: the
canonical outcomes have a hand-picked color and an established meaning
operators already understand.

## The `reasoning` field

This is what makes a trace useful, so spend the few cycles needed to
write it well. Operators read it to answer "why did this agent not bet
on this metric?". Good reasoning strings are:

- **One sentence**, at most 200 chars.
- **Quantitative** where possible: include the inputs your decision was
  computed from, not just the conclusion. "Distance 150 < threshold 200"
  beats "consensus close enough".
- **Strategy-attributed**: start with your strategy name so the entry
  reads top-down. The first-party `anchor` strategy uses
  `"Anchor: future ≈ today. Current metric=X, Y mo out → confidence=Z. ..."`.
- **Lossy is fine**: if the strategy's output is a 20-line proof, summarise
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

This agent is then readable from `GET /api/admin/agent-heartbeats` by any
workspace admin who has it as a member of a `manage`-capable group.

## What this protocol does NOT cover

- **Per-agent customisation.** There is no custom field, column or badge
  for your agent. The point of the protocol is uniformity: every agent is
  stored and read the same way.
- **Bidirectional control.** The platform doesn't push commands back to
  your agent. Telemetry is one-way (agent to platform).
- **Long retention.** Traces are kept 90 days (`services/maintenance.ts`)
  and then deleted. Don't store anything here that you couldn't
  reconstruct.
- **Real-time streaming.** Sub-second visibility is not in scope.
