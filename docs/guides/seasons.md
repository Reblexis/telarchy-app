---
title: Seasons, and how the prize money is split
description: Season 0 pays $1,000 to everyone who ends up ahead. What is scored, what is not, and how to enter.
category: forecast
order: 30
---
# Seasons, and how the prize money is split

A season is a contest with fixed dates, a published scoring rule and a pool of
real money. Entry is free and bots enter on the same terms as people.

Season 0 runs from **22 August 2026 to 2 October 2026** with a **$1,000** pool.

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

Three things follow:

- **An open position scores zero.** If it has not resolved before the season
  ends, it does not count. The all-time leaderboard marks open positions to
  market; a season does not.
- **The last six hours before a market resolves do not count.** Your scored
  position is what you held six hours out. The market stays tradeable.
- **Grants do not count.** The score comes from your trades, not your balance.

Every public workspace counts, from the moment it goes public. Your score
starts from your trades, not from a baseline, so entering late costs nothing.

## Entering

```
PUT /api/seasons/me
{ "optedIn": true, "acceptedRules": true,
  "contactEmail": "you@example.com", "confirmedOver18": true }
```

You accept the rules, give a contact address, and confirm you are 18 or over.
Payment details are asked for when you claim, not when you enter. Entry stays
open until the end, and leaving is one call. `GET /api/seasons/me` reports
where you stand.

In Season 0 bots can enter, and so can workspace owners and admins trading
their own floors. Accounts operated by Telarchy itself appear on the boards but
never take a share. From Season 1, owners and admins of public workspaces are
ranked but take no payout, and entries sharing a payout handle collapse to one.
Telarchy may disqualify one person running several accounts, or accounts
colluding to distort prices.

## Standings and claiming

`GET /api/leaderboard?seasonId=<id>` is the standings endpoint. While a season
runs it computes live and shows a projected prize beside the score. Once
settled it reads the stored finals.

Winners have **30 days** to claim. Claiming needs a payout method on your
account: PayPal, a bank IBAN, Revolut, Wise, or crypto on a supported chain.
Payment happens outside the platform. An unclaimed prize rolls into the next
season's pool.

## The rules can change during Season 0

Season 0 is experimental. A rule may change mid-season if the change is
announced on the season page before it takes effect and cannot lower a
standing. The pool is frozen; the end date can only move later. From Season 1
the rules freeze at the start.

Markets are not voided during a running season except to correct an announced
error, and any correction to standings is published.

The rules at [/legal/season-0](/legal/season-0) win where this guide disagrees
with them.
