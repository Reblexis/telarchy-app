# "Not yet priced" on the Wallpaper Animator floor (2026-09-02)

Owner report (Viktor, 2026-09-02, with a screenshot of the starter contract
"Try Telarchy for one cycle" on the Wallpaper Animator floor): "i traded on
wallpaper animator but i dont see any change and its super weird also what
the hell does not priced yet means.. i fee like there area some bugs".

## What the database says

Workspace `wallpaper-animator` (`f8627e7f`), created 2026-09-02 14:38 UTC by
patrik_cihal, `autoFundNewMarkets` off (the schema default), one metric
"Wallpaper Animator net revenue (USD)" at 6,125.84, range 0 to 25,000. The
starter contract spawned its eight branch markets at 16:03 UTC with zero
liquidity on every one, because the proposal named no subsidy and the
workspace does not auto-fund (`docs/vision.md`, "A conditional market is
never born dead if anyone can pay": nobody could, so they were born
unfunded).

Viktor36 then funded and traded by hand, all times UTC (the screenshot's
18:20 hover is 16:20 UTC):

| time | market | action |
|---|---|---|
| 16:12 | baseline, today | +1,000 credits liquidity from balance |
| 16:18:44 | approved, 2026-09 | +1,000 credits liquidity from balance |
| 16:18:47 | approved, 2026-09 | bet higher, 25 credits, 12,500 to 12,715 |
| 16:27 | approved, today | +1,000 credits liquidity from balance |
| 16:31:14 | declined, 2026-09 | +1,000 credits liquidity from balance |
| 16:31:34 | declined, 2026-09 | bet lower, 900 credits, 12,500 to 6,699 |

The screenshot was taken between 16:18 and 16:31: the approved side of the
month pair was funded and traded, the declined side still had no liquidity.

## Why it read as broken

**"not yet priced"** is the impact chip's word for a pair where one branch
has no liquidity, so no price, so approved minus declined cannot be
computed (`TradePage.tsx`, `jobImpact`; `functions/src/lib/amm.ts`,
`consensus()` returns undefined at b = 0). Here the declined branch was the
unfunded one. The chip says the state and not the cause, and nothing on the
page says "the if-declined side has no market yet, fund it to price the
impact". The unfunded line under the bet verbs only appears for the branch
ON SCREEN; with "if approved" selected and funded, the page showed bet
buttons and a price, and the only trace of the unfunded other side was a
chip with no explanation.

**"$6,108 if declined"** on the chart was not a price. The floor borrows the
baseline's call to DRAW an unfunded branch (`docs/ui-conventions.md`, "An
unfunded market never shows bet buttons": "a blank chart is worse than an
honest prior"), and the baseline stood at 6,107.52. The line is labelled
exactly like a priced branch, so a reader sees two prices, 12,715 and
6,108, and a chip claiming there is no price. The two statements contradict
each other on the same screen.

**"I don't see any change"** is the AMM working as specified. A 25-credit
bet on a 1,000-credit pool (b = 1,442.7) over a 25,000-wide range moves the
call by 215, from 12,500 to 12,715; the chart drew that step and the hover
shows it. The chip stayed on "not yet priced" because the other branch was
still unfunded, so the number a trader watches for a contract, its impact,
did not move at all, whatever the bet.

By the time of writing the pair is priced: 12,714.74 if approved, 6,698.58
if declined, impact +6,016.16.

## Defects worth fixing (proposal, not built)

1. The impact chip names the cause. When one branch is unfunded the chip
   reads "if declined has no market yet" (or "if approved ..."), not "not
   yet priced". Owner rule in `ui-conventions.md`: the impact is always
   said; saying WHY it cannot be said is the missing half.
2. The borrowed line on the chart is marked as borrowed. Either the label
   says "if declined (no market yet)" or the line carries no price label,
   never a number formatted like the priced branch.
3. Funding a contract funds the pair. The owner's add-liquidity dialog
   takes one market id, so a hand-funded contract is half-priced until the
   owner remembers the other side. A contract's pair should be funded as
   one action (both branches, same amount), with the per-market dialog
   kept for top-ups only.
4. A new floor with the default `autoFundNewMarkets = false` gives its
   owner a starter contract nobody can trade. Whether the default should
   flip is an owner decision; the observation is that the very first thing
   a new owner sees is "This contract has no market yet".

Rule these protect (`docs/ui-conventions.md`): two surfaces that show the
same fact must not disagree; a number formatted like a price is read as
one.
