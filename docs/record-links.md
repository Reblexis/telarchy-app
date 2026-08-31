# Linking a forecasting record

A participant who already has a public forecasting record elsewhere is
worth more here than a fresh account, because that record is evidence
they can price a question. Linking one is an earn: it pays the price in
the earn table for that provider, once per participant and once per
external account across the whole platform.

This file is the contract. `docs/agent-economy.md` owns the earn table
itself; the pricing argument is the telarchy umbrella's
`notes/earn-table-design-2026-08-30.md`.

## The flow, which is the same for every provider

1. **Name the account.** `POST /api/import/:provider/start { handle }`
   looks the handle up on the provider's public API and answers with a
   one-time code.
2. **Prove it.** The participant puts that code anywhere in the account's
   public, self-editable text field (its bio) and presses verify.
3. **Verify and pay.** `POST /api/import/:provider/claim` re-reads the
   public profile, confirms the code is present, checks the record
   qualifies, and grants the earn. The code can come out of the bio
   immediately afterwards; nothing re-reads it.

The gates are checked at BOTH steps. At `start`, so nobody is sent to
edit their bio for a record that could never have been paid; at `claim`,
because the answer can change in between and only the second one decides
the money.

Ownership is proved the way a third party can prove it: the provider has
no OAuth for us, so a value only the account holder can publish is the
proof. Nothing is transferred and no credential is ever asked for.

## What every provider must supply

A provider is defined by five things. Adding one is adding this object,
a price row in the earn table, and its tests. Nothing else changes.

| | |
|---|---|
| `key` | url segment and earn key stem, e.g. `polymarket` -> `polymarket_link` |
| `label` | what a reader is told it is, e.g. "Polymarket" |
| `lookup(handle)` | a PUBLIC, UNAUTHENTICATED read returning a stable external id, the canonical handle, and the proof text |
| `proofField` | what the participant is told to edit, in their words: "bio" |
| `qualifies(record)` | whether this record is worth paying for, and if not, why in one sentence a person can act on |

**The external id is the identity, never the handle.** Handles are
rented, sold and renamed; the id is what goes into `earn_claims.ref_id`,
and it is that column's unique index that enforces one external account
paying once across the platform.

## What qualifies, and why it is never the money

A record qualifies on signals a farmer cannot concentrate: **how old the
account is, and whether it has really been used.** Never on balance,
volume or profit.

The reason is the 2026-08-30 Manifold decision generalised: mana, USDC
and positions all move between accounts, so any wealth-shaped signal is
exactly the one input a farmer can pool into a single fresh account and
sell back to us. Age and sustained activity cannot be pooled. A provider
that offers a profit figure may show it to a reader; it must not decide
the grant.

## Providers

### Manifold (`manifold`, live since 2026-08-10)

Lookup `GET https://api.manifold.markets/v0/user/<username>`; proof field
`bio`; id `id`. Qualifies on: not `isBot`, `createdTime` at least 90 days
ago, and either `lastBetTime` within 60 days or `creatorTraders` above
zero.

### Polymarket (`polymarket`)

Two public reads, both documented and explicitly unauthenticated:

- `GET https://gamma-api.polymarket.com/public-search?q=<handle>&search_profiles=true`
  finds the account, returning `name`, `proxyWallet` and
  `displayUsernamePublic`.
- `GET https://gamma-api.polymarket.com/public-profile?address=<proxyWallet>`
  returns `createdAt` and `bio`.
- `GET https://data-api.polymarket.com/traded?user=<proxyWallet>` returns
  `{ traded }`, the number of markets the wallet has traded.

Id is the `proxyWallet`, which is the account's permanent address; proof
field is `bio`. Qualifies on `createdAt` at least 90 days ago and
`traded` at least 10. `weightedVolume` and the PnL endpoints are
deliberately unread, per the rule above.

A profile with `displayUsernamePublic: false` cannot be linked: its bio
is withheld from the public read, so there is nothing to prove ownership
with. The refusal says to make the username public and try again.

### Not available, and why (checked 2026-08-31)

- **Metaculus.** Every API path answers `Permission Error: The API is
  only available to authenticated users`, profile pages sit behind a
  Cloudflare interstitial for any automated fetch, and the terms of use
  prohibit automated retrieval except through an API they provide. There
  is no route short of a negotiated data agreement.
- **Kalshi.** A public profile read exists at `/v1/social/profile` with an
  editable `description`, and it works today, but it is undocumented (the
  web app's own session API) and Kalshi's data terms forbid automated
  retrieval without written permission. Not built: ask first.
- **Good Judgment Open.** Identity could be proved through a forecast
  rationale, but every track-record field (Brier, rank, badges, account
  age) is visible only to signed-in members, so a link would prove who
  someone is while telling us nothing about their record.

## Guarantees

- One participant can link each provider once, and can link several
  different providers and be paid for each.
- One external account pays once across the whole platform, enforced by
  the unique index on `earn_claims (key, ref_id)`, not by a check.
- What was paid is the price on the day it was claimed, recorded on the
  claim. Re-pricing a row never changes a past grant.
- A failed proof, an unqualified record and an unknown provider all
  refuse without granting anything and say which of the three happened.
