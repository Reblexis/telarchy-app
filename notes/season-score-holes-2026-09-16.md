# Season score: every way credits move without being scored (2026-09-16)

Proposal, not a rule. Nothing here is in force until the owner picks an
option; the rule text then lands in `docs/seasons.md` ("The score") and
`docs/legal/season-0-rules.md` (Scoring) before the code changes.

Trigger: Discord, 2026-09-16, a trader (handle withheld here) on the season:
"i dont think this should be allowed though, it allows u to get infinite
profit", and on the one-account-per-person objection, "U can transfer cr".
Owner, same thread: "good point :D, I'll make it count into profit". To the
agent: "can you make credit transfers in telarchy count into season
profit/loss?" and then "or lets make sure that there are nt any holes make
sure its not easy to cheat". Decision record: `notes/decisions/seasons.md`.

## The loop

Season score is per account and counts settled trading only (the 2026-08-28
rule). Two accounts under one person, B and A:

1. B buys the losing side of a market A holds; the market resolves inside
   the season. A's score rises by T, B's falls by T.
2. A transfers T back to B. The transfer is not scored.
3. Repeat. A's score grows without bound; the pair's credits never shrink.

The pair's SUM of scores is zero, but the pool is paid per account and B's
negative score pays nothing, so the pair collects on A. Step 2 is the
reported hole. Counting transfers closes step 2, but every other unscored
channel is another step 2. The list below is complete: it is the closed set
of reasons in `credit_ledger` (`services/credits.ts`, `CreditReason`), which
is the only door to a balance.

## Every channel, and whether it is a return leg

| Channel (ledger reason) | Scored today | Usable as the return leg | Live use by entrants, Season 0 window |
|---|---|---|---|
| Trades on a market that resolved inside the window (`trade`, `redeem`, `payout`, `void_refund`) | Yes | No | The score itself |
| Trades on a market resolving after the window, or never | No (open counts zero, by rule) | **Yes.** A buys on a far-dated book, B sells into A's buys through the pool, B has credits again. A's cost never enters any season. | Entrants hold 125 to 11,244 credits of net cash on such books each; cannot tell honest from washed without pairing counterparties |
| Peer transfer (`transfer_in`/`transfer_out` with a `credit_transfers` row; includes a bot's initial bankroll from its owner) | No | **Yes.** The reported leg. | 9 transfers, 52,100 credits. All but one are owner-to-own-bot bankrolls or a bot parking savings back with its owner (one pair: 30,000 out, 15,000 back) |
| Pool funding from the tradeable balance (`liquidity`) and what the pool returns (`lp_leftover`) | Not as a loss; only the own-book floor (profit out of a book you funded is reduced by what you put in) | **Yes.** A funds B's book, B trades against the pool and takes it; A's funding is never a loss for A. Works whether or not the book resolves in the window. | Small: entrants' funding and leftovers cancel (two voids of 10,000 and 2,925) |
| Proposal reward (`proposal_reward`, owner to proposer) and penalty (`proposal_penalty`, proposer to owner) | No | **Yes**, for anyone who owns a workspace: approve B's proposal, pay B the reward. | Two rewards of 500 received (the-big-boss, vire) |
| Proposal stake buyout (`proposal_stake`) | No | No: it refunds a pool contribution and moves the LP row to the owner, net zero | none |
| Liquidity wallet (bought liquidity, `agents.liquidityBalance`) | Not a balance; leftovers return to the wallet | No: never becomes a tradeable credit | 725 (patrik_cihal), 100 (jesuslm100) |
| USDC deposit and withdrawal (`transfer_in`/`transfer_out` with no `credit_transfers` row), grants (`signup_grant`), `admin_adjustment`, `fault_refund`, `opening_balance` | No | No: platform on one side, nobody to loop with | not a leg |

Note on the transfer rows: a USDC deposit is written with the same ledger
reason as a peer transfer. Any rule that counts transfers must read the
`credit_transfers` table, not the ledger reason, or a deposit becomes score.

## Options

Standings as of 2026-09-16 (Season 0, proportional, $1,000): vi0 263,092.80
(projected $907), bobalobascrob 14,578.05 ($50), Wobert 7,177.69 ($25),
the-big-boss 2,778.46, philipp-gl 1,033.80, bobalob-ascrob 975.16. The
bobalob pair is one human and the bot it owns (`agents.owner_user_id`).

**A. Count transfers both ways (the literal ask).** Received is profit, sent
is loss. Closes the reported leg. Opens a cheaper one: N browser signups
each transfer their starter grant to one account, which is now score (same
bound as losing on purpose, no trading needed). Effect now: bobalobascrob
+15,000 to 29,578 (prize about doubles), bobalob-ascrob to -14,025, for a
pattern that is not cheating (funding your own bot).

**B. Sent counts as loss, received counts as nothing.** Applied to
transfers, rewards and penalties. Nothing anyone agrees to can raise a
score, so every agreement-based leg is closed at once and no pump exists.
Effect now: bobalob-ascrob to -29,025, bobalobascrob to -422. Both fall out
of the prizes for funding their own bot.

**C. An account and the bots it owns are one entry.** Scores summed, one
row, one prize, paid to the human. Everything inside the household cancels
(the bot's loss to its owner, the owner's transfer to the bot), so the loop
above is worth exactly zero for the commonest way to run two accounts. Add
B for transfers, rewards and penalties that cross households. Effect now:
the bobalob pair scores 15,553.21 as one entry, nobody else moves. Two
humans colluding stays what it is today: bounded by their grants, legible
in the ledger, and the disqualification clause. Household key:
`owner_user_id`, then `owner_agent_id` chains, then the account itself.

**D. Cash accounting.** Score = how the balance changed inside the window,
minus what the platform granted (the ledger sum without platform reasons).
The only option that also closes the far-dated-book leg, because every
credit that leaves an account is a loss the moment it leaves. Cost: a
position still open at the end counts at what it cost, not zero, so
long-horizon trades made during a season are losses in that season and
gains in the one where they settle. Reduces most current standings (open
post-season positions: vire 11,244, Quroe 6,798, the-big-boss 6,566, an-on
5,250, jack 4,394, philipp-gl 4,308), which the Season 0 amendment clause
does not allow mid-season.

## Recommendation

C now, with B for cross-household flows, announced on the season page and
applied to the whole window like the 2026-08-28 amendment. It closes the
reported loop for the case that actually exists (a human and their bot),
changes no honest entrant's score, and adds no pump.

D for Season 1, decided before it starts (rules freeze at the start
instant). The far-dated-book leg is the residual under C: two accounts, a
2027 book, and a growing worthless position on A, visible to anyone who
pairs counterparties, but with no mechanical brake.

Under any option, `own-book-no-profit.test.ts` and
`settled-window-scoring.test.ts` are the suites the new rule tests join,
and the rule test is named after the sentence in the rules.

## One thing noticed on the way

- vi0 holds 263,092.80 of settled score from 4,042 resolved Snake books and
  is not flagged `platform_operated`; it projects $907 of the $1,000 pool.
  If vi0 is a house account, the flag is the rule (docs/seasons.md,
  Eligibility); if it is not, the pool is already decided.
