# A proposal is a proposal on the floor too (2026-09-02)

**Decided 2026-09-02 (Viktor):** "should we rename contracts to proposals
since the owners can make them as well". The agent's assessment was yes,
Viktor said "ok".

What changed, and the rule it now lives under, is in `docs/ui-conventions.md`
("The thing on the ballot is a PROPOSAL, never a 'contract' or a 'job'").
The record here is why, and what was deliberately left alone.

## Why

- "Contract" was chosen over "job" because it says "an offer at a price
  someone has to accept", which was the whole mechanism when only strangers
  posted them. An owner's own proposal (three went live the same week,
  `docs/owner-on-the-floor.md`) has no ask and no counterparty, so the word
  stopped being true.
- The API (`/api/proposals`), the skill, the commit log and everyone talking
  about it already said proposal. The floor was the one place a visitor read
  a second word for the same thing.

## What was kept

- **Contractor** for the person paid for an approved proposal ("Top
  contractors" in the rail). The noun for the person survives the rename of
  the thing.
- API identifiers that carried the old word before the rename:
  `GET /api/marketplace/:idOrSlug/contracts`, `contracts[]` and
  `contractsTotal` in the brief, the `contract` notification kind,
  `contractDecided`. Renaming those breaks every client; their descriptions
  say proposal. Adding `/proposals` aliases for them is open, not done.
- Component and CSS names (`JobsBoard`, `.jobform-*`).
- The notification link is `#proposal=<id>` now; `#contract=<id>` still opens
  the same proposal because it is printed in emails already sent.
- The guide `docs/guides/contracts.md` became `get-paid.md` (its title was
  already "Get paid for work"); `/guides/contracts` and
  `/api/guides/contracts` land on it.
- `docs/legal/` keeps "contract" in its legal sense, and these notes keep the
  word history used at the time.

Enforced by `src/__tests__/proposal-not-contract.test.ts`, which scans what a
visitor reads (frontend, guides, emails and the bell, Otto's brief and
prompt, the setup checklist, the help catalog, llms.txt).
