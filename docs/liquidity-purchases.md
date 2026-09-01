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

1. **Walled wallet.** A purchase credits the buyer's LIQUIDITY WALLET
   (`agents.liquidity_balance`, the second currency; owner decision
   2026-08-28): spendable only as market-pool injections, never tradeable,
   never transferable, and LP leftovers from wallet-funded injections
   return to the wallet (`liquidity_events.funded_from` routes them).
   There is no path from a payment to the tradeable balance.
   **Every decision to fund a market counts the wallet**, in the order the
   injection spends it (wallet first, then tradeable):
   `liquiditySpendableUnits`, used by auto-fund and by the conditional
   pair subsidy. A gate that reads `balance` alone leaves the house
   spawning dead markets while sitting on pool money it will not look at
   (owner report 2026-08-30, after granting the admin account 1,000,000
   liquidity credits).

   **The wallet is DRAINED before the tradeable balance is touched**
   (owner ask 2026-08-30, verbatim: "liquidity credits should be
   prioritized and the standard ones only used when no liquidity credits
   are left"). One contribution may therefore be part wallet, part
   balance, and then it writes one `liquidity_events` row per purse, which
   is what keeps the leftover router honest: it groups by
   `funded_from`, so each part returns to the purse that paid it and
   bought credits still never become stake. Before this, a wallet that
   could not cover the WHOLE contribution was skipped and the tradeable
   balance paid all of it, leaving bought credits unused.

   **Whether the tradeable balance may finish the job is the account's
   own setting**, `agents.pool_from_balance` (Account -> Money, "Spend my
   trading credits once my liquidity credits run out"; `poolFromBalance`
   on `POST /api/auth/profile`). Default TRUE, which is what every account
   did before the setting existed: defaulting it off would silently stop
   auto-funding for owners who never bought liquidity credits and their
   markets would open dead. Turned off, an injection that outruns the
   wallet is refused rather than reaching into trading credits, and the
   funding gates count the wallet alone.
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
  $5,000, manage capability + a participant identity): records a pending
  purchase and returns a Stripe Checkout URL. The line item carries a product
  tax code (`STRIPE_TAX_CODE`, default `txcd_10000000`, "General -
  Electronically Supplied Services"), which Managed Payments requires and
  only asks for in live mode.
- Stripe returns the payer to the funding page of the workspace they bought
  for, `/<floor>/funding?liquidity=purchased` (or `=cancelled` when they back
  out), never to the operator door. That page is where they started, it is
  where the wallet they just filled is shown, and it is the only screen that
  can say what landed; the return target is derived from the workspace, not
  taken from the request, so no caller can aim it elsewhere.
- The returned page says the payment arrived and keeps looking until the
  credits do. Stripe's redirect races its own webhook, so a wallet that has
  not moved yet is normal for a second or two and the page says so rather
  than showing an unchanged number with no explanation; a cancelled return
  says only that nothing was charged.
- Stripe calls `POST /api/stripe/webhook` (raw body, signature verified,
  no other auth; the route picks its store from the request host, because it
  is mounted before the swap that does it for everything else, and a purchase
  rehearsed on the candidate belongs to the beta store). On `checkout.session.completed` with `payment_status:
  "paid"` (or `async_payment_succeeded`), the purchase is fulfilled
  idempotently: its credits land in the buyer's liquidity wallet. Placing
  them is the owner's hand on the floor: the market liquidity endpoint
  spends the wallet first whenever it covers the whole amount.
- `GET /api/workspaces/:id/liquidity/purchases` lists a workspace's
  purchases; `GET /api/liquidity/revenue` (platform admin) totals completed
  revenue over a window.

## Where the wallet is visible

Beside the balance in the top bar: the same drop the market's pool rows wear,
the number, and a plus that goes to the funding page (owner ask 2026-09-01,
"liquidity credits are not shown anywhere"). Two purses, so two chips, never
one sum: the balance trades, the wallet can only ever go behind a market.

It is shown to anyone holding some, and to anyone who could put some behind
the market they are standing on, for whom an empty wallet still has the plus
to offer. Standing on a market it leads to that market's funding page;
anywhere else, to the operator door, since a funding page needs a market to
fund. The account panel says it in words beside the other two figures.

## Where an owner buys

`/<floor>/funding` (`src/pages/FundingPage.tsx`), reached from the Buy
affordance beside Inject on any open market and open only to someone with
`manage` on that floor. It shows the liquidity wallet, the count of open
markets the credits can go into, the buy field with $25/$50/$100/$250
presets, and the workspace's past purchases. Its copy carries invariants 1
and 2 above in plain words, so nobody pays before knowing that credits reach
pools and never a balance, and that buying is not season entry. An instance
with no Stripe secrets shows the server's own 503 sentence rather than a
button that silently fails. Placing the credits is a separate act on the
floor (`docs/owner-on-the-floor.md`).

## Pricing

**$1 = 1,000 credits of pool liquidity** (`LIQUIDITY_CREDITS_PER_USD`,
per-instance env), the owner-confirmed number (2026-08-26, liquidity
funding design; it supersedes the earlier provisional 100). The rate is
stamped on each purchase row at creation, so a price change never rewrites
an old purchase.

## Revenue, and what it does not buy

Completed purchases are the platform's liquidity revenue, and their
trailing-30-day sum is public as `revenue30dUsd` on
`GET /api/marketplace/stats`: it is what the floor's "Telarchy revenue (USD)"
metric settles on, so the buyers of the service and the traders pricing it
read the same number (docs/metrics.md, "Revenue, trailing 30 days").

**A payment buys liquidity credits and nothing else.** It is not a share of a
prize, not an entry, and no formula binds a season's pool to it. Telarchy
sizes each season's prize itself, before that season opens, out of its own
funds (ToS 3a), and revenue is one input among several rather than a
promise: what a month took in does not fix what the next season pays. That
is what keeps the platform a contest operator rather than a holder of
somebody else's money, and it keeps prize sizing free to answer how many
seasons run, how long they are, and where the money does the most good
(owner decision 2026-08-30, superseding the provisional
`pool(N+1) = max(pool(0), k x revenue(N))`).

A running season's pool never moves. `GET /api/liquidity/revenue` reports
what came in, for the books, not for a payout rule.

## Enablement

Env-gated like USDC settlement: without `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` every purchase surface answers 503 and the instance
sells nothing. That stays the default, and the right state for anyone
self-hosting.

On telarchy.com the pair lives in Secret Manager and is mounted by the
candidate deploy, so it reaches the published revision and never a branch
preview: the webhook that credits a purchase is registered against one URL,
and a preview taking a payment nothing credits is worse than a preview that
refuses. Both secrets are `:latest`, so a key rotation is a new secret
version plus a redeploy, never a workflow edit.

**telarchy.com takes real cards** (live account `acct_1UAC7ZEilg3s7qOW`,
"Telarchy", CZ, Managed Payments so Stripe is merchant of record and carries
the VAT on cross-border digital sales, Radar Lite). The live pair is version
2 of both secrets and the live webhook endpoint is
`https://telarchy.com/api/stripe/webhook`.

The sandbox account is version 1 of the same two secrets, kept for rehearsal:
pointing the test endpoint back at the candidate and rolling both secrets to
version 1 puts an instance in test mode, where only `4242 4242 4242 4242`
pays. Either direction is the same three moves, in this order, because a
webhook secret belongs to its endpoint and an endpoint belongs to its mode:
register the endpoint for `checkout.session.completed` and
`checkout.session.async_payment_succeeded`, add the key and that endpoint's
`whsec_` as new secret versions, then redeploy so a revision starts with
them (`:latest` is read when a revision starts, never after).

One number is worth knowing before rehearsing anything against production: a
completed purchase enters `revenue30dUsd`, which is the settlement source of
the public "Telarchy revenue (USD)" market, so a test payment there would put
money that does not exist into a number other people are trading.
