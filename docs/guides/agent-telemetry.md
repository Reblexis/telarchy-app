---
title: Agent telemetry protocol
description: How any trading agent (first-party or third-party) makes itself visible in /admin → Bot agents.
category: api
order: 40
---
# Agent telemetry protocol

Any trading agent that follows this contract appears in the `/admin → Bot agents` panel exactly like the platform's first-party bots: heartbeats with a live next-cycle countdown, expandable per-session decision traces, filter chips for outcomes / strategies / metrics. There is no allowlist and no per-agent UI code.

## Endpoints

- `POST /api/admin/agent-heartbeat` — upserts one row per `agentId`. Push at cycle start with `status:"running"` and at end with the final counts. Required: `agentId`. Useful: `status`, `workspaceId`, `strategy`, `lastCycleStartedAt`, `lastCycleEndedAt`, `nextCycleAt`, `pollIntervalSeconds`, `lastTraded`, `lastSkipped`, `lastErrors`, `lastError`, `balance`. Returns `204`.
- `POST /api/admin/agent-traces` — one trace per session, with `entries[]` per market the strategy considered. Required: `workspaceId`, `agentId`, `strategy`, `startedAt`. Useful: `endedAt`, `model`, `tokensIn/Out`, `cacheRead/Write`, `candidates`, `traded`, `skipped`, `errors`, `costUsd`, `entries[]`. Returns `{id}`.
- `GET /api/admin/agent-heartbeats` and `GET /api/admin/agent-traces` — read paths used by the panel. Workspace admins see only their workspace; platform admins / master key see all.

## Auth

Both POST endpoints require the `manage` capability in the target workspace. Either the master `X-API-Key` (first-party operator) or an `X-Agent-Key` whose group grants `manage` (any registered agent in a workspace whose admins have promoted it). Always include `X-Workspace-Id`.

## Per-entry shape

Each item in `entries[]`:

```json
{
  "marketId": "string (required)",
  "metric": "string (metric name shown in UI)",
  "targetDate": "ISO 8601 date",
  "rangeMin": 0, "rangeMax": 1000,
  "consensus": 500, "estimate": 650, "confidence": 0.74,
  "distance": 150, "threshold": 80,
  "outcome": "trade | trade-error | trade-too-small | skip-under-threshold | unknown-market | <custom>",
  "reasoning": "one short sentence explaining the call",
  "cost": 0.05, "resultingConsensus": 540, "error": null
}
```

## Outcome vocabulary

Five canonical outcomes have hand-picked colors and meanings already understood by operators:

- `trade`: placed a trade. Set `cost` and `resultingConsensus`.
- `trade-error`: trade attempt failed. Set `error`.
- `trade-too-small`: edge present but below LMSR minimum.
- `skip-under-threshold`: distance below threshold; market consensus already close to the strategy's estimate.
- `unknown-market`: market id appeared but couldn't be resolved.

Custom outcome strings are allowed and rendered with a deterministic fallback color. Prefer canonical when possible.

## Reasoning field

This is what the operator reads to answer "why didn't this agent bet on this metric?". Keep it to one sentence (≤200 chars), prefix with your strategy name, and include the inputs you computed from. Example: `"Anchor: future ≈ today. Current metric=44368, 4.3mo out → confidence=0.74. Distance 5632 < threshold 6800."`

## Caps and rendering

- Send ≤ 25 most-informative entries per trace (sort by outcome priority, then biggest distance).
- Reuse the same `agentId` across cycles so the heartbeat upserts cleanly.
- Reuse the same `strategy` string across cycles so the chip stays stable.
- The panel polls every 5 s; sub-second visibility is not in scope.

Full reference, including a Python heartbeat example: `docs/agent-telemetry-protocol.md` in the repo.
