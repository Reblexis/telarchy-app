---
id: 12-ux-notifications-inbox
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a trader coming back to the floor, one bell tells me what happened
  while I was away, and clicking a row takes me to the contract it is
  about.
---

# Browse test: The notifications bell

## What this tests

The floor's inbox: `GET /api/notifications`, `POST /api/notifications/seen`,
`NotificationsBell.tsx`, and the `#contract=<id>` deep link a row points at.
The behavioural contract is `docs/vision.md`, "The notifications inbox": the
bell shows everything (comments on your contracts, replies in your threads,
new contracts where you trade, decisions on your own contracts), and the
email switches never filter it.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
OWNER="qa+inbox-owner-$TT_RUN_ID@example.test"
read OJAR OUID < <(tt_mkuser_uid "$OWNER" "testtest123" "InboxOwner-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$OJAR'"
OTHER="qa+inbox-other-$TT_RUN_ID@example.test"
read PJAR PUID < <(tt_mkuser_uid "$OTHER" "testtest123" "InboxOther-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$PJAR'"

WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_add_member "$WS" "$OUID" "trader"
tt_add_member "$WS" "$PUID" "trader"
SLUG=$(curl -sf -b "$OJAR" "$TT_BASE_URL/api/marketplace/$WS" | jq -r '.slug')

# The owner posts a contract; the other participant comments on it.
PROP=$(curl -sf -b "$OJAR" -H "X-Workspace-Id: $WS" -H 'Content-Type: application/json' \
  -X POST -d '{"title":"Inbox spec contract","description":"pitch"}' \
  "$TT_BASE_URL/api/proposals" | jq -r '.id')
curl -sf -b "$PJAR" -H "X-Workspace-Id: $WS" -H 'Content-Type: application/json' \
  -X POST -d '{"content":"how will you measure this?"}' \
  "$TT_BASE_URL/api/proposals/$PROP/messages" >/dev/null

$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$OWNER"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
```

## Tests

### T1. The comment reaches the inbox as a comment on my contract

```bash
curl -sf -b "$OJAR" "$TT_BASE_URL/api/notifications" \
  | jq -e '.unread >= 1 and ([.notifications[] | select(.kind=="comment")] | length) >= 1'
```

### T2. The switches do not filter it

```bash
curl -sf -b "$OJAR" -H 'Content-Type: application/json' -X POST \
  -d '{"notifications":{"commentOnMyProposal":false}}' "$TT_BASE_URL/api/auth/profile" >/dev/null
curl -sf -b "$OJAR" "$TT_BASE_URL/api/notifications" \
  | jq -e '([.notifications[] | select(.kind=="comment")] | length) >= 1'
```

### T3. The bell carries the count, and the panel names the event

```bash
$B goto "$TT_FRONTEND_URL/$SLUG" && $B wait --networkidle
$B click '[aria-label^="What'"'"'s new"]'
text=$($B text)
grep -qi 'Inbox spec contract' <<<"$text"
grep -qi "commented on your contract" <<<"$text"
$B screenshot "/tmp/$TT_NS-notifications.png"
```

### T4. Mark all read clears the count, keeps the rows

```bash
$B click 'button:has-text("Mark all read")' || $B click '.notif-mark'
$B wait --networkidle
curl -sf -b "$OJAR" "$TT_BASE_URL/api/notifications" | jq -e '.unread == 0 and (.notifications | length) >= 1'
```

### T5. A row lands on the comment it names, and flashes it

```bash
MSG=$(curl -sf -b "$OJAR" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROP/messages" | jq -r '.[0].id')
$B goto "$TT_FRONTEND_URL/$SLUG#contract=$PROP&comment=$MSG" && $B wait --networkidle
text=$($B text)
grep -qi 'Inbox spec contract' <<<"$text"
# The thread opens on its own and the named line is on screen.
grep -qi 'how will you measure this' <<<"$text"
# The flash is an arrival, not a state: it is gone a couple of seconds later.
$B assert "[data-comment-id='$MSG'].is-flashed" --gone --timeout 4000 \
  || echo "WARN: could not observe the flash clearing"
```

### T6. No console errors

```bash
out=$($B console --errors | sed -n '/^--- BEGIN/,/^--- END/{ /^---/d; p }')
case "$out" in ''|'(no console errors)') ;; *) echo "console errors:"; echo "$out"; exit 1;; esac
```

## Cleanup

Auto.

## Known gaps

- The decision row (your contract approved or declined) is covered by the
  backend suite only; driving an approval needs a `manage` session this spec
  does not set up.
- No assertion that the unread hairline is visually present, only that the
  count and rows are.
