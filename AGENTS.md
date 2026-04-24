For more info about this project look into docs/vision.md.

## Focus gate

The product has no users yet. Every feature request or refactor should be evaluated against: "Does this help get the first users?" If the answer is no (or unclear), flag it to the user as potential procrastination and suggest deferring it. Renaming, reorganizing, or polishing things that no users will see is not a priority. Remove this section once the product has real users.

## Writing style

Do not use em dashes. Use commas, periods, semicolons, parentheses, or "i.e."/"e.g." instead. This applies to code comments, docs, commit messages, and all generated text.

## Participant symmetry

Human users and AI users must have the same effective platform permissions and workspace access. Treat them as two signup/auth methods for the same kind of participant, not as separate capability tiers: a human user should be able to do everything an agent user can do, and vice versa, once identity is established.

## Commit and push

After every feature implementation or bug fix, commit and push. Keep commit messages concise and descriptive.

## Keeping the test suite in sync

Run the test suite (`npm test`) before committing anything non-trivial, and always after touching backend logic (metrics engine, auth, workspaces, markets, credits, formulas, templates). `npm test` runs both backend Jest (under `functions/`) and frontend Vitest (root); `npm run test:frontend` runs frontend only. Fix failures before moving on; do not commit with a red suite.

Frontend unit tests live alongside the source they cover, under `__tests__` directories (e.g. `src/lib/__tests__/metrics-chart-model.test.ts`). Use `@testing-library/react` for component tests. Chart.js does not render cleanly under jsdom after state updates — when writing tests for components that embed a chart, stub the chart module via `vi.mock`.

When you add or change a feature, update or add tests in the same commit. The rules:

- New pure function or algorithm in `functions/src/lib/` or similar → add a unit test in `functions/src/__tests__/`.
- Changed behavior of an existing function → update its test to match, and add a new case if the change introduces a new path.
- New HTTP route or auth/workspace/permission flow → add a test that hits the path end-to-end against a real DB. Today most of those flows are untested, which is why bugs like "user creates workspace, next request says Not a member" can slip through. When you touch one, leave a test behind.
- Removed or renamed a feature → delete its tests; do not leave a disabled `describe.skip` or dead file behind.

If adding a test for a given change is genuinely impractical (e.g. a Firebase/OAuth callback with no good stubbing story), note that in the commit message so the gap is visible.

## Keeping docs current

When implementing a new feature or design decision not already captured in `docs/`, update the relevant doc file (or `docs/vision.md` if none fits) with a brief note (one or two sentences covering the what and why). Keep it minimal; don't repeat what the code makes obvious.

Do not leave outdated, superseded, historical, or migration-era documentation in place. If a doc is no longer current, update it to match the live system or delete it.

## Browser-driven test specs

When verifying UI features, prefer the structured specs in
`docs/browse-tests/` over ad-hoc browsing. Each file is a per-feature script
of `browse` (`$B`) commands and expected results, runnable end-to-end
without inferring intent. The master index is `docs/browse-tests/README.md`.

When you ship a UI-affecting change, either update the relevant existing
spec or add a new one (use `admin-observability.md` as the gold-standard
template). Coverage gaps in that directory should match the
"Known gaps" notes at the bottom of each spec; if they don't, fix it in the
same commit.

## Testing features locally (user perspective)

To verify features or debug UI/UX issues as the primary user would experience them, use the local dev server:

**Start the local server** (if not already running):
```bash
cd /home/cihalvi/src/metrics-tracker && npm run dev
```
The app runs at `http://localhost:5173` (or whichever port Vite picks; check the terminal output).

**Login credentials**:
- Email: `viktor.cihal@gmail.com`
- Password: `TestAdmin99!`

Use a browser or a headless tool to navigate the app as this user. This account has admin/owner access to the primary workspace, so all features should be accessible.

When debugging a UI bug or feature, always reproduce it at this URL with these credentials before drawing conclusions from code alone.

**API access as this user** (for backend debugging):
```bash
# Sign in and save session cookie
curl -s -c /tmp/cookies.txt -X POST http://localhost:8080/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"viktor.cihal@gmail.com","password":"TestAdmin99!"}'

# Then use the cookie for subsequent requests
curl -s -b /tmp/cookies.txt http://localhost:8080/api/auth/me
curl -s -b /tmp/cookies.txt http://localhost:8080/api/status
```

## Production deployment

The backend runs on **Google Cloud Run** (service: `api`, region: `us-central1`, project: `telarchy-e0043`). The frontend is served from the same origin (`telarchy.com`).

**Database**: Cloud SQL PostgreSQL (instance: `telarchy-pg`). Migrations are managed by Drizzle Kit.

**Running migrations against production**:
```bash
# Start the Cloud SQL Auth Proxy (pick an unused port)
cloud-sql-proxy telarchy-e0043:us-central1:telarchy-pg --port=5435 &

# Run migrations
cd functions && DATABASE_URL="postgresql://telarchy:BhNaKo6sLsEdzyyMDko794lFc0rb9D28@127.0.0.1:5435/telarchy" npx drizzle-kit migrate

# Kill the proxy when done
kill %1
```

Schema changes that add/remove columns will break the running service if the deployed code expects them. Always run migrations immediately after pushing code that depends on new columns. If production returns 503, check `gcloud run services logs read api --region us-central1 --limit 20` first.

**Checking production logs**:
```bash
gcloud run services logs read api --region us-central1 --limit 20
```

## Debugging with the API

When uncertain about a bug or data state, use the live API directly before making code changes. Do not guess; verify.

**Base URL**: `https://telarchy.com/api`
**Auth header**: `X-API-Key: mtrk_a7f3x9kL2pQw8vNdR4jY6mBs`

Example:
```bash
curl -s -H "X-API-Key: mtrk_a7f3x9kL2pQw8vNdR4jY6mBs" \
  "https://telarchy.com/api/predictions/markets?limit=5"
```

Known working endpoints for debugging:
- `GET /api/status` - system health
- `GET /api/agents` - list agents and balances
- `GET /api/tasks` - list tasks (returns id, title, status)
- `GET /api/predictions/markets` - non-conditional markets (add `?taskId=X` for conditional)
- `POST /api/predictions/markets/refresh` - trigger market refresh (body: `{}` or `{ taskId }`)

Important: always rebuild functions before checking compiled output (`npm run build:functions`). The deploy script does this automatically but if you edit `.ts` files and check `lib/*.js` directly, recompile first or the compiled output will be stale.

## Bot trading agents

The market-making / forecasting bots live in a separate repo: **`~/src/telarchy-agents`**. It is a small Node/TypeScript service (systemd units under `~/src/telarchy-agents/systemd/`) that polls the Telarchy API, auto-discovers public workspaces, joins them as bot participants, and runs deterministic + LLM strategies (`anchor`, `momentum`, `stabilizer`, `blended`, `ai-analyst`, `ai-researcher`).

- Service runs under the user's systemd session: `telarchy-agents-prod.service` targets `https://telarchy.com`; `telarchy-agents.service` targets local dev. Check status with `systemctl --user status telarchy-agents-prod.service` and logs at `/tmp/telarchy-agents-prod.log`.
- Config via `.env.production` / `.env` in that repo (`TELARCHY_URL`, `TELARCHY_ADMIN_KEY`, `MULTI_WORKSPACE=1`, `POLL_INTERVAL_SECONDS`, etc.).
- Multi-workspace mode discovers public workspaces via `GET /api/marketplace/workspaces/public` and joins each one via `POST /api/marketplace/:id/join` using each bot's own `X-Agent-Key`, the same flow any third-party agent uses. Trading rights come from the workspace's Public-group capabilities (Open workspaces grant Trader inherently); bots do not self-promote via admin key.

There is no openclaw-based bot trading (the `~/.openclaw` scaffolding is unrelated; the earlier hook-watcher / skill references point at a deprecated integration path). If you need to change bot behaviour, edit `~/src/telarchy-agents/src/strategies/*.ts` and restart the service: `systemctl --user restart telarchy-agents-prod.service`.


If modifying the api capabilities or otherwise changing behaviour of the backend relevant to api communication, always update the documentation and api help endpoint correspondingly as well as the skill description.

## Balance storage convention

Agent balances are stored in PostgreSQL as **integer nanocredits** (`1 credit = 1,000,000,000 units`). Never write raw decimal credits to stored balance fields.

- Use `toUnits(credits)` before any `FieldValue.increment()` on a balance field.
- Use `fromUnits(units)` when reading a balance for display or computation.
- Use `sufficientBalance(storedUnits, cost)` for balance checks (avoids float comparison).
- All helpers are in `functions/src/lib/validation.ts`.

## Error handling convention

Prefer reporting errors over defensive defaults. When something unexpected happens (missing data, failed fetch, unexpected null), surface the error rather than silently substituting a default value:

- **Backend**: Use `console.error(...)` for unexpected state that shouldn't crash the request (e.g. missing metric during event emission, bad formula evaluation). Throw `AppError` for request-level failures. Never use `.catch(() => {})`; at minimum log the error.
- **Frontend**: Distinguish between user-actionable errors (wrong password, account already exists, validation failures) and unexpected errors (SDK failures, missing data, bad state). User-actionable errors → surface via `setError`/`onError`. Unexpected errors → `console.error` only, never show in UI. Never use `.catch(() => {})` silently; at minimum log the error.
- **Avoid `hasattr`/`try-catch` as control flow.** Only use try-catch where errors are genuinely expected (e.g. user-authored formula evaluation). Even then, log the error before returning a fallback.
- **Avoid `|| defaultValue`** where the `undefined`/`null` case would indicate a bug. Use `?? defaultValue` only when the field is genuinely optional. When in doubt, add a `console.error` before the fallback so the unexpected case is visible in logs.