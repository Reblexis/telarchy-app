<!-- Record, 2026-09-10. Written by Codex (codex-cli 0.153.4), fixing the five
     defects its own audit of 2026-09-09 found. Owner instruction: "can it fix
     it". Claude ran the suites Codex's sandbox could not, and corrected the
     hover label's precision rule and one caption Codex missed. -->

# Data room fixes

1. **Profit qualification:** publish the unrounded marked profit used by the
   metric. `trader-window.test.ts`, `UNROUNDED PROFIT DECIDES WHO COUNTS`, pins
   99.6 below the 100-credit threshold, equality, above, zero and losses.
2. **Spend qualification:** publish unrounded absolute-cost sums.
   `UNROUNDED SPEND DECIDES WHO COUNTS` pins 99.996 below the threshold,
   equality, above and negative trade costs. RankChart hover labels retain
   fractional values too; its parameterized threshold test covers both sides.
3. **Lapse dates:** evaluate the remaining sum at each distinct trade expiry,
   then publish the UTC date of the first crossing below the threshold.
   `lapses use the exact trade expiry in UTC` covers today, midnight, 02:00,
   simultaneous expiries, equality and already-expired trades. The page now
   draws today through seven days ahead, covered by DataRoomWindow.test.ts.
4. **Quiet trading days:** emit every UTC date touched by the trailing
   120-day query, including zero activity. Bound the query at the computation
   instant; boundary dates can be partial. `QUIET DAYS ARE REAL ZEROS`,
   `an empty query still publishes every covered UTC date`, and
   `DATES OUTSIDE QUERY COVERAGE ARE ABSENT` prove the range and zeros.
   Existing tests preserve private-workspace and redemption exclusions and
   leave missing metric readings absent.
5. **Traffic captions:** say "Known crawlers and scanner paths excluded" and
   "Distinct addresses", including chart legend and accessible label.
   DataRoomCharts.test.ts pins the wording and rejects the former claims.

Updated docs/data-room.md, its generated browse mirror, the API help entry,
the participant skill description and the browser acceptance spec. No figures
were typed into the prose content module.

## Verification

Tests were written and run before implementation. The initial backend run
failed eight cases for the intended defects; the initial component run failed
three. The additional hover-label test failed three fractional cases before
its fix. The focused backend suites then passed all 37 tests, and the page
and rank-chart suites passed independently (17 and 12 tests).

The full `npm test` run encounters sandbox `listen EPERM` failures in HTTP
suites. The local dev server fails for the same socket restriction. Browser-use
also cannot access its runtime socket on the read-only filesystem. Therefore
live endpoint and browser verification remain incomplete; no production success
is claimed. The default frontend config loader also writes to shared read-only
node_modules; `--configLoader runner` avoids that restriction.

## Findings outside the five fixes

The lapse chart omitted today and the hover labels rounded values, so both
were corrected as necessary parts of fixes 1 through 3. The API help's older
list of evidence blocks still names retired blocks and omits newer blocks;
that unrelated inventory was left unchanged. No redesign was attempted.

Final focused verification: 37 backend tests and 29 component tests pass.
Typechecking and the production Vite build passed; Biome checks and
`git diff --check` pass. The HTTP suite was stopped after repeated sandbox
listener failures. Staging failed because the worktree's shared Git metadata
is read-only (`index.lock` cannot be created), so these changes are neither
committed nor pushed. CODEX-BRIEF.md was left untouched.
The full frontend run produced no result beyond its startup banner after
several minutes and was stopped; only the focused component suites are
confirmed green. The final typecheck and production build also passed after
the hover-label change.
