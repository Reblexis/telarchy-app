---
id: 12-ux-persona-agent-builder
tags: [browse, ux, persona, cold, api-only]
isolation: workspace
parallel-safe: true
needs: []
timeout: 300s
goal-horizon: short
goal-statement: |
  Persona: Sam, a developer who wants to plug a small AI participant
  into Telarchy. Sam reads /api/help, registers an agent, places a
  trade — within 10 minutes — without reading any internal repo docs.
grader: auto
grade-prompt: |
  You are Sam. You opened https://telarchy.com/api with no other
  context. Score:
  - discoverability (1-10): could you find every endpoint you needed
    via /api/help alone?
  - first-trade time (1-10): how clean was the path from key to trade?
  - error legibility (1-10): when you did something wrong, did the
    response tell you what to fix?
  - SDK feel (1-10): does the surface feel cohesive?
  Verdict: BUILD / WAIT_FOR_SDK / WALK_AWAY. Top 2 frictions.
---

# Browse test: Persona — Agent builder (DX)

## What this tests

The participant-symmetry promise from the developer side. Sam never
opens a browser; everything is curl. The spec reproduces an honest
"first-hour" path against the live API.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
mkdir -p "/tmp/$TT_NS-ab"
findings="/tmp/$TT_NS-ab/findings.txt"
:>"$findings"
react() { echo "[T+$(($(date +%s)-T0))s] $1" >> "$findings"; }
T0=$(date +%s)
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
```

## Tests

### T1. /api/help is the first place a developer looks

```bash
help=$(curl -sf "$TT_BASE_URL/api/help")
n=$(jq '.endpoints | length' <<<"$help")
react "/api/help: $n endpoints"
[ "$n" -ge 30 ] || react "FRICTION too few documented endpoints to call this an SDK surface"
echo "=== AUTH LEGEND ===" >> "$findings"
jq -r '.auth_field_legend // .legend // empty' <<<"$help" >> "$findings" || true
```

### T2. /api/agents/register: read the path, derive the body

```bash
endpoint=$(jq -r '.endpoints[] | select(.path=="/api/agents/register") | "\(.method) \(.path) auth=\(.auth) body=\(.body // "?")"' <<<"$help")
echo "register endpoint:" >> "$findings"; echo "$endpoint" >> "$findings"
out=$(curl -sf -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$TT_NS-sambot" --arg ws "$WS" '{agentId:$id, workspaceId:$ws}')" \
  "$TT_BASE_URL/api/agents/register")
KEY=$(jq -r '.apiKey' <<<"$out")
[ -n "$KEY" ] && [ "$KEY" != "null" ] || { react "FRICTION register failed"; exit 1; }
react "registered, got key in $(($(date +%s)-T0))s"
```

### T3. Read your own balance — should be obvious from /me

```bash
me=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/auth/me")
echo "$me" | jq -e '.agent.id, .agent.balance // .agent.balanceCredits' >/dev/null \
  || react "FRICTION /me does not include balance — need an extra call"
```

### T4. List markets, find one to trade on

```bash
mkts=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets")
n=$(jq 'length' <<<"$mkts")
if [ "$n" -lt 1 ]; then
  react "no markets in workspace; create one as Sam (admin would, but test workspace allows it)"
  mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' -X POST \
    -d '{"name":"sam-m","type":"leaf","value":50,"marketRangeMax":100}' \
    "$TT_BASE_URL/api/metrics" | jq -r '.id')
  mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidity:20}')" \
    "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
else
  mkt=$(jq -r '.[0].id' <<<"$mkts")
fi
tt_credit "$WS" "$TT_NS-sambot" 50
react "market id selected: $mkt"
```

### T5. Place a trade — what error do I get on the most natural mistake?

```bash
# Mistake 1: forget Content-Type
status=$(curl -s -o /tmp/$TT_NS-ab/err1.json -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:1}')" \
  "$TT_BASE_URL/api/predictions/trade")
react "no Content-Type: $status — body: $(head -c 300 /tmp/$TT_NS-ab/err1.json)"

# Mistake 2: wrong field name
status=$(curl -s -o /tmp/$TT_NS-ab/err2.json -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, side:"yes", amount:1}')" \
  "$TT_BASE_URL/api/predictions/trade")
react "wrong field: $status — body: $(head -c 300 /tmp/$TT_NS-ab/err2.json)"

# Real attempt
out=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:1}')" \
  "$TT_BASE_URL/api/predictions/trade")
echo "$out" | jq -e '.cost' >/dev/null \
  && react "trade placed in $(($(date +%s)-T0))s (TTHW)" \
  || react "FRICTION real trade also failed: $out"
```

### T6. Read your trades back — close the loop

```bash
trades=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$TT_NS-sambot/trades")
n=$(jq 'length' <<<"$trades")
[ "$n" -ge 1 ] && react "trades round-trip works ($n rows)" || react "FRICTION trades not visible"
```

### T7. Print findings

```bash
echo "=== AGENT-BUILDER FINDINGS ==="
cat "$findings"
echo "Errors saved at: /tmp/$TT_NS-ab/"
```

## Cleanup

Auto.

## Known gaps

- No SDK / library coverage — pure curl. If a TS SDK ships, add a leg.
- No coverage of webhook / event-stream from the agent's perspective.
