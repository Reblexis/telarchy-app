---
id: 06-participants-api-tab-keys
tags: [browse, fast]
isolation: workspace
parallel-safe: false
needs: [auth]
timeout: 90s
goal-horizon: short
goal-statement: |
  As an account owner, I can open the API tab from the sidebar, mint an
  API key for my own account with a non-default scope, see it listed with
  scope chips, and revoke it. The same flow lives entirely behind public
  /api/* endpoints (parity guarantee), so an external integration could
  accomplish the same thing without a browser.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: API tab (mint/revoke own keys)

## What this tests

The new **Platform → API** tab is the home for managing API access against
your own account: minting keys with scopes, listing them, revoking, and
registering bot sub-agents under your ownership. This spec walks through
the most important user-visible flow (mint → see → revoke) end-to-end in
the browser, plus a parity check that the same flow works through the API
with a session cookie (the UI is just one client of `/api/agents/me/keys`).

Maps to `docs/vision.md` — alignment-layer-honesty: the UI does not have
private endpoints.

## Preconditions

- Auth: the admin account; credentials from `keyring/telarchy/admin.env` (`$ADMIN_EMAIL` / `$ADMIN_PASSWORD`), never written here.
- Backend: migration `0022_agent_api_keys_scopes.sql` applied. Verify with:

  ```bash
  curl -sf -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: default" \
    "$TT_BASE_URL/api/help" | jq -r '.endpoints[] | select(.path=="/api/agents/:id/keys" and .method=="POST") | .scope' \
    | grep -q '^account:keys$'
  ```

- Master key (`$TT_ADMIN_KEY`) and a usable workspace are present.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init

JAR="/tmp/$TT_NS.jar"
curl -sf -c "$JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$TT_BASE_URL/api/auth/sign-in/email" >/dev/null

# Capture the user's primary participant id for the API checks.
PRIMARY=$(curl -sf -b "$JAR" "$TT_BASE_URL/api/auth/me" | jq -r '.participantId')
[ -n "$PRIMARY" ] && [ "$PRIMARY" != "null" ]
```

## Tests

### T1. The sidebar exposes an "API" entry under Platform

```bash
$B viewport 1440x900
$B goto "$TT_FRONTEND_URL/api-access"
$B wait --networkidle
$B text | grep -q "Your API access"
$B text | grep -q "Bot participants you own"
$B text | grep -q "Register a new bot"
```

### T2. Minting a key shows it once and only once, with scope chips

```bash
# Mint via the API (the UI does the same thing under the hood).
mint=$(curl -sf -b "$JAR" -X POST -H "Content-Type: application/json" \
  -d '{"label":"browse-test","scopes":["workspace:read"]}' \
  "$TT_BASE_URL/api/agents/me/keys")
KEY_ID=$(jq -r '.keyId' <<<"$mint")
RAW=$(jq -r '.apiKey' <<<"$mint")
[ -n "$KEY_ID" ] && [ "$KEY_ID" != "null" ]
[ -n "$RAW" ] && [ "$RAW" != "null" ]

# Listing returns metadata but never the raw key or full hash.
list=$(curl -sf -b "$JAR" "$TT_BASE_URL/api/agents/me/keys")
jq -e --arg id "$KEY_ID" '.[] | select(.keyId==$id) | .label=="browse-test" and .scopes==["workspace:read"]' <<<"$list" >/dev/null
jq -e --arg id "$KEY_ID" '.[] | select(.keyId==$id) | (.hashPrefix | length) == 8' <<<"$list" >/dev/null
# Defensive: there must be no field literally named "hash" or "apiKey" in any row.
jq -e 'all(.[]; (has("hash") | not) and (has("apiKey") | not))' <<<"$list" >/dev/null
```

### T3. The minted key can read but cannot trade (scope intersection)

```bash
# Status is a read endpoint; should succeed.
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $RAW" -H "X-Workspace-Id: default" \
  "$TT_BASE_URL/api/status")
[ "$code" = "200" ]

# Trade is a workspace:trade-gated endpoint; should be 403.
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $RAW" -H "X-Workspace-Id: default" \
  -H "Content-Type: application/json" \
  -d '{"marketId":"00000000-0000-0000-0000-000000000000","direction":"higher","amount":1}' \
  -X POST "$TT_BASE_URL/api/predictions/trade")
case "$code" in 403) ;; *) echo "expected 403 for read-only key trading, got $code"; exit 1;; esac
```

### T4. Account-touching endpoints respect the scope upper bound

```bash
# This key has only workspace:read; account:write must be 403.
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $RAW" -X POST -H "Content-Type: application/json" \
  -d '{"intent":"creator"}' "$TT_BASE_URL/api/auth/profile")
[ "$code" = "403" ]
```

### T5. Self-elevation is blocked

```bash
# A key with only workspace:read cannot mint a key with workspace:trade.
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $RAW" -X POST -H "Content-Type: application/json" \
  -d '{"label":"elevate","scopes":["workspace:trade"]}' \
  "$TT_BASE_URL/api/agents/me/keys")
case "$code" in 403) ;; *) echo "expected 403 self-elevate, got $code"; exit 1;; esac
```

### T6. Revoking the key removes programmatic access

```bash
curl -sf -b "$JAR" -X DELETE "$TT_BASE_URL/api/agents/me/keys/$KEY_ID" -o /dev/null
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $RAW" "$TT_BASE_URL/api/status")
[ "$code" = "401" ]
```

### T7. The session cannot revoke its own key (browser sessions don't have keys, but the equivalent rule applies to agent-key callers)

```bash
# Mint a fresh key, then try to use it to revoke itself.
fresh=$(curl -sf -b "$JAR" -X POST -H "Content-Type: application/json" \
  -d '{"scopes":["account:keys"]}' "$TT_BASE_URL/api/agents/me/keys")
FID=$(jq -r '.keyId' <<<"$fresh")
FK=$(jq -r '.apiKey' <<<"$fresh")
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $FK" -X DELETE "$TT_BASE_URL/api/agents/me/keys/$FID")
case "$code" in 400) ;; *) echo "expected 400 self-revoke, got $code"; exit 1;; esac

# Cleanup: revoke from the cookie session.
curl -sf -b "$JAR" -X DELETE "$TT_BASE_URL/api/agents/me/keys/$FID" -o /dev/null
```

## Known gaps

- The browser walkthrough in T1 only asserts that the page renders and the
  three section headings are visible. The full mint flow is exercised
  through the API (T2–T7) because that's what the UI calls; a deeper UI
  test (click "Mint new key", pick "Read-only" preset, copy the key out
  of the disclosure, confirm the chip rendering) is left for follow-up.
- `lastUsedAt` is debounced ~60s server-side; this spec doesn't try to
  observe it bumping.
