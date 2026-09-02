# Correcting a reading

Proposal, 2026-09-02. Nothing is built; this note lays out the option space
so the owner can pick, and the doc edits, tests and code follow the pick.

## The ask

Viktor, 2026-09-02:

> is it possible to rewrite past m etric values in telarchy metric graphs
> (/values) as a workspace onwere? essentially amend incorrect writes..

The answer today is no, and the reason it is no is the same reason it is
worth doing properly: readings are what markets settle on.

## What exists today

The reading log (`metric_logs`) is one table that does three jobs: the
chart draws it, an open market's fixing is read from it, and a settled
market's `actualValue` came out of it. There is no route that edits or
removes a single row. Two routes touch history and neither amends a point:

- `POST /api/metrics/:id/logs/backfill` writes dated readings, but every
  instant must be older than the metric's oldest reading and the metric may
  have no resolved market (`docs/guides/sources.md`, "Backfilling a past you
  can prove"). It extends the past; it cannot patch it.
- `POST /api/metrics/logs/purge` deletes every reading of a metric (or the
  workspace). Rebuilding after it means backfill plus a fresh `PUT`, and only
  on a metric that has never settled anything, and the guides say never on a
  live floor.

So a wrong reading on a metric with a settled market is uncorrectable by
design, and in practice it gets corrected anyway: on 2026-09-02 the hourly
self-sync wrote `0` for "Active traders" every hour for most of a day, and
the repair was a hand-written sweep against production
(`notes/verified-traders-zero-2026-09-02.md`, step 1). That is exactly the
shape `docs/market-integrity.md` warns about under the void escape: a guard
with no sanctioned way through gets routed around with an UPDATE, and then
the change happens with no record at all. A correction route is the
sanctioned, loud version of what already happens.

## What a correction touches

A reading at instant `t` on metric `M` can be in one of four situations, and
the rule has to say what happens in each. Ordered by how much the wrong
number has already done:

| Situation | What the wrong reading has done | Correcting it means |
|---|---|---|
| A. No market's period contains `t`, or one does but it is untraded | Drew a wrong dot on the chart | Nothing but the chart changes |
| B. An open, traded market's period contains `t` | Holders are pricing against it (it may be the market's current fixing) | The number they are pricing moves under them |
| C. A settled market used it as its fixing (`settledReadingAt = t`) | Credits were paid on it, LP leftover distributed, season scores read it | The settlement is now known to be wrong |
| D. It is the metric's newest reading | It is also the live `value` (leaf) or feeds composites | The present is wrong too, not just history |

Case A is free. Case D is not a correction problem: the present goes through
`PUT /api/metrics/:id` with `oldValue` and `updateNote`, which writes the
right reading dated now, and the correction fixes the dot behind it. Two
calls, each honest about what it is. B and C are the decisions.

## Option space for B, an open traded market

1. **Refuse** while anyone holds a position (409 naming the holders, like the
   void route). Consistent with I2's spirit, but it leaves the market to
   settle on a number everyone including the owner knows is wrong, which is
   the outcome the whole reading design exists to prevent.
2. **Allow, and publish.** The correction writes a revision row and an event
   that holders can see, the same model as I1 for a definition edit: editing
   in place is honest only if the change is published to whoever is holding.
   The traders priced the true number, not the typo; the market's job is to
   settle on the truth.

Recommendation: 2. The asymmetry it creates (an owner can move a price by
"correcting") is the one already accepted on 2026-09-01 for owner-reported
markets: bounded by publication and reputation, and `strictEligibility`
keeps such an owner out of prize money.

## Option space for C, a settled market

1. **Refuse.** Mirrors backfill's 409: "this metric has a resolved market;
   its history is evidence". Status quo. The SQL sweep continues to be the
   real path, unrecorded.
2. **Correct the reading, leave the settlement alone, publish both.** The
   market keeps its `actualValue` and its payouts. It gains a visible mark:
   "settled on a reading that was corrected on <date> from A to B (reason)".
   No credit moves, so I2 and I3 are untouched, season scores are untouched,
   and the chart stops lying. Anyone who lost on the wrong fixing can see
   exactly why.
3. **Re-settle.** Reverse every payout with a new ledger reason
   (`payout_reversal`), reverse the LP leftover, re-run the fixing, pay again.
   Takes money off people who did nothing wrong (I2), some of whom have
   spent or redeemed it (redemption is liability-neutral only if the credits
   existed), and reopens season scores that may already have paid out. Not
   recommended in any form.
4. **Owner-funded top-up.** Correct as in 2, then compute what each holder
   would have received under the corrected fixing, and pay the shortfall to
   those owed more, debited from the owner's own balance, refused if the
   owner cannot cover it. Nobody is debited but the person who made the
   mistake, every credit leaves a row, the season is untouched (the payout
   is not a settlement). More code, and a policy question about whether the
   owner should be on the hook at all.

Recommendation: 2 now, with the revision table designed so that 4 can be
added later without changing the record. Refusing (1) does not stop
corrections, it stops recording them.

## The mechanics this implies

Precision only where divergence would be costly; the rest is left to
whoever builds it.

- **Route.** `POST /api/metrics/:id/logs/corrections`, `manage`. Body
  `{ corrections: [{ at, value, reason }] }`, at most 200 per call, so the
  hourly-zeros incident is one request. `at` must match an existing reading
  instant exactly (404 otherwise, naming the nearest instants); `reason` is
  at least ten characters (the void escape's rule) and is published. A
  correction that changes nothing is refused (400) rather than recorded.
  There is no delete: a reading that should not exist gets corrected to the
  number that was true at that instant, which is what the chart should show.
- **Record.** New append-only table `metric_reading_revisions`
  (`metricId`, `readingAt`, `oldValue`, `newValue`, `reason`, `changedBy`,
  `createdAt`), same shape and same trigger as
  `metric_definition_revisions`; it joins the Reconstruction list in
  `docs/market-integrity.md`. `metric_logs` itself is rewritten in place
  (`value`, `outlook`); readings do not carry the trigger today and this is
  why they should not start to.
- **Publication.** Event `metric:reading-corrected` with the same fields.
  `GET /api/metrics/:id/logs` returns each reading with `correctedAt` and
  `correctedFrom` when a revision exists. A settled market whose
  `settledReadingAt` matches a corrected instant shows the correction on
  `GET /api/predictions/markets/:id` and on the trade page next to the
  settlement line. The chart marks a corrected dot.
- **Never touched.** `markets.actualValue`, `resolved`, positions, the
  credit ledger, `updates` (the change feed is about the present), and the
  metric's current `value`.
- **Docs.** `docs/guides/sources.md` gets a "Correcting a reading you got
  wrong" section beside backfill; `docs/market-integrity.md` gets the rule
  under I2 (a correction moves no credit) and the new table under
  Reconstruction; `/api/help` and the skill list the route.
- **Tests, named after the rules.** A correction moves no credit and no
  `actualValue`; a correction on a settled fixing is recorded and published;
  an open market's next fixing reads the corrected value; an instant with no
  reading is refused; a reason under ten characters is refused; a no-op is
  refused; two corrections of the same instant leave two revision rows and
  the last value; `read` cannot correct; the batch cap.

## Open questions for the owner

1. Settled markets: publish-only (2), owner-funded top-up (4), or refuse (1)?
2. Open traded markets: allow with publication, or refuse while held?
3. Should a correction be visible on the public chart (a marked dot with the
   old value on hover), or only in the API and the market's settlement line?
4. API only, as with every other administrative write ("there is no admin
   console", `docs/guides/onboarding.md`), or a click-to-edit on the graph
   for the owner? The floor already lets an owner edit a metric's written
   definition in place, so a graph edit would not be the first.
