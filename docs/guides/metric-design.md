---
title: Choose the number worth deciding on
description: How to pick metrics a perfect optimizer could not ruin, and how to name them so the machinery reads them right.
category: run
order: 20
---
# Choose the number worth deciding on

Everything downstream runs on this choice. The market prices what you listed,
proposals are priced against what you listed, and you approve on that price. A
badly chosen metric produces a confident number about the wrong thing, which is
worse than no number.

## Assume it works perfectly

The useful frame is a genie. Assume the system grants your wish with perfect
competence, and, like a genie, delivers precisely what you asked for rather
than what you meant. If the definition has a hole, a competent optimizer finds
it. The failure is then in the definition, never in the optimizer.

So the design question is not "will this actually be achieved?" It is:

> If every metric here were maximized perfectly, walk through the real-world
> state that produces. Is that the outcome you want? Is anything that matters
> missing from it?

Three ways the answer comes back no:

- **A missing dimension.** Your numbers are maxed and something you genuinely
  care about is not represented anywhere, so nothing had a reason to protect it.
- **A proxy that can be satisfied on its own.** Revenue is up and the business
  is hollowed out. The rate is high because the denominator was gamed. The
  metric is satisfied; the goal is not.
- **A trade-off you would never endorse.** Two parts can be traded against each
  other in a way the formula allows, so one collapses while the other
  overcompensates and the total looks fine.

The fix is the same every time: change the definition until perfect achievement
of it is exactly the outcome you want.

## Measure outcomes, not activities

An activity is how an outcome gets produced. It is not the outcome. Track the
activity and a competent optimizer gives you more activity.

- Lines of code, not product output. You get commits.
- Tickets closed, not customer satisfaction. You get tickets closed fast.
- Features shipped, not retention. You get continuous shipping.

Define the outcome as the metric. Then, if you believe some activity causes it,
that belief is a proposal, not a metric. A proposal is where uncertainty
belongs, because the market can price uncertainty and a definition cannot hold
it.

That is the whole division of labour:

- **A metric is a commitment.** It says this quantity certainly matters, in a
  known way. Define metrics at the level of abstraction you are genuinely
  certain about. A self-reported happiness score is a better leaf than a
  dopamine reading, because the link between the two is exactly the thing you
  are unsure of.
- **A proposal is a hypothesis.** "Will doing X move Y?" gets a price from
  people spending their own credits, and you decide on it. See
  [deciding a proposal](/guides/proposals).

If a candidate metric only matters because it leads to something else you
already track, it is instrumental, and it probably belongs below that thing
rather than beside it. The test is: would you still want this if it caused
nothing else?

Double-counting is fine when it is deliberate. A capability that genuinely
raises output and independently raises resilience should appear in both places.
It is a bug only when it appears twice because nobody noticed, not because you
believe both paths are real.

## Make it objectively resolvable

A market settles against a logged number, and someone was paid or not paid on
that number. Anyone with access to the underlying data should land on the same
value you would. Write the description as the resolution source: what is
counted, where it comes from, at what moment, what is excluded. That
description is the settlement text, and it is what a trader reads before pricing
your floor.

Subjective metrics are legitimate when the feeling genuinely is the thing being
tracked. Say so in the name, the way the personal templates do, with a
`(self-reported)` tail and a description that admits it is a gut read.

## Naming is machinery, not decoration

A metric has no unit field and no currency field. The name carries both, and
one rule reads it.

**A trailing parenthetical naming USD, or containing a `$`, marks the metric as
money.** "Net revenue (USD)" is money. "Weekly active traders" is not. That flag
puts a `$` on the public number, and it feeds one behaviour that changes what
traders see: when a metric is money **and** its name contains the word "net", a
contract's approved branch opens at the baseline minus the ask, because
approving a $400 contract takes $400 out of a number that is already net of what
you pay out.

Two consequences to plan for:

- **Only USD and `$` are detected, and only in the last parenthetical.** "MRR
  (EUR)" is not treated as money. Those markets anchor unadjusted, which is the
  safe direction to be wrong in: traders price the cost themselves rather than
  the platform inventing a move nobody made.
- **Gross numbers must not say "net".** Subtracting an ask from a gross revenue
  metric, or from a headcount, drives every approved branch toward the range
  floor and prints an identical fake loss on every contract. That happened once,
  on Telarchy's own floor, which is why the rule is two conditions and not one.

Granularity is not a field either. It is derived from the dates a market is
opened on, which come from time preference. A date does not belong in a metric's
name: a metric is a number over time and the market's target date carries the
date. Putting "@1st October" in a name buys exactly one market and orphans every
recurring one behind it.

## What a metric actually has

Nine fields, and no others: `name`, `description`, `value`, `formula`, `order`,
`timePreference`, `marketRangeMax`, `resetsEvery`, `resolvesNaUntilMeasured`.
There is no `target`, no `granularity` and no `unit`. What each one does is in
[open a floor](/guides/creating); how values reach `value` is in
[keeping the number true](/guides/sources).

If you want a goal line, it is not a field. It is a market: open a horizon and
watch what the crowd says you will hit.

## Several numbers, one floor

Different timescales belong to sibling metrics with their own half-lives, not to
one metric that tries to mean both. Different audiences belong to different
workspaces.

When you run more than one workspace, resist wiring one's metrics into the
other's formulas. The link between a project's numbers and the company's is
usually the uncertain part, and a formula states it as certain. Keep the domain
workspace as context that participants can read, and test the link with a
proposal instead.
