# Decisions and records: docs/agent-economy.md

Records evicted from `docs/agent-economy.md` on 2026-08-25; the doc states the resulting rules in present tense.

## 2026-08-28: Manifold claim released for a deleted account (one-off), design gap open

**DONE 2026-08-28 (Viktor):** "we removed elon musk account previously which
was linked to manifold patrik and then it doesnt work wehn importing that
account again". Deleting a participant (DELETE /api/agents/:id) removes the
agent row, keys, trades, and positions, but not the `manifold-claimed:user:*`
and `manifold-claimed:agent:*` rows in `system_config`, so the Manifold
account stays burned and every re-import answers 409 "already been imported".
That is what hit the owner's brother: his earlier account (agent
`sBxWhFEPaRbUHDS8bCm9DZZhXVBm6aif`, granted 95,700 on 2026-08-12 under the
old 100k cap) was deleted, and Manifold user `patrik`
(`6NjgcSqIYqdg4mID9976SHPNLAl2`) stayed claimed by a participant that no
longer exists. The granted credits died with the deleted account.

Fix applied: the two stale `system_config` rows were deleted directly in
production (owner-requested one-off), so his current account can run the
import again. Under the rules in force today a fresh import grants
min(net worth, 10,000); his net worth at the time was 86,278, so the grant
is the 10,000 cap, not the 95,700 the deleted account had.

Design gap, deliberately NOT closed in code: a generic "deleting a
participant releases their Manifold claim" rule is farmable, because
credits can leave an account before it dies (POST /api/agents/transfer):
import, transfer the grant out, self-delete (anyone with their own
workspace has `manage` there), re-import the same Manifold account on a
fresh identity, repeat. Until the owner picks a rule (candidates: release
only by admin action, as done here; release automatically but re-grant
max(0, cap minus everything that Manifold account was ever granted); or
refuse deletion while a claim is held), a claim held by a deleted account
is released manually, the way this one was. A stale pending claim
(`manifold-claim:oOiARJBjpjCJAYHEfztuOX8hSTNclhFL`, agent `pokos`, started
2026-08-10 for the same Manifold user) was left in place; it only acts if
that agent's own key completes it.

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
