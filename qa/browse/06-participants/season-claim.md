---
id: 06-participants-season-claim
tags: [browse]
isolation: account
parallel-safe: false
needs: [auth, master-key]
timeout: 180s
goal-horizon: short
goal-statement: |
  As a season winner, I can see that I won, add my payment details, claim my
  prize, and know by when I have to do it.
---

# Browse test: Claiming a season prize

## What this tests

The end of the loop, and the only part of Telarchy where a participant is owed
real money. Three things have to be true at once: the winner can tell they won,
the claim actually records something, and nobody who did not win can claim.

The backend rules are pinned in `functions/src/__tests__/season-lifecycle.test.ts`
(claim, double claim, expiry, non-winner, paid-before-claimed). This spec covers
what the winner actually sees, which those tests cannot.

## Preconditions

- A settled season with at least one winner. Run `season-entry.md` first, place
  a trade that finishes above zero, then settle:

  ```bash
  curl -s -X POST -H "X-API-Key: $ADMIN_KEY" \
    https://telarchy.com/api/seasons/$SEASON/settle | jq
  ```

  Note the `winners` array. The account under test must appear in it.
- The winning account must start with **no** `payoutMethod`, so the missing-details
  path is exercised first. Clear it if needed via `POST /api/auth/profile` with
  `{"payoutMethod": null}`.

## Tests

### T1. A settled season shows final standings and the prizes

**Steps:**
1. `$B goto "https://telarchy.com/leaderboard?season=$SEASON"`
2. `$B wait --networkidle`
3. `$B screenshot /tmp/season-settled.png`

**Expected:**
- The subheading reads "Final standings", not a day countdown.
- A "Prize" column exists, showing `$500` on the first row.
- Rows below the paid places show `—` in the prize column rather than `$0`.

### T2. Standings do not move after settlement

**Steps:**
1. Note the order of the top three.
2. As another participant, place a large trade that would change the live board.
3. `$B reload` on the standings page. `$B wait --networkidle`

**Expected:** the order and the prizes are **identical**.

**Why this is the sharpest test on the page:** a settled season reads stored
finals. If it ever recomputes live, the published winner changes quietly every
time a price moves, including after the money has been sent, and nothing on the
page would indicate that it had changed.

### T3. Claiming without payment details says what to do

**Steps:**
1. Log in as the winner.
2. `$B goto https://telarchy.com/lookpilot#account` (the account is a dialog on the floor since 2026-08-19; `/account` redirects here)
3. `$B wait --networkidle`
4. Click "Claim my prize".
5. `$B wait --networkidle`
6. `$B text`

**Expected:** a visible error naming payment details, pointing at where to set
them. Not a silent no-op, and not a bare "400".

**Fails if:** the click appears to succeed, or the error only appears in the
browser console. This is a user-actionable error and belongs on screen
(AGENTS.md error-handling convention).

### T4. Claiming with payment details works and is durable

**Steps:**
1. In the account dialog, set payment details (PayPal is the quickest: an email).
2. Click "Claim my prize".
3. `$B wait --networkidle`
4. `$B text`
5. `$B reload` then `$B wait --networkidle`

**Expected:**
- Confirmation naming the amount, e.g. "Claimed $500".
- Text explaining payment is sent directly to the details on the account, i.e.
  it does not imply Telarchy is transferring money.
- After reload the claim is still recorded (the button does not offer to claim
  again).

Verify server-side:

```bash
curl -s -H "X-API-Key: $ADMIN_KEY" \
  https://telarchy.com/api/seasons/$SEASON/payouts | jq '.payouts[0]'
```

Should show `claimState: "claimed"`, a `claimedAt`, the `prizeUsd`, and the
`payoutHandle` needed to pay them.

### T5. A non-winner cannot claim

**Steps:**
1. Log in as a participant who entered but placed outside the ladder.
2. `$B goto https://telarchy.com/lookpilot#account` (the account is a dialog on the floor since 2026-08-19; `/account` redirects here)
3. `$B text`

**Expected:** no "Claim my prize" button, or a refusal if pressed. The season
section may still show the season; it must not offer a prize.

### T6. Payment details never appear on a public surface

**Steps:**
1. `$B stop` then `$B status` (anonymous).
2. `$B goto "https://telarchy.com/leaderboard?season=$SEASON"`
3. `$B text`
4. `$B goto https://telarchy.com/lookpilot` and `$B text`

**Expected:** the winner's PayPal address, IBAN, or any part of their
`payoutMethod` appears **nowhere**.

Also check the raw payload, because a field can be in the JSON without being
rendered:

```bash
curl -s "https://telarchy.com/api/leaderboard?seasonId=$SEASON" | grep -ci "payout" || echo "clean"
```

Must print `clean`. Pinned by
`season-lifecycle.test.ts` ("payment details never appear in a season standings
response"), and worth re-checking here against the real serializer.

### T7. Only a platform admin sees the payouts list

**Steps:**
1. As the winning participant (not a platform admin):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -b "$WINNER_COOKIES" \
  https://telarchy.com/api/seasons/$SEASON/payouts
```

**Expected:** `403`. This endpoint is the only place payment details are ever
returned, and owning a workspace must not be enough to reach it.

## Known gaps

- The 30-day expiry path is not testable through the browser without waiting or
  editing `settled_at` directly; it is covered in
  `season-lifecycle.test.ts` ("claiming after the 30-day window").
- Does not test the `paid` transition end to end, since that is an operator
  action with no participant-facing UI beyond the payouts list.
- Does not test a claim by an agent-key caller.
