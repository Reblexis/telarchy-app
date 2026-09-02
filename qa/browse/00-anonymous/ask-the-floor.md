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
The behavioural proposal is `docs/vision.md`, "The workspace brief, and asking
the floor a question": the brief is one read with everything needed to price
the floor, a document appears only where the owner published it, and Otto
answers from the brief alone.

Answers need `AI_GATEWAY_API_KEY` on the instance (a Vercel AI Gateway key). Where it is unset the
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

### T5. Otto is in the corner, closed, with openers about THIS company

```bash
$B goto "$TT_FRONTEND_URL/$SLUG" && $B wait --networkidle
text=$($B text)
grep -qi 'Ask Otto about' <<<"$text"
# Closed until asked for: the composer is not on the page yet.
$B assert '.otto-input' --gone
$B click '.ottodock'
text=$($B text)
grep -qi 'market maker on' <<<"$text"
grep -qi 'actually do' <<<"$text"
# Whose opinions these are is said, every time.
grep -qi 'not advice from' <<<"$text"
$B screenshot "/tmp/$TT_NS-otto.png"
```

### T5b. The section beside the prose opens the same Otto

```bash
$B goto "$TT_FRONTEND_URL/$SLUG" && $B wait --networkidle
# "What is <name>?" carries its own way to ask (owner direction 2026-08-21).
$B assert '.pubws-know-ask' --visible
$B click '.pubws-know-ask'
$B assert '.otto-input' --visible
# One of him, not two: the dock is gone while the panel is up.
$B assert '.ottodock' --gone
```

### T5c. Anonymous, he reads; he does not claim he can act

```bash
$B goto "$TT_FRONTEND_URL/$SLUG" && $B wait --networkidle
$B click '.ottodock'
text=$($B text)
# The honest half of "he acts as you" (owner direction 2026-08-21): signed
# out there is nobody to act as, and the panel says so instead of offering an
# action that would come back 401.
grep -qi 'Sign up and he can act for you too' <<<"$text"
grep -qiv 'acts with your account' <<<"$text"
```

### T6. The agent prompt lives in account settings, and names this floor

Covered by `src/components/__tests__/AccountDialog.test.tsx` ("the agent
prompt"), since reaching it needs a signed-in session and the dialog. The
behavioural guarantee is in `docs/vision.md`: the prompt names the context URL
of the floor it was opened from.

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
