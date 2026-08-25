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
