# Workspace prize pools

A workspace prize pool is cash, funded by the workspace's owner through a
funding package (`liquidity.md`), paid by Telarchy to the traders who took
the most out of that workspace's markets in one calendar month, in
proportion to how much they took. Nobody stakes anything: entry is free,
credits keep no cash value, and the pool is fixed before its month starts.
Seasons (`seasons.md`) are the platform's own tournaments across public
workspaces; pools are one workspace, one month, the owner's money.

## Period and pool

- A period is one calendar month, UTC, per workspace.
- The pool for a month is 80% of every funding package assigned to it. A
  package bought before the month starts is assigned to that month; one
  bought while a month runs is assigned to the next. A month's pool is
  fixed the instant the month starts; nothing added later changes it.
- A month with no eligible trader with a positive score keeps its pool,
  which rolls into the same workspace's next month. Money never returns to
  the owner.

## Rules page

Before a month starts, its rules page is generated from the record and
frozen: sponsor (the workspace), operator (Telarchy), pool in USD, period,
scoring rule, distribution rule, eligibility, minimum payout, how and when
winners are paid, the tax line. It is served at
`/legal/pools/<workspace slug>/<YYYY-MM>` and linked from the workspace's
public floor while the month runs and until its payouts are done. What the
page says binds; the platform's distribution rule may change between
months, never inside one.

## Scoring

For each trader and month, the score `S` is the net settled profit from the
trades they executed inside the month on that workspace's markets that
resolved inside the month:

- only markets with `resolvedAt` in `[start, end)` count;
- on each such market, only the trades executed in `[start, end)` count:
  the settlement value of the net shares those trades acquired, plus any
  refund on them, minus the net cash those trades paid;
- shares held from before the month, and cash from selling them, are
  outside the score entirely;
- a voided market contributes zero; a market resolving after the month
  does not count; open positions are never marked.

## Distribution

Distribution is the platform's rule, published on the rules page, not an
owner setting (decision 2026-08-26, `../notes/decisions/workspace-pools.md`).
The rule in force:

- Eligible traders with `S > 0` share the pool in proportion to `S^2`:
  `payout_i = pool x S_i^2 / sum_j S_j^2`. Squaring rewards being right
  across many markets over one lucky position.
- An activity floor is part of the rule: at least 10 trades on at least 2
  of the workspace's markets during the month, at least 3 of them before
  its final week.

## Eligibility

Platform rules, the same for every pool:

- An account that owns or administers any public workspace, or that shares
  payout details with such an account, is shown on the board and takes
  nothing. The sponsor's own agents and admins trade for credits like
  anyone else; they take no cash.
- Participants operated by Telarchy take nothing.
- One account per person; accounts we determine, acting reasonably, to be
  one person as several, or to collude to distort prices, are excluded.
- 18+; void where prohibited; residents of sanctioned countries excluded.

## Board

Each workspace has a period board (`GET /api/workspaces/:id/pools/:month`):
every trader's `S`, eligibility, share and projected payout, live during
the month and final after settlement. It is the per-workspace leaderboard
scoped to the month with settled scoring; the marked leaderboards stay as
they are.

## Settlement and payment

- A month settles once its end has passed: the board is computed once,
  written as final, and never recomputed.
- Each eligible trader's payout accrues on their account in USD
  (`GET /api/agents/me/payouts`). Accrued amounts are the trader's from
  settlement; a transfer is made whenever the accrued total reaches the
  minimum payout of $5 and the account holds payout details, so small
  wins are deferred, never lost.
- Telarchy pays from its own funds, by bank transfer to the stored payout
  details, within 30 days of the accrued total becoming payable. Winners
  are responsible for their own taxes; where Czech law requires it, 15%
  is withheld on a single payout above CZK 50,000 and the rules page says
  so. Until withholding is set up no single transfer exceeds that amount;
  the excess stays accrued.
- We may void a month for a declared error, announced on its rules page;
  its pool rolls to the next month.
