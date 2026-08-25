---
id: 01-auth-oauth-handoff
tags: [browse, human]
isolation: user
parallel-safe: false
needs: [auth, browse]
timeout: 600s
goal-horizon: short
goal-statement: |
  As a stranger who clicks Continue with Google, I land on Google's
  consent screen with the right scopes, complete it, and arrive back at
  Telarchy signed in to a fresh account.
---

# Browse test: OAuth handoff (Google + GitHub)

## What this tests

The handoff to Google / GitHub OAuth from `/signup` and `/login`. The
provider's consent screen itself can only be completed by a human, so this
spec uses `$B handoff` to pause the runner and ask a person to finish.

Maps to `mvp-evaluation/plan.md` 2.10 + 2.11.

## Preconditions

- A real Google account or GitHub account the human can use.
- Telarchy's Google/GitHub OAuth credentials configured in the running
  backend (env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop
```

## Tests

### T1. Google button without consent is blocked

```bash
$B goto "$TT_FRONTEND_URL/signup" && $B wait --networkidle
$B snapshot -i > "/tmp/$TT_NS-snap.txt"
google_ref=$(grep -oE '@e[0-9]+' "/tmp/$TT_NS-snap.txt" | head -1) # adjust per snapshot
# The actual ref-finding has to scan for a "Continue with Google" label;
# for resilience, find by text:
$B click 'button:has-text("Continue with Google"), a:has-text("Continue with Google")'
url=$($B url)
[[ "$url" == *"telarchy"* ]] \
  || { echo "consent gate did not block — URL is $url"; exit 1; }
text=$($B text)
grep -qiE 'consent|terms|agree' <<<"$text"
```

### T2. Google button with consent ticked redirects to Google

```bash
$B reload && $B wait --networkidle
$B click 'input[type="checkbox"]'
$B click 'button:has-text("Continue with Google"), a:has-text("Continue with Google")'
$B wait --networkidle
url=$($B url)
[[ "$url" == *"accounts.google.com"* ]] \
  || { echo "did not reach Google: $url"; exit 1; }
$B handoff "Complete the Google consent screen, then close the human-handoff window."
$B wait --networkidle
url=$($B url)
[[ "$url" == *"telarchy"* ]] \
  || { echo "did not return to Telarchy after consent: $url"; exit 1; }
```

### T3. GitHub flow reaches GitHub

```bash
$B stop
$B goto "$TT_FRONTEND_URL/signup" && $B wait --networkidle
$B click 'input[type="checkbox"]'
$B click 'button:has-text("Continue with GitHub"), a:has-text("Continue with GitHub")'
$B wait --networkidle
url=$($B url)
[[ "$url" == *"github.com/login"* ]] \
  || { echo "did not reach GitHub: $url"; exit 1; }
$B handoff "Optional: finish the GitHub flow if you want a real GitHub-signed-up account."
```

### T4. After OAuth, /api/auth/me returns the new user

```bash
# Pull the cookie out of the browse context.
JAR="/tmp/$TT_NS-oauth.jar"
$B cookies > "$JAR"
me=$(curl -sf -b "$JAR" "$TT_BASE_URL/api/auth/me")
echo "$me" | jq -e '.user.email' >/dev/null
```

## Cleanup

The human-created OAuth account stays in the DB. If you want it gone:

```bash skip
psql "$DATABASE_URL" -c "DELETE FROM \"user\" WHERE email = '<the-oauth-email>';"
```

## Known gaps

- No assertion on the Google scope list (we ask for email + profile only).
  Check it manually during the handoff.
- No coverage of OAuth account-merge: a user who signs up by email and then
  later "Continue with Google" with the same email should land in the same
  account. BetterAuth wiring of this is unverified.
