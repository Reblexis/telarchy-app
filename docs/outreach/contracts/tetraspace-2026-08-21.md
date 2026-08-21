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

**Nothing about the content (owner decision, Viktor, 2026-08-21): what he
writes is entirely his.** An earlier draft of this file wanted the contract to
require a link to telarchy.com and an explanation of what it is, on the grounds
that distribution is the thing being bought. Overruled, and the owner's version
is the better one: a post written under editorial instructions from the person
paying for it is worth less to the audience it is aimed at, and he is writing
about Telarchy either way, so buying the coverage buys the thing that makes it
not work.

Two asks remain, neither of them editorial:

1. **If he names telarchy.com, he says it was paid.** This is a real legal
   obligation and not a courtesy. Undisclosed paid editorial promoting a
   product is a per-se banned commercial practice in the EU (Unfair Commercial
   Practices Directive 2005/29/EC, Annex I point 11) and in the UK (carried
   into the DMCC Act 2024 from the CPUT Regulations 2008), and the US FTC
   Endorsement Guides require disclosure of a material connection. There is no
   de minimis threshold, so $20 is as covered as $20,000. Being paid through a
   contract on Telarchy itself is still being paid; the disclosure line should
   say so plainly. His audience would expect it regardless, which is why this
   costs nothing to ask for.
2. **Venue and rough date.** The contract names neither, and "published" cannot
   be checked without them. This is verification, not editorial input.

## Payment

Telarchy settles USDC on **Base**; he asked for **Solana**. Managed settlement
is disabled anyway (`GET /api/agents/deposit-address` returns 503), so this one
is sent by hand whatever chain it is on. Not a blocker at $20, and another
instance of the gap recorded in `docs/vision.md` ("The owner side reopens").

## Draft reply (Discord)

> yeah let's do it, approving it.
>
> write whatever you want in it, that part is entirely up to you, I'm not going
> to ask for anything specific. only thing is if you name telarchy.com then
> you'd have to flag somewhere that it was paid, it's a contract on Telarchy so
> it counts as paid promotion and undisclosed is actually a banned practice in
> the uk/eu. one line is enough and your readers would want to know anyway.
>
> where are you publishing it and roughly when? just so there's something to
> check against.
>
> also heads up on the money, we settle USDC on Base and you put Solana, and
> the managed instance has settlement off right now anyway, so I'll just send
> you the $20 by hand. Solana is fine.
