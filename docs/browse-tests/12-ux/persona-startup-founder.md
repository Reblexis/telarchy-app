---
id: 12-ux-persona-startup-founder
tags: [browse, ux, persona]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 360s
goal-horizon: short
goal-statement: |
  Persona: Marcus, an early-stage founder picking between two product
  bets. The headline use case for Telarchy. Marcus needs to see, fast,
  how to model his real KPIs and run a market on a real decision.
grader: auto
grade-prompt: |
  You are Marcus, a YC-batch founder with $40k cash and four bets to
  evaluate. Score:
  - relevance (1-10): could you map your real KPI tree onto this in 10 min?
  - decision-pricing (1-10): is the "price a decision" mechanic clear?
  - team scale (1-10): could you bring a co-founder + advisor into this?
  - calibration (1-10): does the UI help you stay calibrated?
  Verdict: ADOPT / TRIAL_ONE_DECISION / SKIP. Top 2 frictions.
---

# Browse test: Persona — Startup founder

## What this tests

Borrowed from `docs/personas/04-startup-founder.md`. The founder needs to
see (a) a startup template that maps to revenue/runway/etc., (b) a way to
propose-and-price a decision, (c) member invite flow.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
EMAIL="qa+sf-$TT_RUN_ID@example.test"
JAR=$(tt_mkuser "$EMAIL" "testtest123" "Marcus")
tt_on_cleanup "tt_rm_user '$JAR'"
$B viewport 1440x900
$B stop
mkdir -p "/tmp/$TT_NS-sf"
findings="/tmp/$TT_NS-sf/findings.txt"
:>"$findings"
react() { echo "[T+$(($(date +%s)-T0))s] $1" >> "$findings"; }
T0=$(date +%s)
```

## Tests

### T1. Land cold; look for "founder" hooks

```bash
$B goto "$TT_FRONTEND_URL/" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-sf/01-landing.png"
text=$($B text)
echo "=== LANDING ===" >> "$findings"; echo "$text" | head -c 2000 >> "$findings"
grep -qiE 'startup|founder|company|kpi|okr|runway|mrr|arr' <<<"$text" \
  && react "Founder framing visible" \
  || react "FRICTION: no founder-relevant copy on landing"
```

### T2. Sign up + pick startup template

```bash
$B goto "$TT_FRONTEND_URL/signup" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B fill 'input[name="name"], input[placeholder*="name" i]' "Marcus"
$B click 'input[type="checkbox"]'
$B click 'button[type="submit"]'
$B wait --networkidle
$B goto "$TT_FRONTEND_URL/workspaces/new" 2>/dev/null && $B wait --networkidle \
  || ($B goto "$TT_FRONTEND_URL/create-workspace" && $B wait --networkidle)
$B screenshot "/tmp/$TT_NS-sf/02-templates.png"
text=$($B text)
grep -qi 'startup' <<<"$text" \
  && react "Startup template visible" \
  || react "FRICTION: no startup template (or under different name)"
$B click 'button:has-text("Startup"), [data-template="startup"]' || true
$B fill 'input[name="name"], input[placeholder*="workspace" i]' "Marcus startup"
$B click 'button[type="submit"]:has-text("Create"), button:has-text("Use this")' || true
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-sf/03-startup-workspace.png"
```

### T3. Inspect the seeded KPIs

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-sf/04-metrics.png"
text=$($B text)
echo "=== METRICS ===" >> "$findings"; echo "$text" | head -c 2000 >> "$findings"
hits=0
for kpi in MRR runway burn growth retention; do
  grep -qi "$kpi" <<<"$text" && hits=$((hits+1))
done
react "founder-relevant KPI matches: $hits / 5"
```

### T4. Propose a decision and price it

```bash
$B goto "$TT_FRONTEND_URL/tasks" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-sf/05-tasks.png"
$B click 'button:has-text("Propose"), button:has-text("New task"), [data-testid="new-task"]' \
  || react "FRICTION: no propose-task affordance found"
$B wait --networkidle
$B fill 'input[name="title"], input[placeholder*="title" i]' "Hire 1 senior engineer"
$B fill 'textarea[name="description"], textarea[placeholder*="description" i]' "Trade-off: increase burn by 15k/mo, expect MRR up 8k/mo by Q3"
$B fill 'input[name="price"], input[placeholder*="price" i]' "20"
$B click 'button[type="submit"]:has-text("Propose"), button:has-text("Submit")'
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-sf/06-task-proposed.png"
text=$($B text)
grep -qi "Hire 1 senior" <<<"$text" \
  && react "Decision proposed and visible" \
  || react "FRICTION: proposed task not visible after submit"
```

### T5. Invite a collaborator (advisor)

```bash
$B goto "$TT_FRONTEND_URL/workspaces" && $B wait --networkidle 2>/dev/null \
  || $B goto "$TT_FRONTEND_URL/settings"
$B screenshot "/tmp/$TT_NS-sf/07-settings.png"
text=$($B text)
grep -qiE 'invite|member|add.*team' <<<"$text" \
  && react "Member-invite affordance visible" \
  || react "FRICTION: no obvious team-invite path"
```

### T6. Check budget

```bash
elapsed=$(($(date +%s)-T0))
react "Total elapsed: ${elapsed}s (budget 180s)"
```

### T7. Print

```bash
echo "=== FOUNDER FINDINGS ==="
cat "$findings"
echo "Screenshots: /tmp/$TT_NS-sf/"
```

## Cleanup

Auto.

## Known gaps

- No coverage of "show this to my co-founder over Zoom" — collaboration
  smoothness across two browsers in one session.
