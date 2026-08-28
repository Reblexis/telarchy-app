# Decisions: docs/liquidity-purchases.md

## 2026-08-28: paid liquidity ships env-gated (owner decision)

**DONE 2026-08-28 (Viktor, "4. yes add that support" and "now that i thnk
about it i gues only global pool can prevent gaming of profits"):** owners
buy market liquidity via Stripe Checkout; credits are minted into the
workspace's open market pools only (no balance path); revenue sizes the
next season's global pool via the published formula; the feature is
disabled until Stripe secrets exist (no Stripe account yet; which entity
signs is a counsel question). Provisional price $1 = 100 pool credits and
k = 0.5, both still owner-unconfirmed. Global pool over per-workspace
pools per the owner's reasoning plus the custody/money-transmitter
argument recorded in the telarchy umbrella,
notes/trader-rewards-design-2026-08-28.md (owner decisions section).
Implemented SDK-free (one form POST + one HMAC verify).

## 2026-08-28: the two-currencies model (owner decision)

**DONE 2026-08-28 (Viktor, verbatim):** "well what has to happen is that
they will have two currencies if its they buy liquidity currency the
liquidity currency shows up and they can use that currency when injecting
liqudity in individual markets.. it should be as simple as taht no
complicated ui aroudn it yet.. just the liquidity option is there and then
they can press buy liquidiyt credits somewhwer and that leads them to
specifying package and then to checkout". Supersedes the auto-spread
fulfilment shipped hours earlier: a purchase now credits the buyer's
walled liquidity wallet (agents.liquidity_balance), the injection endpoint
spends the wallet first, LP leftovers route back to the purse that funded
them (liquidity_events.funded_from), and the v1 UI is exactly a wallet
line plus a Buy button (package -> Stripe checkout) in the account dialog.
This also settles the funding-canvas open decision toward owner placement.
