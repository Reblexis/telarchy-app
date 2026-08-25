---
id: 12-ux-persona-decision-maker
tags: [browse, ux, persona]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 360s
goal-horizon: short
goal-statement: |
  Persona: a non-engineer team lead asked to approve a proposal. The
  decision-maker should be able to (a) understand what they're saying yes
  to, (b) read the consensus signal, (c) approve in one click — without
  needing to learn how AMMs work.
grader: auto
grade-prompt: |
  You are a non-engineer team lead. Score:
  - context (1-10): can you tell what the proposal is and what's at stake?
  - signal-readability (1-10): does the consensus number actually mean
    something to you, with no prior training?
  - confidence (1-10): would you be comfortable clicking approve?
  - mistake-recovery (1-10): if you misclick, can you undo?
  Verdict: APPROVE_NEXT_TIME / NEED_TRAINING / WONT_USE.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Persona — Decision-maker (approver)

## What this tests

The other end of the dual-actor flow: a person who didn't propose the
proposal and is being asked to commit. Borrowed from
the proposal-approver and decision-maker persona fixtures (private notes).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
read PROP KP < <(tt_mkagent "$WS" prop)
tt_credit "$WS" "$PROP" 100
EMAIL_APP="qa+app-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL_APP" "testtest123" "Approver")
tt_on_cleanup "tt_rm_user '$JAR'"
tt_add_member "$WS" "$MUID" "admin"
# Propose a real-feeling proposal as bot
PROPOSAL=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"title":"Run a paid ad campaign in Q2","description":"Spend $5k targeting design teams. Expected lift: 80 signups."}' \
  "$TT_BASE_URL/api/proposals" | jq -r '.id')
# Have a third bot trade so consensus exists
read T3 K3 < <(tt_mkagent "$WS" thirdparty)
tt_credit "$WS" "$T3" 100
mkts=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL" | jq -r '.conditionalMarketIds[]?')
target=$(echo "$mkts" | head -1)
[ -n "$target" ] && curl -sf -H "X-Agent-Key: $K3" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$target" '{marketId:$id, direction:"higher", amount:5}')" \
  "$TT_BASE_URL/api/predictions/trade" >/dev/null
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL_APP"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
mkdir -p "/tmp/$TT_NS-app"
findings="/tmp/$TT_NS-app/findings.txt"
:>"$findings"
react() { echo "[T+$(($(date +%s)-T0))s] $1" >> "$findings"; }
T0=$(date +%s)
```

## Tests

### T1. Land on /proposals; can I tell what I'm being asked?

```bash
$B goto "$TT_FRONTEND_URL/proposals" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-app/01-proposal-list.png"
text=$($B text)
echo "=== PROPOSAL LIST ===" >> "$findings"; echo "$text" | head -c 1500 >> "$findings"
grep -qi 'Run a paid ad' <<<"$text" \
  && react "proposal visible in list" \
  || react "FRICTION proposed proposal not surfaced for approver"
```

### T2. Open the proposal — is the context complete?

```bash
$B click "a:has-text(\"Run a paid ad\"), [data-proposal-id=\"$PROPOSAL\"]" || true
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-app/02-proposal-detail.png"
text=$($B text)
echo "=== PROPOSAL DETAIL ===" >> "$findings"; echo "$text" | head -c 2000 >> "$findings"
grep -qi 'paid ad campaign' <<<"$text" || react "FRICTION title missing"
grep -qi 'lift' <<<"$text"             || react "FRICTION description missing"
```

### T3. Read the consensus

```bash
grep -qiE 'consensus|forecast|signups|outlook' <<<"$text" \
  && react "consensus surface visible to approver" \
  || react "FRICTION the signal is buried"
$B screenshot "/tmp/$TT_NS-app/03-consensus.png"
```

### T4. Approve

```bash
$B click 'button:has-text("Approve"), [data-action="approve"]' || true
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-app/04-approved.png"
text=$($B text)
grep -qiE 'approved|accepted' <<<"$text" \
  && react "approval confirmed in UI" \
  || react "FRICTION no confirmation after approve"
```

### T5. Mistake recovery: try to un-approve

```bash
text=$($B text)
grep -qiE 'undo|revert|cancel' <<<"$text" \
  && react "undo affordance present" \
  || react "FRICTION no undo after approve (irreversible state)"
```

### T6. Print

```bash
echo "=== APPROVER FINDINGS ==="
cat "$findings"
echo "Screenshots: /tmp/$TT_NS-app/"
```

## Cleanup

Auto.

## Known gaps

- No A/B between "consensus shown as a number" vs "as a sentence". When
  a sentence-mode lands, add a leg to compare comprehension.
