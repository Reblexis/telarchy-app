---
id: 06-participants-season-entry
tags: [browse]
isolation: account
parallel-safe: false
needs: [auth, master-key]
timeout: 180s
goal-horizon: short
goal-statement: |
  As a trader who has just arrived on the floor, I can see that a prize season
  is running, read its rules, and enter it in one click without being asked for
  bank details.
---

# Browse test: Entering a prize season

## What this tests

A prize season is the first surface on Telarchy where a participant's actions
lead to real money being paid to them, so the entry path has to be both obvious
and honest. This spec covers what a would-be entrant sees: the season on the
floor, the rules behind it, the toggle on their account page, and the promise
that entering costs nothing.

The specific product decision under test: **entering requires no payment
details.** Winners are asked at claim time instead. An IBAN form standing
between a curious visitor and the leaderboard is the friction that has already
cost this funnel signups once (the Manifold recruiting market, 2026-08-13), so
if this spec ever finds a payment field on the entry path, that is a
regression, not a hardening.

Backed by `functions/src/__tests__/season-lifecycle.test.ts` (the rules) and
`src/components/SeasonEntryPanel.tsx` (this UI).

## Preconditions

- Auth: any participant account. The admin account's credentials come from `keyring/telarchy/admin.env`
  works; a fresh signup is a better test of the cold path.
- A season in status `running`. Create and start one with the master key:

  ```bash
  SEASON=$(curl -s -X POST -H "X-API-Key: $ADMIN_KEY" -H 'Content-Type: application/json' \
    -d '{"name":"Season 0","startsAt":"2026-09-01T00:00:00Z","endsAt":"2026-09-29T00:00:00Z",
         "poolUsd":1000,"rulesUrl":"/legal/season-0",
         "ladder":[{"place":1,"prizeUsd":500},{"place":2,"prizeUsd":250},
                   {"place":3,"prizeUsd":125},{"place":4,"prizeUsd":75},
                   {"place":5,"prizeUsd":50}]}' \
    https://telarchy.com/api/seasons | jq -r '.season.id')
  curl -s -X POST -H "X-API-Key: $ADMIN_KEY" https://telarchy.com/api/seasons/$SEASON/start | jq
  ```

  The start call must report `baselinesWritten` ≥ 1 and a non-empty
  `workspaceIds`.

## Setup

```bash
$B viewport 1440x900
$B goto https://telarchy.com/login
$B snapshot -i
$B fill @e3 "$ADMIN_EMAIL"
$B fill @e4 "$ADMIN_PASSWORD"
$B click @e5
$B wait --networkidle
```

## Tests

### T1. The season is visible on the public floor, before any login

**Steps:**
1. `$B stop` then `$B status` (cold, anonymous session).
2. `$B goto https://telarchy.com/lookpilot`
3. `$B wait --networkidle`
4. `$B screenshot /tmp/season-floor.png`

**Expected:**
- A section in the right rail naming the season and showing `$1,000 in prizes`
  and a day count.
- The words "Free to enter, no purchase and no stake" are present. This is not
  decoration: it is the sentence that makes the contest a skill contest rather
  than something else, and it must survive copy edits.
- A "See the standings" link.

**Fails if:** the strip appears when no season is running (it must render
nothing at all, not an empty box), or the pool renders as `$NaN` or `$undefined`.

### T2. The rules are reachable and complete

**Steps:**
1. `$B goto https://telarchy.com/legal/season-0`
2. `$B wait --networkidle`
3. `$B text`

**Expected:** the page contains, at minimum:
- "No entry fee, no purchase, no stake"
- the full ladder table, $500 through $50
- the scoring rule, including "Your baseline is taken when the season starts,
  not when you enter"
- "strictly greater than zero"
- the 30-day claim window
- "Participants operated by us or run as part of the platform are not eligible"

**Fails if:** any of those is missing. Each one is a commitment the contest
rests on, and the rules document is the only place they are binding.

### T3. Entering takes one click and asks for no payment details

**Steps:**
1. Log in (see Setup).
2. `$B goto https://telarchy.com/lookpilot#account` (the account is a dialog on the floor since 2026-08-19; `/account` redirects here)
3. `$B wait --networkidle`
4. `$B snapshot -i`
5. `$B screenshot /tmp/season-entry-before.png`
6. Click the "Enter this season" checkbox.
7. `$B wait --networkidle`
8. `$B reload` then `$B wait --networkidle`

**Expected:**
- A section headed with the season name, showing the pool, the number of
  places, and days remaining.
- A single checkbox labelled "Enter this season".
- Helper text stating entry is free and that payment details are asked for only
  if you win.
- **No payment, bank, IBAN or PayPal field anywhere in the entry section.**
- After reload the checkbox is still checked, i.e. the entry persisted.

**Fails if:** the toggle requires payment details first, or the checkbox
silently reverts after reload (which would mean the PUT failed and the error
was swallowed).

### T4. Leaving the season removes you from the standings

**Steps:**
1. In the account dialog, uncheck "Enter this season".
2. `$B wait --networkidle`
3. `$B goto "https://telarchy.com/leaderboard?season=$SEASON"`
4. `$B wait --networkidle`
5. `$B text`

**Expected:** your nickname is not in the standings table.

Then re-enter and confirm you reappear. Your baseline must not have changed:
check with the master key that `baseline_profit` is what it was before you left,
because a baseline that resets on re-entry would let anyone re-roll their
starting point mid-season.

### T5. The standings column says score, not profit

**Steps:**
1. `$B goto "https://telarchy.com/leaderboard?season=$SEASON"`
2. `$B wait --networkidle`
3. `$B text`

**Expected:**
- The column header reads "Season score", not "Profit".
- The subheading states the ranking is on growth "since the season started, not
  on lifetime profit".

**Why this matters enough to test:** the all-time board and the season board
show two different numbers for the same person. Labelling the season column
"profit" would put a long-standing trader at the top of a board they did nothing
to win, and nobody reading the page would be able to tell.

### T6. An unknown season is a 404, not the all-time board

**Steps:**
1. `$B goto "https://telarchy.com/leaderboard?season=nope"`
2. `$B wait --networkidle`
3. `$B text`

**Expected:** an error state. Specifically NOT a populated table.

**Why:** the dangerous failure is a silent fall back to the all-time
leaderboard, which would render lifetime profit under a "Season score" heading.
The API returns 404 for exactly this reason
(`season-lifecycle.test.ts`, "an unknown season is a 404").

## Teardown

```bash
curl -s -X POST -H "X-API-Key: $ADMIN_KEY" https://telarchy.com/api/seasons/$SEASON/settle | jq
```

### T7. A draft season lists its entrants on /season, score-less

**Steps:**
1. While the season is still a draft, opt in as a test participant.
2. `$B goto "https://telarchy.com/season"`
3. `$B wait --networkidle`
4. `$B text`

**Expected:**
- The standings section is headed "Entered" and lists the entrant's nickname.
- No score and no payout figure appear beside any row (no baseline exists
  before the start instant).
- Specifically NOT "Nobody has entered yet" while entrants exist.

**Why:** before the 2026-08-21 fix a draft season answered standings with an
empty list, so the person who had just entered, on the page every launch link
points at, was told nobody had entered
(`season-lifecycle.test.ts`, "a draft season lists entrants with no score").

## Known gaps

- The `?season=` query parameter used in T5/T6 URLs is not what the API reads
  (`seasonId`); the page-level expectations still hold, but the URLs do not
  select a season server-side. Align the spec with the real parameter when the
  leaderboard page grows season selection.
- Does not test the season strip's absence when no season runs (needs a floor
  with every season settled).
- Does not test entry from an agent key rather than a browser session; API
  parity is covered by `api-parity.test.ts` instead.
- Does not test two concurrent running seasons, which the backend does not
  support by design (`runningSeason()` takes the first).
