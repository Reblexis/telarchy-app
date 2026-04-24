# Browse test: Tasks (propose → approve → payout)

## What this tests

The end-to-end task flow: a participant proposes a task with a price; an
admin reviews; on approve, the proposer's balance grows by `price` credits
and any associated conditional markets resolve correctly. Also covers the
chat thread on the task and the decline flow.

Maps to `mvp-evaluation-plan.md` Sections 15.4 and persona 16.13
(`13-task-approver.md`).

## Preconditions

- Two participant accounts in the same workspace:
  - **Proposer**: has the `trade` capability (default Trader group is enough).
  - **Approver**: has the `manage` capability (workspace admin/owner).
- Workspace has at least one metric so conditional markets can spawn.

## Setup

```bash
$B viewport 1440x900
# Sign in as the Proposer first (use $B state save proposer for re-runs).
$B goto https://telarchy.com/login
# fill + submit, then save state
$B state save proposer-session
```

## Tests

### T1. Propose a task

**Steps:**
1. From the Proposer session: `$B goto https://telarchy.com/tasks`.
2. `$B snapshot -i` and find the "Propose task" affordance.
3. Fill: title `Test task <timestamp>`, description `automated`, price `10`.
4. Submit.
5. `$B wait --networkidle && $B text` and grep for the new title.

**Expected:**
- The new task appears in the Pending column with status `pending`.
- Network log: `POST /api/tasks` returned 201.
- Save the task id from the URL or DOM for later steps.

### T2. Send a chat message on the task

**Steps:**
1. `$B click <task-card-ref>`
2. `$B snapshot -i` and find the chat input.
3. `$B fill <ref> "Looks good?"`
4. Submit.
5. `$B text` and verify the message appears in the thread.

**Expected:**
- Message visible with the proposer's label.
- `POST /api/tasks/<id>/messages` returned 200.

### T3. Switch to Approver, see the proposal

**Steps:**
1. `$B state save proposer-session`
2. Sign out, sign in as the Approver (or `$B state load approver-session`
   if previously captured).
3. `$B goto https://telarchy.com/tasks && $B text`

**Expected:**
- The pending task created in T1 is visible with the proposer's label.
- An "Approve" and "Decline" affordance are present.

### T4. Approve the task → balance shifts by `price`

**Steps:**
1. Capture proposer's balance before:
   `curl -s -H "X-API-Key: $ADMIN_KEY" -H "X-Workspace-Id: <ws>" https://telarchy.com/api/agents/<proposerId> | jq '.balance'`.
2. From the Approver UI, click "Approve" on the task.
3. `$B wait --networkidle`
4. Re-read the proposer's balance.

**Expected:**
- Balance grew by exactly `10` credits (the task `price`).
- Task status now `approved` in the UI and via API.

### T5. Conditional markets created/resolved

**Steps:**
1. If the task carries `conditionalMarketIds`, fetch them:
   `curl -s -b <cookie> https://telarchy.com/api/tasks/<id> | jq '.conditionalMarketIds'`.
2. For each id: `curl https://telarchy.com/api/predictions/markets/<mid>` and
   inspect `voided` / `resolved` fields.

**Expected:**
- Conditional markets are resolved (or voided as the spec requires) once
  the task is approved.

### T6. Decline path voids conditionals and refunds stakes

**Steps:**
1. As Proposer: create another test task, attach a conditional market
   (or wait for the platform to auto-attach if that's the default).
2. As Approver: click "Decline".
3. `$B text` and confirm the task moves to a `declined` state.
4. Inspect the conditional market: it should be `voided: true`.
5. Inspect any participant who held shares: their balance should be
   restored to within rounding of the pre-trade value.

**Expected:** All listed.

## Cleanup

Decline or approve any leftover test tasks rather than leaving them in
`pending`. Test tasks accumulate visually in the workspace.

## Known gaps

- No coverage of multi-message chat ordering or pagination.
- No assertion on real-time updates: today the UI polls; if WebSocket support
  lands, retest that the Approver sees the proposer's chat message without
  reload.
- No coverage of the in-app email/notification when a task is approved
  (no email pipe wired today; placeholder for the future).
