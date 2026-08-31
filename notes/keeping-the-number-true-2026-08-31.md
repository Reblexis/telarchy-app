# Proposal: making sure the number is there when the market settles

Written 2026-08-31, at the owner's ask ("lets focus more on the metric
updating aspect ... to ensure that workspace owners update their metric in
time"). Nothing here is built. It is the ground, three decisions, and what I
would do about each.

## What is already true, so nobody redesigns it by accident

- **There is one write path**, `PUT /api/metrics/:id`, and a market settles on
  **the last logged reading at or before its `resolvesOn` instant**
  (`docs/guides/sources.md`). Not the live value, not a price. So settlement
  is ALREADY automatic and deterministic; "resolve automatically or by hand"
  is not the open question. The open question is what happens when the reading
  that settlement lands on is old.
- **A metric with no reading at all** falls back to the live value and logs a
  server error, unless `resolvesNaUntilMeasured` is set, in which case the
  market voids as N/A and refunds. So the never-measured case is handled; the
  stale case is not.
- **There is no scheduler inside Telarchy for metric values.** Owners run
  their own cron. Telarchy does exactly this to itself hourly
  (`/api/cron/self-sync`), which is the proof that the shape works, and the
  scheduler infrastructure (Cloud Scheduler to `/api/cron/*`) already exists
  and already runs four jobs.
- **`sources` exist** as a table and a UI, and they are context, not
  ingestion: prose, links and GitHub configs Otto reads. Nothing in the system
  turns a source into a reading.
- **Otto can already write a value**: his `call_api` replays the caller's own
  request, so on a floor he can do anything the signed-in operator can,
  including `PUT /api/metrics/:id`. What he cannot do is act when nobody is
  in the conversation, and he has no memory of having promised to.
- **Nothing warns anyone.** The notification kinds are comment, reply,
  contract, anyComment, settled, decision. There is no "your market settles
  tomorrow on a reading from three weeks ago". The floor says the reading's
  age in one line and that is the whole system.

## The failure this is about

A market opens, people price it, the boundary arrives, and it settles on a
number nobody has touched since the metric was created. The trader who was
right about the real world loses to the one who guessed the stale number. It
costs the platform its only product, which is that the price means something.
Nothing today prevents it, notices it, or reports it afterwards.

## Decision 1: whose job is the reading

Three answers, and they compose rather than compete. The question is which is
the floor and which is optional.

- **A. The owner, nudged.** Telarchy never writes a value. It warns: the
  floor's line gets sharper, and a notification and an email go out when a
  market is inside its last stretch and its reading is older than the period
  it settles on. Keeps the one-write-path invariant exactly as it is.
- **B. Otto, when the metric says where to look.** A metric gains an optional
  place to read the number from (a URL and a sentence of how to read it, or an
  existing source). A cron walks the metrics whose market is due, Otto fetches,
  proposes a value, and writes it as the owner with a note saying he did. A
  model is then inside the settlement path, which is the reason to be careful:
  it must be visible in the change log and refusable by the owner.
- **C. The owner's own agent.** The handoff prompt already hands their coding
  agent everything it needs; it does not currently OFFER to set up a schedule.
  One paragraph in the prompt, plus the guide that exists, and this is done.
  Costs nothing and works for exactly the people who already run agents.

**My recommendation: A now, C in the same change, B behind a per-metric
opt-in.** A is the honest floor for everyone and cannot go wrong. C is a
paragraph. B is where the leverage is, but a model writing settlement numbers
needs the nudge and the audit trail to exist first.

## Decision 2: what a market does when the reading is stale at the boundary

Today it settles on the old number, silently. Four candidates:

1. **Keep it.** Deterministic and predictable. The traders who read the
   metric's description knew what it settles on.
2. **Void as N/A when the reading predates the market's own period.** Nobody
   is scored against a number nobody measured; positions are refunded and the
   reason is published. Costs the owner nothing but their credibility, which
   is the point.
3. **Hold and warn.** At the boundary, if the reading is stale, the market
   does not settle for a grace window (a day, say). The owner gets "settle it
   or it voids", and either a reading arrives or rule 2 applies.
4. **Settle, and say so.** It settles on the old reading as today, but the
   settlement event and the market's page carry "settled on a reading from 23
   days before the boundary", permanently.

**My recommendation: 4 plus 3, in that order of certainty.** Saying it is
cheap, unarguable and immediately useful to traders deciding whether this
floor is worth trading. Holding is the stronger medicine and can follow.
Voting for 2 outright means the first owner who goes on holiday has every
market on their floor void, which is a harsh way to learn the rule.

## Decision 3: does the owner ever confirm a settlement

Not today: the resolver runs and pays. Making settlement wait for a human
would be worse for traders (their money is locked until someone clicks) and
worse for the platform (settlement latency becomes a person's inbox). The one
version worth having is decision 2's hold: settlement waits only when the
number is stale, and only for a stated window.

**Recommendation: no manual confirmation, ever, on a fresh reading.**

## The small thing, regardless of the above

The floor shows "settles in 122d" and hides the exact instant in a tooltip. An
owner deciding when to push a number needs the instant, not the distance: the
fixing is "the last reading at or before `resolvesOn`", so a push at 23:58 and
a push at 00:02 land in different markets. Show the date and the UTC time
beside the countdown, everywhere a settle line appears.

## Decided 2026-08-31 (Viktor)

- **Decision 1: the owner, nudged hard.** Only that. Otto writing values and
  the prompt offering to set up a cron were both on the table and neither was
  taken, so Telarchy still never writes a value.
- **Decision 2: settle, and say so permanently.** No holding, no voiding.
- **Decision 3: no manual confirmation, ever, on a fresh reading.**

Built the same day: the bell item, the floor's line measured against the
period rather than a flat three days, the settlement instant written out on
the floor, and `markets.settled_reading_at` so a settlement can say how old
its reading was. Email and push for the nudge are not built: the matrix's
email cells are owned by legacy columns and this kind has none, so it is
bell-and-floor until there is a job to send the rest. The rules live in
`docs/guides/sources.md`, "Stale at the boundary is said out loud".
