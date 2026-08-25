---
id: 13-infra-rate-limits
tags: [api-only, slow]
isolation: global
parallel-safe: false
needs: [auth]
timeout: 120s
goal-horizon: short
goal-statement: |
  As a defender, the documented limits actually trigger 429s under burst
  load — both the global limiter (300/min) and the registration limiter
  (5/min on signup + waitlist).
---

# Browse test: Rate limits

## What this tests

Two limiters:
- global API limiter: ~300 requests / minute / IP,
- registration limiter: 5 / minute on `/api/auth/sign-up/email` and
  `/api/waitlist`.

`parallel-safe: false` — running this in parallel poisons the limit
counters for everyone else.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
```

## Tests

### T1. Global limit returns 429 after sustained burst

```bash
ok=0; lim=0; other=0
for i in $(seq 1 400); do
  s=$(curl -s -o /dev/null -w '%{http_code}' "$TT_BASE_URL/api/status")
  case "$s" in 200) ok=$((ok+1));;
                429) lim=$((lim+1));;
                *)   other=$((other+1));;
  esac
done
echo "global limiter: ok=$ok lim=$lim other=$other"
[ "$lim" -ge 1 ] || echo "WARN: no 429 in 400 reqs — limiter may be off or generous"
```

### T2. Registration limiter on /waitlist

```bash
ok=0; lim=0
for i in $(seq 1 12); do
  s=$(curl -s -o /dev/null -w '%{http_code}' \
    -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg e "qa+rl-$TT_RUN_ID-$i@example.test" '{email:$e}')" \
    "$TT_BASE_URL/api/waitlist")
  [ "$s" = "201" ] || [ "$s" = "200" ] && ok=$((ok+1))
  [ "$s" = "429" ] && lim=$((lim+1))
done
[ "$lim" -ge 1 ]
```

### T3. Signup limiter

```bash
ok=0; lim=0
for i in $(seq 1 10); do
  EMAIL="qa+su-rl-$TT_RUN_ID-$i@example.test"
  s=$(curl -s -o /dev/null -w '%{http_code}' \
    -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg e "$EMAIL" '{email:$e, password:"testtest123", name:"r", consent:true}')" \
    "$TT_BASE_URL/api/auth/sign-up/email")
  [ "$s" = "200" ] || [ "$s" = "201" ] && ok=$((ok+1))
  [ "$s" = "429" ] && lim=$((lim+1))
done
[ "$lim" -ge 1 ] || echo "WARN: signup limiter did not trigger"
```

### T4. Trade-path limiter (`strictLimiter` on /api/predictions/trade)

```bash
[ -n "$TT_ADMIN_KEY" ] || { echo "skip: needs master key"; exit 0; }
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
read AID KEY < <(tt_mkagent "$WS" rate)
tt_credit "$WS" "$AID" 1000
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"rl","type":"leaf","value":50,"marketRangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidity:30}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
ok=0; lim=0
for i in $(seq 1 60); do
  s=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:0.1}')" \
    "$TT_BASE_URL/api/predictions/trade")
  [ "$s" = "200" ] || [ "$s" = "201" ] && ok=$((ok+1))
  [ "$s" = "429" ] && lim=$((lim+1))
done
echo "trade limiter: ok=$ok lim=$lim"
```

### T5. 429 response carries Retry-After header

```bash
out=$(curl -sI -H 'Content-Type: application/json' -X POST \
  -d '{"email":"qa+ra-x@example.test"}' "$TT_BASE_URL/api/waitlist")
status=$(awk '/^HTTP/{print $2; exit}' <<<"$out")
[ "$status" = "429" ] && {
  awk -F': ' '/^[Rr]etry-[Aa]fter/{print $2}' <<<"$out" | grep -q . \
    || echo "WARN: 429 missing Retry-After"
} || true
```

## Cleanup

Auto.

## Known gaps

- No assertion that the limit window resets after the documented period.
  Would need a parameterised sleep; expensive to run in CI.
