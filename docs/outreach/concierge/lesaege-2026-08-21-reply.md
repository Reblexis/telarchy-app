# Clément Lesaege (Kleros) - reply draft, 2026-08-21

**Inbound, not outreach.** He replied to Viktor on X
(https://x.com/viktorci/status/2090762840479064500), followed back, then went to
telarchy.com and left `clement@kleros.io` on the "List your own number" tile at
11:50 UTC. `notifyOwner` mailed it through. The floor promised "we will get back
to you within a few days"; this is that.

Why he scores well against the selection criteria in `program.md`: real protocol
with on-chain numbers, and he is a mechanism-design person, so the pitch is not
the work. The work is picking the number and getting one real decision onto it.

## Pricing decision (Viktor, 2026-08-21)

The question raised was YC's "charge from day one", and it is the right
question. The answer is not "network effects, so free": that is the
free-for-the-logo trap. Two things decide it.

**What we would want to charge is not access, it is liquidity.** Per
`docs/vision.md` ("Decision quality scales with capital"), the operator's spend
on Telarchy is meant to be the subsidy they put on the decisions they want
priced, not a seat fee. That is the version of "charge from day one" that fits
this product: real money out of his pocket, scaling with how badly he wants an
answer, buying the thing he actually needs, since traders go where the subsidy
is. Someone who funded a market about his own decision turns up to read the
price.

**We cannot take his money today.** The managed instance runs with USDC
settlement disabled (`GET /api/agents/deposit-address` returns 503, checked
2026-08-21), and `docs/vision.md` is explicit that managed credits are play
money handed out by admins. So "he funds his own liquidity" would mean handing
him free credits and calling it payment, which is worse than not charging: it
is a fake price. Off-platform invoicing plus an admin credit grant is possible
but is a heavy first move and delays a floor we want live for Season 0.

So: no price in the first email, and the reason is a missing billing rail, not
a belief that this should be free. The commitment gets taken in the currency we
can actually collect, which is a named decision with a date that he agrees to
put through the market before he makes it. That is the ask this draft makes
binding rather than polite. The money conversation happens the first time a
price he reads changes what he does.

**Follow-up this creates:** the inability to accept money from a willing
operator is the gap, and it turned out to be one of three. Recorded as an owner
decision in `docs/vision.md` ("The owner side reopens", 2026-08-21): a person
who wants a floor has to be able to create one, steer their own liquidity, and
buy credits. Kleros is blocked on the first of those today; someone has to open
the workspace by hand until it ships.

## The number to propose

**Monthly disputes arbitrated.** On-chain, so nobody can argue about the value,
and it is the number the protocol rides on. Fallbacks if he wants something
else: PNK staked, or active jurors. Let him choose; do not choose for him.

Per `program.md`: no mocked data, and the workspace gets created while he is
still in the conversation, not after.

## Draft

Subject: your number on Telarchy

> Hi Clément,
>
> Yes, happy to set it up.
>
> The way it works is you put up one number Kleros actually answers to, and then
> anyone, human or AI, can propose a paid job that would move it, and the market
> prices the job before you decide. The obvious candidate is monthly disputes
> arbitrated, because it is on-chain so nobody can argue about the value and it
> is the number the whole protocol rides on. PNK staked or active jurors work as
> well if you would rather price one of those. Your call.
>
> The thing I would ask for instead of money is a decision. Name one you are
> actually going to make in the next month or so, with roughly when you will
> make it, and agree to read the price before you decide. Without that the
> market is just a chart, and I would rather not build you a chart.
>
> I am not charging you for access, and I would rather say why than let it look
> like a favour. The trader pool is still small, so you would be paying for thin
> markets. When it is thick enough that a price you read changes what you do,
> I will come back and ask for money.
>
> I should be honest about the state of it too: it is early, it works, but you
> will hit bugs.
>
> One more thing. Season 0 starts tonight at midnight UTC, $1,000 of real money
> to whoever's trading profit grows the most by 16 October, free to enter and no
> stake. telarchy.com/season. Separate from the above, but you would probably do
> well at it.
>
> Viktor

## Notes for whoever sends this

- **Updated 2026-08-22:** workspace creation is no longer invite-only
  (`POST /api/workspaces` is open to any signed-in identity, capped at 3 per
  account, new floors unlisted). There is still no operator SCREEN and the
  first-run experience is deliberately undesigned (`docs/operator-setup.md`),
  so a human still opens his floor and this note stands: somebody sets him up
  in the conversation, not afterwards.
- If he says yes, the floor needs a context briefing as a Source before AI
  participants forecast it, per the forecaster-context strategy in `program.md`.
