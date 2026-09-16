# Missing orders on Sell, 2026-09-16

Viktor reported that existing limit orders were missing from Sell, that
Quick/Limit disappeared, and that selling seemed to move the market without
spending credits on a new buy. Governing contract: [limit orders](../docs/limit-orders.md).

## Findings

The floor withheld orders from the inline ticket unless its separate manage
state had been opened. The ticket's own Sell tab did not open that state.
Quick/Limit also disappeared when holdings reached zero. Limit placement
refreshed money only, even when it executed an immediate trade.

Production was inspected read-only through Cloud SQL and the public API.
For the monthly LookPilot revenue market
`0533c7d4-75ec-468c-b0d4-6a6dfc0ab65c`, the trade ledger records:

- 2026-08-22 11:26:13 UTC: 1,194.019281866 Lower shares bought for 780 credits.
- 2026-09-16 18:26:38 UTC: all those shares sold for 840.637734758 credits.
  The call moved from 7,246.98 to 7,552.22. The sell limit was 7,784;
  a Lower sell executes at or below its limit, so it filled immediately.
- 18:27:03 UTC: a Higher buy at 7,052 reserved 1,100 credits, with zero filled.
- 18:28:04 UTC: another Higher buy at 7,052 reserved 5,300 credits, with zero filled.

The credit ledger confirms the sale proceeds and both reservations. The
sale used an existing paid position, not unfilled buy orders or free shares.
No production order, balance, or trade was changed during this investigation.

## Behavior and verification

The governing doc now requires orders on both tabs from initial load,
Quick/Limit even with zero holdings, an explanation distinguishing pending
orders from shares, and immediate market refresh after limit placement.

Four regression tests failed before the change: missing orders on Buy,
missing orders on Sell, hidden Quick/Limit with no holdings, and no immediate
market refresh. All passed after the change (94 tests in the two affected suites).
The actual floor was also reproduced in Chromium at localhost with an
isolated HTTP fixture based on the public LookPilot payload, zero holdings,
and a resting buy. Before the fix Sell showed only the empty state; after
it showed Quick/Limit, the resting buy and Cancel. These browser fixtures
verify the UI, not production execution; the latter was checked against the
read-only ledger and the existing backend limit-order tests.

Browser follow-up: Limit stays selected with no sale button when holdings
are zero; cancelling removes the fixture order. At a 390px viewport the
page has no horizontal overflow and Quick/Limit remain visible. Production
frontend and backend builds pass.


Backend validation: all 55 limit-order integration tests pass on Node 22
with `npm --prefix functions run test -- --runInBand limit-orders.test.ts`.
The test process retained open handles after reporting success. Full backend
runs were attempted on Node 26 and the declared Node 22, both with workers
and serially. They stalled before reporting a completed suite and were
stopped. A CPU profile and paused stack located the worker inside PGlite's
`TRUNCATE ... RESTART IDENTITY CASCADE` cleanup, not a request to production.
The full backend suite is therefore unverified; this branch must not be
reported as merged, published, or completely green on that basis.

Final frontend run on Node 22: all 169 suites and 2,036 tests pass. The
existing empty-state assertion was updated to the new wording. Branch:
`fix-sell-order-visibility`.


## Follow-up: keep the ticket selection

Viktor reported that successful actions reset the ticket to Quick Buy and
clarified that pending orders are cancelled, while only bought shares are
sold. The governing doc now puts pending orders first and preserves tab,
mode, and limit-price draft after actions and refreshes.

Four new regressions failed before implementation: buy-limit placement
reset the mode, sell-limit placement reset the mode and price, quick sale
collapsed the remaining-share composer, and pending orders lacked a separate
region before holdings. All 138 tests across the ticket, guard, open-ticket,
and floor integration suites now pass. Browser verification on the actual
local floor with an isolated HTTP fixture confirms Buy Limit after placing,
Sell Limit after placing and cancelling, and Sell Quick after a full sale
and the zero-position refresh. Pending orders have Cancel only and precede
held shares. The production build passes.

The original commit's complete hosted CI passed, including all three backend
shards and frontend/type checks:
https://github.com/Reblexis/telarchy-app/actions/runs/35148722642
Its branch preview deployed successfully. This clears the earlier local
full-backend verification gap for that commit; no backend behavior changes
in this follow-up.

The follow-up full frontend run passes all 169 suites and 2,040 tests.


Deployed follow-up: commit `5b48badf` passed the complete hosted CI, including
all three backend shards and frontend/type checks, and its preview deployed:
https://github.com/Reblexis/telarchy-app/actions/runs/35149948605

Verified through the authenticated public beta proxy at
`https://telarchy.com/beta/lookpilot?branch=br-fix-sell-order-visibility`:
HTTP 200, served bundle `/beta/assets/index-20mGk9TP.js` contains the new
Open orders and Your shares regions and the Order placed acknowledgement,
and no longer contains Order resting. This is the updated preview, not the
published site. The branch is not merged and no production publish occurred.

Visual review: [before/after ticket comparison](design/limit-order-ticket-before-after.html),
with [scope and validation](design/limit-order-comparison.md).
