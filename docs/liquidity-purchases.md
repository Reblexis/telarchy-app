# Paid market liquidity

The one path by which real money enters the managed instance: a workspace
manager buys pool liquidity for their own markets. This document governs the
behavior; the legal shape it implements is the approved real-money design in
the telarchy umbrella (`notes/real-money-economy-design-2026-08-26.md`,
approach A) and the trader-rewards design
(`notes/trader-rewards-design-2026-08-28.md`).

## What is sold, and what is not

A liquidity purchase is a non-refundable service: sharper prices on the
buyer's own markets. It is never a credit sale. Three invariants keep that
true, and every change to this feature must preserve all three:

1. **Pool-only.** Purchased credits are minted directly into market pools
   (`applyMintedLiquidityInjectionTx`, which has no balance write and no
   credit-ledger row) and reach an account balance only through market
   payouts under the published scoring rule. There is no path from a
   payment to a balance.
2. **Whoever pays cannot win.** Buying requires the `manage` capability in
   the target workspace, and accounts that own or administer a public
   workspace take no season payout under strict eligibility
   (`docs/seasons.md`, Eligibility). The payment therefore never buys
   contest standing.
3. **No per-credit price for participants.** Credits remain unpurchasable
   and unredeemable (ToS section 2); the liquidity price is a price for a
   service delivered into pools, not an exchange rate for a currency.
   A per-credit exchange rate would make every market a real-money bet
   (telarchy umbrella, `notes/wheel-vs-proportional-legality-2026-08-28.md`).

## Flow

- `POST /api/workspaces/:id/liquidity/checkout { usdAmount }` ($5 to
  $5,000, manage capability): records a pending purchase and returns a
  Stripe Checkout URL. Refused (409) when the workspace has no open market
  to fund.
- Stripe calls `POST /api/stripe/webhook` (raw body, signature verified,
  no other auth). On `checkout.session.completed` with `payment_status:
  "paid"` (or `async_payment_succeeded`), the purchase is fulfilled
  idempotently: its credits are split EVENLY across the workspace's open
  markets (active, unresolved, unvoided) via price-preserving pool
  contributions, and the split is recorded on the purchase row
  (`allocation`).
- `GET /api/workspaces/:id/liquidity/purchases` lists a workspace's
  purchases; `GET /api/liquidity/revenue` (platform admin) totals completed
  revenue over a window.

## Pricing

**$1 = 1,000 credits of pool liquidity** (`LIQUIDITY_CREDITS_PER_USD`,
per-instance env), the owner-confirmed number (2026-08-26, liquidity
funding design; it supersedes the earlier provisional 100). The rate is
stamped on each purchase row at creation, so a price change never rewrites
an old purchase.

## Revenue and the season pool

Completed purchases are the platform's liquidity revenue. The published
season-pool formula sizes the next season from it:

```
pool(N+1) = max(pool(0), k x revenue(N)) + rollover(N)
```

with `pool(0) = 1000 USD` and `k = 0.5` (provisional, owner to confirm).
Revenue never moves a RUNNING season's pool; the formula is applied between
seasons, and `GET /api/liquidity/revenue` is its input. No purchase is
earmarked for prizes: revenue is service revenue, prizes are paid from
Telarchy's own funds (ToS 3a), which is what keeps the platform out of
holding anyone's money.

## Enablement

Env-gated like USDC settlement: without `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` every purchase surface answers 503 and the instance
sells nothing. telarchy.com stays disabled until the owner creates the
Stripe account under the paying entity (open question in the approved
design: Czech sole trader vs a US entity, a counsel question) and sets the
secrets.
