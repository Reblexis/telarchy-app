# Contributing

Thank you for looking. This is a small project run by one person and a few
agents, so the rules below exist to keep it that way: reviewable, and honest
about what governs what.

## The one rule: docs govern

The documents under `docs/` are the source of truth and the code is derived from
them. Where they disagree, the code is wrong. A behaviour change starts as a doc
change, in the same pull request as the code that conforms to it. Which doc owns
what:

| You changed... | Update |
|---|---|
| What Telarchy is, how a mechanism works | `docs/vision.md` |
| Metric formulas | `docs/formulas.md` |
| Participants, credits, auth, attribution | `docs/agent-economy.md` |
| An in-app guide | `docs/guides/<section>.md`, then `npm run build:guides` |
| An endpoint | the catalog in `functions/src/lib/help-catalog.ts` (served at `/api/help`) |
| Anything a contributor needs to know about the code | `ARCHITECTURE.md` |
| Deploying the managed instance | `docs/infra/deploy.md` |

`docs/README.md` is the index.

## Setting up

`README.md` has the two commands. Tests need no credentials: the backend suite
boots an in-process PGlite and replays the migrations.

```bash
npm install && (cd functions && npm install)
npm test                 # backend Jest, then frontend Vitest
npm run typecheck
npm run lint             # Biome
```

## A pull request

- One change per PR, with its doc change and its tests. The test suite is the
  specification you can execute; a change without a test that fails before it
  and passes after it will be asked for one.
- Every route is authenticated unless its prefix is in
  `functions/src/middleware/route-policy.ts`, with a reason. The guard test
  fails otherwise; the auth matrix test shows what you changed.
- Formulas are never evaluated as JavaScript. The parser in
  `functions/src/lib/formula/` is the only interpreter.
- No credentials, ever, anywhere in the tree. `no-committed-secrets.test.ts` and
  gitleaks both fail the build on one.
- No em dashes in prose or commit messages; hyphens, commas, or two sentences.
- CI runs on every PR from a fork with no secrets; a maintainer approves the run.

Review is best effort: an agent reads every PR against the docs and the suite
first, and a maintainer merges. There is no SLA. A PR that closes a funded issue
says so in its description; the issue names how and when it is paid.

## Contributor licence agreement

The repository is AGPL-3.0-only and the project may relicense or dual-license it
in future, so every contribution needs the CLA in `CLA.md`, signed once through
the CLA check on the pull request. If an agent wrote the contribution, the
natural or legal person operating that agent signs.

## Security

Do not open an issue for a vulnerability; see `SECURITY.md`.
