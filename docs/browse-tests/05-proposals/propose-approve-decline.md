---
id: 05-proposals-propose-approve-decline
tags: [browse, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 180s
goal-horizon: short
goal-statement: |
  In a workspace with two participants, the proposer can propose a proposal,
  the approver can approve or decline, and any conditional markets resolve
  or void as the spec requires.
---

# Browse test: Proposals (propose → approve → decline)

## What this tests

The end-to-end proposal flow: a participant proposes a proposal; an admin reviews;
on approve the proposal is recorded as approved and conditional markets stay
open for post-decision tracking; on decline conditional markets are voided
and stakes refunded. Also covers the chat thread on the proposal.

Maps to `mvp-evaluation/plan.md` Sections 15.4 and persona 16.13
(`13-proposal-approver.md`).

## Preconditions

- Two participant accounts in the same workspace:
  - **Proposer**: has the `trade` capability (default Trader group is enough).
  - **Approver**: has the `manage` capability (workspace admin/owner).
- Workspace has at least one metric so conditional markets can spawn.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
# Sign in as the Proposer first (use $B state save proposer for re-runs).
$B goto "$TT_FRONTEND_URL/login"
# fill + submit, then save state
$B state save "$TT_NS-proposer-session"
```

## Tests

### T1. Propose a proposal

**Steps:**
1. From the Proposer session: `$B goto https://telarchy.com/proposals`.
2. `$B snapshot -i` and find the "Propose proposal" affordance.
3. Fill: title `Test proposal <timestamp>`, description `automated`.
4. Submit.
5. `$B wait --networkidle && $B text` and grep for the new title.

**Expected:**
- The new proposal appears in the Pending column with status `pending`.
- Network log: `POST /api/proposals` returned 201.
- Save the proposal id from the URL or DOM for later steps.

### T2. Send a chat message on the proposal

**Steps:**
1. `$B click <proposal-card-ref>`
2. `$B snapshot -i` and find the chat input.
3. `$B fill <ref> "Looks good?"`
4. Submit.
5. `$B text` and verify the message appears in the thread.

**Expected:**
- Message visible with the proposer's label.
- `POST /api/proposals/<id>/messages` returned 200.

### T3. Switch to Approver, see the proposal

**Steps:**
1. `$B state save proposer-session`
2. Sign out, sign in as the Approver (or `$B state load approver-session`
   if previously captured).
3. `$B goto https://telarchy.com/proposals && $B text`

**Expected:**
- The pending proposal created in T1 is visible with the proposer's label.
- An "Approve" and "Decline" affordance are present.

### T4. Approve the proposal → status flips to approved

**Steps:**
1. From the Approver UI, click "Approve" on the proposal.
2. `$B wait --networkidle`
3. Confirm the proposal detail.

**Expected:**
- Proposal status now `approved` in the UI and via API.
- Conditional markets stay open for post-decision tracking.

### T5. Conditional markets created/resolved

**Steps:**
1. If the proposal carries `conditionalMarketIds`, fetch them:
   `curl -s -b <cookie> https://telarchy.com/api/proposals/<id> | jq '.conditionalMarketIds'`.
2. For each id: `curl https://telarchy.com/api/predictions/markets/<mid>` and
   inspect `voided` / `resolved` fields.

**Expected:**
- Conditional markets are resolved (or voided as the spec requires) once
  the proposal is approved.

### T6. Decline path voids conditionals and refunds stakes

**Steps:**
1. As Proposer: create another test proposal, attach a conditional market
   (or wait for the platform to auto-attach if that's the default).
2. As Approver: click "Decline".
3. `$B text` and confirm the proposal moves to a `declined` state.
4. Inspect the conditional market: it should be `voided: true`.
5. Inspect any participant who held shares: their balance should be
   restored to within rounding of the pre-trade value.

**Expected:** All listed.

### T7. Impact table opens the correct branch; market card labels the branch

The Impact-predictions table renders each metric row as `Decline → Approve`,
where each number is an individual link: the decline value opens the
decline-branch market, the approve value opens the approve-branch market.
Conditional market cards carry an `approve` / `decline` branch badge so the
approver always knows which side they are on.

**Steps:**
1. As Approver, open a proposal with funded conditional markets (subsidy > 0 so
   both branches exist). The drawer's "Impact predictions" section lists rows.
2. In the first row, capture both forecast numbers (the `.forecast-before` and
   `.forecast-after` buttons inside `.predictions-row`).
3. Click the `.forecast-before` number (the decline value).
4. `$B wait --networkidle`, then read the expanded market card:
   `$B js "var c=document.querySelector('.market-card.expanded');var n=c.querySelector('.market-metric-name').textContent;var b=c.querySelector('.market-branch-badge').textContent;n+' / '+b"`.
5. Go back to the proposal, click the `.forecast-after` number (approve value),
   and read the expanded card the same way.

**Expected:**
- Step 4 lands on the same metric with badge text `decline`, and the URL
  `marketId` matches the proposal's `declined.marketId` for that row.
- Step 5 lands on the same metric with badge text `approve`, and the URL
  `marketId` matches the proposal's `approved.marketId` for that row.
- Every conditional market card (in `?kind=conditional` view) shows a branch
  badge; no conditional card is unlabeled.

### T8. Impact table follows the metric tree; composites route to descendants

The Impact-predictions table lists rows in metric-tree order (higher metrics
first, the same order as the Metrics page). Composite metrics (those with a
formula) appear as their own rows showing the computed outlook, and clicking one
navigates to the Markets page filtered to its descendant leaf markets.

**Steps:**
1. Open a proposal whose workspace has at least one composite metric with funded
   descendant markets (e.g. the personal-utility workspace's "Utility" tree).
2. Read the impact rows in order:
   `$B js "Array.from(document.querySelectorAll('.predictions-row')).slice(0,8).map(r=>(r.classList.contains('predictions-row--composite')?'[C] ':'[L] ')+r.querySelector('.metric-name').textContent.trim()).join('|')"`.
3. Click a composite row (`.predictions-row--composite`).
4. `$B wait --networkidle` and read the URL plus the filter banner
   (`.markets-metric-filter`) and the distinct `.market-metric-name` values.

**Expected:**
- Step 2 shows roots/composites before their descendants, with `[C]` rows
  carrying a numeric outlook and `[L]` rows carrying a `Decline → Approve` cell.
- Step 3 navigates to `/markets?kind=conditional&metric=<compositeId>`.
- The Markets page shows a `Showing markets under <name>` banner, and the listed
  metrics are exactly the composite's transitive leaf descendants (no unrelated
  metrics). The `Clear ×` button removes the filter.
- Metric names in the conditional market cards are fully legible (the branch
  badge does not crush the name); long names keep the name on its own line and
  wrap the status/branch/proposal chips beneath it.

### T9. Liquidity top-up updates subsidy header and sidebar balance in place

Admin top-ups from the drawer are durable subsidy contributions: the proposal's
subsidy figure must reflect them on the very next refetch (no yellow "No
subsidy" warning left behind), and the bottom-left credit counter must drop by
the spend without any navigation.

**Steps:**
1. As an admin, open a pending proposal's drawer. Capture the subsidy line and
   the sidebar balance:
   `$B js "document.querySelector('.proposal-subsidy-line').innerText"`,
   `$B js "document.querySelector('.sidebar-bottom a[href=\"/account\"] div div:nth-child(2)').textContent"`.
2. Click `add liquidity` (zero-subsidy proposal) or `top up`, fill the
   `.proposal-subsidy-input input` with `0.1`, snapshot scoped to
   `.proposal-subsidy-line`, click the `add` ref.
3. Wait ~1.5s (refetch + 300ms balance debounce), then re-read both values and
   the URL.

**Expected:**
- The subsidy line shows the increased per-branch figure and total (e.g.
  `5.00/branch` -> `5.10/branch`); a zero-subsidy proposal flips from the
  yellow warning to `Subsidy 0.10/branch ...`.
- The sidebar balance drops by exactly `0.1 x branchMarketCount` credits.
- The URL is unchanged (both updates happen in place, no navigation).

## Cleanup

Decline or approve any leftover test proposals rather than leaving them in
`pending`. Test proposals accumulate visually in the workspace.

## Known gaps

- No coverage of multi-message chat ordering or pagination.
- No assertion on real-time updates: today the UI polls; if WebSocket support
  lands, retest that the Approver sees the proposer's chat message without
  reload.
- No coverage of the in-app email/notification when a proposal is approved
  (no email pipe wired today; placeholder for the future).
