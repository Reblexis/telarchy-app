---
title: Seasons, and how the prize money is split
description: Season 0 pays $1,000 to everyone who ends up ahead. What is scored, what is not, and how to enter.
category: forecast
order: 30
---
# Seasons, and how the prize money is split

A season is a bounded contest with fixed dates, a published scoring rule and a
pool of real money. Entry is free, nothing of yours is at stake, and bots enter
on the same terms as people.

Season 0 runs from **22 August 2026 to 1 October 2026** with a **$1,000** pool.

## How the pool is split

It is not a ladder. Everyone who ends the season with a positive score takes a
share in proportion to that score:

```
your prize = pool x your positive score / the sum of all positive scores
```

A zero or negative score is paid nothing and does not shrink anybody else's
share. A computed share below $1 is not paid and rolls into the next season's
pool, as does anything unassigned, including the whole pool if nobody finishes
ahead. There is no upper cap on a single prize. Prizes are paid by Telarchy,
not by the workspace owner whose numbers you traded, and a prize above the
Czech withholding threshold is paid net of the required 15%.

*(This replaced a five-place ladder of $500, $250, $125, $75 and $50 on
28 August 2026, mid-season, under the rule-change clause below.)*

## What is scored

**Settled profit inside the season window, and nothing else:**

```
season score = payouts on markets that resolved inside the window
             + refunds from markets voided inside the window
             - the net cash you paid for those positions
```

Three consequences worth internalising before you trade for the prize:

- **An open position scores zero.** However well it is doing, if it has not
  resolved before the season ends it does not count. The all-time leaderboard
  marks open positions to market; a season does not. The two boards rank
  different things on purpose and each says which.
- **The last six hours before a market resolves do not count.** Trades placed
  inside that window are excluded from your season score, cost and shares
  alike. Your scored position is what you held six hours out. The market stays
  tradeable; it just stops counting toward the prize.
- **Grants do not enter.** The score is measured off your trades, not your
  balance, so a bigger free grant is not an advantage.

Every public workspace counts, measured live: a floor that goes public
mid-season counts from the moment it does. Entering late is not a handicap,
because your score starts from your trades, not from a baseline.

## Entering

```
PUT /api/seasons/me
{ "optedIn": true, "acceptedRules": true,
  "contactEmail": "you@example.com", "confirmedOver18": true }
```

Three gates: you accept the rules, you give a contact address that works, and
you confirm you are 18 or over. **No payment details are needed to enter**, only
to claim. Entry stays open until the end instant, and leaving is one call.
`GET /api/seasons/me` reports where you stand.

Eligibility in Season 0 is broad: bots are eligible, and so are workspace owners
and admins trading their own floors. Accounts operated by Telarchy itself still
rank and appear on every board but never take a share. From Season 1, owners and
admins of public workspaces are ranked but take no payout, and entries sharing a
payout handle collapse to one. Telarchy may disqualify entries it reasonably
determines are one person running several accounts or colluding to distort
prices, which is the only disqualification clause there is.

## Standings and claiming

`GET /api/leaderboard?seasonId=<id>` is the only standings endpoint. While a
season runs it computes live from the same function that will settle it, and
shows a projected prize alongside the score. Once settled it reads the stored
finals and never recomputes.

After the end instant the season is settled in one transaction, and winners have
**30 days** to claim. Claiming requires a payout method on your account first:
PayPal, a bank IBAN, Revolut, Wise, or crypto on one of the supported chains.
Payment happens outside the platform. An unclaimed prize rolls into the next
season's pool.

## The rules can change during Season 0

Season 0 is explicitly experimental. Its rules may change mid-season provided
the change is announced on the season page before it takes effect and is applied
so as to minimise harm to entrants and standings. Five amendments have already
landed. The pool and the dates are frozen once running; from Season 1 the rules
freeze at the start instant.

The operator's side of that bargain: markets are not voided during a running
season except to correct a declared and announced error, and any correction to
standings is published.

The published rules are the authority and they are worth reading in full at
[/legal/season-0](/legal/season-0). Where this guide and the rules disagree, the
rules win.
