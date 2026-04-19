# MVP launch backlog

Last updated: 2026-04-19

Captured from a first-user-flow audit of telarchy.com production (signup → workspace creation → bot trading → marketplace share). The legal floor, 1000 seed credits, and the closed bot-trading loop are already in place. The items below are the remaining gaps between "works" and "strangers want to sign up and tell their friends."

Items are grouped by theme and prioritized roughly by ROI on acquisition + retention. #1 (OG/Twitter meta tags + share button) is being handled alongside this doc; everything else is queued here so it isn't lost.

## Viral loop

- **Per-market OG image endpoint**. Static site-wide OG preview is the floor; the real unlock is `/og/market/:id.png` (or SSR) that renders the metric name, current consensus, and target date into a Twitter-friendly card. Today the SPA can't emit per-page meta tags, so a link to a specific market previews as the site default.
- **No shareable artifact after a trade or forecast**. After a user places a trade or sees a surprising consensus, there's nothing to screenshot, no "copy my forecast" link, no auto-generated card. Add a one-click "Share this forecast" that copies a URL with the user's prediction visible.
- **No referral hook**. If an existing user invites a friend, neither side gets a benefit (credit bonus, named attribution, badge). A 500-credit referral for both sides would cost nothing and gives a reason to send the link.

## Activation / onboarding

- **Invisible "bots are coming" moment**. New workspace creation silently enqueues bot trading but the UI never signals it. Within 5 minutes bots arrive and move consensus, but if the user has closed the tab they miss it. Show a visible "Bots will start trading within 5 minutes" banner on the metrics page right after workspace creation, and render a subtle activity indicator when the first bot trade lands.
- **Silent 13.5-credit deduction on workspace creation**. The startup template creates 27 markets at 0.5 credits each. The user sees their 1000-credit balance drop to 986.5 with no explanation. Show a one-line receipt on the check-in page: "13.5 credits reserved as seed liquidity for 27 markets."
- **No email lifecycle**. There is no welcome email, no "your first forecast landed" email, no day-3 re-engagement, nothing. BetterAuth has the address; wire one transactional provider (Resend, Postmark) and send at minimum: welcome (with the workspace URL), first-bot-trade (with the consensus delta), and a 72h check-in nudge.
- **Signup friction**. `SignupPage.tsx` still has a password-confirm field (deprecated UX; show/hide toggle is better) and hardcodes `name = email`, which then renders the full email as personalization across the app. Drop confirm, ask for a display name.
- **Seed 1000 credits is invisible pre-signup**. The landing page never mentions that new accounts get 1000 free credits. This is the single best hook and it's buried until after account creation. Put "Get 1000 free credits" on the primary CTA.

## Landing / positioning

- **B2B-only framing**. `LandingPage.tsx` leads with "AI forecasts on your company goals" — narrow. Quantified-self, AI agent builders, and researchers all bounce. Add a second surface (or a rotating subhead) aimed at individuals: "or track and forecast your own life."
- **No pricing**. There is no `/pricing` page, no mention that the managed instance is free, and no hint of what (if anything) will eventually be paid. Even a one-liner "Free while in beta. Self-host forever." removes a common bounce reason.
- **No social proof**. No user count, no quote, no logo, no screenshot of a real consensus forming. A single live-data widget ("Telarchy agents have placed N trades across M workspaces") using the existing `/api/status` endpoint would cost nothing and make the page feel alive.

## Product surface

- **Templates are too narrow**. Workspace creation offers `startup` or `personal` or blank. Researchers, teams tracking AI agent performance, and goal-tracking communities don't see themselves. Add at least: "AI agent evaluation," "research project," and "community goal."
- **504 instead of 404 on unknown API routes**. Cloud Run returns a 504 timeout on routes that don't exist instead of a clean 404. Makes integration look fragile. Add a catch-all 404 handler in `functions/src/app.ts`.

## Deferred, but worth noting

- Dynamic OG (per-market, per-workspace) is gated on SSR or a render-to-PNG endpoint; not a single-commit fix.
- Email infra pulls in a provider dependency and a template repo — scope it carefully when picked up.
- Referral system needs a credit-grant audit trail; don't wire it to `/api/agents/:id/credit` without a reason code.
