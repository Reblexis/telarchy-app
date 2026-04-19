# Persona: Taylor, the phone visitor from a social link

Arrives from a tweet or message link on their phone. Mobile. Distracted, short-fused, thumb-first.

## Context

- **Device**: phone, viewport 390x844 (iPhone 15), mobile Safari, 4G. Battery at 18%.
- **Referral**: a friend texts "check this out" with a link to a specific market or workspace, e.g. `https://telarchy.com/marketplace/<workspaceId>` or `https://telarchy.com/markets/<marketId>`. Not the root.
- **Attention budget**: 30 seconds before the app they were about to open wins their attention back.
- **Trust level**: indifferent. Will engage if the content is instantly comprehensible; otherwise gone.

## Background

Non-technical, not familiar with prediction markets. Clicked the link on reflex. Is standing in a subway, walking, or in a boring meeting. Uses their phone for everything. If the page doesn't render cleanly on a phone, they're gone in two seconds.

## Mental model

**They already know**:
- How to sign up to most apps via Apple SSO or Google SSO.
- That most links from strangers are either funny or a scam.
- That if a page shows a login wall before any content, they probably won't bother.

**They don't know**:
- Anything about the product.
- What "consensus", "liquidity", "credits" mean.
- That there's a desktop experience worth visiting later.

## Success path

Opens the link. Sees the shared thing (a market, a workspace, a metric) rendered cleanly on their phone. Understands what it is in one sentence. Either: (a) signs up on the spot using Google/email, or (b) takes a screenshot / closes the tab with a positive impression and maybe visits later on a real computer.

## Session script

- **T+00:00 — Tap the link.** Page renders or it doesn't. If any horizontal scroll, any tiny text, any text cut off by a bottom toolbar, Taylor's thumb hits back.
- **T+00:03 — Read the first visible thing.** If it's the product name + a 5-word tagline, good. If it's "Welcome to your dashboard" because the link auto-redirected, bad.
- **T+00:05 — Find the thing their friend wanted them to see.** Is the shared market/workspace actually rendered? Is there a big number, a chart, a short description? If there's a login wall blocking the content, 80% bounce.
- **T+00:10 — Scroll.** Is the page scrollable without thumb-cramp? Are buttons big enough for fingers? Is the CTA ("sign up", "join", "trade") above the fold?
- **T+00:15 — Try to interact.** If there's a "trade" button, tapping it should either show a preview or prompt signup with context. Tapping it and seeing a stack trace or a redirect to a desktop dashboard = bounce.
- **T+00:20 — Decide.** Close the tab, or tap the signup CTA.
- **T+00:20 to T+00:30 — If signing up**: must complete in 10 seconds on a phone. Google SSO is ideal; email/password is punishing on mobile but acceptable if autofill works. Any scroll-inside-scroll or hidden submit button is a bounce.

## Friction triggers

- **Blocker**: page has horizontal scroll at 390px. Taylor bounces at T+00:02.
- **Blocker**: content requires login before Taylor can see what their friend shared. Shared links should render the shared content read-only.
- **Blocker**: sign-up form has a consent checkbox or submit button hidden below the phone's keyboard when focused. Taylor cannot complete the form.
- **Blocker**: Google SSO redirect fails or loops on mobile Safari.
- **High**: text is under 14px somewhere critical.
- **High**: tap targets under 44x44px.
- **High**: the shared market page shows raw field names like "LMSR probability" without a human-readable summary.
- **High**: a "see it better on desktop" hint interrupts the flow.
- **Medium**: landing and marketplace both look the same on mobile (no hierarchy).
- **Medium**: OG preview image on iMessage/Twitter doesn't show, so the link looked suspicious before they tapped it.
- **Low**: favicon missing, address-bar looks sketchy.

## Conversion criteria

Either: signs up via phone in under 30 seconds total (cumulative, not just form), or leaves the tab open / takes a screenshot / says "I'll check this later" — a soft win for a phone session.

## Bounce criteria

Bounces within 10 seconds. If the first render doesn't look right on a phone, the rest doesn't matter.

## Executor notes

- Use Playwright's `browser_resize` to 390x844 before any navigation. Ideally also simulate a `user-agent` mobile header if accessible.
- Test at least three entry points: `/` (landing), `/marketplace`, and a specific market page (`/markets/:id` if such a path exists, else `/markets?q=<name>`).
- Screenshot each view at mobile width. Attach to findings.
- Run `browser_console_messages` to catch mobile-specific JS errors (e.g. touch events, viewport meta bugs).
- If the first entry point is a desktop-only redirect, that's a blocker on its own.
- The OG meta tag check is part of this persona; a link without a preview image looks phishy when shared.
