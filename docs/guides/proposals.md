---
title: Decide a proposal on the number
description: What the two prices mean, what each of the four buttons does to the money, and what the record says afterwards.
category: run
order: 60
---
# Decide a proposal on the number

Someone offers to do a piece of work on your floor, optionally for a price. The
moment it is posted, every open market on your floor gets a twin pair: what this
metric does **if you approve**, and what it does **if you decline**. People with
their own credits at stake price both. The gap between them is what you decide
on.

This guide is the owner's side. The proposer's side, including how to write one
and what it costs to post, is [get paid for work](/guides/get-paid).

## The number you are reading

Per metric and per date:

```
delta = approved consensus - declined consensus
```

Not "the market went up after they posted". The baseline can already be pricing
in that you will say yes, so a rise in the baseline tells you what the crowd
expects you to do, and the delta tells you what it is worth. Both branches open
at the same baseline price, so a spread only exists because someone paid to put
it there.

Three places give you the same numbers:

- **The floor.** Each proposal in the right rail carries its impact on the
  headline horizon, and selecting one swaps the chart and the ticket onto the
  approved branch so you can trade it yourself.
- **`GET /api/proposals/:id`.** `markets[]` carries one row per metric and date:
  `approved` and `declined` (each with `consensus`, `liquidity`, `tradeCount`),
  `delta`, and `baselineConsensus` for context. `delta` is `null` when either
  side has no price. For a caller with `manage`, the row also carries the
  proposer's `payoutHandle`, which is where the money goes if you approve.
- **`GET /api/marketplace/:workspaceId/context?format=md`.** The whole floor as
  one markdown brief, proposals and their priced impact included. This is the
  form to hand a model.

**A pair with no liquidity has no price and tells you nothing.** That is the
usual reason a proposal sits there reading "no price yet" instead of a number.
Posting is free, and a proposal is the proposer's to price: a proposer who
paid no subsidy has left you nothing to read.

You can fund it yourself. `POST /api/predictions/markets/liquidity/bulk
{ amount, proposalId }` puts `amount` credits into **each** branch under that
proposal, so the bill is `amount` times the number of markets, and it needs
`manage`. `POST /api/predictions/markets/:id/liquidity { amount }` funds one
market and needs only `trade`, so a trader who wants a readable price can deepen
it without you. Top-ups on a pending proposal are recorded as durable subsidy
and re-seeded when target dates roll forward, so they do not evaporate.

**Or decide it once, per date.** Every date a metric is priced on carries a
"Proposal opens with" number beside its "Book opens with"
(`timePreference.horizonCredits[entry].proposal`, set on the metric's sheet
on the floor or with `PUT /api/metrics/:id`). When a proposal arrives and no
listed contributor can pay, each branch opens with its own date's number,
from your wallet, then your balance; a proposal across three dates is three
different bills. **The number defaults to 0**, and 0 means the pair spawns
unfunded and the floor says so in place of the bet buttons: the owner pays
only on a date where they chose a number because they want the price before
the proposer pays for one. When your wallet covers only part of the bill,
every branch gets the same share of what it asked for, down to the minimum
contribution, rather than some branches everything and others nothing. The
workspace's `autoFundNewMarkets` and `newMarketLiquidityCredits` fund the
metric's own books and never a proposal.

## The four ways it ends

| | Endpoint | What happens to the pair | Money |
|---|---|---|---|
| Approve | `POST /api/proposals/:id/approve` | declined branch voided and refunded, approved branch stays live | the ask is owed; stake bought out; `proposalReward` paid |
| Decline | `POST /api/proposals/:id/decline` | approved branch voided and refunded, declined branch stays live | nothing moves |
| Decline as spam | `POST /api/proposals/:id/decline-spam` | both branches voided and refunded | up to `spamPenalty` taken from the proposer, credited to you |
| Remove | `DELETE /api/proposals/:id` | both branches voided and refunded | nothing moves |

All four need the `manage` capability. The proposer has a fifth, `POST
/api/proposals/:id/withdraw`, which voids both branches and moves no money.

Nothing expires. There is no deadline on a pending proposal and no sweep that
decides for you: it stays pending until a person acts. The one automatic thing
is that a branch market reaching its own resolution date while the proposal is
still pending gets voided and refunded, because a conditional market on an
undecided condition has nothing to settle against.

If you want a ceiling on how many can pile up, `maxPendingProposalsPerParticipant`
caps pending proposals per participant (0, off, by default) and returns 429 with
`{ pending, cap }`. The cap never applies to anyone who can review the queue,
i.e. whoever holds the `manage` capability on the floor: the owner, the admins
they added, and a platform admin acting there. It is a brake on what strangers
can queue for a reviewer to look at, and a reviewer's own proposals are their
own to manage, so they may post any number of pending proposals whatever the cap
says.

## Approving is the payment

At the press, the agreed amount is owed and the proposal counts as paid. Nothing
sits between the button and that record. Whatever rail carries the dollars
afterwards, your bank transfer included, settles a debt already incurred rather
than making a second decision.

So do not treat approve as "I will decide once I see the work", and do not offer
a proposer a staged or on-delivery arrangement. If you are not ready to owe the
money, the answer is decline.

The platform does not move dollars. It records what you owe: approved proposals
sum into `approvedUsd`, and the proposer's payout handle is on the proposal. You
send the money on whatever rail their handle names.

Two credit movements do happen automatically on approve, both out of your
balance:

- **The proposer's liquidity stake is bought out.** Whatever they put into the
  branch markets comes back to them, and the LP position transfers to you. If
  your balance cannot cover it, the buyout is skipped and their stake stays in
  the market until it resolves.
- **`proposalReward` is paid**, if you set one. It defaults to 0. When it is set
  and your balance cannot cover it, the whole approve returns 409 naming what
  you need and what you have.

The reward is checked before anything else moves. An approve that returns 409
leaves the proposal exactly as it was: still pending, both branches still open
and priced, no stake bought out. Top up and approve again.

## Declining, and why the reason is enforced

`POST /api/proposals/:id/decline` takes `{ declineReason?, refund? }`.

**A reason is required exactly when your workspace has a charter set.** That
coupling is the point. Making a public commitment about what you will do with
the market's answer is what turns the requirement on. A floor that promises
nothing stays frictionless; a floor that promises something cannot quietly skip
the one decline that is embarrassing to explain. Maximum 4000 characters, and it
is published permanently on the proposal.

`refund: true` is the "genuine idea, just not this one" variant: it voids both
branches instead of one, so the proposer's whole staked liquidity comes straight
back. No penalty either way.

The reason appears on `GET /api/proposals`, on `GET /api/proposals/:id`, in the
floor's decided list, in the workspace brief, and in the email and inbox
notification sent to the proposer and to everyone who traded either branch. It
does not post an announcement; announcements are a separate surface you publish
by hand.

**Decline as spam** is for the carpet-bombers, not for bad ideas. It charges
`spamPenalty`, a per-workspace credit amount that defaults to 0, capped at
whatever the proposer actually has, and credits it to you. It takes no reason.
There is no button for it on the floor; it is an API call.

**Remove** takes a proposal off the board entirely: a duplicate, a test row,
something that should never have been there. Every stake is refunded first. It
is not a decision, it notifies nobody, and it cannot be undone from the browser.

## What the declined branch does

Both branches are real markets and both can pay. Whichever world the decision
creates is the one that settles against the metric; the other is a
counterfactual with nothing to settle against, so it voids and every position
in it is refunded at net cash.

- **You approve.** The approved branch stays live and settles at its date on
  what the metric actually read. The declined branch voids.
- **You decline.** The declined branch stays live and settles at its date on
  what the metric actually read. The approved branch voids.

That symmetry is the point of pricing both. A decline is not a dead end for the
people who priced it: they said what would happen if you said no, you said no,
and the number arrives to prove them right or wrong. It is also what makes a
decline auditable later, because "we declined and the metric did what the
market said it would" is a record you can point at.

Neither branch settles if you never decided. A proposal still pending at a
market's resolution instant created no world, so both branches void there and
everyone is refunded.

*(Until 2026-08-30 the resolver voided a declined proposal's surviving branch
too, so a decline paid nobody. Fixed; the behaviour above is what runs.)*

## Two habits that make the delta mean something

**Publish a charter.** Forecasters are being asked to price a stranger's
decisions with their own credits. A floor that has not said what their work
buys them is asking for free labour, and they correctly refuse. The charter is
what you will do with the number and the reasons you may decline anyway, stated
in advance so they cannot be invented afterwards. Set it with `PUT
/api/workspaces/:id/settings { charter }` (up to 20000 characters, `manage`).

**Push back on unbounded proposals.** A market is only useful when execution is
near-certain and the outcome is uncertain, because those are the two doubts it
cannot tell apart. "Improve onboarding" has no stated quantity. "Hire a senior
engineer this month" needs somebody else to say yes, so a low price could mean
"this would not help" or "this will not happen". Bounded by time, money, count
or a single discrete act, they become priceable: spend 20 engineering hours on
the onboarding flow, interview 20 churned customers, publish the new pricing
page.

The strongest shape is one where pressing approve **is** the action. A paid
proposal already is: the press is the payment. A proposal an AI participant
executes on approval already is. Everything else, "publish the post", "wire the
money", happens soon after the press rather than at it, and that gap is where
the price quietly absorbs the odds of you getting round to it. When no mechanism
exists, approve the commitment instead of the deed, and the follow-through risk
moves inside the price where it can be seen.
