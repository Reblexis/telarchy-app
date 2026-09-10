# Is a proposal page intuitive to a newcomer? (2026-09-10)

Asked because Viktor asked: "i dont know if the proposals aer clear enough..
if a newcomer will understand what a proposal is from the proposal page..
e.g. shouldn't if approved be above right below the horoizon and then
determine market question: e.g. what will reveneu be like if person {x} is
approvevd to do {y} just like it was before".

Reviewed: `telarchy.com/lookpilot/p/11` on branch `proposal-decision`, at
1440px, signed out shape (no ruling bar). GPT-5.6 via the Codex CLI got the
full page text in DOM order, a screenshot, and a description of the
mechanics. Its verdict, then mine.

## Codex's scores

- **Intuitiveness 3/10.** "A newcomer sees proposed work and trading
  controls, but must infer that approval pays for the work and that two
  forecasts determine its impact."
- **Frictionlessness 4/10.** "The ticket is accessible; understanding what
  the bet means takes substantial reading and guessing."

Heuristic, from the screenshot and text; it did not click anything.

## What I would act on, ranked

**1. Say the transaction under the title.** One or two lines: "Viktor36
asks $250 to commission gameplay footage in five simulators. If LookPilot
approves, Viktor36 is paid $250 and does the work." The page never states
this anywhere. The icon row says "Viktor36 · $250 · decides 15 Sept", which
is legible only to somebody who already knows what a proposal is. This is
the single biggest gap and it costs two lines.

**2. Two different numbers are both called "now".** The stat row's NOW cell
is the last LOGGED READING ($7,656, "read 4 days old"). The chart's baseline
label reads "$7,049 now", which is the unconditional market's call for the
same settle date. They are 8% apart and both say now. The chart's word is
the wrong one: that point is the market as it stands WITHOUT this proposal.
Verified in `NumberChart.tsx` (the `key: 'now'` label). This is a defect,
not a preference.

**3. "MOVE BY" should be "MOVES BY".** The hero caption reads "if approved,
net revenue this month move by". `TradePage.tsx`, `dateQuestionOf(hero).word}
move by`. One word.

**4. The question sentence: yes, but after the number.** Codex agrees the
sentence is worth restoring and disagrees with the placement Viktor
suggested: "The sentence is worth restoring; pushing the first number to
826px is not... Moving the selector directly under the date strip would
introduce the branch choice before explaining the proposal." Its wording,
under the three world cells and above the chart, changing with the selected
world: "If this proposal is approved, what will LookPilot's net revenue be
on 30 September?" It drops the proposer and the task because the title two
inches above already carries them.

**5. Name what the hero is a comparison OF.** "+$614" can be read as growth
from today, or as profit after paying the $250. Codex wants the subtraction
shown: "$7,283 if approved − $6,669 if declined". The three cells under the
hero already carry both numbers, so this is a caption change rather than new
furniture: say "versus declining" in the caption and the reading collapses
to one.

**6. The side pills do not say higher than WHAT.** "Higher / up to 635 cr"
never names the number being bet against. At the rail's 293px "Higher than
$7,283" will not fit beside the ceiling, so this needs a design pass rather
than a copy change: probably one quiet line under the pills naming the
market's call and the settle day.

## What I would NOT do

**Stake presets and a simplified default ticket** (codex's item 6). It asks
for "small credit presets" and for Buy/Sell and Quick/Limit to move behind
an advanced control. Presets are ruled out by name in
docs/ui-conventions.md ("no boxed field, no stepper chips, no presets"), and
Buy/Sell was added yesterday on Viktor's own ask after Kalshi. Raising it
here only so the decision is his and not silently mine.

**Move the world selector above the question** (Viktor's own suggestion).
Both codex and I read it the same way: the branch is a choice you make about
a thing you have understood, so it cannot come before the thing is
explained. The strips above are the metric and the date, which the market
would have with or without a proposal; the world belongs with the number it
changes.

## The costed order

1 and 3 are copy. 2 is a one-word label change in the chart. 5 is a caption.
4 is a short block. 6 is the only one needing a drawing. Doing 1, 2, 3 and 5
would answer most of what the score is measuring, in one pass.
