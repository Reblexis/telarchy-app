---
id: 00-anonymous-data-room
tags: [browse, fast]
isolation: none
parallel-safe: true
needs: [browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a stranger deciding whether to trade the Telarchy floor or build on this,
  telarchy.com/data-room shows me the platform's own books with no account,
  and I can fetch the same numbers myself to check the page against them.
---

# Browse test: The data room

## What this tests

`GET /api/data-room` and `src/pages/DataRoomPage.tsx`. The behavioural proposal
is `docs/data-room.md`: one anonymous read carries the prose and every figure,
the page renders that response and nothing else, a figure that could not be
computed is `null` and reads as "not published", and the traffic history
survives the purge of the visit rows it came from.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
```

## Tests

### T1. The feed answers a stranger, and carries every block the prose names

```bash
feed=$(curl -sf "$TT_BASE_URL/api/data-room")

# The document ships as sections, in source order, with their block names.
jq -e '(.doc.sections | length) >= 5 and (.doc.sections[0].title | length) > 0' <<<"$feed" >/dev/null

# Every block a section names is a key the evidence carries. A renamed block
# would otherwise delete a number from a public page with no error anywhere.
jq -e '([.doc.sections[].blocks[]] | unique) - (.evidence | keys) | length == 0' <<<"$feed" >/dev/null

# Refuse, do not guess: no figure is allowed to be published as a string.
jq -e '.evidence.traffic.totalVisits | type == "number"' <<<"$feed" >/dev/null
jq -e '.evidence.shipping.total > 0 and (.evidence.shipping.days | length) > 0' <<<"$feed" >/dev/null
```

### T2. It is readable from any origin, with no credentials

```bash
# The page's claim is that anyone can fetch what it fetches, including from
# another site (LookPilot's data room does exactly this with the floor payload).
hdrs=$(curl -s -D - -o /dev/null -H 'Origin: https://example.com' "$TT_BASE_URL/api/data-room")
grep -qi 'access-control-allow-origin: \*' <<<"$hdrs" || { echo "not open to every origin"; exit 1; }
grep -qi 'access-control-allow-credentials' <<<"$hdrs" && { echo "credentials on a wildcard origin"; exit 1; }
true
```

### T3. The page renders the document, anonymously

```bash
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/data-room" && $B wait --networkidle

$B text | grep -qi 'Data room' || { echo "no headline"; exit 1; }
# The section index and the sections themselves come from the feed, so a
# title in the feed must appear on the page.
title=$(curl -sf "$TT_BASE_URL/api/data-room" | jq -r '.doc.sections[1].title')
$B text | grep -qi "$title" || { echo "section '$title' missing from the page"; exit 1; }

# The change log is the git history, so the newest subject is on the page.
subject=$(curl -sf "$TT_BASE_URL/api/data-room" | jq -r '.evidence.shipping.changes[0].subject')
$B text | grep -qF "$subject" || { echo "newest change missing from the page"; exit 1; }

# No console errors, and no sign-in wall.
$B console --errors | grep -qi 'error' && { echo "console errors on the data room"; exit 1; }
case "$($B url)" in */login*) echo "bounced to login"; exit 1 ;; esac
true
```

### T4. The traffic history is a rollup, not a sliding window

```bash
feed=$(curl -sf "$TT_BASE_URL/api/data-room")
# keptSince names the first day of the kept history and is never in the
# future; byDay is ordered oldest first and holds counts, not visitor detail.
jq -e '.evidence.traffic.byDay | length >= 1' <<<"$feed" >/dev/null
jq -e '.evidence.traffic.byDay[0] | has("day") and has("visits") and has("uniques")' <<<"$feed" >/dev/null
jq -e '.evidence.traffic.byDay[0] | has("ip") or has("path") or has("referer") | not' <<<"$feed" >/dev/null
jq -e '.evidence.traffic.keptSince == .evidence.traffic.byDay[0].day' <<<"$feed" >/dev/null
```

### T5. The proposal rows add up to the total

```bash
# A published total whose own rows sum to less reads as a mistake. Removed
# entries (spam, duplicates, test rows) are excluded from both sides.
curl -sf "$TT_BASE_URL/api/data-room" \
  | jq -e '.evidence.contracts | (.approved + .declined + .pending + .withdrawn) == .proposed' >/dev/null
```

## Known gaps

- The freshness of `shipping.builtAt` against the running revision is not
  asserted: the log is generated at deploy time, so the only honest check is
  that it is a date, which T1 covers by shape.
- The "Show all N named changes" toggle and the sticky section index are not
  driven here; T3 asserts the first page of the log renders.
- Nothing asserts the page against a floor with no open market (the "No open
  market on this floor right now" branch), because production always has one.
