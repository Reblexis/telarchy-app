# A season where entrants pay into the pool (2026-09-16)

Owner question, verbatim: "what if we made the next season work like you
have to put money into a pool and it gets converted fromt here? would that
become illegal?"

Not legal advice, and I am not a lawyer. This extends the table in
`notes/where-money-can-touch-the-season-2026-09-01.md`; read that first.

## What the design is, in the three-element test

Entrant pays money in. The money becomes the prize pool. The entrant gets
credits, trades, and is paid a share of the pool in proportion to trading
profit on markets about real-world outcomes.

- **Prize**: yes, the pool.
- **Consideration**: yes, and by design. This is row 4 of the earlier
  table, not row 7: the payment path is built and intended, not a cheat.
- **Chance**: now load-bearing. Today's season wins on "no consideration"
  and does not need the skill argument. A paid season needs it, and a
  prediction market on real events is where that argument is weakest,
  because the outcome is not something the contestant controls.

So the design gives up the belt and keeps only the braces.

## Where it lands, regime by regime

1. **US state gambling law.** A paid skill contest is legal in most states
   under the dominant-factor test. It is not in the states that bar entry
   fees for skill contests (Colorado, Maryland, Nebraska, North Dakota per
   the 2026-09-01 sources; Vermont moved), and it fails in the "any chance"
   states however much skill is present. Florida's carve-out for skill
   games specifically requires that the prize is NOT made of the entry fees
   and does not vary with the fees collected, which is exactly what "money
   into a pool, converted from there" does. This design fails Florida on
   its face.
2. **Federal, CEA event contracts.** This is the one that matters. When the
   contestant's own money goes in and comes out in proportion to profit on
   outcome markets, the credits are a wrapper: the economics are "stake
   money on an event, get paid by the outcome". That is the row 5 regime
   (real-money wagering on event outcomes, a swap under the CEA, DCM
   registration), with a different regulator and a different order of
   consequence. Calling the payout a "prize" and routing it through a pool
   does not change what the money does. The 2026 CFTC proposed rule on
   prediction markets is the live reference (CRS LSB11441, IF13187).
3. **Czech law (operator's jurisdiction).** Act No. 186/2016 Coll. on
   gambling covers betting on outcomes with a stake and a prize; a paid
   entry with outcome-dependent payouts reads as a licensed activity, not a
   contest. Prizes from Telarchy's own funds for a free contest are outside
   it; entrant money in is what pulls it in. Needs a Czech lawyer's yes
   before anything is built.
4. **Withholding and tax** apply either way and are already handled
   (CZK 50,000 line).

## What keeps the same idea legal

The distinction from the 2026-09-01 note holds: what changes the answer is
whether the CONTESTANT pays for standing, and whether the payout is tied to
event outcomes.

- **Sponsor-funded pool, free entry** (today). Any third party may put
  money in: the workspace owner, Telarchy, a sponsor. Nobody competing
  pays. Cleanest position, and the pool can be any size.
- **Paid entry, fixed announced prize, skill scoring, excluded states.**
  The Florida-shaped version: entry fee is revenue, the prize is announced
  in advance and independent of fees collected, geo-exclude the entry-fee
  states. Legal in most of the US as a skill contest, but the CEA question
  (item 2) does not go away, because the payout still tracks outcome
  trading. Ask before building.
- **Buying liquidity or credits with no path to cash** (rows 2 and 4).
  Row 4 is a real business model; the earlier note's questions 1 and 2 are
  the ones to pay for first.

## Recommendation

Do not build the pay-into-the-pool season. It converts the contest into
the one design (row 5) the earlier note says to take to counsel before
building, and it fails Florida outright. If the goal is a bigger pool,
fund it from sponsors or workspace owners and keep entry free. If the goal
is entrants with skin in the game, the question to pay a lawyer for is item
2 above, worded exactly: "entrants pay in, are paid out in proportion to
profit on outcome markets, credits are not cashable outside the contest; is
that an event contract under the CEA, and a betting game under the Czech
Gambling Act?" A yes to either ends it.
