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
