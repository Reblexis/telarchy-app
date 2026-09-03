# The metrics panel, the range, and a book that opened at $20,000 (2026-09-03)

Viktor, 2026-09-03, on telarchy.com/telarchy: "where do i modify metric
raange exactly i dont see tha tsetting anywhere as well as editing
existing metrics it should be similar to dates panel so isntead of
metrc+ its hould be just metrics you know? figure out best /design .. .i
want to be able to modify metric ragne.. another thing i dont understand
is there should be stable range for all dates in a given metric so how
is it possible that telarchy implied valueation has 1k at yearly market
and 1 mil at monthly .. cmon"

Proposal, not built. Three things are tangled here: where the range
control is today (and why it was invisible), what the metric controls
should look like, and why the two valuation books disagree. The last one
is not a range problem.

## 1. Where the range lives today, and why it was not there

The range control is inside dialog 4, "Report the number", and only while
no market on the metric has ever been traded
(`docs/owner-on-the-floor.md`, "The range rides in the same dialog";
`docs/market-integrity.md`, "machinery is refused while anyone has money
in a market"). The moment one book on the metric takes a trade, the
control disappears from the dialog, and nothing on the page says where it
went.

"Implied valuation (USD)" on the Telarchy floor has a September book with
five trades in it. So the control is gone for that metric, and will stay
gone until every traded book on it settles (1 October for the September
one). That is the rule working as written, and it is also the reason the
owner could not find it: a control that vanishes without a trace reads as
a control that never existed.

The rule is right for a book people are in: the range is what their
shares pay out against, and changing it under them changes what they
bought. But the range is stored per market (`markets.rangeMax`), and the
metric's `marketRangeMax` only feeds books that open later. Nothing about
integrity requires the metric-level number to freeze; it only requires
that an open traded book keeps its own.

## 2. Proposal: one `metrics` chip, one panel, the dates dialog's shape

Replace `+ metric` at the end of the metric picker with a `metrics` chip,
the twin of the `dates` chip on the row beneath it. Same rule as the dates
dialog (owner ask 2026-08-31: a list that can only be added to is a list
that can only be got wrong once): it opens on the list, adding is folded
behind one chip, and every line says what the thing is.

**The list.** One line per metric on the floor:

    Implied valuation (USD)          0 - 20,000,000 · 2 dates · 902 traded
    Telarchy revenue (USD)           0 - 1,000 · 3 dates · nobody in it
    Active traders                   0 - 50 · 3 dates · 41 traded

Name, range, how many dates, and whether anyone is in it. Tapping a line
opens that metric. `+ Add a metric` sits under the list, and when the
floor has no metric the add form is open with no chip, exactly as dates
does. Dialog 1 (name and what it is) is the add form, unchanged; it still
hands off to dates for the first date.

**One metric.** The sheet for a metric carries everything the floor knows
about it, each on its own line, edited in place:

- **Name** and **what it is**: the words. Free to edit at any time; every
  change is kept as a revision (already true, `metric_definition_revisions`).
- **Range**: `0 - 20,000,000`, with "change". The rule (section 3 below)
  is printed under the field, in the words that apply right now: either
  "No one has traded, so this re-opens every book at the new range" or
  "2 books are traded and keep their range; the new range applies to
  every book that opens after this."
- **Dates**: the dates dialog's list, or a "Dates ›" line that opens it.
  One home, not two: the `dates` chip on the floor keeps opening the
  same dialog.
- **Final after**: the settlement lag sentence, moved here from the foot
  of dates, because it belongs to the metric (the dates doc already says
  so). Keeping it in dates too is a choice, not a requirement.
- **Opens with**: `metrics.liquidityCredits`, the credits a new book on
  this metric opens with. Today it lives in the dates dialog under the
  add form; the metric sheet is where an owner would look for it.
- **Remove the metric**: the footer link, with the same confirmation the
  dates dialog has today (traded books block it and the button says so).

Report-the-number keeps its range field for the untraded case, since the
report is where an owner discovers the range is too small ("4,200 into a
market priced inside 0 to 1,000"). The metric sheet is the place to go
looking for it; the report dialog is the place it finds you.

Nothing here is a new write: name and definition are the metric edit,
range is `marketRangeMax`, dates and lag and credits are what dialog 2
already sends, removal is dialog 2's removal. The change is one chip, one
list, and one sheet that puts the metric's five facts in one place.

## 3. Proposal: the range edit is "from now on", never under anyone's money

Today `marketRangeMax` is refused with a 409 while any book on the metric
is traded. Proposed rule, one sentence for `docs/market-integrity.md`:

> A range edit applies to every book that opens after it and to every
> open book nobody has traded (voided and respawned at the new range,
> pools refunded); a traded book keeps the range it opened with, to its
> settlement.

This is the settlement-lag rule applied to the range ("Markets already
open keep the instant they opened with, so changing it never moves a
settlement people are trading against"). Nobody's money moves under a
changed rule, and the owner can fix a range on a live metric today
instead of on 1 October. The facts row on a traded book that is now
outside the metric's range says so ("priced inside 0 - 1,000; new books
open inside 0 - 20,000"), the same line the report dialog already prints
when a reading is above a frozen range.

What it does not do: it does not let a traded book's range grow. If the
September valuation book at 0 - 20,000,000 turns out too small, it
settles at the top, as today. A book's range is a term of the bet.

## 4. The $20,000 yearly book is not a range problem

Both valuation books have the same range, 0 - 20,000,000 (live API,
2026-09-03 20:00 UTC):

| Book | Opened | Trades | Price |
|---|---|---|---|
| 2026-09 (monthly) | 2026-08-25 | 5, 902 credits | $820,132 |
| 2026 (yearly) | 2026-09-03 19:44 | 0 | $20,000 |

The yearly date was added this evening. A new book opens at the metric's
reading (`docs/ui-conventions.md`, "Where markets open"). The reading is
$0, because a valuation is a number that does not exist until an
investment does (`resolvesNaUntilMeasured`). $0 sits at the edge of the
range, the engine cannot quote certainty, so it clamps one part in a
thousand in: 0.001 x 20,000,000 = $20,000. The monthly book is at
$820,000 because five trades pushed it there. The range was stable; the
opening rule ignored the sibling.

Which is the actual bug: **a metric that already has a traded book has a
better opening price than its reading, and the engine does not use it.**
A reading is the past; a traded sibling is the market's own forecast of
the same number. Opening the yearly at $20,000 next to a monthly at
$820,000 tells a stranger the floor expects the valuation to fall
forty-fold between September and December, which nobody believes and
nobody bet.

Proposed rule, for the same "Where markets open" section:

> A baseline book on a metric that has an open traded book opens at the
> price of the traded book whose settlement is nearest its own; only a
> metric with no traded book opens at the reading.

A conditional pair keeps anchoring to its own baseline, which is
unchanged. The 2026-09-02 proposal that untraded books re-anchor on every
refresh (`notes/untraded-books-and-the-price-floor-2026-09-02.md`)
composes with this: "what it would open at now" becomes the sibling
price when there is one, the reading when there is none. Adopting both
together means the yearly book follows the monthly one until someone
trades it, and then it is its own market.

Why the sibling and not, say, the reading extrapolated: the sibling is
the only number on the floor that anyone has paid for. For a
never-measured metric the reading is not even a number, it is the
absence of one, and pricing a book on it produced exactly this.

For the book that exists now: the yearly valuation is untraded and its
pool came from the owner agent, so it can be re-anchored by hand to the
monthly price the way the 65 books were on 2026-09-02, or left until the
rule ships. Not done; it is the owner's call after the last hand repair.

## Open questions

- Section 3: should a range edit on a metric with traded books also be
  allowed to *shrink* the range for future books, or only widen? Both
  are safe for money (future books only); widen-only is simpler to
  explain. Recommendation: both, printed plainly.
- Section 2: does "Final after" leave the dates dialog, or live in both?
  Recommendation: metric sheet only, with the dates list showing it as a
  read-only fact.
- Section 4: when the nearest traded sibling settles, the untraded book
  it copied from is on its own. With the 2026-09-02 re-anchor rule it
  then follows the next-nearest traded sibling, or the reading if none.
  Without it, it stays where it was. Recommendation: adopt both rules
  together.

## Recommendation

Do all three: the `metrics` chip and sheet (section 2), the from-now-on
range rule (section 3), and the sibling-price open (section 4). Section
4 is the cheapest and fixes the thing that looks broken to a stranger
today; section 3 is one sentence and one gate; section 2 is the UI work.
Tests first for 3 and 4, named after the rules above.
