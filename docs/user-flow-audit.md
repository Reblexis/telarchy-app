# User-flow audit plan

Repeatable script for walking the first-time-user flow end-to-end with the gstack `browse` headless browser (`$B`), screenshotting each step, and noting every friction point. Run this before every launch-adjacent push. Designed for one human + one AI agent pair: the AI drives, the human skims screenshots. The previous Playwright MCP commands referenced here map 1:1 to `$B` (see `qa/browse/README.md` for the cheat sheet).

## Why this exists

The product's conversion funnel has too many hands-off steps (email → consent → profile → template → check-in → bots arriving → first share) to catch regressions by reading code alone. This script turns the flow into a checklist with artifacts.

## How to run

Pick an environment:
- **Prod** (`https://telarchy.com`): realistic; risks polluting with test accounts.
- **Local** (`http://localhost:5173` with `npm run dev`): current code, no prod pollution.

Use a fresh email for each run, e.g. `flow-audit-<unix-ts>@integration.test`. Keep screenshots in `/tmp/flow-audit-<date>/` so they aren't committed.

For each step, capture: (1) full-page screenshot, (2) any console errors, (3) any network 4xx/5xx. Record the time from one step to the next, since friction shows up as seconds of staring.

## Steps

### 1. Landing (logged out)

URL: `/`

**Check:**
- Primary CTA copy: does it say signup is free ("Free to start" or equivalent)? Do not use "1000 free credits" (owner direction 2026-07-19: the number means nothing to a stranger).
- Positioning: does the hero address the three main audiences (founders / quantified-self / AI-agent-builders), or only one?
- Social proof: any user count, live data, quote, or logo? If not, note it.
- Footer: are `/terms` and `/privacy` linked?
- Link preview test: fetch `/` HTML, grep for `og:title`, `og:description`, `og:image`, `twitter:card`. Missing tags → dead link previews.

### 2. Signup (email path)

URL: `/signup`

**Check:**
- Is the password-confirm field present? (deprecated UX)
- Is the consent checkbox required and linked to `/terms` + `/privacy`?
- Is the 1000-credit hook mentioned before the user commits?
- Does submit actually work? Watch for network 4xx.

### 3. Consent page

URL: `/consent` (redirected if `consentedAt` is null)

**Check:**
- Does the page explain what you're consenting to in plain language?
- Is the "Accept" button the primary action?
- Is there a visible way to back out? (should not be trapped)

### 4. Profile setup

URL: `/profile/setup` (or wherever the first-time name entry is)

**Check:**
- Is display name asked for, separately from email? (current code hardcodes `name = email`)
- Is there any personality (welcome copy, what's next), or is it bare?

### 5. Workspace creation

URL: `/workspaces/new`

**Check:**
- Template variety: startup / personal / blank is the menu. Do the options cover "AI agent evaluation," "research project," or "community goal"? Note any missing personas.
- Is the "what happens next" explained? (Markets being created, credits being spent, bots being invited)
- Does the action complete in under 5 seconds?

### 6. Check-in page (post-creation)

URL: `/check-in?welcome=1`

**Check:**
- Is the 13.5-credit seed-liquidity deduction surfaced, or silent? (spec: should show a receipt)
- Is the "bots will start trading within 5 minutes" promise visible? (spec: should be a banner)
- What happens if the user leaves now? Is there a reason to come back?

### 7. Metrics page (first real view)

URL: `/metrics`

**Check:**
- Does the page show recent bot activity / consensus movement, or is it static?
- Are the 27 markets discoverable, or buried?
- Is there any "your agents are waking up" indication?

### 8. Marketplace (accessible)

URL: `/marketplace`

**Check:**
- Does "Your accessible markets" render the new workspace?
- Is the Share button visible and functional? Click it; confirm clipboard received the URL or native share sheet opened.
- Does the shared URL (`/marketplace?workspace=<id>`) filter the public list to that workspace when opened in an incognito context?

### 9. Marketplace (public, incognito)

Open the shared URL in an incognito context (`$B stop` to drop cookies, then `$B goto <shared-url>`).

**Check:**
- Does the page sell the product to a cold visitor? (It's the landing for shared links.)
- Is there a clear Sign-up CTA for non-authenticated visitors?
- Is the workspace-filter query param honored?

### 10. Return visit (email)

**Check:**
- Did the user receive a welcome email? (spec: they should. Today: no email system wired.)
- Did the user receive any notification of bot activity? (today: no.)

## Outputs

After each run, append a brief dated entry below with: env, screenshot dir, friction found, and any regressions.

## Run log

<!-- Append entries here, newest first -->

### 2026-04-19, prod, `flow-audit-1776625883@integration.test`

Walked all 10 steps via `$B`. Highlights:

**Working well:**
- OG/Twitter meta tags live on prod (title, description, image, card).
- Share button on `/marketplace` accessible-workspace header copies `https://telarchy.com/marketplace?workspace=<id>` via `navigator.share` or clipboard fallback; query param pre-fills search.
- Live-stats widget pulls real numbers (280 markets, 18 agents, 706 trades this week).
- Closed bot loop confirmed end-to-end: signed up a fresh account, created the Audit Co workspace, and within ~4 minutes an anchor bot had already moved "Weekly revenue 2026-W20" from 50000 → 45500. Zero manual intervention.
- Signup → workspace creation → check-in → metrics path has no dead ends.
- Balance-visible hint: 986.50 credits = 13.5 credits silently spent seeding 27 markets (proves auto-fund is working, but the spend is invisible to the user).

**Friction found, added to `mvp-launch-backlog.md`:**
- Signup: password-confirm field, no 1000-credit hook, no display-name field.
- Check-in welcome page: no credit-balance surface, no "bots will trade in ~5 min" banner, no "27 markets created" receipt.
- Metrics page: Outlook values render but no drill-down to the per-period markets.
- Markets page: "Hooks: offline" red dot reads as "your account is broken."
- Marketplace cold-visitor view: no headline pitch explaining Telarchy above the market list.
- Marketplace header shows 32-char trader id instead of a friendly name.

**False alarm corrected:** initial screenshot showed stats at 0/0/0 but that was just `useCounter` frame-0 animation; real values appear within 1.6s.

**Screenshots:** `flow-audit-20260419/` (gitignored).
