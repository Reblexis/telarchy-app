---
id: 07-admin-agents-control-pages
tags: [browse, slow]
isolation: global
parallel-safe: false
needs: [auth, master-key, platform-admin]
timeout: 180s
goal-horizon: short
goal-statement: |
  As the platform operator, I can open /agents, see every out-of-process
  agent runner with live health, pause/resume any of them, request an
  immediate cycle, and drill into a per-agent page with its telemetry.
---

# Browse test: Agents control pages (/agents, /agents/:id)

## What this tests

The `/agents` picker and `/agents/:id` detail pages are the management UI for
the out-of-process agent runners (the cli-agents watcher units). They merge
two data sources: heartbeats (`GET /api/admin/agent-heartbeats`) and the
control plane (`GET /api/admin/agent-controls`). Controls write through
`POST /api/admin/agent-control`. Both pages are platform-admin gated, which
is stricter than `/admin` (workspace `manage` is not enough).

## Preconditions

- Auth: a platform-admin account (the default `viktor.cihal@gmail.com`
  account from `AGENTS.md` qualifies).
- Backend: `agent_controls` table exists (migration `0039_agent_controls.sql`
  applied).
- At least one agent runner has pushed a heartbeat, or at least one control
  row exists. To create a control row without a runner:

  ```bash
  curl -s -H "X-API-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
    -d '{"agentId":"browse-test-agent","desiredState":"enabled"}' \
    https://telarchy.com/api/admin/agent-control
  ```

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
$B goto https://telarchy.com/agents
$B wait --networkidle
$B screenshot /tmp/agents-baseline.png
```

The baseline screenshot should show:
- Sidebar with an "Agents" item (platform admins only) highlighted.
- Heading "Agents" with a "Live (5s)" label.
- One table row per agent: status chip (`idle` / `running` / `error` /
  `paused` / `stale` / `no heartbeat`), strategy, last/next cycle, last
  result, balance, and Pause + Run now buttons.

## Tests

### T1. Pages are platform-admin gated

**Steps:**
1. `$B state save agents-session` (keep the admin cookies for later).
2. Curl the control endpoints WITHOUT auth:

   ```bash
   curl -s -o /dev/null -w '%{http_code}' https://telarchy.com/api/admin/agent-controls
   curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" \
     -d '{"agentId":"x","desiredState":"paused"}' https://telarchy.com/api/admin/agent-control
   ```

**Expected:**
- Both curls return 401 or 403, never 200.
- (If a non-platform-admin test account is available: /agents renders the
  "Platform admin access required." message instead of the table.)

### T2. Picker rows match API ground truth

**Steps:**
1. Pull both sources:

   ```bash
   curl -s -H "X-API-Key: $ADMIN_KEY" https://telarchy.com/api/admin/agent-controls | jq -r '.controls[].agentId'
   curl -s -H "X-API-Key: $ADMIN_KEY" -H "X-Workspace-Id: default" \
     https://telarchy.com/api/admin/agent-heartbeats | jq -r '.heartbeats[].agentId'
   ```
2. `$B text` on /agents.

**Expected:**
- The union of both agentId lists appears in the page, one row each.
- Agents with a heartbeat show status / cycle times; control-only agents show
  `no heartbeat` and em-dash placeholders.

### T3. Pause and resume round-trip

**Steps:**
1. `$B snapshot -i` and find the Pause button @ref of a row.
2. `$B click <ref>` then `$B wait --networkidle`.
3. Verify via API: `curl -s -H "X-API-Key: $ADMIN_KEY" https://telarchy.com/api/admin/agent-controls | jq '.controls[] | select(.agentId=="<id>") | .desiredState'` → `"paused"`.
4. The row's status chip now reads `paused`, next cycle shows `—`, and the
   button reads Resume; Run now is disabled.
5. Click Resume; the chip returns to the heartbeat-derived status and the API
   row flips back to `"enabled"`.

**Expected:** as inlined above. The page reflects each change within one 5s
poll without a manual reload.

### T4. Run now requests a trigger and shows pending state

**Steps:**
1. On an enabled row, click "Run now".
2. Verify via API: `triggerRequestedAt` is set and newer than
   `triggerAckedAt` (or `triggerAckedAt` is null).
3. `$B text` → the row shows "trigger pending" and Run now is disabled.

**Expected:**
- With a live runner: within one runner tick (60s) the cycle fires, the
  runner acks (`triggerAckedAt` >= `triggerRequestedAt`), and "trigger
  pending" clears.
- Without a runner: "trigger pending" persists (this is correct; nothing is
  consuming the queue).

### T5. Per-agent page renders detail + filtered telemetry

**Steps:**
1. From /agents, click an agent id link → URL is `/agents/<id>`.
2. `$B text`.

**Expected:**
- Heading is the agent id with its status chip; "← All agents" link goes back.
- Detail grid shows Strategy, Last cycle started/ended, Next cycle, Last
  result, Balance, Heartbeat updated, Control updated.
- If the heartbeat carries `lastError`, it renders in full (red, monospace).
- The telemetry panel below lists ONLY this agent's heartbeat row and traces
  (other agent ids absent from the trace list).
- Pause / Run now buttons behave exactly as on the picker (T3/T4).

## Cleanup

```bash
# Remove the synthetic control row if T-precondition created one.
# (No DELETE endpoint by design; just leave it enabled - harmless - or
# verify it shows as "no heartbeat" which is the expected rendering.)
```

## Known gaps

- No automated check that a real runner acks triggers end-to-end (needs the
  kpi-sync box units running against prod; covered operationally by
  telarchy-agents' own deploy checklist).
- No test of the stale-heartbeat threshold (would need a 15-minute wait or
  clock control).
