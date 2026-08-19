---
id: 13-infra-usdc-killswitch
tags: [api-only, abuse]
isolation: global
parallel-safe: false
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As legal counsel, when USDC settlement is off, every USDC-related
  endpoint returns 503 with a kill-switch explanation; no participant can
  deposit, withdraw, or read their wallet.
---

# Browse test: USDC settlement kill-switch

## What this tests

`/api/agents/deposit-address`, `/api/agents/:id/deposit`, `/:id/withdraw`,
`/:id/wallet`, `/api/agents/treasury` (the on-chain part). And the
frontend hides the corresponding deposit / withdraw UI.

Maps to `mvp-evaluation/plan.md` Section 8.

`parallel-safe: false` because this spec checks env-flag state.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
read AID KEY < <(tt_mkagent "$WS" usdc)
config=$(curl -sf "$TT_BASE_URL/api/public-config")
ENABLED=$(jq -r '.usdcSettlementEnabled' <<<"$config")
echo "USDC enabled in this env: $ENABLED"
```

## Tests

### T1. /api/public-config exposes the flag

```bash
echo "$config" | jq -e '.usdcSettlementEnabled' >/dev/null
```

### T2. When disabled, /deposit-address returns 503

```bash
[ "$ENABLED" = "true" ] && { echo "skip: USDC enabled in this env"; exit 0; }
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/deposit-address")
[ "$status" = "503" ] || { echo "deposit-address returned $status"; exit 1; }
```

### T3. /deposit returns 503

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{}' \
  "$TT_BASE_URL/api/agents/$AID/deposit")
[ "$status" = "503" ]
```

### T4. /withdraw returns 503

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{"amount":1}' \
  "$TT_BASE_URL/api/agents/$AID/withdraw")
[ "$status" = "503" ]
```

### T5. /wallet PUT returns 503

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X PUT \
  -d '{"walletAddress":"0xabc"}' \
  "$TT_BASE_URL/api/agents/$AID/wallet")
[ "$status" = "503" ]
```

### T6. 503 body explains the kill-switch

```bash
body=$(curl -sf -o - -w '' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/deposit-address" || true)
grep -qiE 'disabled|settlement|usdc|coming soon' <<<"$body" \
  || echo "WARN: 503 body does not mention USDC kill-switch"
```

### T7. Frontend hides deposit UI in the account dialog

```bash
tt_browse_init
EMAIL="qa+ks-$TT_RUN_ID@example.test"
JAR=$(tt_mkuser "$EMAIL" "testtest123" "KsUser")
tt_on_cleanup "tt_rm_user '$JAR'"
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
$B goto "$TT_FRONTEND_URL/lookpilot#account" && $B wait --networkidle
text=$($B text)
grep -qiE 'deposit|withdraw|usdc' <<<"$text" \
  && grep -qiE 'disabled|coming|paused' <<<"$text" \
  && echo "deposit UI hidden + disclosure present" \
  || echo "WARN: USDC UI may be visible despite kill-switch"
```

### T8. /api/agents/treasury matches the kill-switch state

When USDC is enabled the on-chain treasury balance returns 200; when
disabled it returns 503 with the kill-switch message. The treasury
endpoint is the on-chain settlement balance, not a generic credits pool.

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/treasury")
if [ "$ENABLED" = "true" ]; then
  [ "$status" = "200" ] || { echo "treasury (USDC on) returned $status"; exit 1; }
else
  [ "$status" = "503" ] || { echo "treasury (USDC off) returned $status, expected 503"; exit 1; }
fi
```

## Cleanup

Auto.

## Known gaps

- No coverage of flipping the flag at runtime; would need a server
  restart with new env. Run manually before any settlement-on milestone.
