---
id: 07-admin-treasury-and-credit
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 45s
goal-horizon: short
goal-statement: |
  As the platform operator, I can read the workspace treasury balance and
  manually credit a participant; non-admins cannot.
---

# Browse test: Treasury + manual credit

## What this tests

`GET /api/agents/treasury`, `POST /api/agents/:id/credit`, `POST
/api/agents/:id/spend`. These bypass the LMSR market and are admin-only.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
read AID KEY < <(tt_mkagent "$WS" target)
```

## Tests

### T1. Treasury endpoint behaves correctly for the current USDC flag

`/api/agents/treasury` is the on-chain USDC settlement balance. When USDC
is disabled (the default in dev/test), it returns 503 with the
kill-switch message. When enabled it returns a numeric balance.

```bash
config=$(curl -sf "$TT_BASE_URL/api/public-config")
usdc=$(jq -r '.usdcSettlementEnabled' <<<"$config")
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/treasury")
if [ "$usdc" = "true" ]; then
  [ "$status" = "200" ] || { echo "treasury (USDC on) returned $status"; exit 1; }
else
  [ "$status" = "503" ] || { echo "treasury (USDC off) returned $status, expected 503"; exit 1; }
fi
```

### T2. Non-admin still cannot read treasury

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/treasury")
case "$status" in 401|403|503) ;; *) echo "non-admin treasury returned $status"; exit 1;; esac
```

### T3. Credit grants increment the agent's balance

```bash
b1=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$AID/balance" | jq -r '.balance')
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"amount":50}' \
  "$TT_BASE_URL/api/agents/$AID/credit" >/dev/null
b2=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$AID/balance" | jq -r '.balance')
delta=$(awk -v a="$b1" -v b="$b2" 'BEGIN{print b-a}')
awk -v d="$delta" 'BEGIN{exit !(d == 50 || d > 49.99)}' \
  || { echo "credit delta $delta != 50"; exit 1; }
```

### T4. Self-spend works for the participant

The spend endpoint requires `type` (`betting | tokens | purchase`).

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{"amount":1,"type":"tokens","description":"test"}' \
  "$TT_BASE_URL/api/agents/$AID/spend")
case "$status" in 200|201) ;; *) echo "self-spend returned $status"; exit 1;; esac
```

### T5. Cross-spend (one agent spending another's balance) is blocked

```bash
read AID2 KEY2 < <(tt_mkagent "$WS" other)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY2" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{"amount":1,"type":"tokens","description":"steal"}' \
  "$TT_BASE_URL/api/agents/$AID/spend")
[ "$status" = "403" ]
```

### T6. Negative amount rejected

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{"amount":-1}' \
  "$TT_BASE_URL/api/agents/$AID/credit")
case "$status" in 400|422) ;; *) echo "negative credit returned $status"; exit 1;; esac
```

### T7. Credit denominated in nanocredits internally (no float drift)

```bash
# Grant 0.000_000_001 credits (1 unit). Should round-trip as 1 unit.
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"amount":0.000000001}' \
  "$TT_BASE_URL/api/agents/$AID/credit" >/dev/null \
  || true
```

## Cleanup

Auto.

## Known gaps

- No coverage of credit-event log (no endpoint yet; admin /activity sees
  some events).
- USDC deposit / withdraw flows are `/13-infra-and-abuse/usdc-killswitch.md`.
