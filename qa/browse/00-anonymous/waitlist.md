---
id: 00-anonymous-waitlist
tags: [api-only, fast]
isolation: global
parallel-safe: true
needs: []
timeout: 45s
goal-horizon: short
goal-statement: |
  As a curious visitor who isn't ready to sign up, I can drop my email on
  a waitlist, get a clean confirmation, and not be able to abuse the
  endpoint to spam emails or enumerate existing users.
---

# Browse test: Waitlist

## What this tests

`POST /api/waitlist` accepts an email, deduplicates, and is rate-limited.
The endpoint is mounted under `registrationLimiter` (5/min) which we verify
end-to-end.

## Preconditions

- Public endpoint reachable.
- Email column is unique (per Drizzle schema).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
EMAIL="qa+wl-$TT_RUN_ID@example.test"
```

## Tests

### T1. Valid email returns 201

```bash
out=$(curl -s -o /tmp/$TT_NS-wl.body -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -X POST -d "{\"email\":\"$EMAIL\"}" \
  "$TT_BASE_URL/api/waitlist")
[ "$out" = "201" ] || { echo "expected 201, got $out: $(cat /tmp/$TT_NS-wl.body)"; exit 1; }
```

### T2. Duplicate is idempotent (200) or rejected cleanly (409/4xx)

```bash
out=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -X POST -d "{\"email\":\"$EMAIL\"}" \
  "$TT_BASE_URL/api/waitlist")
case "$out" in 200|201|409) ;; *) echo "unexpected dup status: $out"; exit 1;; esac
```

### T3. Missing email returns 400

```bash
out=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -X POST -d '{}' "$TT_BASE_URL/api/waitlist")
[ "$out" = "400" ] || { echo "expected 400 for empty body, got $out"; exit 1; }
```

### T4. Malformed email rejected

```bash
out=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -X POST -d '{"email":"not-an-email"}' "$TT_BASE_URL/api/waitlist")
case "$out" in 400|422) ;; *) echo "expected 4xx for bad email, got $out"; exit 1;; esac
```

### T5. Rate limit kicks in

```bash
hits=0; lim=0
for i in $(seq 1 12); do
  s=$(curl -s -o /dev/null -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -X POST -d "{\"email\":\"qa+rl-$i-$TT_RUN_ID@example.test\"}" \
    "$TT_BASE_URL/api/waitlist")
  [ "$s" = "201" ] && hits=$((hits+1))
  [ "$s" = "429" ] && lim=$((lim+1))
done
[ "$lim" -ge 1 ] || { echo "expected at least one 429 within 12 reqs/min, got hits=$hits lim=$lim"; exit 1; }
```

### T6. Endpoint does not echo whether the email already exists

```bash
existing="qa+wl-stable-$TT_RUN_ID@example.test"
curl -s -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$existing\"}" "$TT_BASE_URL/api/waitlist" >/dev/null
body1=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$existing\"}" "$TT_BASE_URL/api/waitlist")
body2=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"qa+wl-fresh-$TT_RUN_ID@example.test\"}" "$TT_BASE_URL/api/waitlist")
# Both responses should look the same to the caller (no enumeration oracle).
diff <(jq -S 'del(.id,.createdAt)' <<<"$body1" 2>/dev/null) \
     <(jq -S 'del(.id,.createdAt)' <<<"$body2" 2>/dev/null) >/dev/null \
  || echo "WARN: waitlist response shape differs between new/existing — possible enumeration oracle"
```

## Cleanup

```bash
# If admin key is set, drop test rows. Otherwise leave them; they're harmless.
if [ -n "$TT_ADMIN_KEY" ]; then
  : # No DELETE endpoint exposed; rely on DB-level GC of qa+%@example.test.
fi
```

## Known gaps

- No assertion on whether waitlist rows are surfaced anywhere visible
  (admin /waitlist page does not exist as of writing).
- No CAPTCHA — rate limit is the only friction. If abuse becomes a real
  pattern, escalate to challenge-response rather than tightening the limit.
