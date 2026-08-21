# Tetraspace - $20 writeup contract, 2026-08-21

## How it happened

He found Telarchy on his own: he saw the Telarchy bot trading on Manifold,
followed it to the site, and joined the Discord before Viktor had mentioned it
there. Viktor asked whether he wanted to give feedback, then offered to turn it
into a contract ("the first ever approved one"). He answered by posting one.

**The contract**, on `telarchy.com/telarchy`, 2026-08-21 13:40 UTC, pending:

> $20: Write & publish >500 words on Tetra's thoughts on futarchy/telarchy

He cites his own 2020 LessWrong post *You can do futarchy yourself* and his
Manifold profile as the evidence he can write this. Ask $20, payout handle
"USDC on Solana", no liquidity subsidy, no comments on the proposal yet.

He is a credible name in exactly the audience Telarchy recruits from, and $20
is cheap for that. Do not haggle.

## What to change before approving

The contract as written does not require the post to point at Telarchy at all.
"Tetra's thoughts on futarchy/telarchy" is satisfied by 500 words that never
link the site, and distribution is the entire reason to pay for it. That is the
term to fix; the rest is smaller.

1. **Name the deliverable.** Links to telarchy.com, and says enough about what
   it is that a reader who has never heard of it could decide to try it. This
   is not a demand for praise, it is what "promote" means when written down.
2. **Disclosure, in the post itself.** He writes for the LessWrong and Manifold
   audience, which treats an undisclosed paid endorsement as close to fraud.
   The contract is public on our own site, so the payment will be found whether
   or not he mentions it. Disclosure is not a courtesy here, it is what keeps
   the post credible, and a post that audience believes is the only kind that
   converts.
3. **His verdict is his own.** Follows from 2: disclosure only buys credibility
   if the reader thinks he was free to say anything. Worth stating so a
   negative post is a delivered contract rather than an argument. **Not** an
   invitation to a hit piece: the ask is that it links and explains, not that
   it flatters (correction, Viktor, 2026-08-21: an earlier draft claimed a
   critical post would be worth *more* than a positive one, which is wrong.
   The value is distribution, and a trashing does not distribute).
4. **Venue and rough date.** The contract names neither, and "published" cannot
   be checked without them.

## Payment

Telarchy settles USDC on **Base**; he asked for **Solana**. Managed settlement
is disabled anyway (`GET /api/agents/deposit-address` returns 503), so this one
is sent by hand whatever chain it is on. Not a blocker at $20, and another
instance of the gap recorded in `docs/vision.md` ("The owner side reopens").

## Draft reply (Discord)

> yeah let's do it, approving it.
>
> couple of things on the terms. the thing I'm actually paying for is people
> finding the site, so can it link telarchy.com and say enough about what it is
> that someone who's never heard of it could decide to try it. and say in the
> post that it was paid, it's public on the site anyway so it'd come out, and
> honestly your audience is the one audience where an undisclosed paid post
> would kill it. with the disclosure your verdict is your own, if you think
> it's bad say it's bad, still counts as delivered.
>
> where are you publishing and roughly when? just so there's something to check
> against.
>
> also heads up on the money, we settle USDC on Base and you put Solana, and
> the managed instance has settlement off right now anyway, so I'll just send
> you the $20 by hand. Solana is fine.
