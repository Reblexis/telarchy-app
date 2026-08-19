---
id: 01-auth-signup-and-login
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a stranger who decided to try Telarchy, I can sign up with email +
  password, complete the consent gate, land on first-screen, and log back
  in on a second visit.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Signup and login

## What this tests

The activation funnel from a cold visitor to a signed-in user with at least
one workspace. Specifically: the signup form's validation, the consent gate,
the OAuth-button affordance (without completing real OAuth), and the
post-signup landing.

Maps to `mvp-evaluation/plan.md` Section 2.

## Preconditions

- A fresh email per run (`qa+signup-$(date +%s)@example.test`). The signup
  endpoint enforces uniqueness.
- The backend allows uncontrolled email signup (no allowlist gate active).
- BetterAuth is wired to the same DB the test asserts against.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop                              # cold-start a fresh browser context
$B goto "$TT_FRONTEND_URL/signup"
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-signup-baseline.png"
```

## Note: first-run surfaces (2026-07-12)

Auto-tutorials are enabled: a fresh signup shows the persona picker modal
("What do you want to do here?") right after account creation, and picking a
track starts a guided tour. Specs that click through signup must either pick
a persona or dismiss with the "Skip" button before interacting with the page
underneath.

## Tests

### T1. Signup form has the documented fields

**Steps:**
1. `$B snapshot -i`

**Expected:**
- Refs include: an Email textbox, a Password textbox, a Display name
  textbox, a Consent checkbox, and a primary "Sign up" button.
- A "Continue with Google" and "Continue with GitHub" button each appear,
  with the consent checkbox visually associated.
- Documented gap (mvp 2.1, persona 1): if Display name or Consent are
  missing, file under `mvp-launch-backlog.md` and continue with what's there.

### T2. Empty submit blocks with field-level errors

**Steps:**
1. `$B click <signup-button-ref>`
2. `$B text` and look for inline error strings.
3. `$B network` and grep for the signup endpoint.

**Expected:**
- Each empty required field surfaces a specific error ("Email required",
  "Password required", "Consent required", etc.).
- No POST to `/api/auth/sign-up/email` is recorded.

### T3. Password under 8 chars rejected with specific message

**Steps:**
1. `$B fill <email-ref> "qa+pw-short-$(date +%s)@example.test"`
2. `$B fill <password-ref> "1234"`
3. Tick consent, click submit.
4. `$B text`

**Expected:** Message contains "8 characters" or equivalent. POST not made
or returned 400.

### T4. Consent unchecked + OAuth click blocks the redirect

**Steps:**
1. Reload the page (`$B reload`).
2. Verify consent box is unchecked: `$B is checked <consent-ref>` returns false.
3. `$B click <google-ref>`
4. `$B url` immediately after.

**Expected:**
- URL still on `telarchy.com/signup`.
- An inline error references the consent requirement.

### T5. Happy-path signup completes

**Steps:**
1. `EMAIL="qa+happy-$(date +%s)@example.test"; PASSWORD="testtest123"`
2. Reload, fill all fields, tick consent, submit.
3. `$B wait --networkidle`
4. `$B url`

**Expected:**
- Redirected to `/create-workspace` (or the current first-screen route).
- `$B network` shows a `200` from `/api/auth/sign-up/email`.
- `curl -b <cookie> https://telarchy.com/api/auth/me` returns the new user.

### T6. Duplicate email returns a clean error

**Steps:**
1. Reuse the email from T5 in another fresh context.
2. Submit.
3. `$B text` for error.

**Expected:** A user-friendly "account already exists" message, not a stack
trace. POST returns 4xx.

### T7. Existing-user login round-trip

**Steps:**
1. `$B goto https://telarchy.com/login`
2. `$B snapshot -i`
3. Fill email + password, click "Login".
4. `$B wait --networkidle && $B url`

**Expected:**
- URL is `/metrics` (or whichever first authenticated screen is current).
- Page text contains the workspace switcher and the user's email.

### T8. Logout clears the session

**Steps:**
1. From a logged-in state, find the Logout link in the sidebar (`$B snapshot -i`).
2. Click it.
3. `$B goto https://telarchy.com/admin && $B url`

**Expected:** URL is `/login` (route guard kicked in).

## Cleanup

The test accounts created here have no special privileges; leave them in the
DB or delete with:

```sql
DELETE FROM "user" WHERE email LIKE 'qa+%@example.test';
```

(Cascade to BetterAuth tables via the FK constraints.)

## Known gaps

- Steps 2.10 and 2.11 in `mvp-evaluation/plan.md` (real Google/GitHub OAuth)
  remain human-only. Use `$B handoff` if you need to walk a human through it.
- T2 currently asserts on text patterns; once the signup form has stable
  `data-testid` attributes, switch to those for resilience.
