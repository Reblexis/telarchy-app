# tetraspace shows negative impact on the contractor rail (2026-09-04)

**Symptom (Viktor, 2026-09-04):** the leaderboard's Top contractors lists
tetraspace at -5.3 for one approved $20 proposal ("Write & publish >500
words on Tetra's thoughts on futarchy/telarchy", 39a343ce, Telarchy
floor). Nobody has ever said approving it hurts the number.

## What the number is made of

`jobImpact` (functions/src/lib/contractors.ts) scores a job as
approved-branch consensus minus declined-branch consensus on the hero
metric, largest-magnitude horizon. For this job, on Active traders 2026-09:

| branch | consensus | trades | history |
|---|---|---|---|
| approved (ba447e68) | 12.83 | none, volume 0 | one point: the current book |
| declined (9ee70500) | 18.14 | one, 84 cr on 2026-08-21 | opened 23.41, traded to 18.14 |

12.83 - 18.14 = -5.31.

Both branches opened at 23.41 on 2026-08-21 (the baseline's price then;
the declined branch's history still shows it). The one trader that day
sold the declined branch down to 18.14: "declining costs about five
traders", a POSITIVE view of the job. The approved branch was never
traded, so on 2026-09-02 the hand re-anchor
(`notes/untraded-books-and-the-price-floor-2026-09-02.md`) set it to the
baseline's price that morning, 12.83. The baseline has since moved to
20.18; the approved book has not, because nothing moves a book nobody
trades. `marketPriceSeries` reports an untraded market's current shares
as its "opening", which is why the approved branch's only history point
reads 12.83 rather than 23.41.

So the -5.3 is a stale opening price on one side subtracted from a real
trade on the other. It is not a forecast of anything. The same delta is
what the ballot prints for the proposal (`delta` in the public workspace
response), so the proposal row on the floor shows it too.

## The doc bug

The floor already says an open is not a forecast (an unfunded or untraded
book shows an honest prior, never a bet button). `jobImpact` and the
ballot's `delta` do not honour that: they take a branch's price at face
value whether or not anyone has traded it. That is the underspecified
sentence.

## Fix (proposed, not built)

Rule for `docs/ui-conventions.md`, next to "Both leaderboards rank on
what the market says right now":

> A conditional pair is priced only when BOTH branches have been traded.
> A pair with an untraded branch has no delta: the ballot shows it as not
> priced yet and it adds nothing to the poster's impact, because an
> opening price is where the engine put the book, not where a trader did.

Conforming change: the marketplace route already computes per-branch
volume and trader counts for the ballot; pass "traded" per branch into
`ContractorJobPair` and make `jobImpact` skip a pair where either side has
no trade, and make the ballot's `delta` null on the same condition (the UI
already has the "not priced yet" state). Tests first, in
`contractors.test.ts`: "a pair with an untraded branch does not price the
job", "a job whose only priced horizon has an untraded branch counts as
unpriced", and the existing "impact is denominated in the far horizon"
case stays green.

After the fix tetraspace shows "1 proposal, $20 earned, not priced yet"
and ranks on dollars, which is the truth: one person traded one side once.

Alternative considered: substitute the baseline's current price for an
untraded branch (20.18 - 18.14 = +2.04). That is the untraded-books
re-anchor proposal from 2026-09-02, which Viktor has not adopted; if he
does, the pair becomes priced again on its own and this rule still holds
for the interval before any refresh. Not doing it here.

Not a fix: re-anchoring the approved branch by hand again (asked not to,
2026-09-02).

## Owner ruling (Viktor, 2026-09-04)

Verbatim: "both branches dont have to be traded its enough if both are
liuqiditated.. and they were so it shouldve been positive imapct it should
sum the differences of the prices when the market was decided it shouldnt
look at anything later after it has been decdied.."

So the "both traded" rule above is dropped. The rule that ships
(`docs/ui-conventions.md`, Top contractors): a pair is priced as soon as
both branches hold liquidity, a pending job is valued live, and a decided
job is valued at the prices recorded at the moment of the decision, never
re-read afterwards. For tetraspace's job that is 23.41 - 18.14 = +5.27 at
15:45 UTC on 2026-08-21, when it was approved.

Storage: `proposals.decided_pricing` (migration 0106), written by approve
and decline before either branch is voided. Approved jobs decided before
this shipped are backfilled once by
`scripts/backfill-decided-pricing.mjs`, which replays each branch's trades
up to the decision; for the untraded books that were re-anchored by hand
on 2026-09-02 the replay would return the re-anchored price, so the script
takes those books' state from `notes/reanchor-2026-09-02-before.json`
instead.
