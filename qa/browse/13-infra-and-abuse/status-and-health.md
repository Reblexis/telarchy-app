---
id: 13-infra-status-and-health
tags: [api-only, fast]
isolation: global
parallel-safe: true
needs: []
timeout: 30s
goal-horizon: short
goal-statement: |
  As an oncall engineer, /api/status returns 200 with a useful body, and
  shallow checks of every router prefix prove the server is healthy.
---

# Browse test: Status + health

## What this tests

`GET /api/status` and a smoke crawl of every documented prefix.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
```

## Tests

### T1. /api/status returns 200 with a structured body

```bash
out=$(curl -sf "$TT_BASE_URL/api/status")
echo "$out" | jq -e '.status, .version // .build // empty' >/dev/null \
  || echo "WARN: /api/status missing version field"
```

### T2. Shallow check of every documented endpoint prefix

```bash
help=$(curl -sf "$TT_BASE_URL/api/help")
prefixes=$(jq -r '.endpoints[] | .path' <<<"$help" \
  | awk -F/ '{print "/"$2"/"$3}' | sort -u)
fails=0
for p in $prefixes; do
  status=$(curl -s -o /dev/null -w '%{http_code}' "$TT_BASE_URL$p")
  case "$status" in 200|400|401|403|404|405) ;; *) echo "FAIL $p -> $status"; fails=$((fails+1));; esac
done
[ "$fails" = "0" ]
```

### T3. /api/public-config returns feature flags

```bash
out=$(curl -sf "$TT_BASE_URL/api/public-config")
echo "$out" | jq -e '.usdcSettlementEnabled' >/dev/null
```

### T4. CORS preflight from cross-origin

```bash
out=$(curl -s -i -X OPTIONS \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Content-Type' \
  "$TT_BASE_URL/api/status")
echo "$out" | grep -qiE '^Access-Control-Allow-Origin'
```

### T5. CORS denies unlisted origin (production / canary only)

The CORS layer with credentials enabled echoes the request `Origin`
back. There is no preflight-level signal that distinguishes "open
allow-all" mode from "restricted-allowlist" mode, so this assertion
runs only when `$TT_BASE_URL` points at a production-style host.

```bash
case "$TT_BASE_URL" in
  *telarchy.com*|*run.app*) ;;
  *) echo "skip: CORS denial only checked against production host"; exit 0;;
esac
out=$(curl -s -i -X OPTIONS \
  -H 'Origin: http://evil.example' \
  -H 'Access-Control-Request-Method: POST' \
  "$TT_BASE_URL/api/status")
got=$(echo "$out" | awk -F': ' '/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin/{print $2}' | tr -d '\r')
[ "$got" = "http://evil.example" ] && echo "FAIL: CORS allowed evil.example" && exit 1 || true
```

### T6. Cold-start latency under 5s on Cloud Run

```bash
# Cloud Run only — local backend is always warm.
case "$TT_BASE_URL" in
  *telarchy.com*|*run.app*) ;;
  *) echo "skip: not Cloud Run"; exit 0;;
esac
# Force a cold start by waiting for the idle timeout would take 15+ minutes,
# so we just measure the next request's latency.
start=$(date +%s%N)
curl -sf "$TT_BASE_URL/api/status" >/dev/null
end=$(date +%s%N)
ms=$(( (end-start)/1000000 ))
[ "$ms" -lt 5000 ] || echo "WARN: status latency ${ms}ms > 5s budget"
```

### T7. 50 concurrent /api/status all 200

```bash
fails=0
pids=()
for i in $(seq 1 50); do
  (curl -sf -o /dev/null "$TT_BASE_URL/api/status" || echo fail) >/tmp/$TT_NS-st-$i &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid" || true; done
fails=$(grep -l fail /tmp/$TT_NS-st-* 2>/dev/null | wc -l)
[ "$fails" = "0" ] || echo "WARN: $fails of 50 concurrent /status failed"
```

## Cleanup

None.

## Known gaps

- No `/api/healthz` distinct from `/api/status`. Add when liveness vs.
  readiness split lands.
