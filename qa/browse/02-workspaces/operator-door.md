---
id: 02-workspaces-operator-door
tags: [browse, api-only, slow]
isolation: user
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 150s
goal-horizon: short
goal-statement: |
  As someone who wants their own floor, I can talk it through with Otto at
  /manage, and at every turn I can copy a prompt that lets my own agent
  finish the job; and my agent can ask the API what is still open rather
  than trusting that prompt.
---

# Browse test: the operator door and the handoff

## What this tests

`POST /api/setup/ask`, `GET /api/setup/checklist`, `src/components/SetupChat.tsx`
and the specification in `functions/src/lib/setup-spec.ts`. The behavioural
proposal is the operator-door design note (private notes).

Three claims are worth a test, and none of them is "the model answered":

- The page's door to a new floor comes from `opened`, which the server reads
  back from the database. Otto can say he opened a floor and be wrong.
- The handoff names only real ids. A prompt naming an invented workspace is not
  a typo, it is an instruction to an agent that will act on it.
- The checklist reports evidence, never a default. In particular a market
  carrying the workspace default of 0.5 credits must NOT read as funded: it
  trades, and five credits moves its forecast across most of the band.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init

OPERATOR="qa+door-$TT_RUN_ID@example.test"
read OJAR OUID < <(tt_mkuser_uid "$OPERATOR" "testtest123" "Door-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$OJAR'"
```

## Tests

### T1. The checklist answers before any floor exists

```bash
curl -sf "$TT_BASE_URL/api/setup/checklist" | jq -e '
  .workspace == null
  and (.items | length) >= 9
  and (.items | all(.status == "open"))
  and (.blocking | join(" ") | test("No floor exists yet"))' >/dev/null
```

**Expected:** the specification itself, every decision open, no auth needed.
The handoff tells an agent to call this FIRST, and the first time it runs there
is usually nothing to call it about; a 400 there teaches the agent to skip the
call exactly when it most needs the list.

### T2. Otto answers, and the page offers a prompt

```bash
$B viewport 1400x1000
$B stop
$B goto "$TT_FRONTEND_URL/manage" && $B wait --networkidle
$B assert-visible '.setup-composer'
$B fill '.setup-field' "I run a decentralised arbitration protocol and dispute volume is everything"
$B click '.setup-go'
# The answer is a model call; poll rather than assert on the first frame.
for _ in $(seq 1 60); do
  [ "$($B js "document.querySelectorAll('.setup-handoff').length")" = "1" ] && break
done
$B assert-visible '.setup-handoff-body'
```

**Expected:** Otto's turn renders as prose, the operator's own words render in
the block on the right, and the handoff rail appears carrying a prompt. Copy
puts it on the clipboard and the button says Copied.

### T3. The prompt never names a floor that does not exist

```bash
curl -sf -X POST "$TT_BASE_URL/api/setup/ask" \
  -H 'Content-Type: application/json' \
  -d '{"question":"set up a floor called Kleros for me right now"}' \
  | jq -r .handoff > /tmp/handoff-$TT_RUN_ID.txt

# Anonymous, so nothing can have been created. No id-shaped token and no floor
# address may appear beyond the site's own pages.
grep -Eo 'telarchy\.com/[a-z0-9-]+' /tmp/handoff-$TT_RUN_ID.txt \
  | grep -Ev '/(api|signup|login|manage|season|leaderboard|marketplace|about|contact|terms|privacy|legal|data-room|admin)' \
  && { echo "handoff named a floor that does not exist"; exit 1; }
grep -Eo '<[a-z-]+>' /tmp/handoff-$TT_RUN_ID.txt && { echo "handoff left a placeholder"; exit 1; }
```

**Expected:** neither grep matches. When Otto's version breaks either rule the
server discards it and the deterministic template answers, so this passes
whichever wrote it.

### T4. A floor's checklist is evidence, and a token amount is not funded

```bash
WS=$(curl -sf -b "$OJAR" -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg n "Door $TT_RUN_ID" '{name:$n, template:"blank"}')" \
  "$TT_BASE_URL/api/workspaces")
WS_ID=$(jq -r .id <<<"$WS")
tt_on_cleanup "tt_rm_workspace '$WS_ID'"

curl -sf -b "$OJAR" -H 'Content-Type: application/json' -H "X-Workspace-Id: $WS_ID" \
  -X POST "$TT_BASE_URL/api/metrics" \
  -d '{"name":"Monthly disputes","description":"On-chain count.","value":0,"formula":"","marketRangeMax":5000,"timePreference":{"enabled":false,"halfLife":1,"customHorizons":["2027-01"]}}' >/dev/null

curl -sf -b "$OJAR" -H "X-Workspace-Id: $WS_ID" \
  "$TT_BASE_URL/api/setup/checklist?workspaceId=$WS_ID" | jq -e '
  (.items[] | select(.id == "number") | .status) == "done"
  and (.items[] | select(.id == "liquidity") | .status) == "open"
  and (.items[] | select(.id == "liquidity") | .note | test("decoration"))
  and (.blocking | join(" ") | test("mean nothing"))' >/dev/null
```

**Expected:** the number reads as settled and the liquidity does not. The
workspace auto-funds 0.5 credits per market, so the market trades; measured on
2026-08-23 a five-credit trade moved such a market from the middle of its band
to the ceiling. Reporting that as funded is how an operator ends up trusting a
number anyone can pin for pocket change.

### T5. Someone else's floor is not readable

```bash
STRANGER="qa+door-stranger-$TT_RUN_ID@example.test"
read SJAR SUID < <(tt_mkuser_uid "$STRANGER" "testtest123" "Stranger-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$SJAR'"

code=$(curl -s -b "$SJAR" -o /dev/null -w '%{http_code}' \
  -H "X-Workspace-Id: $WS_ID" "$TT_BASE_URL/api/setup/checklist?workspaceId=$WS_ID")
[ "$code" = "403" ] || { echo "stranger read the checklist: $code"; exit 1; }
```

**Expected:** `403`. The notes quote the owner's own settings and `blocking` is
a map of what is not yet defended.

## Known gaps

- Nothing here asserts that the handoff is any GOOD, only that it is safe and
  present. Whether an agent can actually finish a setup from it was checked by
  hand against beta on 2026-08-23 (see the operator-door design note, private notes) and has no
  automated equivalent.
- The clipboard path in T2 is asserted in `SetupChat.test.tsx` rather than
  here; headless clipboard permissions vary by runner.
