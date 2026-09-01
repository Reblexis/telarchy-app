# Season 0: official rules

_Published 2026-08-17, renamed to Season 0 on 2026-08-19 and amended that day
and on 2026-08-21, before the season started. Season 0 is experimental: we may
adjust these rules while it runs. Every change is announced on the season page
before it takes effect, and changes are applied so as to minimize harm to
entrants and standings._

_Amended 2026-08-22, mid-season: a prize no longer requires a score above
zero; place alone decides the prize. The change only increases what is paid,
never reduces anyone's standing or prize, and is announced on the season
page._

_Amended 2026-08-25, mid-season: accounts that own or administer a workspace
are explicitly eligible. The rule never excluded them, but it did not say so;
this change widens who may enter and reduces nobody's standing or prize. It is
announced on the season page._

_Amended 2026-08-28, mid-season: the ranking now pays for being right, not
for holding marks. Effective immediately, the season score is SETTLED
profit: what markets that actually resolved during the season paid you,
minus what you paid on them. Open positions are still marked on the boards,
but a mark scores nothing until its market resolves. Trades placed in a
market's final 6 hours no longer count toward the season score. Announced on
the season page; the Scoring section below has the details._

_Amended 2026-09-01, mid-season: **every trade counts, and the 6-hour cutoff
is removed.** A market now resolves the moment a reading dated inside its
period is filed, so there is no interval in which an already-visible answer
can be traded against, which is the only thing the cutoff protected. It also
cost something: "does not count" ignored late SELLING as well as late buying,
so a position sold before resolution was still scored as if held. Your score
is now what your trades actually did, all of them. Announced on the season
page before it takes effect. This can REDUCE the score of an entrant who sold
out inside a cutoff and kept the win, which is why it is called out here
rather than folded in quietly._

_Amended 2026-08-28, mid-season (second amendment that day): prizes are no
longer fixed amounts by place. The $1,000 pool is split among entrants in
proportion to positive settled season score, so every entrant in the green
is paid their share rather than only the top five. Shares below $50 are not
paid and roll into the next season's pool; no single prize exceeds $2,000.
Prizes are now paid by Telarchy directly, from its own funds, rather than by
the workspace owner. Effective on announcement on the season page; the
Prizes and Getting paid sections below have the details._

_Amended 2026-08-28, mid-season (third amendment that day): the minimum
paid share drops from $50 to $1, and the $2,000 single-prize cap is
removed. Where the law requires withholding on a prize (Czech law does,
above CZK 50,000), we withhold the required amount and pay the rest. Both
changes only increase what can be paid; nobody's share shrinks._

**Season 0 is the first one, and the platform is still being launched.** Expect
rough edges, apologies in advance. If something looks wrong, tell us through
the feedback channel in the app; where a bug affects standings we say so
publicly and publish the correction.

## The deal

Trade on the public Telarchy floor; entrants are paid real money in
proportion to the settled trading profit they earn while the season runs
(amended 2026-08-28; originally a five-place prize ladder). The season runs from
its published start instant to its published end instant, both UTC, shown on
the season page. Entries close when the season ends; settlement and prizes
follow.

## Free means free

You pay nothing to enter and risk nothing you own. Credits are play money:
they cannot be bought, have no cash value, and are never exchanged for a prize
or redeemed. A prize is for where you place under the scoring rule, not for
credits, and your credit balance is unaffected by winning or losing.

## Prizes

Total pool: **$1,000 USD**.

```
your prize = pool x your positive settled season score
                  / the sum of all entrants' positive settled season scores
```

(Amended 2026-08-28, replacing the original fixed ladder of $500 / $250 /
$125 / $75 / $50 by place.) The pool is split in proportion to settled
season score: earn twice the settled profit of another entrant, be paid
twice their prize. A zero or negative score is paid nothing and does not
shrink anyone else's share. Three boundary rules:

- A computed share below **$1** is not paid and rolls into the next
  season's pool (a prize smaller than the cost of sending it helps nobody;
  lowered from $50 by the third 2026-08-28 amendment).
- There is no upper cap on a single prize. A prize large enough to trigger
  a legal withholding duty (Czech law: 15% above CZK 50,000) is paid net
  of the required withholding.
- Anything otherwise unassigned, including the whole pool if no entrant has
  a positive score, rolls into the next season's pool.

## Scoring

```
season score = what the season's resolved markets paid you - what you paid on them
```

(Amended and in force 2026-08-28; before that day the previous
marked-to-market rule applied.)

Your score counts only markets that RESOLVED, or were cancelled and
refunded, inside the season window: resolution payouts on your shares, plus
refunds from cancelled markets, minus the net cash you paid on those
markets. A position still open when the season ends counts nothing, however
high the board marks it: a prediction is paid when reality arrives, not
before. Resolutions at the season's end instant count; anything resolving
later does not.

- **Credits the platform granted you never enter the score**, as before.
- **Every trade counts, whenever you made it.** There is no cutoff. A market
  stays open and tradeable right up until it resolves, and it resolves the
  moment a reading dated inside its period is filed - so there is never a
  window in which the answer is visible and the book is still open, and
  nothing can be farmed off a reading you can already read. Your scored
  position in a market is what you actually held when it resolved: sell out
  beforehand and the sale counts too, so it cancels what the purchase would
  have earned.
- **Entering late changes nothing**: the score counts what resolved inside
  the window, whenever you opted in.
- **The boards keep showing your open positions at their marked value.** The
  mark is information for the owner and other traders; the score is what
  settled. The all-time leaderboard is unchanged and still ranks total
  profit including open marks; only the season ranking pays out.
- The score runs over every public workspace on the platform, including
  workspaces that become public while the season runs, as before.

Worth knowing before you trade: buying moves the price, so a large buy shows
a gain on the boards the moment it lands. That marked gain is display, not
score: nothing enters your season score until a market you traded actually
resolves.

Only entrants who explicitly opted in are ranked or paid. Equal scores are
paid equal shares, so a tie needs no breaking for money; the displayed rank
order breaks ties by earlier entry, then by participant id, both automatic
and identical on any recount.

## Entering

- 18 or older, with a Telarchy account, explicitly opted in. Entry opens when
  the season is announced, before it starts.
- Entering means agreeing to these rules, and we record when you agreed. Entry
  asks for a contact email, used to tell you if you win. No payment details
  are needed; winners are asked at claim time. Leaving is one click.
- Participants operated by us or run as part of the platform are **not
  eligible**.
- Accounts that own or administer a workspace **are eligible**, and their
  trades in that workspace count like any other; the score already runs over
  every public workspace. Being a workspace owner is not being the platform.
- We may disqualify entries that we determine, acting reasonably, are one
  person running several accounts, or collude to distort prices.

## Getting paid

Winners have **30 days** after settlement to claim, by adding payment
details to their account and pressing claim; Telarchy then pays them
directly, from its own funds, outside the Service, using those details
(amended 2026-08-28; previously the workspace owner paid). Telarchy holds,
transmits, escrows and processes no third-party funds: a prize is our own
money paid as a contest prize. An unclaimed prize rolls into the next
season's pool. Winners are responsible for taxes on amounts received; where
Czech law requires withholding on a prize (above CZK 50,000), we withhold
the required amount and pay the rest.

## The operator's side

We do not void markets during a running season, except to correct a declared
error, and we announce it if we do. We may end or void a season; if we do, we
say so on the season page, and no prize is owed. Disputes: write to us through
the feedback channel in the app; we answer, and we publish any correction to
standings rather than making it silently.
