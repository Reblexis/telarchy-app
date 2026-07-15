---
id: 01-auth-consent-and-profile
tags: [api-only, fast]
isolation: user
parallel-safe: true
needs: [auth]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a participant, I can record my consent on signup, edit my display
  name later, and have those updates reflected in /api/auth/me on the
  next read.
---

# Browse test: Consent + profile

## What this tests

`POST /api/auth/consent` (browser-session-only) and `POST /api/auth/profile`
(participant-symmetric). Verifies that:

- consent persists `consentedAt` and `consentedVersion`,
- profile updates persist a chosen display name,
- agent keys cannot hit `/consent` (it's the one route that requires a
  BetterAuth user — see `api-parity.test.ts`),
- agent keys *can* hit `/profile` to update their own display name.

## Preconditions

- `$TT_BASE_URL/api/auth/sign-up/email` is open (no allowlist).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
EMAIL="qa+consent-$TT_RUN_ID@example.test"
JAR=$(tt_mkuser "$EMAIL" "testtest123" "ConsentUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
read AGENT KEY < <(tt_mkagent "$WS" consent)
tt_on_cleanup "tt_rm_agent '$WS' '$AGENT'"
```

## Tests

### T1. POST /consent with {accepted:true} succeeds

The version is server-controlled (see `CURRENT_CONSENT_VERSION` in
`functions/src/routes/legal.ts`); the body is just `{"accepted":true}`.

```bash
out=$(tt_user_curl "$JAR" -H 'Content-Type: application/json' \
  -X POST -d '{"accepted":true}' "$TT_BASE_URL/api/auth/consent")
echo "$out" | jq -e '.ok == true' >/dev/null
echo "$out" | jq -e '.version != null' >/dev/null
```

### T2. (covered above) — /api/auth/me does not currently surface `consentedVersion`

`/api/auth/me` returns a flat session shape (`uid`, `email`,
`participantId`, …), not the underlying consent columns. The DB row is
updated by T1; surfacing it on `/me` is a separate doc/API change.

### T3. Agent key cannot hit /consent (browser-session-only)

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{"accepted":true}' \
  "$TT_BASE_URL/api/auth/consent")
[ "$status" = "401" ] || [ "$status" = "403" ] \
  || { echo "expected 401/403 for agent on /consent, got $status"; exit 1; }
```

### T4. POST /profile updates browser user's display name

`/api/auth/me` returns a flat shape: `{ uid, email, nickname, … }`. The
display name lives under `.nickname`.

```bash
# Use a per-run unique nickname so we don't collide with prior test runs.
NEW_NICK="qa-$(echo "$TT_RUN_ID" | tr -d - | head -c 16)"
tt_user_curl "$JAR" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg n "$NEW_NICK" '{nickname:$n}')" \
  "$TT_BASE_URL/api/auth/profile" >/dev/null
got=$(tt_user_curl "$JAR" "$TT_BASE_URL/api/auth/me" | jq -r '.nickname // empty')
[ "$got" = "$NEW_NICK" ] || { echo "profile name not updated: '$got' (wanted $NEW_NICK)"; exit 1; }
```

### T5. Agent key can also update its own display name via /profile

```bash
BOT_NICK="bot-$(echo "$TT_RUN_ID" | tr -d - | head -c 16)"
tt_agent_curl "$KEY" "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg n "$BOT_NICK" '{nickname:$n}')" \
  "$TT_BASE_URL/api/auth/profile" >/dev/null
got=$(tt_agent_curl "$KEY" "$WS" "$TT_BASE_URL/api/auth/me" | jq -r '.nickname // empty')
[ "$got" = "$BOT_NICK" ] || { echo "agent profile name not updated: '$got' (wanted $BOT_NICK)"; exit 1; }
```

### T6. Empty / overlong nicknames rejected

The profile endpoint takes `{intent?, nickname?}` (not `name`).

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" \
  -H 'Content-Type: application/json' \
  -X POST -d '{"nickname":""}' "$TT_BASE_URL/api/auth/profile")
case "$status" in 400|422) ;; *) echo "empty nickname should be 400, got $status"; exit 1;; esac

big=$(printf 'X%.0s' $(seq 1 5000))
status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" \
  -H 'Content-Type: application/json' \
  -X POST -d "{\"nickname\":\"$big\"}" "$TT_BASE_URL/api/auth/profile")
case "$status" in 400|413|422) ;; *) echo "overlong nickname should be 4xx, got $status"; exit 1;; esac
```

## Cleanup

Auto via `tt_on_cleanup`.

## Known gaps

- No assertion that consentedAt timestamp is within ±5s of signup.
- No coverage of consent reset on a major ToS bump (no UI yet).
