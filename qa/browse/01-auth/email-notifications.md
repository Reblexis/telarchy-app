---
id: 01-auth-email-notifications
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a trader, I control which emails Telarchy sends me from account
  settings, and the link at the bottom of any of those emails takes me
  straight to the switch that produced it.
---

# Browse test: Email notification switches

## What this tests

The Emails section of the account dialog (`AccountDialog.tsx`) and the
`#emails` deep link the notification emails close on. The behavioural
proposal is `docs/vision.md`, "Participant email notifications": two switches
on for a new account (a comment under a proposal you posted, a reply in a
thread you are in), one off (every new proposal on the ballot), each saving
on the click through `POST /api/auth/profile`.

Sending itself is not exercised here: `RESEND_API_KEY` is unset outside
production, which is deliberate, so nothing a test does can mail a person.
The fan-out rules have their own suite,
`functions/src/__tests__/comment-notifications.test.ts`.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+notif-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "NotifUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_add_member "$WS" "$MUID" "trader"
SLUG=$(curl -sf -b "$JAR" "$TT_BASE_URL/api/marketplace/$WS" | jq -r '.slug')
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
```

## Tests

### T1. A new account starts with the two personal switches on and the firehose off

```bash
curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/auth/me" \
  | jq -e '.notifications.commentOnMyProposal == true
           and .notifications.replyToMyComment == true
           and .notifications.newProposal == false'
```

### T2. The #emails link opens the dialog ON the switches

```bash
$B goto "$TT_FRONTEND_URL/$SLUG#emails" && $B wait --networkidle
text=$($B text)
grep -qi 'Emails' <<<"$text"
grep -qi 'comments on my proposal' <<<"$text"
$B screenshot "/tmp/$TT_NS-email-switches.png"
```

### T3. Clicking a switch stores it, and only it

```bash
$B click '[role="switch"][aria-checked="false"]'
$B wait --networkidle
curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/auth/me" \
  | jq -e '.notifications.newProposal == true
           and .notifications.commentOnMyProposal == true
           and .notifications.replyToMyComment == true'
```

### T4. The stored state is what a reopened dialog shows

```bash
$B goto "$TT_FRONTEND_URL/$SLUG" && $B wait --networkidle
$B goto "$TT_FRONTEND_URL/$SLUG#emails" && $B wait --networkidle
$B assert '[role="switch"][aria-checked="true"]' --count 3
```

### T5. No console errors

```bash
out=$($B console --errors | sed -n '/^--- BEGIN/,/^--- END/{ /^---/d; p }')
case "$out" in ''|'(no console errors)') ;; *) echo "console errors:"; echo "$out"; exit 1;; esac
```

## Cleanup

Auto.

## Known gaps

- Delivery is not exercised end to end (no mail transport outside production),
  so a broken Resend configuration would not fail this spec.
- The unsubscribe link inside a real email is asserted only as far as the
  `#emails` route; the email body itself is covered by the backend suite.
