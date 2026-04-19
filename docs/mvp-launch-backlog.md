# MVP launch backlog

Last updated: 2026-04-19

Captured from a first-user-flow audit of telarchy.com production (signup → workspace creation → bot trading → marketplace share). The legal floor, 1000 seed credits, and the closed bot-trading loop are already in place. The items below are the remaining gaps between "works" and "strangers want to sign up and tell their friends."

Items are grouped by theme. Focus is on fixing current friction before chasing scale features (referrals, email infra, pricing, per-market OG images are deferred).

## Activation / onboarding

- **No email lifecycle**. There is no welcome email, no "your first forecast landed" email, no day-3 re-engagement, nothing. BetterAuth has the address; wire one transactional provider (Resend, Postmark) and send at minimum: welcome (with the workspace URL), first-bot-trade (with the consensus delta), and a 72h check-in nudge.
- **Signup friction**. `SignupPage.tsx` still has a password-confirm field (deprecated UX; show/hide toggle is better) and hardcodes `name = email`, which then renders the full email as personalization across the app. Drop confirm, ask for a display name.

## Landing / positioning

- **B2B-only framing**. `LandingPage.tsx` leads with "AI forecasts on your company goals", which is narrow. Quantified-self, AI agent builders, and researchers all bounce. Add a second surface (or a rotating subhead) aimed at individuals: "or track and forecast your own life."
- **No pricing**. There is no `/pricing` page, no mention that the managed instance is free, and no hint of what (if anything) will eventually be paid. Even a one-liner "Free while in beta. Self-host forever." removes a common bounce reason.
- **No quote / no logo / no screenshot**. Counters are live, but there's still zero human social proof. One early-user quote (even anonymized) would beat the counter by a mile.

## Product surface

- **Templates are too narrow**. Workspace creation offers `startup` or `personal` or blank. Researchers, teams tracking AI agent performance, and goal-tracking communities don't see themselves. Add at least: "AI agent evaluation," "research project," and "community goal."
- **504 instead of 404 on unknown API routes**. Cloud Run returns a 504 timeout on routes that don't exist instead of a clean 404. Makes integration look fragile. Add a catch-all 404 handler in `functions/src/app.ts`.
- **Sign-out flow is single-step but hidden**. Works via sidebar Logout, but `POST /api/auth/sign-out` returned 200 without clearing the cookie on the server (had to clear client cookies manually). Verify the BetterAuth sign-out actually invalidates the session server-side.

## Deferred to post-first-users

These are scale plays, not friction fixes, so they wait until early users actually need them.

- **Per-market OG image endpoint**. Static site-wide OG preview is the floor; dynamic `/og/market/:id.png` is gated on SSR or a render-to-PNG endpoint.
- **Shareable artifact after a trade or forecast** (one-click "Share this forecast" with the user's prediction embedded).
- **Referral hook** (500-credit bonus both sides). Needs a credit-grant audit trail before wiring to `/api/agents/:id/credit`.
