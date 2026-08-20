---
id: 00-anonymous-ask-the-floor
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a stranger who just landed on a company's floor, I can ask what the
  company is and get an answer from that floor's own facts, without an
  account, and I can point my own AI at the same brief.
---

# Browse test: Ask the floor

## What this tests

The workspace brief (`GET /api/marketplace/:idOrSlug/context`) and the Ask
field on top of it (`POST /api/marketplace/:idOrSlug/ask`, `AskFloor.tsx`).
The behavioural contract is `docs/vision.md`, "The workspace brief, and asking
the floor a question": the brief is one read with everything needed to price
the floor, a document appears only where the owner published it, and answers
come from the brief alone.

Answers need `ANTHROPIC_API_KEY` on the instance. Where it is unset the
endpoint answers 503 by design and T4 is the whole of what runs.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
SLUG=$(curl -sf "$TT_BASE_URL/api/marketplace/$WS" | jq -r '.slug')
$B viewport 1440x900
$B stop
```

## Tests

### T1. The brief reads anonymously and carries the floor's facts

```bash
curl -sf "$TT_BASE_URL/api/marketplace/$SLUG/context" \
  | jq -e '.name and (.metrics | type == "array") and (.markets | type == "array") and (.contracts | type == "array")'
```

### T2. ?format=md is one readable document

```bash
md=$(curl -sf -H 'Accept: text/markdown' "$TT_BASE_URL/api/marketplace/$SLUG/context?format=md")
grep -q '^# ' <<<"$md"
grep -qi 'open markets' <<<"$md"
```

### T3. An unpublished source never appears in the brief

```bash
# Needs a manage session; skipped when the runner has no owner cookie.
if [ -n "${TT_OWNER_JAR:-}" ]; then
  SRC=$(curl -sf -b "$TT_OWNER_JAR" -H "X-Workspace-Id: $WS" -H 'Content-Type: application/json' \
    -X POST -d '{"name":"Private notes","content":"NEVER-IN-THE-BRIEF"}' \
    "$TT_BASE_URL/api/sources" | jq -r '.id')
  curl -sf "$TT_BASE_URL/api/marketplace/$SLUG/context" | grep -q 'NEVER-IN-THE-BRIEF' \
    && { echo "an unpublished source leaked into the brief"; exit 1; }
  echo "unpublished source stayed out (source $SRC)"
else
  echo "SKIP: no owner session in this runner"
fi
```

### T4. The ask door refuses an empty question, and says when it is off

```bash
code=$(curl -s -o /tmp/$TT_NS-ask.json -w '%{http_code}' -H 'Content-Type: application/json' \
  -X POST -d '{"question":"  "}' "$TT_BASE_URL/api/marketplace/$SLUG/ask")
# 400 when answers are configured, 503 when they are not: both are correct,
# and a 500 is not.
case "$code" in 400|503) ;; *) echo "unexpected $code"; cat /tmp/$TT_NS-ask.json; exit 1;; esac
```

### T5. The field is on the floor, with questions about THIS company

```bash
$B goto "$TT_FRONTEND_URL/$SLUG" && $B wait --networkidle
text=$($B text)
grep -qi 'Ask anything about' <<<"$text"
grep -qi 'Point your own AI at this floor' <<<"$text"
$B screenshot "/tmp/$TT_NS-ask-floor.png"
```

### T6. The agent prompt names this floor's own brief

```bash
$B click 'button:has-text("Point your own AI at this floor")' || $B click '.askfloor-link'
text=$($B text)
grep -q "/api/marketplace/$SLUG/context" <<<"$text"
grep -q 'format=md' <<<"$text"
```

### T7. No console errors

```bash
out=$($B console --errors | sed -n '/^--- BEGIN/,/^--- END/{ /^---/d; p }')
case "$out" in ''|'(no console errors)') ;; *) echo "console errors:"; echo "$out"; exit 1;; esac
```

## Cleanup

Auto.

## Known gaps

- The answer itself is not asserted (it costs a model call and is not
  deterministic); the backend suite pins the refusals and the brief's shape,
  and the prompt's honesty rules are in `functions/src/lib/ask.ts`.
- No assertion on the per-IP limiter, which would need seven calls and would
  spend seven answers to prove.
