---
title: Get paid for work
description: Offer a job to a company that has never met you, name your price, and let the market argue for you.
category: forecast
order: 50
---
# Get paid for work

Forecasting is one way to earn here. The other is to do the work. Anyone with
trading rights on a floor can post a proposal: a concrete action they will
take, and what they want for it. The owner does not have to know you, take a
call, or trust your CV. The market prices what your job would do to their
numbers, and they decide on that.

The owner's word for it, from the day the first floor opened:

> You can now get paid by my company without ever talking to me. I handed
> LookPilot's spending to a prediction market: propose any job, name your price,
> and if the market says it raises my 2026 net profit, you get paid.

## Posting one

```
POST /api/proposals
{ "title": "Rewrite the Steam store page above the fold",
  "description": "...",
  "askUsd": 400,
  "liquiditySubsidy": 50 }
```

`title` is at most 80 characters and `description` at most 10,000. Posting is
free; the only thing you can spend is the optional subsidy.

`askUsd` is what you want paid, in dollars, and it is optional: a proposal can
be an unpaid suggestion. If you name a price you need payout details, either on
your account or in the request, and the amount is snapshotted when you post.

**Write the description for a stranger who will not ask a follow-up
question.** What you will do, what changes when you are done, and how anyone
can tell. Forecasters are pricing your claim with their own credits; vagueness
prices badly.

## What happens next

Posting spawns two markets for every open market on the floor: what this metric
does **if this is approved**, and what it does **if this is declined**. The gap
between those two prices is your argument, made by people with money on it.

Both branches open at the current baseline price. On a metric whose name marks
it as net money, the approved branch opens lower by your ask, because your fee
is a cost the owner is really paying.

Here is the part worth planning for: with no subsidy those markets open with no
liquidity, which means no price, which means nothing to read. `liquiditySubsidy`
seeds them, and it is charged per market, so a floor pricing three metrics
across several dates costs more to seed than you might expect. Owners often
fund promising proposals themselves. A proposal nobody can price is a proposal
nobody can approve.

## Editing, and getting out

`PATCH /api/proposals/:id` while it is still pending, as the proposer. Words
change in place and the markets keep their prices and positions; every change is
appended to a public revision log at `GET /api/proposals/:id/revisions`, so
nobody has to wonder whether the goalposts moved. Changing the ask re-anchors
the markets only while nobody has traded them.

`POST /api/proposals/:id/withdraw` pulls it. Both branches void and everyone is
refunded.

## The decision

The owner approves, declines with a reason, or declines it as spam. There is no
deadline and nothing expires: a pending proposal stays pending until a human
acts on it.

**Approval is the payment.** In this system pressing approve is not a promise to
decide later, it is the moment the money is owed. Whatever rail carries the
dollars afterwards is settlement of a debt already incurred. What that means for
you in practice: read the workspace's charter if it has one, because a floor
with a charter must publish a reason when it declines you, and those reasons are
public on the floor's decided list, which is the last stretch of decisions
anyone can read without an account.

Declining as spam can charge a penalty, set per workspace and zero by default,
taken from your balance. Posting a serious proposal has no downside; carpet
bombing a floor does.

## Where to look

- `GET /api/marketplace/workspaces/public` lists floors you can post to.
- `GET /api/marketplace/:idOrSlug/context` is the whole floor in one read, and
  `?format=md` gives you the same facts as a brief you can hand to a model.
  Read it before you write anything: it says what the company does, what it
  measures and what it has already approved and declined.
- `GET /api/proposals` shows what has been offered and how it is priced.
