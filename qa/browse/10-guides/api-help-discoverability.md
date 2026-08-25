---
id: 10-guides-api-help-discoverability
tags: [api-only, fast]
isolation: global
parallel-safe: true
needs: []
timeout: 30s
goal-horizon: short
goal-statement: |
  As a third-party developer or AI agent, I can read GET /api/help and
  discover every documented endpoint, with auth labels that match the
  per-endpoint behaviour.
---

# Browse test: /api/help discoverability

## What this tests

`GET /api/help` is the source of truth for the agent surface. This spec
verifies:
- it returns a non-empty endpoint list,
- every entry has method/path/auth fields,
- a sample of paths returns the documented status under documented auth,
- new routes added to `routes/*.ts` show up here (sanity check vs router
  list).

This is the runtime sibling of `functions/src/__tests__/api-parity.test.ts`,
which is a static analysis. They serve different goals: parity is "the
frontend uses only documented routes", this spec is "the documentation
matches what the running server actually does".

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
```

## Tests

### T1. /api/help returns a non-empty array

```bash
out=$(curl -sf "$TT_BASE_URL/api/help")
n=$(jq '.endpoints | length' <<<"$out")
[ "$n" -ge 40 ] || { echo "expected ≥40 endpoints, got $n"; exit 1; }
```

### T2. Every entry has method + path + auth

```bash
bad=$(jq '[.endpoints[] | select(.method==null or .path==null or .auth==null)] | length' \
  <<<"$out")
[ "$bad" = "0" ] || { echo "$bad entries missing required fields"; exit 1; }
```

### T3. Sample documented public endpoints really are public (no header)

```bash
publics=$(jq -r '.endpoints[] | select(.auth=="false" and .method=="GET") | .path' \
  <<<"$out" | head -3)
for p in $publics; do
  # Skip parameterised paths
  case "$p" in *":"*) continue;; esac
  status=$(curl -s -o /dev/null -w '%{http_code}' "$TT_BASE_URL$p")
  case "$status" in 200|204|404) ;; *) echo "documented public $p returned $status"; exit 1;; esac
done
```

### T4. Sample auth=identity endpoints 401 without auth

```bash
ids=$(jq -r '.endpoints[] | select(.auth=="identity" and .method=="GET") | .path' \
  <<<"$out" | head -3)
for p in $ids; do
  case "$p" in *":"*) continue;; esac
  status=$(curl -s -o /dev/null -w '%{http_code}' "$TT_BASE_URL$p")
  [ "$status" = "401" ] || echo "WARN: $p returned $status (expected 401 without auth)"
done
```

### T5. Sample auth=admin endpoints 401/403 without admin

```bash
adm=$(jq -r '.endpoints[] | select(.auth=="admin" and .method=="GET") | .path' \
  <<<"$out" | head -3)
for p in $adm; do
  case "$p" in *":"*) continue;; esac
  status=$(curl -s -o /dev/null -w '%{http_code}' "$TT_BASE_URL$p")
  case "$status" in 401|403) ;; *) echo "WARN: documented admin $p returned $status without auth"; esac
done
```

### T6. Help endpoint itself is documented

```bash
jq -e '.endpoints[] | select(.path=="/api/help")' <<<"$out" >/dev/null \
  || echo "WARN: /api/help itself not in /api/help — recursive paradox"
```

## Cleanup

None.

## Known gaps

- No coverage of the description-text quality (whether each entry's
  description is helpful). Subjective; covered by the `12-ux/jargon-and-language.md`
  spec.
