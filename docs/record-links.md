# Linking a forecasting record

A participant who already has a public forecasting record elsewhere is
worth more here than a fresh account, because that record is evidence
they can price a question. Linking one is an earn: it pays the price in
the earn table for that provider, once per participant and once per
external account across the whole platform.

This file is the proposal. `docs/agent-economy.md` owns the earn table
itself; the pricing argument is the telarchy umbrella's
`notes/earn-table-design-2026-08-30.md`.

## Linking and being paid are two different things

**Linking is free and open to any account. Only the grant is gated.**

A link says who somebody is: this participant is that forecaster, and a
reader on the leaderboard can see it. That is worth having whether or not
the record is worth money, so a fresh account, a dormant one and one
flagged as a bot can all be linked. What they cannot do is collect.

The grant is the separate question, and it is answered by the quality
gates below plus two rules that have not moved: a participant is paid for
a provider once ever, and an external account pays once ever across the
whole platform.

## The flow, which is the same for every provider

1. **Name the account.** `POST /api/import/:provider/start { handle }`
   looks the handle up on the provider's public API and answers with a
   one-time code. It refuses only a handle that does not exist.
2. **Prove it.** The participant puts that code anywhere in the account's
   public, self-editable text field (its bio) and presses verify.
3. **Verify, link, and pay if it qualifies.** `POST
   /api/import/:provider/claim` re-reads the public profile and confirms
   the code is present. That records the link. It then checks the gates
   and the two payment rules: passing all of them grants the earn,
   failing any of them answers `granted: 0` with `why`, and the link
   stands either way. The code can come out of the bio immediately
   afterwards; nothing re-reads it.

The gates therefore run only at `claim`, and only to decide money. A
record that does not qualify today may qualify later, so a participant
who was linked without payment can verify again and be paid then: the
free link writes nothing into `earn_claims`, which is where the money
rules live.

## Relinking

**A link can always be replaced, including after it has been paid.**
Linking again to a different handle moves the badge; nothing about the
money changes, because the payment rules are counted in `earn_claims`
and a link does not write there.

So a participant who was paid for one account and then relinks to
another is paid nothing for the second: not for that account, and not
for any account after it. One payment per participant per provider is
the rule, and relinking is not a way around it.

One external account is badged by at most one participant, so two
profiles never claim to be the same forecaster. Relinking away from an
account releases it for whoever can prove they hold it.

**One router serves every provider, and no provider has a mount of its
own.** `/api/import/:provider/*` is the whole surface. A provider-specific
mount registered above it shadows the generic one for that provider only,
which is invisible in a test that mounts the generic router by itself and
shows up as the provider's dialog refusing every handle.

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

- Anyone who can prove they hold an account can link it. Age, activity
  and a bot flag decide the money, never the link.
- One participant is paid for a provider once, ever, whatever they link
  afterwards, enforced by `earn_claims (agent_id, key)`.
- One external account pays once across the whole platform, enforced by
  the unique index on `earn_claims (key, ref_id)`, not by a check.
- A participant can link several different providers and be paid for
  each.
- What was paid is the price on the day it was claimed, recorded on the
  claim. Re-pricing a row never changes a past grant.
- A failed proof and an unknown provider refuse outright. An unqualified
  record does not: it links, pays nothing, and says why.
- A linked handle is shown as a badge on the participant's profile and on
  the leaderboard, for every provider, paid or not.
- One external account is badged by at most one participant at a time.
