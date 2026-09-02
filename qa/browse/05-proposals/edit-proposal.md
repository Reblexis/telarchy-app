---
id: 05-proposals-edit-proposal
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As the participant who posted a proposal, I can fix its title, its
  description and its price while it is pending; once someone has traded,
  a price edit leaves the markets and every position exactly where trading
  put them, disclosed by a revision.
---

# Browse test: editing a proposal you posted

## What this tests

`PATCH /api/proposals/:id` and `GET /api/proposals/:id/revisions`, the rule in
`docs/market-integrity.md` I1b: words and price both edit in place and are
published; a price change re-anchors the pair only while nobody has traded,
and once traded leaves the markets and positions exactly where trading put
them. Passing means a proposer can correct a listing without the market losing
its price or its positions.

## Setup

```bash
source qa/browse/_runner/env.sh    # TT_API, TT_ADMIN_KEY, WS
PROPOSER_KEY="${PROPOSER_KEY:?register a participant first, see 06-participants/agent-register.md}"
```

## Tests

### T1. The proposer edits words in place

1. Post a contract:

```bash
PID=$(curl -s -X POST "$TT_API/api/proposals" \
  -H "X-Agent-Key: $PROPOSER_KEY" -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" \
  -d '{"title":"$200: rewrite the store page","description":"Five languages.","askUsd":200,"liquiditySubsidy":50}' \
  | jq -r .id)
```

2. Note the pair's price and pool:

```bash
curl -s "$TT_API/api/predictions/markets?proposalId=$PID&kind=conditional" \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" | jq '.[] | {id, branch, consensus, liquidity}'
```

3. Edit the description:

```bash
curl -s -X PATCH "$TT_API/api/proposals/$PID" \
  -H "X-Agent-Key: $PROPOSER_KEY" -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" \
  -d '{"description":"Now six languages."}' | jq
```

**Expected:** `{ ok: true, changed: ["description"], reanchored: false }`. The
markets from step 2 still exist with the same ids, the same consensus and the
same liquidity.

### T2. The edit is published

```bash
curl -s "$TT_API/api/proposals/$PID/revisions" \
  -H "X-Agent-Key: $PROPOSER_KEY" -H "X-Workspace-Id: $WS" | jq
```

**Expected:** one revision, `field: "description"`, `oldValue: "Five
languages."`, `newValue: "Now six languages."`, with an `at`. The public floor
payload carries the marker: `curl -s "$TT_API/api/marketplace/$WS" | jq
'.proposals[] | select(.id=="'$PID'") | .editedAt'` is non-null.

### T3. The price re-anchors while nobody has traded

```bash
curl -s -X PATCH "$TT_API/api/proposals/$PID" \
  -H "X-Agent-Key: $PROPOSER_KEY" -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" \
  -d '{"title":"$300: rewrite the store page","askUsd":300}' | jq
```

**Expected:** `changed` contains `askUsd`, `reanchored: true`. Re-reading the
proposal's markets shows a NEW pair (different market ids), and the approved
branch opens lower than in step 2, because a bigger ask burns more out of the
metric.

### T4. Once traded, the price still edits but the markets stay put

1. Trade the approved branch:

```bash
MKT=$(curl -s "$TT_API/api/predictions/markets?proposalId=$PID&kind=conditional" \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" | jq -r '[.[] | select(.branch=="approved")][0].id')
curl -s -X POST "$TT_API/api/predictions/trade" \
  -H "X-Agent-Key: $PROPOSER_KEY" -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" \
  -d "{\"marketId\":\"$MKT\",\"direction\":\"higher\",\"amount\":5}" | jq -r '.tradeId // .error'
```

2. Try to move the price, then the words:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH "$TT_API/api/proposals/$PID" \
  -H "X-Agent-Key: $PROPOSER_KEY" -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" -d '{"title":"$400: rewrite the store page","askUsd":400}'
curl -s -X PATCH "$TT_API/api/proposals/$PID" \
  -H "X-Agent-Key: $PROPOSER_KEY" -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" -d '{"description":"Clarified after a question."}' | jq -r '.changed[0]'
```

**Expected:** `200` for the price: the proposal now reads `askUsd: 400`, but
`GET /api/predictions/markets?proposalId=$PID&kind=conditional` shows the SAME
market ids as before the edit (no void, no respawn) and the traded position is
still held. An `askUsd` revision row appears at
`GET /api/proposals/$PID/revisions`. `description` for the words, as before.

### T5. The title may not disagree with the ask

```bash
curl -s -X PATCH "$TT_API/api/proposals/$PID" \
  -H "X-Agent-Key: $PROPOSER_KEY" -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" -d '{"title":"$999: rewrite the store page"}' | jq -r .error
```

**Expected:** 400, "The title says $999 but the ask is $300; make them agree".

### T6. A stranger cannot edit someone else's proposal

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH "$TT_API/api/proposals/$PID" \
  -H "X-Agent-Key: $OTHER_AGENT_KEY" -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" -d '{"description":"mine now"}'
```

**Expected:** `403`. A caller with `manage` gets `200` on the same body.

### T7. A decided proposal is closed

Approve it (`POST /api/proposals/$PID/approve` with the admin key), then retry
T1's edit.

**Expected:** `409`, naming the status. An approved proposal's terms are the
deal the owner agreed to pay for.

## Known gaps

- The floor's own edit button is not driven here (this spec is api-only); the
  UI path is the same endpoint.
- Nothing checks that a re-anchored pair keeps the proposer's liquidity
  subsidy; `proposal-edit.test.ts` covers the respawn, not the credit flow.
