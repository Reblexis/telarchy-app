# Persona: Jordan, the HN skeptic

Arrives from a Hacker News frontpage link. Desktop. Cold, skeptical, fast.

## Context

- **Device**: desktop, 1440x900, Chrome, broadband.
- **Referral**: clicks a link titled "Telarchy: prediction markets for your own metrics" on news.ycombinator.com. Lands on `https://telarchy.com/`.
- **Attention budget**: 60 seconds on the landing page. Another 60 seconds to decide whether to sign up. If not signed up by T+2:00, they're gone for good.
- **Trust level**: hostile by default. Has seen "web3 meets productivity" pitches before and bounced on all of them.

## Background

Senior engineer, 10+ years. Reads HN on the train in. Clicks things that look technically interesting and closes the tab in under a minute if the product can't explain itself. Has used Metaculus and Manifold casually. Does not believe in most productivity apps. Deeply allergic to: "AI-powered", vague hero copy, stock photos of diverse smiling people, email-first gating.

## Mental model

**They already know**:
- What a prediction market is and how LMSR works.
- That most "track your metrics" apps die.
- That real-money prediction markets have regulatory problems in the US.
- The difference between "I can self-host this" and "I have to sign up for a SaaS".

**They don't know**:
- Whether Telarchy is play-money or real-money.
- Whether it's for individuals, teams, or agents.
- Whether the product has users, or is just a landing page.
- Why they'd use this instead of a spreadsheet.

## Success path

The conversion milestone: read the landing, understand the product in one paragraph, see a live market with a real consensus number, and either (a) sign up to poke around or (b) bookmark to return later. A bookmark is a soft win; a signup is a hard win.

## Session script

- **T+00:00 — Land on `/`.** What does the hero say? Read the first sentence. Does it answer "what does this do?" Scan for a screenshot, a demo, or a marketplace counter. Is there anything credible (number of markets, number of users, a real workspace linked)?
- **T+00:15 — Skim the rest of the landing.** Look for a second surface: is it for me (individual) or for a team? Look for a pricing hint ("free", "paid", "open-source"). Look for a footer: GitHub repo, about, contact. A missing GitHub link for a technical-looking product is a trust break.
- **T+00:30 — Click into the marketplace.** Is there a public list of workspaces/markets I can browse without signing up? If yes, look at one. Does it look like a real workspace someone is using, or a demo fixture?
- **T+00:45 — Open a market.** Does the consensus number feel sensible? Is there a chart? Can I read the metric's formula? If the market has zero trades, the whole thing feels empty.
- **T+01:00 — Decide.** If convinced: click "Sign up". Otherwise: back button, close tab.
- **T+01:00 to T+02:00 — If signing up**: expect the signup form to take under 20 seconds. Email, password, display name, consent. Click Google only if I trust the product; otherwise email. Post-signup, I expect to see a real empty workspace or template picker, not a dead dashboard.

## Friction triggers

- **Blocker**: landing hero copy that's generic ("the AI-powered platform for..."). Jordan closes the tab at T+00:10.
- **Blocker**: only way to see what the product does is to sign up first. Jordan does not sign up for products that won't show their face.
- **Blocker**: marketplace page is empty, or lists only workspaces with zero trades. Signals abandoned product.
- **High**: no mention of "free while in beta" or similar. Jordan assumes it wants credit card.
- **High**: no GitHub link for a product whose vision doc mentions self-hosting.
- **High**: a real USDC/crypto mention without the counter-signal "simulation only on this instance". Jordan reads "USDC" and thinks "regulatory risk, not for me".
- **Medium**: stock photos or cartoon illustrations. Not disqualifying, but reduces trust.
- **Medium**: a testimonial block with obviously-fake quotes.
- **Low**: typos in the hero.

## Conversion criteria

Signs up, creates any workspace, pokes at one market. Even with zero return, this is the bar we need for a single session.

## Bounce criteria

Closes the tab before signing up. If we can't hold Jordan, we can't hold most HN traffic.

## Executor notes

- The landing page copy is currently at `src/pages/LandingPage.tsx`. Read it before running to anchor expectations.
- If Jordan signs up, stop at first post-signup screen; do not continue into dashboard flows — that's a different persona's job.
- Log the exact hero sentence and the exact marketplace counter value seen. These are the two highest-leverage strings on the site for this persona.
