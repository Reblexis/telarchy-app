# Persona: Kai, the Polymarket refugee

Arrives looking for a prediction market they can trade on. Desktop. Crypto-native, impatient, expects real-money markets.

## Context

- **Device**: desktop, 1440x900, Brave browser with a wallet extension (Rabby). On a VPN.
- **Referral**: clicked a tweet saying "Polymarket alternative with agent trading". Lands on `https://telarchy.com/`.
- **Attention budget**: 3 minutes to decide whether this is a market they can actually deposit into. If yes: will attempt a deposit. If no: will leave, maybe loudly.
- **Trust level**: skeptical of anything that isn't on-chain, but curious about agent markets.

## Background

Trades on Polymarket, uses Manifold for fun, reads crypto-twitter. Expects order books, liquidity in USDC, one-click wallet connect. Does not care about "play money" unless there's a clear path to real money later.

## Mental model

**They already know**:
- What a prediction market is.
- What LMSR means, and that it's worse than an order book for big trades.
- What USDC, Base, and a wallet are.
- That "regulatory framing" matters; a US-incorporated prediction market that accepts real USDC without KYC is either illegal or restricted.

**They don't know**:
- That Telarchy is different (metrics, not events; futarchy, not betting).
- That the managed instance has USDC settlement disabled by default.

## Success path

Kai reads the landing, understands that the managed instance is play-money-only today, decides whether the product is interesting enough as a "capital-F Funny Money" sandbox to trade on, and either bounces gracefully or creates an agent and places a trade. A hard-win is an agent trading weekly; a soft-win is leaving with a correct mental model ("not a USDC market today, but intentional").

## Session script

- **T+00:00 — Land on `/`.** Scan for "USDC", "wallet", "deposit", "KYC". The absence of these words is a signal.
- **T+00:15 — Look at marketplace.** Check if markets have trade volume. If markets have zero volume and zero agents, Kai assumes dead product and bounces at T+00:30.
- **T+00:30 — Open one market.** Is there a "trade" button visible pre-signup? Is the price in credits or USD? If the price shows a $ sign, Kai expects real money.
- **T+01:00 — Click "sign up" or look for a wallet-connect button.** If there's a wallet-connect button on the managed instance, Kai expects it to work. A failed connect-or-deposit flow is worse than no button.
- **T+01:30 — Sign up** via email. Look for deposit flow. If UI still shows "deposit USDC" but backend returns 503, that's a trust break.
- **T+02:00 — If sign-up: try to trade.** Place a trade with seed credits. If seed credits are zero, Kai cannot trade and bounces.
- **T+02:30 — Decide.** If the platform is transparent about being play-money-only and the markets are actually interesting (forward-looking metric questions), Kai might stay. If it's ambiguous, Kai leaves.

## Friction triggers

- **Blocker**: landing or marketplace mentions USDC prominently without saying "settlement disabled on this instance". Kai tries to deposit, fails with a 503, rage-quits.
- **Blocker**: new user has 0 seed credits, no way to get more, cannot trade on anything. Nothing to do = bounce.
- **Blocker**: "deposit USDC" button visible in the account page but the endpoint returns 503 with a generic error.
- **High**: the word "real money" appears in marketing copy but the managed instance is play-money. Either strike the word or disambiguate.
- **High**: marketplace shows prices with a `$` sign when the currency is play credits.
- **High**: the public marketplace workspace list is dominated by test/demo workspaces with names like "Test", "aaa".
- **Medium**: no wallet-connect button at all is fine; a broken one is worse.
- **Medium**: Kai looks for a leaderboard of top agents and there is none.
- **Low**: the copy uses "LMSR" without explanation.

## Conversion criteria

Creates an account, registers an agent (via key or UI), places at least one trade using seed credits, and comes back within a week to see if the agent's balance changed. Soft win: leaves with an accurate mental model of the managed-vs-self-hosted play-vs-real split.

## Bounce criteria

Bounces if the site appears to promise real-money markets and then hides them. The worst outcome here is a public tweet calling the product "fake crypto".

## Executor notes

- Live files: `src/pages/LandingPage.tsx` (hero, marketplace stats), `src/pages/MarketplacePage.tsx`, `src/components/TopUpCreditsInstructions.tsx`, `src/pages/AccountPage.tsx`, `functions/src/routes/agents.ts` (USDC gate), `functions/src/routes/status.ts` (`usdcSettlementEnabled` flag).
- Check `GET /api/status` response for the `usdcSettlementEnabled` flag on the live instance. If it's `true` on the managed instance, the legal posture is wrong; if it's `false`, every UI deposit affordance must be hidden.
- Grep landing + marketplace for `USDC`, `real money`, `wallet`, `deposit`. Any match warrants inspection.
- Simulate a fresh signup and check the delivered initial balance. Zero seed credits with no path to earn means this persona cannot convert.
- Re-run after any change to the USDC gate, marketplace page, or landing hero.
