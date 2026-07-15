---
id: 06-participants-agent-portal
tags: [browse, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As an operator who just registered an agent key via API, I can sign in
  to /agent-portal, see balance, browse markets, and place a trade — and
  every UI capability has a documented API equivalent.
---

# Browse test: Agent portal (post-key registration)

## What this tests

The `/agent-portal/<id>` view that an agent operator sees after registering
an API key directly via `POST /api/agents/register`. Verifies that an
agent-key participant can sign in to the portal, see balance, browse markets
they can trade on, and place a trade — i.e. that the AGENTS.md "participant
symmetry" rule holds at the UI layer.

Maps to `mvp-evaluation/plan.md` Section 5 and persona `03-agent-builder.md`.

## Preconditions

- A registered agent and its API key. Get one with:

  ```bash
  curl -s -X POST https://telarchy.com/api/agents/register \
    -H "Content-Type: application/json" \
    -d '{"agentId":"qa-portal-test","workspaceId":"<ws>"}' | jq
  ```

- The workspace's Public or Trader group grants `read` and `trade` to the
  participant.

## Setup

```bash
$B viewport 1440x900
$B goto https://telarchy.com/agent-portal
$B wait --networkidle
$B screenshot /tmp/agent-portal-login.png
```

## Tests

### T1. Sign in with the agent key

**Steps:**
1. `$B snapshot -i` and find the agent-id + api-key inputs.
2. Fill both, submit.
3. `$B url`

**Expected:** Redirected to `/agent-portal/<agentId>`; sidebar shows the
balance from `/api/agents/me`.

### T2. Browse markets visible to this agent

**Steps:** Navigate to the markets section in the portal, `$B text` and
sanity-check that listed markets match `GET /api/predictions/markets`
filtered by the agent's permissions.

**Expected:** Same set of markets the API returns.

### T3. Place a directional trade

**Steps:**
1. Pick an active market with liquidity.
2. Place a 1-credit "higher" trade.
3. Verify balance decreased and consensus increased
   (`GET /api/predictions/markets/<id>`).

**Expected:** Trade succeeds; counts agree.

### T4. Set wallet address (USDC withdrawal)

**Steps:** Submit a Base-network address via the portal form. Verify
`GET /api/agents/me` returns the new `walletAddress`.

**Expected:** Address persists; format validation rejects invalid input.

## Cleanup

Delete the test agent if you don't need it anymore:

```bash
curl -s -X DELETE -H "X-API-Key: $ADMIN_KEY" -H "X-Workspace-Id: <ws>" \
  https://telarchy.com/api/agents/qa-portal-test
```

## Known gaps

- Withdrawal happy-path needs USDC settlement enabled. Skip on the live env
  while the kill-switch is on.
- No coverage of agent-key login from inside an existing browser session
  (mixing agent-key + cookie auth). Add when the portal exposes a "switch to
  browser session" affordance.
