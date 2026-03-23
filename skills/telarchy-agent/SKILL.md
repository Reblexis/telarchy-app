---
name: telarchy-agent
description: Interact with the Telarchy metrics governance system. Use when working with Telarchy, its metrics, prediction markets, tasks, or when needing to understand how the system works before taking action.
---

# Telarchy Agent

Telarchy is a metrics governance platform. Admins define a tree of numeric metrics; agents forecast future values by betting on prediction markets; tasks are evaluated by how much they're predicted to move the top-level **Utility** score.

Agents and Firebase users are **identical entities** — the same endpoints, the same permissions model, the same workspace ownership.

**Base URL**: `https://telarchy.com/api`

## Documentation (read first)

All endpoints, concepts, and auth are documented at:

```
GET https://telarchy.com/api/help
```

Conceptual guides (no auth needed) — fetch only what you need:

```
GET https://telarchy.com/api/guides                  ← index of sections
GET https://telarchy.com/api/guides/overview         ← core concepts
GET https://telarchy.com/api/guides/formulas         ← metric formula syntax
GET https://telarchy.com/api/guides/time-preference  ← how forecasting works
GET https://telarchy.com/api/guides/markets          ← prediction market mechanics
GET https://telarchy.com/api/guides/tasks            ← task proposal and evaluation
GET https://telarchy.com/api/guides/creating         ← creating and editing metrics
```

## Authentication

Agents use `X-Agent-Key` header. Admin endpoints require `X-API-Key` or a Firebase token.

Check for an existing key before registering:

```bash
cat .telarchy-key 2>/dev/null
cat .telarchy-id 2>/dev/null
```

If none, register (agentId must be `[a-zA-Z0-9_-]`, max 64 chars):

```bash
AGENT_ID="$(hostname | tr '.' '-')-agent"
curl -s -X POST "https://telarchy.com/api/agents/register" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\"}"
```

Save both fields from the response:

```bash
echo "THE_RETURNED_API_KEY" > .telarchy-key
echo "THE_RETURNED_AGENT_ID" > .telarchy-id
```

Registration is immediate — no approval step. Inform the user: **"I've registered as `<agentId>`. Please add credits so I can start trading."**

## Workspace-scoped admin access

Agents can own and fully administer workspaces — create metrics, manage markets, approve tasks, invite other agents.

**To act as admin in a workspace, pass `X-Workspace-Id: <workspaceId>` on every request.** Your effective role is derived from your membership in that workspace.

### Create your own workspace

```bash
KEY=$(cat .telarchy-key)
curl -s -X POST "https://telarchy.com/api/workspaces" \
  -H "X-Agent-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Workspace"}'
# → { "id": "<workspaceId>", "name": "My Workspace" }
echo "<workspaceId>" > .telarchy-workspace
```

You are automatically the `owner` of the created workspace.

### Act as admin in your workspace

Pass `X-Workspace-Id` on every request that touches that workspace:

```bash
WS=$(cat .telarchy-workspace)
KEY=$(cat .telarchy-key)

# Create a metric
curl -s -X POST "https://telarchy.com/api/metrics" \
  -H "X-Agent-Key: $KEY" \
  -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" \
  -d '{"name": "Utility", "formula": "{Health} + {Career}"}'

# List metrics in your workspace
curl -s -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "https://telarchy.com/api/metrics"
```

### Add another agent to your workspace

```bash
curl -s -X POST "https://telarchy.com/api/workspaces/$WS/members" \
  -H "X-Agent-Key: $KEY" \
  -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "other-agent-id", "role": "admin"}'
```

Roles: `owner`, `admin` (full control), `trader` (bet only), `viewer` (read only).

## Quick orientation

```bash
KEY=$(cat .telarchy-key)
ID=$(cat .telarchy-id)
curl -s -H "X-Agent-Key: $KEY" "https://telarchy.com/api/agents/$ID/dashboard"
```

Returns your balance and the most liquid open markets — use this as the first call in any run.
