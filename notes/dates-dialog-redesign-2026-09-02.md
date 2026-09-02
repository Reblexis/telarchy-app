# The dates dialog, redesigned (proposal, 2026-09-02)

**Status: built, 2026-09-02.** Viktor picked the recommended row ("ok do
it"), so the doc edit below is in `docs/owner-on-the-floor.md`, the tests
in `src/components/__tests__/DatesDialog.test.tsx`, and the code conforms
(PR #173). The strict cut and the two alternates stay sketched.

**Owner report 2026-09-02 (Viktor)**, on the dialog as shipped:
"this looks horribly unintuitive and tgoo bloated please do better".

Canvas with the mockups (three states, a YC strict cut, two low-fi alternates):
https://claude.ai/code/artifact/594d7aca-be39-4151-998b-4acd876a2823

YC's published guidance on the same question, fetched and quoted:
`notes/yc-product-simplicity-2026-09-02.md`.

## What is wrong with the one that shipped

The dialog does five jobs in one column, in the wrong order for a
reader who does not already know the model:

1. It opens on a question ("This number is final how long after each
   period?") that presumes the reader knows what a period is, what
   settlement is, and why a lag exists. It is the least-used control in
   the dialog and it is the first thing on the screen.
2. The existing dates, the only thing most owners came to look at, sit
   under that question.
3. The six-way cadence picker wraps onto two rows at the modal's width,
   so the row that should read as one choice reads as two.
4. "Which one: THIS YEAR / NEXT YEAR" reads as picking a year. It is the
   `+0` / `+1` offset, a distinction almost no owner needs, and it gets a
   whole labelled control.
5. Removing the metric has a sentence written around it ("Remove the
   metric and everything above") that adds fear without adding
   information.

The result is a 700px column for what is, in almost every session, one
of two acts: look at the list, or add one date.

## The recommendation (the hi-fi row on the canvas)

The same dialog, same tokens, same components, reordered around the two
acts:

- **The list comes first.** Each line says what it is ("Every day",
  "Every week", "September 2026, once") and what its open market holds,
  with Stop. Unchanged in substance; it moves to the top. The month entry
  reads "September 2026, once" rather than "2026-09, once", which is what
  `docs/owner-on-the-floor.md` already promised ("31 December 2026,
  once").
- **Adding is folded behind one dashed chip** ("+ Add a date", the same
  chip as the date row's `dates`) whenever the metric already has a date.
  It is open, with no chip, when the metric has none, which is the state
  the dialog opens in straight after "New metric".
- **One row of six**: hourly, daily, weekly, monthly, yearly, once. The
  "every" prefix moves into the label so the six fit one line at 480px.
  Same vocabulary, same entries stored.
- **"This / next period" stops being a control.** The default is this
  period, and one tertiary line under the picker says so with the date
  ("Starts with this week, 2026-W36. Start with next week instead"),
  where the last clause is a link that flips it. The `+1` entry is still
  reachable; it no longer costs a labelled row.
- **Liquidity** keeps its field and its "of your N cr" heading, directly
  above the button that spends it.
- **Settlement lag becomes a footer sentence** with the number inline:
  "Final 0 days after each period · change". "Change" reveals the field.
  It stays in this dialog, as the doc asks, but as a fact about the
  metric rather than a question the owner must answer before seeing
  anything.
- **Remove metric is a quiet red link** in the same footer. The
  confirmation step, which lists what is in the way, is unchanged.

Nothing is removed from the API surface or from what the dialog can do.
What changes is what the owner has to read before doing the common
thing.

## Where YC pushes further than the recommendation

`notes/yc-product-simplicity-2026-09-02.md` applies Seibel's test ("does a
truly desperate customer need that feature to start?") and Garry Tan's
removal test to the same dialog and cuts deeper in four places. The
"Strict cut" artboard on the canvas shows the result: the list, one row of
four (daily, weekly, monthly, once), a "1,000 cr each · change" line, one
button. No footer.

| Element | Recommendation (hi-fi row) | Strict cut (YC) |
|---|---|---|
| Hourly, yearly | On the row | Off the surface, API only, until an owner asks |
| This / next period | Default this, one link flips it | Default only, no control |
| Settlement lag | Footer sentence, "change" reveals the field | A default; no field until an owner brings the problem |
| Remove metric | Footer link | Out of this dialog, onto the metric itself |
| Liquidity | Field above the button | Default with a "change" link |

The recommendation stops short of the strict cut because
`docs/owner-on-the-floor.md` promises three of those things today (the six
cadences, lag in this dialog, removal in this dialog) and the lag exists
because an owner asked for it two days ago. Each step towards the strict
cut is a doc edit first, and Viktor's call, not the redesign's. YC's own
caveat applies: with a handful of owners, the test is a few conversations,
not an experiment ("Does it solve the problem I want it to solve? That's
it.").

## The doc edit that would land first

`docs/owner-on-the-floor.md`, dialog 2, replacing the paragraphs from
"It is the whole subject in one place" to "Removing the metric sits at
the foot":

> **2. The dates**, opened from the `dates` chip on the date row, or
> straight after dialog 1 while the metric still has none. It opens on
> the list: each line says what the metric is priced on ("Every month",
> "Every day", "31 December 2026, once"), what that line's open market
> holds (next date, pool, traders), and a Stop. A list that could only
> be added to was a list that could only be got wrong once (owner ask
> 2026-08-31).
>
> Adding one is folded behind a single "+ Add a date" chip while the
> metric has any date, and open when it has none, so a new metric's
> first visit asks one question: how often. The six answers sit on one
> row (hourly, daily, weekly, monthly, yearly, once) in the vocabulary
> the API always had. A repeat starts with the current period, and one
> line under the picker names the date it starts with and offers the
> next period instead; that is the `+0d` / `+1d` the entry stores. Once
> asks for a day, with an optional UTC hour. Under it, the liquidity
> each one opens with, and the heading says whose credits that is.
>
> **How long after a period the number is final** is a sentence at the
> foot of the same dialog with the number in it, because it belongs to
> the metric rather than to any one date and is changed rarely. A
> monthly total that needs three days of refunds says three, and
> markets opened afterwards settle three days after their period. Markets
> already open keep the instant they opened with.
>
> **Removing the metric** is a link in the same footer, because it is
> the same kind of act as stopping every date. Its confirmation lists
> what is in the way first: a traded market blocks it and the button
> says so, while untraded ones go with their pools returned.

The "Stopping a date says which of two things it will do" paragraph and
the "Every one of those is the same write" paragraph stay as they are.

## What the tests would encode (before any code)

- The dialog renders the list above the add form; with one or more
  dates the add form is hidden behind the chip; with none it is open and
  there is no chip.
- The month entry `2026-09` is labelled "September 2026, once".
- The cadence picker has six options and defaults to weekly (or the
  workspace's most common cadence; open question below).
- The offset defaults to `+0`; the link stores `+1`; the sentence names
  the resolved date for both.
- The lag field is hidden until "change" is pressed, and the write still
  sends `settlementLagMinutes` from it.
- The existing load-guard, stop-consequence and remove-blocked tests
  stay green unchanged.

## Open questions for Viktor

1. Default cadence when adding: weekly, as now, or the metric's period
   if it already has one?
2. "Hourly" stays on the row, or moves behind "once" as a rarely-used
   option? The doc vocabulary keeps it; the canvas keeps it.
3. Alt B on the canvas moves lag and removal to a separate metric dialog
   (name, description, lag, remove). That contradicts the current doc
   and adds a door; it is sketched, not recommended.

## Token note

`--delete-color` (#a5192c) is not redefined for the dark theme, so the
remove link is near-invisible on the dark card. The canvas uses
`--lower` (#f87171) for it; the redesign should either add a dark
`--delete-color` or use `--lower`.
