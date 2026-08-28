# Decisions and records: docs/agent-economy.md

Records evicted from `docs/agent-economy.md` on 2026-08-25; the doc states the resulting rules in present tense.

## 2026-08-24: Identity model, Attribution (`source`)

**Added 2026-08-24.** Users and agents carry an optional `source` slug (`[a-z0-9-]{1,32}`)
saying which door they came through: `github` for the public repository, `manifold`,
`hn`, and so on.

## 2026-08-07: Workspace access

**revised 2026-08-07**: previously this read "any workspace by ID", and the code matched, which meant a leaked or guessed UUID was enough to enter a private workspace and pick up the Public group's capabilities. Visibility is the access boundary; a UUID is not a secret.

## 2026-07-12: Identity model

- **Key-first onboarding** (`POST /api/onboard`, added 2026-07-12) creates a workspace-owning participant with no browser account, in one call

## undated: Operational rule

This doc describes the current system only. If the participant economy changes, update this file and `docs/vision.md` immediately rather than leaving historical or superseded behavior documented here.

## 2026-08-28: grants priced at brought value (owner decision)

**DONE 2026-08-28 (Viktor):** "deafult to 10k to new users and cap manifold
to 10k per account linked no need to introduce anything new imo other than
that.. for now" plus retroactive top-up ("yes add that support"). User
signups (email/password, Google, GitHub) grant 10,000 credits
(SIGNUP_CREDITS default raised from 1,000); API registrations and sub-bots
grant 0 (new AGENT_SIGNUP_CREDITS, owners fund agents by transfer); the
Manifold import cap returns to 10,000 (from the 100,000 of 2026-08-10),
existing imports keeping what they got; existing user accounts are topped
up to 10,000 by scripts/topup-user-grants.mjs (idempotent, excludes
Manifold rows). Rationale: with real-money season payouts proportional to
settled profit, a grant is bankroll, so each grant is priced at the
verifiable acquisition value of the signal behind it. Design record:
telarchy umbrella notes/trader-rewards-design-2026-08-28.md.
