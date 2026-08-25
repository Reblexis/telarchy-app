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

**Season 0 is the first one, and the platform is still being launched.** Expect
rough edges, apologies in advance. If something looks wrong, tell us through
the feedback channel in the app; where a bug affects standings we say so
publicly and publish the correction.

## The deal

Trade on the public Telarchy floor; the five entrants whose trading profit
grows the most while the season runs are paid real money. The season runs from
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

| Place | Prize |
|---|---|
| 1st | $500 |
| 2nd | $250 |
| 3rd | $125 |
| 4th | $75 |
| 5th | $50 |

**Place decides the prize, whatever the score** (amended 2026-08-22, see
above): the entrant in 1st place is paid the 1st rung even if their season
score is zero or negative. A rung with no entrant to take it, and anything
otherwise unassigned, rolls into the next season's pool.

## Scoring

```
season score = your trading profit now - your trading profit when the season started
```

Trading profit is what your positions are worth, plus refunds from cancelled
markets, minus the net cash you paid. An open position is worth what it would
pay if the market resolved right now at its current call: your shares times
that number. It is the same number as the public leaderboard, it moves before
anything resolves, and credits the platform granted you never enter it. The
score is computed over every public workspace on the platform, including
workspaces that become public while the season runs.

Worth knowing before you trade: buying moves the price, so a large buy shows a
gain the moment it lands and loses it if the market comes back; the per-market
position cap is what bounds this. The trading desk's "worth" line beside a
position is a different, lower number (what a sell would actually pay today);
the board and your season score use the resolve-now value.

- **Everyone's baseline is read when the season starts, not when they enter**,
  so entering late cannot pick a favourable starting point, and entering early
  buys nothing except not having to remember.
- **An account that did not exist at the start has a baseline of zero** and
  keeps everything it earns inside the window.

Only entrants who explicitly opted in are ranked or paid. Ties are broken by
earlier entry, then by participant id; both are automatic and give the same
result on any recount.

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
  person running several accounts, collude to distort prices, or use control
  of a workspace's metrics or markets to move their own score.

## Getting paid

Telarchy holds, transmits, escrows and processes no funds. Winners have **30
days** after settlement to claim, by adding payment details to their account
and pressing claim; the workspace owner then pays them directly, outside the
Service, the same arrangement paid job proposals use (Terms of Service section
3). An unclaimed prize rolls into the next season's pool. Winners are
responsible for taxes on amounts received.

## The operator's side

We do not void markets during a running season, except to correct a declared
error, and we announce it if we do. We may end or void a season; if we do, we
say so on the season page, and no prize is owed. Disputes: write to us through
the feedback channel in the app; we answer, and we publish any correction to
standings rather than making it silently.
