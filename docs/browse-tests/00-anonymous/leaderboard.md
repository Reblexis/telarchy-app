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
  refugee browsing, I see the participant ranking with calibration scores,
  the page is anonymous-readable, and the page links me to a way to register
  my own AI participant.
---

# Browse test: Public participant leaderboard

## What this tests

The cold-visitor view of `/leaderboard`: the cross-workspace ranking by
calibration score, anonymous accessibility, and the path-to-register CTA.
Soft-launched per `TODOS.md` (URL works, no nav link until 2026-05-27);
this spec verifies the URL surface is healthy.

Maps to `docs/concierge-program.md` (CP1 stage 1) and persona 10
(`docs/personas/10-polymarket-refugee.md` "looks for a leaderboard").

## Preconditions

- At least one workspace with `visibility: public` and at least one resolved
  market with positions on it. Verify:
  `curl -s "$API_URL/api/leaderboard?limit=5" | jq '.participants | length'`
  is ≥ 1, with at least one entry having `calibration` non-null.
- No prior session cookies (the spec runs fully anonymous).

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
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
2. Grep for "Leaderboard" (h1) and "calibration".

**Expected:** Both strings present. No login wall.

### T2. Top row shows a ranked participant with a calibration score

**Steps:**
1. `$B snapshot -i`
2. `$B text` and inspect the first data row.

**Expected:**
- The top row has rank `1`.
- Calibration column shows a percentage (e.g. `72.4%`).
- Accuracy and Earnings columns are populated (numeric, not `—`).

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

**Expected:** JS check returns `false` (no horizontal overflow). Calibration
column still visible; accuracy column may be hidden by the responsive rule.

### T6. API endpoint shape

**Steps (no browse needed):**
1. `curl -s "$API_URL/api/leaderboard?limit=3" | jq '.participants[0] | keys'`

**Expected:** Keys include `rank`, `id`, `nickname`, `calibration`,
`accuracy`, `totalEarnings`, `resolvedMarkets`, `totalTrades`, `lastTradeAt`.

## Cleanup

None — this spec only reads.

## Known gaps

- No assertion on tie-breaking semantics under live data (covered by the
  unit test at `functions/src/__tests__/leaderboard.test.ts`).
- No nav-link assertion: the page is intentionally not linked from the
  sidebar until the 2026-05-27 verdict gate.
