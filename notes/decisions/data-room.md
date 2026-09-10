# Decisions and records: docs/data-room.md

Records evicted from `docs/data-room.md` on 2026-08-25; the doc states the resulting rules in present tense.

## 2026-08-24: The change log is the git history

## The change log is the git history (**noted 2026-08-24**: it restarts at the public open-source release, which is a clean-root snapshot; the private archive keeps the earlier history and it is not stitched in, eng review 2026-08-24)

## 2026-08-20: The data room (introduction)

Owner ask, 2026-08-20: "you know how lookpilot has data room .. we
should make one for telarchy as well ... there should be vision, plans.. log of
changes traffic etc."

## 2026-08-20: Otto browses it; it is not in his context

Owner direction 2026-08-20: "he should be able to browse it itself,
not force fed the context".

## 2026-09-10 - the desk (Viktor: "i wanted a whole page redesign so it looks cool abnd amazing")

Three whole-page directions were drawn with live data on a design canvas
(broadsheet / instrument / time-spine); Viktor picked the instrument, "do B".

What that decided:

- The page fixes its own palette. It renders on the site's own dark tokens
  whatever the visitor's theme is, because it is an instrument rather than a
  page about the product. It is the only page on the site that does this, and
  it sets `data-theme="dark"` on its own root rather than inventing a second
  palette. The theme toggle in the top bar therefore does nothing here.
- The column widened from 760px to 1180px, and a section with drawings became
  two columns: what it is on the left, sticky, the drawings on the right.
- A strip of tiles sits above the first section: the priced metrics, trades
  this week, accounts. Each carries the figure, the change over the trailing
  seven days, and the same series drawn small; each links to the section that
  draws it full size. The change is the one derived figure on the page and it
  is labelled `7d`; a series that does not reach back seven days prints none.
- The sparks are `TimeChart` with its axes off, not a third kind of drawing:
  they still answer the pointer. A spark uses the series' own range rather
  than anchoring at zero, because it shows shape beside a printed level.
- A ticker of the dated things the owner did runs under the strip.
- Event marks now stagger out of each other's way: where two fall closer than
  their badges are wide, the first keeps its number and the rest keep only
  their rule. Twelve decisions in a fortnight on a 120-day axis printed twelve
  numbers on top of each other.
- The accounts running total is counted DOWN from the published figure (it
  used to count up from the first signup in the sixty-day window and end below
  the accounts number printed beside it).
- Three blocks had shipped with no CSS at all and were rendering raw: the
  weekly readings row and its caption, and the outreach squares. They are
  styled, and the outreach shade ramp is named rather than left to a tooltip.
