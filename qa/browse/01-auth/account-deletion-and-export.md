---
id: 01-auth-account-deletion-and-export
tags: [api-only, fast]
isolation: user
parallel-safe: true
needs: [auth]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a user exercising my GDPR rights, I can export everything Telarchy
  holds about me as JSON and delete my account; afterwards my session is
  invalid and the row is gone (or detached) from the database.
---

# Browse test: Data export + account deletion

## What this tests

`GET /api/auth/me/export` returns a JSON blob covering user + agent + trades
+ feedback. `DELETE /api/auth/me` invalidates the session and removes
identifying data. Both are participant-symmetric in name (`requireIdentity`)
so an agent key can also delete itself.

Maps to `mvp-evaluation/plan.md` 9.4 + 9.5.

## Preconditions

- Signup endpoint open. Master key set (for sanity-checking via DB-equivalent
  endpoints).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
EMAIL="qa+del-$TT_RUN_ID@example.test"
JAR=$(tt_mkuser "$EMAIL" "testtest123" "DelUser-$TT_RUN_ID")
# create at least one trade so the export has content
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
mid=$(curl -sf "$TT_BASE_URL/api/metrics" -H "X-Workspace-Id: $WS" -b "$JAR" \
  | jq -r '.[0].id // empty')
if [ -n "$mid" ]; then
  market=$(curl -sf -b "$JAR" -H 'Content-Type: application/json' \
    -H "X-Workspace-Id: $WS" -X POST \
    -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01"}')" \
    "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
  curl -sf -b "$JAR" -H 'Content-Type: application/json' \
    -H "X-Workspace-Id: $WS" -X POST \
    -d "$(jq -nc --arg id "$market" '{marketId:$id, direction:"higher", amount:1}')" \
    "$TT_BASE_URL/api/predictions/trade" >/dev/null || true
fi
```

## Tests

### T1. Export returns JSON with documented top-level keys

```bash
exp=$(tt_user_curl "$JAR" "$TT_BASE_URL/api/auth/me/export")
echo "$exp" | jq -e '.user, .trades' >/dev/null \
  || { echo "export missing required keys"; exit 1; }
echo "$exp" | jq -e '.user.email == "'$EMAIL'"' >/dev/null
```

### T2. Export is well-formed JSON, not a stack trace

```bash
echo "$exp" | jq . >/dev/null
echo "$exp" | grep -qiE 'stack trace|\bError:' \
  && { echo "export contains error markers"; exit 1; } || true
```

### T3. Export includes consent + profile

```bash
echo "$exp" | jq -e '.user.consentedAt' >/dev/null
echo "$exp" | jq -e '.user.consentedVersion' >/dev/null
```

### T4. DELETE /me invalidates the session

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" \
  -X DELETE "$TT_BASE_URL/api/auth/me")
[ "$status" = "204" ] || [ "$status" = "200" ] \
  || { echo "DELETE /me returned $status"; exit 1; }
status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$TT_BASE_URL/api/auth/me")
[ "$status" = "401" ] \
  || { echo "session still valid after deletion: $status"; exit 1; }
```

### T5. Re-creating the same email after deletion succeeds

```bash
JAR2="/tmp/$TT_NS-redo.jar"
status=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR2" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg e "$EMAIL" '{email:$e, password:"testtest123", name:"R", consent:true}')" \
  "$TT_BASE_URL/api/auth/sign-up/email")
case "$status" in 200|201) ;; *) echo "could not re-signup after deletion: $status"; exit 1;; esac
# clean up the re-created user too
curl -sf -b "$JAR2" -X DELETE "$TT_BASE_URL/api/auth/me" >/dev/null
rm -f "$JAR2"
```

### T6. Agent participant can also delete itself

```bash
read AGENT KEY < <(tt_mkagent "$WS" del)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -X DELETE "$TT_BASE_URL/api/auth/me")
case "$status" in 200|204) ;; *) echo "agent self-delete returned $status"; exit 1;; esac
```

## Cleanup

`$JAR` was deleted via T4. Workspace cleaned via tt_on_cleanup.

## Known gaps

- No assertion on what happens to outstanding LMSR positions when a user
  deletes — today they remain on the books with `authUserId: null`. Decide
  the policy and assert on it.
- No CCPA-style "right to be forgotten" verification: the schema retains
  trade rows for AMM correctness, which is technically arguable. Document
  the carve-out in privacy policy and verify it's mentioned.
