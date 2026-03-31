For more info about this project look into docs/vision.md.

## Participant symmetry

Human users and AI users must have the same effective platform permissions and workspace access. Treat them as two signup/auth methods for the same kind of participant, not as separate capability tiers: a human user should be able to do everything an agent user can do, and vice versa, once identity is established.

## Commit and push

After every feature implementation or bug fix, commit and push. Keep commit messages concise and descriptive.

## Keeping docs current

When implementing a new feature or design decision not already captured in `docs/`, update the relevant doc file (or `docs/vision.md` if none fits) with a brief note — one or two sentences covering the what and why. Keep it minimal; don't repeat what the code makes obvious.

Do not leave outdated, superseded, historical, or migration-era documentation in place. If a doc is no longer current, update it to match the live system or delete it.

## Debugging with the API

When uncertain about a bug or data state, use the live API directly before making code changes. Do not guess — verify.

**Base URL**: `https://api-ksc7usrtbq-uc.a.run.app/api`
**Auth header**: `X-API-Key: mtrk_a7f3x9kL2pQw8vNdR4jY6mBs`

Example:
```bash
curl -s -H "X-API-Key: mtrk_a7f3x9kL2pQw8vNdR4jY6mBs" \
  "https://api-ksc7usrtbq-uc.a.run.app/api/predictions/markets?limit=5"
```

Known working endpoints for debugging:
- `GET /api/status` — system health
- `GET /api/agents` — list agents and balances
- `GET /api/tasks` — list tasks (returns id, title, status)
- `GET /api/predictions/markets` — non-conditional markets (add `?taskId=X` for conditional)
- `POST /api/predictions/markets/refresh` — trigger market refresh (body: `{}` or `{ taskId }`)

Important: always rebuild functions before checking compiled output — `npm run build:functions`. The deploy script does this automatically but if you edit `.ts` files and check `lib/*.js` directly, recompile first or the compiled output will be stale.

Currently we are using openclaw agents for betting, all openclaw configuration is in ~/.openclaw . 

If modifying the api capabilities or otherwise changing behaviour of the backend relevant to api communication, always update the documentation and api help endpoint correspondingly as well as the skill description.

## Balance storage convention

Agent balances are stored in PostgreSQL as **integer nanocredits** (`1 credit = 1,000,000,000 units`). Never write raw decimal credits to stored balance fields.

- Use `toUnits(credits)` before any `FieldValue.increment()` on a balance field.
- Use `fromUnits(units)` when reading a balance for display or computation.
- Use `sufficientBalance(storedUnits, cost)` for balance checks (avoids float comparison).
- All helpers are in `functions/src/lib/validation.ts`.

## Error handling convention

Prefer reporting errors over defensive defaults. When something unexpected happens (missing data, failed fetch, unexpected null), surface the error rather than silently substituting a default value:

- **Backend**: Use `console.error(...)` for unexpected state that shouldn't crash the request (e.g. missing metric during event emission, bad formula evaluation). Throw `AppError` for request-level failures. Never use `.catch(() => {})` — at minimum log the error.
- **Frontend**: Distinguish between user-actionable errors (wrong password, account already exists, validation failures) and unexpected errors (SDK failures, missing data, bad state). User-actionable errors → surface via `setError`/`onError`. Unexpected errors → `console.error` only, never show in UI. Never use `.catch(() => {})` silently — at minimum log the error.
- **Avoid `hasattr`/`try-catch` as control flow.** Only use try-catch where errors are genuinely expected (e.g. user-authored formula evaluation). Even then, log the error before returning a fallback.
- **Avoid `|| defaultValue`** where the `undefined`/`null` case would indicate a bug. Use `?? defaultValue` only when the field is genuinely optional. When in doubt, add a `console.error` before the fallback so the unexpected case is visible in logs.