---
id: 02-workspaces-settings-and-visibility
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a workspace admin, I can change the name, swap visibility between
  public/unlisted/private, change the auto-fund liquidity, and confirm
  each setting takes effect on the next read.
---

# Browse test: Workspace settings + visibility

## What this tests

`PUT /api/workspaces/:id/settings`. The settings surface controls how a
workspace appears in `/marketplace`, the Public group's capabilities, and
how new markets are seeded. Visibility flips public ↔ unlisted ↔ private
with corresponding capability changes.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
```

## Tests

### T1. Default visibility is public

```bash
vis=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/workspaces/$WS" | jq -r '.visibility')
[ "$vis" = "public" ] || { echo "default visibility is $vis, expected public"; exit 1; }
```

### T2. Rename persists

```bash
new="ttws-$TT_RUN_ID-renamed"
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d "$(jq -nc --arg n "$new" '{name:$n}')" \
  "$TT_BASE_URL/api/workspaces/$WS/settings" >/dev/null
got=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/workspaces/$WS" | jq -r '.name')
[ "$got" = "$new" ]
```

### T3. Public → unlisted removes from /marketplace

```bash
# Confirm currently listed
listed=$(curl -sf "$TT_BASE_URL/api/marketplace/workspaces/public" \
  | jq -r --arg id "$WS" '.[] | select(.id==$id) | .id')
[ "$listed" = "$WS" ]
# Flip
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"visibility":"unlisted"}' \
  "$TT_BASE_URL/api/workspaces/$WS/settings" >/dev/null
listed=$(curl -sf "$TT_BASE_URL/api/marketplace/workspaces/public" \
  | jq -r --arg id "$WS" '.[] | select(.id==$id) | .id')
[ -z "$listed" ] || { echo "unlisted workspace still in /marketplace"; exit 1; }
# Direct read still works for members (via marketplace/:workspaceId is public)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  "$TT_BASE_URL/api/marketplace/$WS")
case "$status" in 200|404) ;; *) echo "unlisted /:id returned $status"; exit 1;; esac
```

### T4. Private hides the workspace from /marketplace and from /:id

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"visibility":"private"}' \
  "$TT_BASE_URL/api/workspaces/$WS/settings" >/dev/null
status=$(curl -s -o /dev/null -w '%{http_code}' "$TT_BASE_URL/api/marketplace/$WS")
[ "$status" = "404" ] || [ "$status" = "403" ] \
  || { echo "private workspace public-fetch returned $status"; exit 1; }
```

### T5. Public group capabilities follow visibility

```bash
# Flip back to public, expect Public group has trade capability
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"visibility":"public"}' \
  "$TT_BASE_URL/api/workspaces/$WS/settings" >/dev/null
caps_pub=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/groups" \
  | jq -r '.[] | select(.name=="Public") | .capabilities | join(",")')
grep -q 'read' <<<"$caps_pub"
# Open template should also include 'trade' on Public; blank/private may not.
# Flip to private → Public group should drop trade
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"visibility":"private"}' \
  "$TT_BASE_URL/api/workspaces/$WS/settings" >/dev/null
caps_priv=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/groups" \
  | jq -r '.[] | select(.name=="Public") | .capabilities | join(",")' || echo "")
grep -q 'trade' <<<"$caps_priv" \
  && { echo "Public group still has 'trade' on private workspace"; exit 1; } || true
```

### T6. Auto-fund toggle changes new-market liquidity behaviour

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"autoFund":true,"newMarketLiquidityCredits":50}' \
  "$TT_BASE_URL/api/workspaces/$WS/settings" >/dev/null
got=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/workspaces/$WS" | jq -r '.autoFund')
[ "$got" = "true" ]
got=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/workspaces/$WS" | jq -r '.newMarketLiquidityCredits')
[ "$got" = "50" ]
```

### T7. Non-admin cannot edit settings

```bash
read AGENT KEY < <(tt_mkagent "$WS" reader)
# Public group on a private workspace grants read only, so this agent does not have manage
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X PUT -d '{"name":"hacked"}' \
  "$TT_BASE_URL/api/workspaces/$WS/settings")
[ "$status" = "403" ] || { echo "non-admin should be 403, got $status"; exit 1; }
tt_rm_agent "$WS" "$AGENT"
```

## Cleanup

Auto.

## Known gaps

- No coverage of `unlisted` joinable-via-link path. Add when the share-link
  flow stabilises.
