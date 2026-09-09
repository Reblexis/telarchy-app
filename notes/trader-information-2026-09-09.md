# What traders are told about Telarchy, and what else would help them price it

Record and proposal, 2026-09-09. Asked: "what information do we share with
traders about telarchy, and can we share anything else useful, so predictions
are better and it is entertaining to work with, so the metrics are maximized".

Nothing here is built. It is a ranked list for the owner to pick from. Every
number below was read live from production on 2026-09-09, not remembered.

## The three surfaces, measured

A trader reaching the Telarchy floor can read exactly three things.

**1. The floor page** (`GET /api/marketplace/telarchy`). The hero number with
279 hourly readings back to 2026-08-01, the metric's definition, the charter,
the "what is Telarchy" blurb, nine open books with consensus, liquidity and
trade counts, 32 proposals (24 approved, 4 declined, 4 pending, all four
deciding by 15 September) with their priced impact per horizon, top
contractors, the standings, per-market comments, positions and trades, the
newest announcement, and Otto in the corner with the data room as a tool.

**2. The data room** (`GET /api/data-room`, public and uncredentialed). The
funnel, 12,970 page loads since 11 August to 61 accounts (0.47%) to 25
verified (41%) to 9 weekly active (36%); visits and uniques per day; signups
per day, including the 15 on 4 September; every shipped change by date and
subject, 16.8k characters of them; proposal counts and the $1,530 approved;
prose on plans and risks.

**3. The agent brief** (`GET /api/marketplace/telarchy/context`). Charter,
about, five metrics, nine markets, 23 proposals with impact and comments, five
announcements.

The interesting result is what the third one does not have.

## Three defects: information we already hold and do not hand over

**D1. The agent brief shows one day of history where the page shows six
weeks.** `HISTORY_POINTS = 24` in `functions/src/services/workspace-context.ts`
was written for daily readings; the self-sync writes hourly, so the 24 rows are
the last 24 hours. Read live: every metric's history spans 2026-09-08 to
2026-09-09 and prints one value nine times. An outside agent asked to forecast
30 September is handed a flat line one day long, while the human page draws 279
points. `runningSince` and `telarchyStartedOn` are both null on top of it, so
the agent cannot even tell how old the series is. **S.** Downsample the same
series the page draws to one point a day since the first reading.

**D2. The data room is invisible to agents.** `documents: []` in the live
brief: the Telarchy workspace publishes no text source to the Public group, so
the one document that explains what moves the number (funnel, traffic,
shipping, plans, risks) reaches humans and Otto and never reaches the agents we
most want trading. **S.** Publish the data-room text as a public source, or
slot `/api/data-room` into the brief the way `dataRoomTool` slots it into Otto.

**D3. An approved proposal never says whether it happened.** The proposals
table has `status`, `resolvedAt`, `resolvedBy` and `declineReason`, and nothing
else: approval is the terminal state on the record. So the market prices "if
this is approved, the metric lands at X", the owner approves and pays, and from
then on no trader can see whether the work was done, when, or at all. "Reach
out personally to 30 founders" is approved; whether 30 people were contacted is
not on the floor. A conditional market whose antecedent is unobservable after
the fact is priced on faith. **M.** A delivery state on an approved proposal,
dated, with a line of evidence, and shown on the proposal row.

## What to add, most predictive first

**A1. The roll-off: what the number is doing right now.** All four priced
numbers are trailing windows, so their next few readings are already mostly
determined and nobody publishes that. Per metric, per day for the next seven:
how many counted units drop out of the window unless they act again, and how
many are within reach of the line. For active traders that is "three of the
nine fall out of the window on Thursday" and "four verified participants have
traded 40 to 99 credits this week; 100 counts". For profitable forecasters it
is the marked-profit distribution near 100 credits plus which books settle
inside the window, because settlement is what moves it. For outside owners
deciding it is the count of outside workspaces holding a pending proposal with
a deadline inside the window, which is the metric's ceiling and is knowable
today. For revenue it is the paid-liquidity rail, the only one that can move
it. This is the single most decision-relevant block and it is also a live
scoreboard, which is the entertainment answer as well. Every input is already
in the public trade log; it is counts, never names. **M.**

**A2. Base rates.** Per metric: the last eight weekly values, the largest
single-week move ever recorded, how many weeks it sat flat, and the
day-of-week shape of trading. A forecaster's first question is how much this
number normally moves in three weeks, and today they reconstruct it by eye off
a chart with no numbers on it. **S.**

**A3. Annotate the chart.** Shipping days, announcements and approvals are all
dated and all sit beside a line they plainly moved. The 15 signups on 4
September had a cause and the floor does not say what it was. Markers on the
hero chart, and a short "what moved it" log giving date, event, and what the
number did in the seven days after. Cheapest way to turn a chart into an
argument, and the most fun object on the page to read. **M.**

**A4. The forward calendar.** Shipping is retrospective; the metric is
forward. Publish the owner's dated intentions the way the charter already
promises material disclosure: prizes running (the $500 open-source agent prize
closes 30 September), posts scheduled, outreach counts by stage, the deadline
on every pending proposal. Counts and dates, not names. A trader pricing 30
September is pricing the owner's calendar and currently has to guess it. **M.**

**A5. The owner's own number, on the record.** Viktor publishes what he
expects each metric to read at each date, before the market does, and is
scored on the same leaderboard as everyone else. Highest entertainment per
byte: people trade to disagree with the house. It anchors, which is the cost,
and the mitigation is that his forecast is a scored entry rather than a
disclosure, so being wrong in public is his risk too. **S**, and the one item
on this list that needs the owner rather than an agent.

## Entertainment, which is the same lever

Three of the four numbers count traders' own activity, so anything that makes
forecasting fun raises the metric directly. Ranked by what brings a forecaster
back:

1. **Tell them whether they were right.** Calibration is defined in
   `docs/metrics.md` (liquidity-weighted Brier on resolved markets) and is
   neither computed nor shown. A profile that shows credits but not accuracy
   answers the wrong question. **M.**
2. **Resolution day as an event.** A countdown on the book, and a settled-book
   view that says what it closed at, who was closest, and who was earliest.
   **M.**
3. **Beat the house.** A5 above, plus Otto's own call.
4. **The weekly results post already exists.** Extend it with movers, the
   biggest winning trade of the week, and who called the move first, from data
   the leaderboard already computes. **S.**

## What not to publish

- **Nothing the owner can move after seeing the price.** The revenue rail came
  out of the owner's hands on 2026-08-28 for this reason; a forward calendar
  (A4) must be a commitment made before the market reads it, not a hint
  dropped after.
- **Names attached to threshold positions.** A1 publishes counts. "Participant
  X is 12 credits short" is an invitation to buy that person's trade.
- **Anything that is not derivable from the public log.** The line that keeps
  A1 honest: it repackages what any trader could compute from trades and
  settlements, so it removes an advantage rather than creating one.

The reflexivity worry is real and is smaller than it looks. Publishing the
roll-off does make traders act to tip a count they are also pricing. But the
count is of people trading, and someone trading because they saw the scoreboard
is the platform working, not gaming it. The line to hold is that nobody is paid
for the trade that tips the count.

## Falsifier

Ship D1, D2 and A1. D1 and D2 are testable directly: an outside agent given
the brief and asked for a 30-day forecast should stop returning the current
value. For A1, take the fourteen days before publish as the baseline and read
the trade count on the days a roll-off is visible against days it is not. If
the block moves no trades and no forecast error, the missing information was
not the constraint and the cause is funding or the offer, and this note was
wrong rather than under-shipped.
