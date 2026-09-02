# The floor said zero verified traders for sixteen hours (2026-09-01/02)

**What a visitor saw.** From 18:40 UTC on 2026-09-01 the Telarchy floor's
"Active traders" read 0 (true value: 4), its chart dropped to zero, the
floor's Manifold import count read 0 (true: 10), and the data room's
verified-participants count read 0. At 00:00 UTC on 2026-09-02 the two
daily "Active traders" markets for 2026-09-01 settled on 0, and the daily
market for 2026-09-02 opened at 1.0, the lowest price the book can hold,
because it anchors on the reading. That 1.0 is what Viktor reported.

**Why.** Commit 355f8064 ("Manifold linking: one router serves every
provider", merged 2026-09-01) moved a paid Manifold link from
`manifold-claimed:agent:<id>` to `record-handle:manifold:<id>` in
`system_config`. Its migration 0100 rewrote the ten existing links into the
new shape and deleted the old rows. The leaderboard and the profile were
taught both shapes; the three counts of the verified set were not:
`weeklyActiveVerifiedTraders` and `manifoldImportCount` in
`services/platform-stats.ts`, `manifoldImportCount` on the public floor in
`routes/marketplace.ts`, and the data room's verified count in
`services/data-room.ts` all still read the deleted prefix and found nothing.
The hourly self-sync then recorded that 0 as a measurement, every hour.

The deploy runs migrations before anyone presses Publish, so the rows were
rewritten under whichever build was serving. It did not matter here (the
build was published the same evening), but it is worth knowing: a data
migration takes effect the moment main deploys, not when it is published.

**Doc bug.** `docs/metrics.md` named the old key in "how to compute".
The doc now names the record-link key and says the three counts are the
same rows, and `platform-stats.ts` exports that prefix as the one constant
the three readers share. Tests: `marketplace-stats.test.ts` (a link the
record-link router wrote counts, the retired key does not; the floor and the
stats route report the same import count) and `data-room.test.ts` (the
verified step reads the same rows). All five were red against the old code.

**Repair, done by hand in production at 06:30 UTC on 2026-09-02**, with the
reasoning for each write, since none of these has an API:

1. `metric_logs`: the 26 hourly readings (13 per metric, "Active traders"
   and "Weekly active verified traders", 18:40 to 05:40 UTC) set from 0 to
   4. The true value was recomputed at each timestamp from `trades` and the
   `record-handle:manifold:` rows and was 4 at every one.
2. `metrics.value` for both set to 4.
3. Two `updates` feed rows announcing "4 -> 0" at 18:40 UTC deleted: they
   announced a change that never happened.
4. The two daily markets for 2026-09-01 that settled on 0
   (`d91b3a71-95cd-49ed-ac74-e5195a316703`,
   `390c0100-491c-4768-92e6-3281e766d0d2`): `actual_value` set to 4. Neither
   had a trade, so no payout existed to correct; only the record was wrong.
5. The 2026-09-02 daily market that opened at 1.0
   (`4b25c095-b67a-4c98-ab85-1c38d5cfb773`, untraded) voided through the
   sanctioned route with a published reason, and the refresh reopened it
   (`14636f93-33b2-4cc6-b06b-7fc338bf8176`) anchored at 4.

Two trades were placed on the September month market for "Active traders"
during the window (21:12 and 21:44 UTC, 25 and 250 credits). They traded
against a chart that showed a drop to zero. The market's own price moved
from 12.83 by nothing visible and both traders keep their positions; there
is no refund for a trade a person chose to make, and it is noted here so
the record is complete.

**What is not fixed until Publish.** The serving build still reads the old
key, so its hourly self-sync writes 0 again at every :40 until the fixed
build is published, each time adding a wrong reading and a "4 -> 0" feed
row. The daily market for 2026-09-02 settles on the last reading at or
before 00:00 UTC on 2026-09-03, so a publish before 23:40 UTC on 2026-09-02
settles it right on its own. Readings recorded between 06:40 UTC and the
publish need the same sweep as step 1 (and the feed rows the same as step
3), which is one query each; the repair above is the template.
