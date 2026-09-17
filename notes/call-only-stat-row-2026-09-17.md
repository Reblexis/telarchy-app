# The stat row: one number, the market's call (proposal, 2026-09-17)

Status: DECIDED 2026-09-17, Viktor picked A; built on branch `call-only-stat-row`
(the footer reading line was added so CALL and LIVE modes still print the value).
Originally: Viktor picks, then `docs/ui-conventions.md`
("The price and the chart", "The stat row") changes first and the page follows.

## The ask

Viktor, 2026-09-17, of the snake floor's stat row (NOW 22.0 beside MARKET'S
CALL 49.9): "im thinking this should be simpliefied to just show the market's
call instead.. as current value etc.. can be nicely seen in the value graph
etc.. and now it's confusing what's what".

## Why the row confuses

Two numbers at the same size (2.1rem), the same weight, in equal cells, told
apart only by a 0.7rem grey caption and a colour. The eye lands on the left
one first, and the left one is NOT the price. On the snake it is worse: NOW
changes every few seconds and resets to 1, so the loudest, liveliest number on
a trading page is the one nobody trades.

Everything the NOW cell says is already said elsewhere on the page:

- the reading: the ink line of the value chart directly below
- the attempt: the live board
- the age: the chart's newest dot

One gap: the value chart draws the newest reading as a dot with no number on
it. Only the call's marker carries its value. Removing the NOW cell without
fixing that would remove the only place the current value is printed.

## Recommendation: A, call only, and the chart prints "now"

```
  MARKET'S CALL · SETTLES THIS ATTEMPT
  49.9  ▲ +0.4
  ---------------------------------------------------------
  [VALUE|CALL|LIVE]        REACHED LENGTH        1H 1D ALL
                                                  o 49.9
            __/\__                               /
        ___/      \___ o 22.0 now . . . . . . . .
```

- The stat row becomes one block, left-aligned, no centre hairline: the
  caption, the amber call at the price size, its move chip (or a proposal's
  impact chip) beside it. Nothing else.
- The value chart labels the end of the ink line with the value in force, in
  ink: "22.0 now". Same label anatomy as the call's amber label, so the
  picture reads as "it is 22, the market says 49.9" on one axis, which is the
  sentence the two cells were trying to say.
- The age of the reading moves to the chart footer's quiet row ("read 35m
  ago", exact instant on hover). It stays on the page because a reading is
  only trustworthy with its age on it; it stops being a headline.
- The snake's "attempt 41" moves to the live board's own caption.
- No reading yet: the chart's existing empty state says so; the stat row is
  unaffected.
- CALL mode of the chart has no ink line, so no "now" there. Fine: the reader
  chose the call's history.

Cost: on a phone the chart is below the fold sooner than the row was, so a
visitor sees the call before the current value. I think that is the right
order for a page whose buttons are HIGHER and LOWER than the call.

## Alternative B: call is the hero, now is a caption-sized line

```
  MARKET'S CALL · SETTLES THIS ATTEMPT
  49.9  ▲ +0.4
  now 22.0 · attempt 1 · read just now
```

One number at the price size, the reading as one small mono grey line under
it. Keeps the comparison in the first 100px with no chart change. Weaker than
A because it is still two numbers in one block and the small line is the
first thing to get ignored or to wrap on a phone. Pick this if you want the
current value above the fold on mobile.

## Alternative C: keep two cells, fix the hierarchy

Call first (left) at 2.1rem amber, NOW second at about 1.3rem grey. Smallest
change, least gain: still two cells to decode.

## What changes in the docs if A is picked

- `docs/ui-conventions.md`, "The price and the chart": the newcomer's order
  becomes question, the market's call, then the picture of both. "The stat
  row" is rewritten as one block; the reading bullet moves into the number
  chart paragraph as the "now" label; the snake attempt sentence moves to the
  live board section; the ASCII floor sketch near the date strip loses its
  NOW column.
- `docs/vision.md` where it describes the two stats.
- Tests first: the row renders no `.pubws-stat--now`; the value chart prints
  the newest reading's value with "now"; no label when there is no reading;
  the label is absent in CALL mode; the age appears in the footer with the
  instant as its title; proposal view still carries the impact chip.
