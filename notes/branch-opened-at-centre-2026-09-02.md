# A branch pair opened at the range midpoint (2026-09-02)

**Symptom (Viktor, 2026-09-02, evening):** "why has the market been
autoliquidated at this high value it should liquidate at the main
unconditional market value unless specified otherwise". On the Wallpaper
Animator floor, the 31 Dec pair of "I will lower the price to 5 USD" read
$12,500 (the middle of a 0-25,000 range) while the unconditional 31 Dec
market read $6,126.

**Cause.** The proposal was posted with no subsidy, so its branches
spawned with an empty book (no money, no price). Its owner deepened both
branches a minute later through the injection endpoint, and
`anchorUntradedMarketTx` declined to place a conditional branch ("a
different question", left to the spawn), so the injection opened the
book at the centre. The doc already said a pair opens at the baseline
price; the code only did so when the money arrived at spawn.

**Rule (docs/guides/creating.md):** a branch opens at the baseline price
whenever its book is first given money, at spawn or at the first
injection; one formula in `lib/branch-anchor.ts` serves both, and
`anchor-ownership.test.ts` keeps it one. Tests:
`every-open-anchors.test.ts`, "a branch that spawned unfunded opens at
the baseline price when first given money". PR #181.

**Repair applied to production, by hand:** the two funded branch
markets of that proposal (untraded, no positions) were re-anchored at the
baseline's $6,126.17 with the book sized as the fix would size it
(b 711.08 on a 1,000 pool), each with an `anchor` liquidity event. The
other three horizons of the pair have no money in them and will open
correctly when funded under the fixed build.
