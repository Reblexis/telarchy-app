# Browse test: Admin observability (Bot agents panel)

## What this tests

The `/admin` page surfaces two things that have no other UI: per-agent cycle
heartbeats from the out-of-process `telarchy-agents` service, and per-session
LLM decision traces (`ai-analyst`, `ai-researcher`). This spec verifies the
panel renders, refreshes, filters, and fails gracefully — and that the backing
endpoints are properly access-controlled.

Maps to `mvp-evaluation-plan.md` Section 17.

## Preconditions

- Auth: a participant whose membership in at least one workspace carries the
  `manage` capability (e.g. workspace owner or admin). The default
  `viktor.cihal@gmail.com` account from `AGENTS.md` qualifies.
- Backend: `agent_traces` and `agent_heartbeats` tables exist (migration
  `0019_agent_telemetry.sql` applied) and `/api/admin/agent-heartbeats`
  returns 200 to a master-key request.
- Service: `telarchy-agents-prod.service` (or the local equivalent) is
  configured with `TELARCHY_ADMIN_KEY` and has completed at least one cycle
  against the same backend. Verify with:

  ```bash
  curl -s -H "X-API-Key: $ADMIN_KEY" -H "X-Workspace-Id: default" \
    https://telarchy.com/api/admin/agent-heartbeats | jq '.heartbeats | length'
  ```

  Should be ≥ 1 within 30 seconds of a service restart.
- Master key: `$ADMIN_KEY` set to the `mtrk_…` master key for direct POSTs in
  the auth-control tests below.

## Setup

```bash
$B viewport 1440x900
$B goto https://telarchy.com/login
$B snapshot -i
# fill the email / password refs returned above, then submit
$B fill @e3 "viktor.cihal@gmail.com"
$B fill @e4 "TestAdmin99!"   # see AGENTS.md
$B click @e5
$B wait --networkidle
$B goto https://telarchy.com/admin
$B wait --networkidle
$B screenshot /tmp/admin-baseline.png
```

The baseline screenshot should show:
- Sidebar with "Admin" highlighted.
- Main heading "Platform Admin".
- A "Bot agents" section near the top, with at least one row.
- "Decision traces (N)" subsection (N may be 0 immediately after deploy).
- The existing "Activity feed" section below.

## Tests

### T1. Page requires the `manage` capability

**Steps:**
1. `$B state save admin-session` (save the logged-in cookies for later tests).
2. `$B stop` then `$B status` (cold start a new session).
3. `$B goto https://telarchy.com/admin`
4. `$B url`

**Expected:**
- Final URL is `/login` (or `/`), not `/admin`.
- No "Bot agents" or "Activity feed" headings present in `$B text`.

After verifying, restore: `$B state load admin-session`.

### T2. Bot agents panel renders one row per reporting agent

**Steps:**
1. `$B goto https://telarchy.com/admin && $B wait --networkidle`
2. Curl the underlying endpoint to know the ground truth:

   ```bash
   curl -s -H "X-API-Key: $ADMIN_KEY" -H "X-Workspace-Id: default" \
     https://telarchy.com/api/admin/agent-heartbeats \
     | jq -r '.heartbeats[].agentId' | sort
   ```
3. `$B text` and grep the listed agent ids.

**Expected:**
- Every `agentId` from the API appears in the page text.
- Each row includes a strategy label (anchor / momentum / stabilizer / blended
  / ai-analyst / ai-researcher), a status chip (`idle` / `running` / `error`),
  a "last cycle" relative time, a "next cycle" countdown, and a balance
  formatted as `<n.nn> cr`.

### T3. Next-cycle countdown ticks down

**Steps:**
1. `$B goto https://telarchy.com/admin && $B wait --networkidle`
2. `$B snapshot -s "section:has(h2:contains('Bot agents'))" -D` (sets baseline).
3. `sleep 6`
4. `$B snapshot -s "section:has(h2:contains('Bot agents'))" -D`

**Expected:**
- The diff shows the "in Xm Ys" text decrementing on every visible row that
  was not in the middle of running a cycle. Increment of `lastCycleEndedAt`
  values is acceptable on rows where a cycle completed during the wait.

### T4. Last-result column matches API ground truth

**Steps:**
1. Pull the API: `curl -s -H "X-API-Key: $ADMIN_KEY" -H "X-Workspace-Id: default" https://telarchy.com/api/admin/agent-heartbeats | jq '.heartbeats[0] | {agentId, lastTraded, lastSkipped, lastErrors}'`.
2. `$B text` the page and find the matching row.

**Expected:**
- Row shows `<lastTraded>t <lastSkipped>s` and, if `lastErrors > 0`,
  `<lastErrors>e`.

### T5. Click an agent row to filter traces

**Steps:**
1. `$B snapshot -i` to find the @ref of the first agent row.
2. `$B click <ref>`
3. `$B text` and look for "Filtering traces to <agentId>".

**Expected:**
- A "Filtering traces to <agentId>. clear" line appears under the table.
- The decision-traces list either empties (if that agent has no traces) or
  contains only rows whose `agentId` matches.
- Clicking again toggles the filter off (text disappears).

### T6. Decision trace expands to show per-market reasoning

Skip if no trace has been recorded yet (`Decision traces (0)`).

**Steps:**
1. `$B snapshot -i` to find the @ref of the first trace row.
2. `$B click <ref>`
3. `$B text` and look for "tokens:" line and per-entry "consensus … →
   estimate …" lines.

**Expected:**
- Trace expands inline with: model name, total tokens (in/cached/out), entry
  count, and one block per entry containing an outcome chip
  (`trade` / `skip-under-threshold` / `trade-too-small` / `trade-error` /
  `unknown-market`), the metric name, target date, before/after consensus, and
  a reasoning quote.
- Errors (if any) render in red with the error string.

### T7. Stale-agent UI signal

**Steps:**
1. As an out-of-band action: `systemctl --user stop telarchy-agents-prod.service`.
2. Wait `2 × pollInterval` (default 600 s). Don't sleep in the test runner;
   schedule a return.
3. `$B goto https://telarchy.com/admin && $B wait --networkidle`
4. `$B text` the row corresponding to a stopped agent.

**Expected:**
- Either the status chip turned `error`, or the "next cycle" countdown reads
  `overdue`.

After verifying: `systemctl --user start telarchy-agents-prod.service`.

### T8. `GET /api/admin/agent-heartbeats` access control

**Steps (no browse needed):**
1. `curl -i https://telarchy.com/api/admin/agent-heartbeats` (no headers).
2. `curl -i -H "X-Agent-Key: $NON_ADMIN_AGENT_KEY" -H "X-Workspace-Id: default" https://telarchy.com/api/admin/agent-heartbeats`.
3. `curl -i -H "X-API-Key: $ADMIN_KEY" -H "X-Workspace-Id: default" https://telarchy.com/api/admin/agent-heartbeats`.

**Expected:**
- 401, 403, 200 in that order.

### T9. `POST /api/admin/agent-heartbeat` rejects non-master keys

**Steps:**
1. `curl -i -X POST -H "Content-Type: application/json" -H "X-Agent-Key: $NON_ADMIN_AGENT_KEY" -H "X-Workspace-Id: default" -d '{"agentId":"forbidden-bot","status":"idle"}' https://telarchy.com/api/admin/agent-heartbeat`.
2. Verify no row was inserted: `curl -s -H "X-API-Key: $ADMIN_KEY" -H "X-Workspace-Id: default" https://telarchy.com/api/admin/agent-heartbeats | jq '.heartbeats[].agentId' | grep forbidden-bot`.

**Expected:**
- 403 from the POST.
- `forbidden-bot` not present in the heartbeats list.

### T10. `POST /api/admin/agent-traces` rejects non-master keys

Same as T9 but POST `/api/admin/agent-traces` with a minimal valid body:

```bash
curl -i -X POST -H "Content-Type: application/json" \
  -H "X-Agent-Key: $NON_ADMIN_AGENT_KEY" -H "X-Workspace-Id: default" \
  -d '{"workspaceId":"default","agentId":"x","strategy":"x","entries":[]}' \
  https://telarchy.com/api/admin/agent-traces
```

**Expected:** 403; no row inserted (verify with `GET /api/admin/agent-traces`).

### T11. Trace POST accepts an empty `entries` array

**Steps:**
1. POST a trace with `entries: []` using the master key.
2. `GET /api/admin/agent-traces?agentId=test-empty&limit=1`.

**Expected:**
- 201 from the POST.
- The returned trace has `entries: []` and the metadata fields you sent.

### T12. Heartbeat upsert keeps a single row per agent

**Steps:**
1. POST two heartbeats in a row with the same `agentId`:

   ```bash
   for i in 1 2; do
     curl -s -X POST -H "Content-Type: application/json" \
       -H "X-API-Key: $ADMIN_KEY" -H "X-Workspace-Id: default" \
       -d "{\"agentId\":\"upsert-test\",\"status\":\"idle\",\"lastTraded\":$i}" \
       https://telarchy.com/api/admin/agent-heartbeat
   done
   ```
2. `curl -s -H "X-API-Key: $ADMIN_KEY" -H "X-Workspace-Id: default" https://telarchy.com/api/admin/agent-heartbeats | jq '[.heartbeats[] | select(.agentId == "upsert-test")] | length'`.

**Expected:** `1`. The `lastTraded` field equals `2` (the more recent value).

### T13. Polling does not produce console errors

**Steps:**
1. `$B console --clear`
2. `$B goto https://telarchy.com/admin && $B wait --networkidle`
3. `sleep 12` (panels poll every 5s and 4s, so this catches at least one cycle).
4. `$B console --errors`

**Expected:** Empty output. (Warnings about React DevTools or third-party
content are tolerable; app-emitted errors are not.)

## Cleanup

```bash
# Remove the test heartbeats so they don't pollute the dashboard:
psql "$DATABASE_URL" -c "DELETE FROM agent_heartbeats WHERE agent_id IN ('upsert-test','forbidden-bot');"
psql "$DATABASE_URL" -c "DELETE FROM agent_traces WHERE agent_id IN ('test-empty','x');"
```

## Known gaps

- No spec for the trace retention policy yet (T17.13 in the feature plan); add
  one once a TTL or pruning job exists.
- No spec for multi-workspace filtering of the trace list. Today the panel
  scopes to the workspace selected in the dropdown above the activity feed,
  but that selector and the panel are not visually linked. Revisit when the
  panel gains its own workspace filter.
- No mobile viewport assertion. The panel is a wide table; on phones it
  horizontally scrolls. Add a 390x844 screenshot once mobile-admin is in scope.
