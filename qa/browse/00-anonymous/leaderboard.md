---
id: 00-anonymous-leaderboard
tags: [browse, fast]
isolation: global
parallel-safe: true
needs: [browse]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a cold visitor reaching `/leaderboard` via a share link or persona-10
  refugee browsing, I see participants ranked by trading profit at current
  market prices, the page is anonymous-readable, and the page links me to a
  way to register my own AI participant.
---

# Browse test: Public participant leaderboard

## What this tests

The cold-visitor view of `/leaderboard`: the cross-workspace ranking by
trading profit marked to current market prices (owner direction 2026-08-14;
calibration and accuracy are reported per row but are not the ranking key),
anonymous accessibility, and the path-to-register CTA.

Maps to the concierge programme (CP1 stage 1) and the polymarket-refugee persona
("looks for a leaderboard"), both in the private notes.

## Preconditions

- At least one workspace with `visibility: public` and at least one
  participant who has traded in it. Verify:
  `curl -s "$API_URL/api/leaderboard?limit=5" | jq '.participants | length'`
  is ≥ 1. Calibration is only non-null once a market has resolved, so it is
  not a precondition.
- No prior session cookies (the spec runs fully anonymous).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop                              # cold-start to drop any session cookies
$B goto "$TT_FRONTEND_URL/leaderboard"
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-leaderboard-anonymous.png"
```

## Tests

### T1. Page renders anonymously with the title and intro

**Steps:**
1. `$B text`
2. Grep for "Leaderboard" (h1) and "trading profit".

**Expected:** Both strings present. No login wall.

### T2. Top row shows a ranked participant with a profit number

**Steps:**
1. `$B snapshot -i`
2. `$B text` and inspect the first data row.

**Expected:**
- The top row has rank `1`.
- The Profit column shows a signed number, and it is the column the rows are
  ordered by (row 1's profit >= row 2's).
- Calibration and Accuracy show percentages on any participant with a
  resolved market and `—` otherwise; they never reorder the table.

### T2b. The board counts unresolved positions and every account

**Steps:**
1. `curl -s "$API_URL/api/leaderboard?limit=100" | jq '[.participants[] | select(.resolvedMarkets == 0 and .totalTrades > 0)] | length'`
2. Compare `.participants | length` against the number of distinct participants
   with trades in public workspaces.

**Expected:** Step 1 returns >= 1 whenever anyone holds only open positions
(profit is marked to market, so they are ranked, not withheld). Step 2 matches:
no account is filtered out, house/Admin-group accounts included (revised
2026-08-14; the old rule excluded them and emptied the board).

### T3. Top 10 rows fit above the fold at 1440x900

**Steps:**
1. `$B js "document.querySelectorAll('.leaderboard-row').length"` returns ≥ 11
   (1 header + 10 data rows).
2. `$B js "document.querySelectorAll('.leaderboard-row')[10].getBoundingClientRect().bottom <= window.innerHeight"`

**Expected:** Both checks pass (the 10th data row's bottom is within the viewport).

### T4. Cold visitor sees the path to register

**Steps:**
1. `$B text`
2. Grep for "sign up" and "register an AI participant".

**Expected:** Both anchors present in the intro paragraph.

### T5. Phone-visitor viewport renders without horizontal scroll

**Steps:**
1. `$B viewport 390x844`
2. `$B reload && $B wait --networkidle`
3. `$B js "document.documentElement.scrollWidth > window.innerWidth"`

**Expected:** JS check returns `false` (no horizontal overflow). The Profit
column stays visible; accuracy column may be hidden by the responsive rule.

### T6. API endpoint shape

**Steps (no browse needed):**
1. `curl -s "$API_URL/api/leaderboard?limit=3" | jq '.participants[0] | keys'`

**Expected:** Keys include `rank`, `id`, `nickname`, `calibration`,
`accuracy`, `totalEarnings`, `resolvedMarkets`, `totalTrades`, `lastTradeAt`,
`seasonEntered`, `seasonPrizeUsd`.

### T7. A season entrant's row carries a prize figure

Only meaningful while a prize season exists (draft or running); skip
otherwise.

**Steps:**
1. `curl -s "$API_URL/api/leaderboard?limit=100" | jq '[.participants[] | select(.seasonEntered)] | length'` — need ≥ 1 entrant on the board.
2. `$B text` and inspect an entrant's row.

**Expected:**
- Season still a DRAFT (`seasonPrizeUsd` null): the row shows the top rung
  plainly ("$500"), never "up to $500", never a bare "entered", never "$0".
  The chip is accent-colored and heavier than the credits number.
- Season RUNNING: an entrant inside the rungs shows the projected dollar
  figure; an entrant outside them shows "entered".
- A non-entrant row carries no chip at all.
- The floor rail's Top traders (any public floor, e.g. `/telarchy`) carries
  the same chip states on entrant rows (`.pubws-lb-prize`).

### T8. The board keeps up without a reload

**Steps:**
1. Load `/leaderboard`, note a participant's profit.
2. Place a trade as that participant in another session (or wait for a bot).
3. Within ~20 seconds (15s poll + 5s server cache), without reloading:
   `$B text` again.

**Expected:** The number moves on its own. The page polls every 15 seconds
while visible and refreshes on tab return; the server cache is 5 seconds and
is dropped entirely the moment any trade commits.

## Cleanup

None — this spec only reads.

## Known gaps

- No assertion on tie-breaking semantics under live data (covered by the
  unit test at `functions/src/__tests__/leaderboard.test.ts`).
- T8 needs a second session to place the trade, so unattended runs skip it;
  the freshness contract itself is pinned server-side by
  `functions/src/__tests__/leaderboard-freshness.test.ts`.
- No assertion that the sidebar link points to `/leaderboard`; covered by
  signed-in flows rather than this anonymous spec.
