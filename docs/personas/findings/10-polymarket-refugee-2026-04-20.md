# Persona findings: Kai, the Polymarket refugee
Date: 2026-04-20. Executor: Claude. Budget: 3 min. Used: ~3 min.

## Outcome
Bounce (graceful). Kai correctly reads the product as "metrics futarchy, play money only on managed" and closes the tab. No trust break. If the product is later positioned to this audience, the play-money framing is clear enough to survive a Polymarket-user smell test.

## Session log
1. T+00:00 — Land on `/`. Hero says `Telarchy: AI forecasts on your goals`. Scan for "USDC", "wallet", "deposit", "KYC" in first viewport. None found. The illustration shows "Monthly Revenue $146K predicted by 6 competing agents" — $ is a unit on the *predicted quantity*, not a stake/price. `1000 free credits on signup. No credit card required.` appears twice on the page. Kai reads this correctly: play money.
2. T+00:30 — Click into `/marketplace`. 28 market cards rendered. Prices shown as `50%` (probability) and `5.00 (of 0–10)` (consensus). No `$` used as currency. No "trade" button pre-signup; only "Join workspace". Kai sees a small but real-looking set of markets across a handful of workspaces.
3. T+01:00 — Check `GET /api/public-config` (technical users look under the hood). Returns `{"usdcSettlementEnabled":false}`. Matches the site's framing.
4. T+01:20 — Attempt deposit to see if the path is cleanly blocked: `POST /api/agents/me/deposit {txHash:"0xfake"}` returns HTTP 503 `{"error":"USDC settlement is disabled on this instance. Credits on this instance are for simulation and have no redemption value."}`. Error is informative, not generic. AccountPage-side: the UI only renders Deposit/Withdraw/Wallet sections when `usdcSettlementEnabled` is true (`src/pages/AccountPage.tsx:245,269,295`), and a persistent note "Credits on this instance are for simulation and have no redemption value." appears when it's false.
5. T+02:00 — Sign up as `qa+10-<ts>@example.test`, consent, upsert profile. Fresh user gets 1000 credits (`GET /api/auth/me/export` shows `balance: 1000000000000` units = 1000 credits). Join the first public workspace via `POST /api/workspaces/:id/join` → 201, role "member".
6. T+02:30 — Place a trade: `POST /api/predictions/trade {marketId, direction:"higher", amount:1}` returns `{tradeId, shares:1.40, cost:1.00, probability:0.875}`. Trade succeeds, probability moves from 50% to 87.5% on a 1-credit trade. That's a useful data point: market liquidity is extremely thin.
7. T+03:00 — Close tab. Kai's conclusion: "It's a forecasting sandbox with low liquidity, not an orderbook. Not what I want right now, but intentional and honest."

## Friction found
- [medium] F1 — Landing hero illustration uses `$146K`, `$612K`, `$775K` as sample values for `Monthly Revenue`. On a 2-second skim a Polymarket user could briefly read this as market prices. Mitigated by the immediate-next surfaces ("predicted by 6 competing agents" and "1000 free credits on signup"), but a crypto user's first instinct is that `$` = settlement currency. Optional: swap to a non-dollar metric or explicitly label as "example revenue".
- [medium] F2 — New users land with 1000 credits, a participant, and zero workspace memberships. They must discover "Join workspace" on `/marketplace` to trade. For a crypto user who expected "sign up → deposit → trade", the detour is unexpected. Easy fix: after signup, route directly to `/marketplace` (or a "Choose your first workspace" onboarding) rather than `/create-workspace`. Today the landing-page post-OAuth effect sends them to `/create-workspace`, which tells them to *build* a product instead of *use* one.
- [medium] F3 — Extremely thin liquidity on most public markets (1-credit trade moved probability from 50% to 87.5%). For Kai this looks like an empty casino; a single agent can dominate. Not a bug of the consent/legal surface, but the product-level "is this alive" signal is weak for small public workspaces. Increasing default liquidity or exposing a "volume traded" number on each marketplace card would help. Related to retracted finding 16 (seed-marketplace; prod has more variety than localhost).
- [low] F4 — No leaderboard of top agents. Kai would look for one to calibrate whether the forecast layer is any good. Matching `docs/roadmap.md` intentional deferral; flag only.
- [low] F5 — The play-money framing is correct in the product but not loud on the landing page. Kai only sees "1000 free credits" as the signal. A Polymarket user might not recognize this as non-redemption; a one-liner like "Play-money simulation — no real-money deposits on this instance" somewhere in the hero or FAQ would foreclose the question.

## What worked
- `usdcSettlementEnabled` flag is plumbed correctly: `/api/public-config` reports it, `AccountPage.tsx` gates all three USDC-related UI sections on it, and the deposit endpoint returns a clear 503 with an informative message when disabled.
- No `$` is used as currency anywhere on `/marketplace`. Prices are in credits or percent.
- Fresh signup gets 1000 credits *immediately*, no email-verification gate, no waitlist. The trading path from signup → trade takes ~4 API calls.
- Deposit error message explicitly names "simulation" and "no redemption value" — a Polymarket user would read this and not try again.

## Would they come back?
Soft maybe. Not today; Kai wants an orderbook and real stakes. If the product later publishes a self-hosted image with USDC settlement enabled (per `docs/vision.md`), Kai might come back to run their own node. Today they leave with an accurate mental model and no grievance.

## Recommended changes
- [medium] Route post-signup to `/marketplace` rather than `/create-workspace`. Users who signed up from a marketplace-shaped pitch want to trade first, build later. Captures Kai, the agent-developer persona 3, and any other "I want to use this, not build it" segment. Makes the creator-first `/create-workspace` an opt-in from the marketplace or account menu.
- [low] Add a one-liner in the landing FAQ or footer: "Credits are play money on this instance; no real-money deposits or withdrawals." Removes the last drop of ambiguity for this persona.
- [low] Consider replacing the `$612K / $775K` Revenue example with a non-dollar quantity or prefixing with "Example:" so a crypto-skimmer doesn't see dollars and think "real stakes".

## Console / network anomalies
- Console: 0 errors on `/`, `/marketplace`, account-flow.
- Network: zero third-party hosts. Consistent with Privacy Policy claim.
- One API behavior worth noting: `/api/predictions/trade` returns `HTTP 400 "Provide {targetValue, maxBudget}, {direction, amount}, or {direction, sellShares}"` on malformed payload. Helpful message; not a finding.
