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

## 2026-08-29: the wallet leaves account settings (owner decision)

**DONE 2026-08-29 (Viktor, verbatim):** "liquiidty creddits purchase should
definitely not be in acccount settings figure out a better design using
/design how they appear and at what point.." The v1 buy flow shipped in
Account > Money on 2026-08-28; it is removed here, plumbing kept (wallet
column, spend-first injection, refund routing, checkout endpoint, the
liquidityBalance field on the balance endpoints).

Where it goes instead, designed on
https://claude.ai/code/artifact/b8d1b6d1-1fdb-42a6-b084-f77424d50e09:
the wallet appears where depth is SPENT (the owner's own floor in manage
mode: a liquidity strip beside markets that each show their depth), and
the purchase appears at the MOMENT OF SHORTFALL, inside the deepen sheet
that needed it (packages inline, Stripe, back to finish the injection);
add-a-date pays a new market's opening depth from the same wallet. Nothing
liquidity-shaped appears in account settings, and nothing appears for a
visitor or a pure trader. Building it belongs with manage mode
(branch owner-metrics-screen), which owns the floor's owner controls.
