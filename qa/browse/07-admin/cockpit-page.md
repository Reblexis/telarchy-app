---
id: 07-admin-cockpit-page
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As the platform operator, telarchy.com/admin shows me who showed up, who
  signed up, who is waiting and what people reported; and to anyone else the
  page is indistinguishable from a URL that does not exist.
---

# Browse test: The /admin cockpit

## What this tests

`GET /api/admin/floor-stats`, `GET /api/feedback`, and `src/pages/AdminPage.tsx`.
The behavioural contract is `docs/ui-conventions.md`, "The cockpit": the
endpoints are platform-admin gated server-side, the page renders the waitlist
and the reports in full rather than summarising them, and a caller who is not
a platform admin is bounced to the floor with no error screen.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init

# A plain signed-up visitor: not a platform admin, and the account the gate
# has to turn away.
STRANGER="qa+cockpit-stranger-$TT_RUN_ID@example.test"
read SJAR SUID < <(tt_mkuser_uid "$STRANGER" "testtest123" "Cockpit-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$SJAR'"

# Something to find on the page: one waitlist row and one report.
WAITER="qa+cockpit-waiter-$TT_RUN_ID@example.test"
curl -sf -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg e "$WAITER" '{email:$e, source:"marketplace"}')" \
  "$TT_BASE_URL/api/waitlist" >/dev/null
curl -sf -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg s "cockpit spec $TT_RUN_ID" '{kind:"bug", subject:$s, body:"reported by the cockpit spec"}')" \
  "$TT_BASE_URL/api/feedback" >/dev/null
```

## Tests

### T1. floor-stats is platform-admin only

```bash
# Anonymous.
code=$(curl -s -o /dev/null -w '%{http_code}' "$TT_BASE_URL/api/admin/floor-stats")
[ "$code" = "401" ] || [ "$code" = "403" ] || { echo "anonymous got $code"; exit 1; }

# A signed-in stranger. A workspace role must not reach a platform-global
# response: it carries every account's email and every visitor's IP.
code=$(curl -s -b "$SJAR" -o /dev/null -w '%{http_code}' "$TT_BASE_URL/api/admin/floor-stats")
[ "$code" = "403" ] || { echo "stranger got $code"; exit 1; }
```

### T2. The master key sees the whole waitlist and the reports

```bash
stats=$(curl -sf -H "X-API-Key: $TT_ADMIN_KEY" "$TT_BASE_URL/api/admin/floor-stats")
jq -e --arg e "$WAITER" '[.waitlist[] | select(.email == $e)] | length == 1' <<<"$stats" >/dev/null
jq -e '.totalUsers >= 1 and (.visitsByDay | type) == "array"' <<<"$stats" >/dev/null
curl -sf -H "X-API-Key: $TT_ADMIN_KEY" "$TT_BASE_URL/api/feedback?limit=100" \
  | jq -e --arg s "cockpit spec $TT_RUN_ID" '[.items[] | select(.subject == $s)] | length == 1' >/dev/null
```

### T3. A signed-in non-admin lands on the floor, not on an error

```bash
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$STRANGER"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle

$B goto "$TT_FRONTEND_URL/admin" && $B wait --networkidle
# The bounce waits on the session check, which is a round trip: poll rather
# than assert on the first frame.
url=""
for _ in $(seq 1 20); do
  url=$($B url)
  case "$url" in */admin) sleep 0.5 ;; *) break ;; esac
done
case "$url" in
  */admin) echo "stranger stayed on /admin: $url"; exit 1 ;;
esac
# And nothing rendered on the way out, not even the headline: a page that
# paints "Admin" for a second has told the stranger it exists.
$B text | grep -qi "$WAITER" && { echo "waitlist leaked to a non-admin"; exit 1; }
$B text | grep -qi "bot hits" && { echo "cockpit stats rendered for a non-admin"; exit 1; }
true
```

### T4. Human-only: the owner sees the cockpit

```bash
# HUMAN-ONLY. Needs the platform-admin account's own password, which the
# runner does not hold. Log in as the platform admin, open /admin, and check:
#   - the page headline reads "Admin" over the visits / people / accounts /
#     waitlist / bot-hits figures
#   - the waitlist section names every row with the door it came through
#   - open reports sort above resolved ones, bodies inline
#   - it refreshes itself roughly every 20 seconds
```

### T5. The question log is platform-admin only, and carries the answers

```bash
# Anonymous: refused.
code=$(curl -s -o /dev/null -w '%{http_code}' "$TT_BASE_URL/api/admin/questions")
[ "$code" = "403" ] || [ "$code" = "401" ] || { echo "questions readable without a key ($code)"; exit 1; }

# Master key: the shape the cockpit renders.
curl -sf -H "X-API-Key: $ADMIN_KEY" -H "X-Workspace-Id: default" \
  "$TT_BASE_URL/api/admin/questions?limit=5" \
  | jq -e 'has("totalCostUsd") and (.questions | type == "array")'
```

## Known gaps

- T4 is not automated: the fixture user cannot be promoted to platform admin
  through the public API, and `INITIAL_ADMIN_EMAIL` is a deploy-time env var.
- Traffic rows (by day, referers, countries, visitor IPs) are asserted only
  as shape, not as content; the log is written by real document loads, which
  the Vite dev server does not produce.
