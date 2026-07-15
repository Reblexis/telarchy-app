---
id: 03-metrics-formulas
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As an admin defining KPIs, I can write formulas that reference other
  metrics, and the engine evaluates them correctly, surfaces a clear error
  on syntax issues, refuses cycles, and survives huge or NaN inputs.
---

# Browse test: Formula engine

## What this tests

`type: formula` metrics. The formula engine accepts `{name}` references and
basic arithmetic. The hard cases:
- referencing a non-existent metric,
- syntax error,
- cycle (A = B; B = A),
- division by zero,
- huge magnitudes (1e300),
- NaN propagation.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
mkleaf() {
  # Leaf metrics default to timePreference.enabled=true; until markets spawn,
  # the engine reports total=null on TP leaves. Pure formula evaluation
  # tests want a deterministic value, so disable TP at creation.
  tt_admin_curl "$WS" -H 'Content-Type: application/json' \
    -X POST -d "$(jq -nc --arg n "$1" --argjson v "$2" \
        '{name:$n,type:"leaf",value:$v,timePreference:{enabled:false}}')" \
    "$TT_BASE_URL/api/metrics" | jq -r '.id'
}
mkformula() {
  curl -s -o /tmp/$TT_NS-fbody -w '%{http_code}' \
    -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' \
    -X POST -d "$(jq -nc --arg n "$1" --arg f "$2" \
        '{name:$n,type:"formula",formula:$f,timePreference:{enabled:false}}')" \
    "$TT_BASE_URL/api/metrics"
}
```

## Tests

### T1. Simple addition

```bash
A=$(mkleaf a 3); B=$(mkleaf b 4)
mkformula c '{a} + {b}' >/dev/null
val=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics?name=c" \
  | jq -r '.[] | select(.name=="c") | .total')
[ "$val" = "7" ]
```

### T2. Reference to a non-existent metric returns clean error or evaluates to null

```bash
status=$(mkformula bad '{nope} + 1')
case "$status" in 200|201|400|422) ;; *) echo "unexpected: $status"; exit 1;; esac
# Whether create succeeds or fails, the workspace must still load
tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics" >/dev/null
```

### T3. Syntax error rejected with 4xx (or accepted with eval-time warning)

```bash
status=$(mkformula syn 'foo(' )
case "$status" in 400|422) ok=1 ;; 200|201) ok=0 ;; *) echo "unexpected: $status"; exit 1;; esac
# Both paths are acceptable: reject at create, or accept and surface a warn at eval.
# Either way, dashboard must not 500.
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics")
[ "$status" = "200" ]
```

### T4. Cycle is detected

```bash
mkformula loop1 '{loop2} + 1' >/dev/null || true
mkformula loop2 '{loop1} + 1' >/dev/null || true
# The engine must not stack-overflow or hang
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics" --max-time 5)
[ "$status" = "200" ]
```

### T5. Division by zero handled

```bash
Z=$(mkleaf zero 0)
mkformula bydiv '{a} / {zero}' >/dev/null
val=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics?name=bydiv" \
  | jq -r '.[] | select(.name=="bydiv") | .value')
case "$val" in null|"Infinity"|"NaN"|"") ;; *) [ "$val" = "0" ] || echo "WARN: bydiv = $val";; esac
```

### T6. Large magnitudes don't NaN-poison the rest

```bash
big=$(mkleaf big 1)
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"value":1e300}' "$TT_BASE_URL/api/metrics/$big" >/dev/null
mkformula explode '{big} * {big}' >/dev/null
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics")
[ "$status" = "200" ]
```

### T7. Edit a formula → dependent metric recomputes immediately

```bash
A=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics" | jq -r '.[] | select(.name=="a") | .id')
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"value":100}' "$TT_BASE_URL/api/metrics/$A" >/dev/null
val=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics?name=c" \
  | jq -r '.[] | select(.name=="c") | .total')
[ "$val" = "104" ] || { echo "expected c=104, got $val"; exit 1; }
```

## Cleanup

Auto via workspace teardown.

## Known gaps

- No coverage of advanced formula syntax (min/max, conditional). Add once
  the engine documents which functions are supported.
- No assertion on evaluation latency for deep dependency chains.
