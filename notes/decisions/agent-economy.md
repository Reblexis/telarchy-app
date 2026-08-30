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

## 2026-08-30: the earn table goes in the database (owner decision)

**DONE 2026-08-30 (Viktor, verbatim):** "no we will edit it dynamically it
should be in db.. and can change midseason season 0 is esxperimental and we
should nto be afraid to change rules during", after "I will have a table of
the all the ways that people can earn credits ... whenever I feel like
something gives me less value, for a task, I will just edit it in the
table". Shipped as `earn_rules` + `earn_rule_history` (migration 0085),
read by browser signup, API registration, sub-bot creation and the Manifold
import; public at `GET /api/earn`, edited at `PATCH /api/admin/earn/:key`.
Prices may change mid-season under Season 0's experimental clause; the
history table is what keeps such a change reconstructable. The pricing
principle and the measured base rates behind it (median Manifold balance
600 mana against Telarchy's 10,000 grant on books of b = 330 to 2,000) are
in the telarchy umbrella, notes/earn-table-design-2026-08-30.md.

## 2026-08-30: the earn table gets its prices (owner decision)

**DONE 2026-08-30 (Viktor):** "i agree witht hte table for now.. lets set
it up". Migration 0086 applies the priced table from the telarchy
umbrella's notes/earn-table-design-2026-08-30.md, section 8, where each
row is min(value to us, a fraction of what the signal costs to fake) at
the internal accounting rate of 1,000 credits = $1:

- Signup splits by provider: email + password 100, Google/GitHub 300. The
  old single `signup_user` row survives as the fallback, priced at the
  cheaper of the two so it can never be the generous path.
- The Manifold import becomes a FLAT 5,000 for a QUALIFIED account (not a
  bot, 90+ days old, a bet in the last 60 days or markets others traded)
  instead of net worth capped at 10,000. Net worth stopped deciding it
  because mana transfers between Manifold accounts, which makes it the one
  input a farmer can concentrate into a fresh account.
- Referral is deliberately NOT shipped: a flat bounty is self-referrable
  (see the umbrella note for the fix, which is to pay a share of the
  referred trader's earned value rather than a bounty).

## 2026-08-30: every earn becomes claimable, links pay separately

**DONE 2026-08-30 (Viktor: connecting Google and GitHub should earn
credits, "somewhere like a quest table"; design canvas
https://claude.ai/code/artifact/3d605cc3-5d42-450e-bb42-3f07b21bcb38,
approved "yes looks good"):** the price stopped hanging off signup, which
had made the OAuth premium unearnable for anyone who signed up with an
email. Creating an account now pays 100 and each attached proof pays
separately: one link earn covering both providers (200, either Google or
GitHub, owner: "lets make it connect google acc or github", since a second
attached account is the same person proving they hold another free
account), and Manifold 5,000. An OAuth signup still totals 300 and an
email signup can come back and connect one.

Migration 0087 adds `earn_claims` with the two uniqueness rules that carry
the whole anti-farming weight, enforced in the database rather than in
code because two link callbacks racing is exactly when a check-then-write
pays twice: one earn per participant, and one external account paying once
ACROSS the platform. Existing accounts are backfilled as having claimed
what they already hold, so nobody is paid twice and nobody is offered an
earn they already had.
