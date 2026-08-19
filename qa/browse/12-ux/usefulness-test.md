---
id: 12-ux-usefulness-test
tags: [browse, ux, persona]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 480s
goal-horizon: long
goal-statement: |
  Given a real, concrete goal a stranger might have ("decide whether to
  hire a senior engineer"), can the user accomplish it on Telarchy in
  one sitting? The spec is the truth-test for "is this useful?".
grader: auto
grade-prompt: |
  You are evaluating whether the product is *useful*, not whether it
  works. A user with a real goal walked through it. Score:
  - goal completion (1-10): could they actually decide?
  - signal quality (1-10): did the forecast/consensus tell them anything?
  - trust (1-10): would you act on the output?
  - re-use (1-10): would you bring the next decision here too?
  Verdict: USEFUL / DEMO_ONLY / NOT_YET. Top 2 frictions.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Usefulness test

## What this tests

The product can be functional and beautiful and still useless. This spec
forces a complete decision through the system: "should we hire a senior
engineer?" — and asks whether the output is something the user would
actually act on.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+use-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "DecidingFounder")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace startup public); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_add_member "$WS" "$MUID" "admin"
read BOT KEY < <(tt_mkagent "$WS" usebot)
tt_credit "$WS" "$BOT" 200
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
mkdir -p "/tmp/$TT_NS-use"
findings="/tmp/$TT_NS-use/findings.txt"
:>"$findings"
react() { echo "[T+$(($(date +%s)-T0))s] $1" >> "$findings"; }
T0=$(date +%s)
```

## Tests

### T1. Frame the decision in the user's words

```bash
react 'Goal: decide whether to hire 1 senior eng @ $200k. Trade-off: +burn, expected MRR lift.'
```

### T2. Set the relevant KPIs (MRR, runway, headcount)

```bash
mid_mrr=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"name":"MRR","type":"leaf","value":12000,"unit":"$"}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mid_runway=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"name":"Runway months","type":"leaf","value":18}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
react "set up MRR + Runway"
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-use/01-kpis.png"
```

### T3. Propose the decision as a proposal with conditional markets

```bash
PROPOSAL=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"title":"Hire senior engineer at $200k base","description":"~+15k/mo burn, expected +8k/mo MRR by Q3"}' \
  "$TT_BASE_URL/api/proposals" | jq -r '.id')
react "proposed proposal: $PROPOSAL"
mkts=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL" | jq -r '.conditionalMarketIds[]?')
n_mkts=$(echo "$mkts" | grep -c .)
react "conditional markets spawned: $n_mkts"
```

### T4. The bot/advisor takes a position

```bash
target=$(echo "$mkts" | head -1)
[ -n "$target" ] && {
  curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg id "$target" '{marketId:$id, direction:"higher", amount:30}')" \
    "$TT_BASE_URL/api/predictions/trade" >/dev/null
  react "bot bought 'higher' MRR-conditional at 30 credits"
}
```

### T5. Look at the actual signal the founder gets

```bash
$B goto "$TT_FRONTEND_URL/proposals" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-use/02-proposals-with-conditional.png"
text=$($B text)
echo "=== PROPOSALS PAGE ===" >> "$findings"
echo "$text" | head -c 2000 >> "$findings"
# What is the consensus telling me?
[ -n "$target" ] && {
  c=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
    "$TT_BASE_URL/api/predictions/markets/$target" | jq -r '.consensus')
  react "consensus on conditional: $c"
}
```

### T6. Decide and approve / decline

```bash
$B click "a:has-text(\"Hire senior engineer\")" || true
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-use/03-proposal-detail.png"
react "founder reads consensus, decides; approving"
curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{}' \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/approve" >/dev/null
react "decision recorded"
```

### T7. Review the resolved outcome

```bash
$B reload && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-use/04-after-decision.png"
text=$($B text)
echo "=== POST-DECISION ===" >> "$findings"; echo "$text" | head -c 1500 >> "$findings"
elapsed=$(($(date +%s)-T0))
react "total time-to-decision: ${elapsed}s"
```

### T8. Print

```bash
echo "=== USEFULNESS FINDINGS ==="
cat "$findings"
echo "Screenshots: /tmp/$TT_NS-use/"
```

## Cleanup

Auto.

## Known gaps

- "Would you act on the output" is purely subjective; the grader judges
  it from the dossier.
- The market here has no human counter-party (only the bot). To stress-
  test the signal, run alongside `11-multi-agent/two-traders-converge.md`.
