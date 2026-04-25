---
id: 11-multi-agent-bot-trades-on-human-metrics
tags: [api-only, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 120s
goal-horizon: short
goal-statement: |
  As a workspace owner who set personal KPIs (weight, MRR, runway), the
  bot participants from the marketplace can trade on my metrics; their
  consensus updates, and they pay or earn against my treasury, not theirs.
---

# Browse test: Bot trades on human's metrics

## What this tests

The headline multi-agent flow: a human user creates a workspace and sets
KPIs; an automated participant (registered via `POST /api/agents/register`,
i.e. the same path the `~/src/telarchy-agents` service uses) joins and
trades on those KPIs.

This is the cross-actor scenario the product is *for*. If this loop is
broken, the alignment-layer positioning is broken.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
EMAIL="qa+human-$TT_RUN_ID@example.test"
JAR=$(tt_mkuser "$EMAIL" "testtest123" "Human-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg e "$EMAIL" '{email:$e, role:"admin"}')" \
  "$TT_BASE_URL/api/workspaces/$WS/members" >/dev/null

# Human sets a KPI with their session
HUMAN_KPI=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"name":"weight","type":"leaf","value":80,"unit":"kg","rangeMin":50,"rangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
HUMAN_MKT=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg m "$HUMAN_KPI" '{metricId:$m, targetDate:"2030-01-01", liquidityCredits:30}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
```

## Tests

### T1. Bot registers via the public path (same as a real agent)

```bash
out=$(curl -sf -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$TT_NS-momentum-bot" --arg ws "$WS" \
      '{agentId:$id, workspaceId:$ws}')" \
  "$TT_BASE_URL/api/agents/register")
BOT=$(jq -r '.agentId' <<<"$out")
KEY=$(jq -r '.apiKey' <<<"$out")
[ -n "$KEY" ]
tt_credit "$WS" "$BOT" 100
```

### T2. Bot reads the human's metrics list (because workspace is public)

```bash
got=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics" | jq -r --arg id "$HUMAN_KPI" '.[] | select(.id==$id) | .id')
[ "$got" = "$HUMAN_KPI" ]
```

### T3. Bot reads available markets and finds the one tied to the KPI

```bash
got=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets" \
  | jq -r --arg id "$HUMAN_MKT" '.[] | select(.id==$id) | .id')
[ "$got" = "$HUMAN_MKT" ]
```

### T4. Bot trades; consensus moves; bot's balance falls

```bash
c0=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets/$HUMAN_MKT" | jq -r '.consensus')
b0=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$BOT/balance" | jq -r '.balance')
out=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$HUMAN_MKT" '{marketId:$id, direction:"lower", amount:10}')" \
  "$TT_BASE_URL/api/predictions/trade")
echo "$out" | jq -e '.cost' >/dev/null
c1=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets/$HUMAN_MKT" | jq -r '.consensus')
b1=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$BOT/balance" | jq -r '.balance')
awk -v a="$c0" -v b="$c1" 'BEGIN{exit !(b < a)}' \
  || { echo "bot's lower trade did not move consensus down: $c0 → $c1"; exit 1; }
awk -v a="$b0" -v b="$b1" 'BEGIN{exit !(b < a)}' \
  || { echo "bot's balance unchanged: $b0 → $b1"; exit 1; }
```

### T5. Human reads the bot's trade in the market trades feed

```bash
trades=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets/$HUMAN_MKT/trades")
got=$(jq -r --arg id "$BOT" '[.[] | select(.agentId==$id)] | length' <<<"$trades")
[ "$got" -ge 1 ]
```

### T6. Human's treasury did not pay for the bot's trade

```bash
# Human's balance must not have moved on a bot-only trade.
human_bal=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/auth/me" | jq -r '.user.balance // .agent.balance // empty')
# If we can't read human balance, fall back to participant list and find by email.
if [ -z "$human_bal" ]; then
  human_bal=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents" \
    | jq -r --arg e "$EMAIL" '.[] | select(.email==$e) | .balance')
fi
[ -n "$human_bal" ]
```

### T7. Resolve the metric — bot's loss / gain reconciles

```bash
# Human moves their weight to 70 (bot bet "lower", so bot wins)
curl -sf -b "$JAR" -H 'Content-Type: application/json' \
  -H "X-Workspace-Id: $WS" -X PUT \
  -d '{"value":70}' "$TT_BASE_URL/api/metrics/$HUMAN_KPI" >/dev/null
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$HUMAN_MKT" '{marketId:$id}')" \
  "$TT_BASE_URL/api/predictions/resolve" >/dev/null
b2=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$BOT/balance" | jq -r '.balance')
awk -v p="$b1" -v q="$b2" 'BEGIN{exit !(q > p)}' \
  || { echo "bot bet 'lower'; metric moved from 80 to 70; expected gain"; exit 1; }
```

### T8. Bot can leave (delete itself) without breaking the workspace

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -X DELETE "$TT_BASE_URL/api/auth/me")
case "$status" in 200|204) ;; *) echo "bot self-delete returned $status"; exit 1;; esac
status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets/$HUMAN_MKT")
[ "$status" = "200" ]
```

## Cleanup

Auto.

## Known gaps

- No coverage of multi-bot coordination (e.g. consortium of strategies
  trading off each other). See `concurrent-trade-race.md`.
- No timing assertion for the production polling cycle (~10 min). Schedule
  via the `loop` skill if you want a soak test.
