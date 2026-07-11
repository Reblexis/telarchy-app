For more info about this project look into docs/vision.md.

## Canonical positioning (do not drift)

Telarchy is an alignment layer for AI and humans. You define the metrics that matter; participants, human or AI, forecast how each proposed action will move them, before you commit.

- **Scope:** company governance is the headline use case (founders pricing decisions against KPIs and OKRs); individuals use the same mechanism on personal goals and are first-class from day one.
- **Participant = human or AI:** humans sign up with email or OAuth; automated participants register for an API key. Once identity is established, signup path does not matter. The API and schema keep the word `agent`; in docs, UI, and outward copy use **participant**.
- **Never write "AI agents" in isolation** in user-facing prose where the same statement applies to humans. Use "participants" or "participants, human or AI." The symmetry is load-bearing. Exception: when a sentence is specifically about the AI moment (e.g. the "why now" line "AI agents can already act, but you cannot tell which actions are good"), naming AI alone is fine.
- **Do not claim open source today.** Repo is private, no `LICENSE` file yet. Open-sourcing is a possibility we'll evaluate at a later stage; no commitment today. Two reasons: business model is unsettled (open-core is a one-way door), and current security posture has gaps that would be exposed by public release. Public-facing copy should describe Telarchy as a managed hosted service, not as open-core or "planned open core." Revisit only after: (a) the headline wedge is locked by real customer validation, (b) `/cso` security pass clears the gaps, (c) business-model conviction increases (e.g., enterprise pilots, transaction-fee data).
- **Alignment layer for AI and humans is the load-bearing positioning.** The mechanism is prediction markets; the product is an alignment layer that prices proposed actions, whether the proposer is an AI agent or a human teammate. Owners say what they want; participants (human or AI) propose actions; markets price the actions against the owner's metrics; owner approves with calibrated confidence. The realistic alternatives a founder uses today are a generic chatbot (for AI proposals) or a gut call / the loudest voice in the room (for human proposals). See `docs/vision.md` ("Telarchy as an alignment layer for AI and humans") and `docs/go-to-market.md` ("Why 'alignment layer' is the load-bearing framing"). Do not drift back to "alignment layer for AI" alone (it understates scope, since the system also prices human proposals) or to "private prediction markets" framing (it loses the wedge).
- **Why now** (the timing argument, used in marketing copy): two compounding facts. (1) Intelligence is now the cheapest it has ever been; prediction markets thrive in cheap intelligence because every proposal can be evaluated by many forecasters at near-zero per-forecast cost. (2) AI participants grant privacy that human forecasters cannot: a founder will not put a sensitive KPI or unannounced strategic move in front of human teammates or a public market, but an AI participant inside a private workspace can forecast it without leaking it. Together these unlock pricing decisions that previously had no realistic forum.

When rewriting user-facing copy, always check that the four commitments above (dual-scope, participant symmetry, no OSS claim, alignment-layer framing) hold. If a change makes any of them slippery, flag it.

## Focus gate

The product has no users yet. Every feature request or refactor should be evaluated against: "Does this help get the first users?" If the answer is no (or unclear), flag it to the user as potential procrastination and suggest deferring it. Renaming, reorganizing, or polishing things that no users will see is not a priority. Remove this section once the product has real users.

One failure pattern is worth naming on its own: solo-loop UI/copy polish on surfaces no real user has asked about (landing-page rewrites, sidebar redesigns, "calmer / sharper" visual passes, positioning iterations driven by taste alone). These are not product iteration. Before opening `LandingPage.tsx` or `Sidebar.tsx` for visual reasons, name the external trigger (a founder, investor, or outreach event that asked for it). If you cannot name one, leave the file closed.

## Writing style

Do not use em dashes. Use commas, periods, semicolons, parentheses, or "i.e."/"e.g." instead. This applies to code comments, docs, commit messages, and all generated text.

## UI conventions

Frontend layout, type, color, and component patterns live in `docs/ui-conventions.md`. When adding or restyling a page, read it first. Key invariants: every workspace tab uses `max-width: 1080px; margin: 0 auto` so left edges align across tabs (do not widen for one page); horizontal padding belongs to `.page-content`, never the inner wrapper; sections use tiny uppercase `h2` labels, not large bold headers; lists use 1px hairlines, not card containers; the product is monochrome plus a single accent (no per-category color coding).

## Participant symmetry

Human users and AI users must have the same effective platform permissions and workspace access. Treat them as two signup/auth methods for the same kind of participant, not as separate capability tiers: a human user should be able to do everything an API-key user can do, and vice versa, once identity is established.

## Frontend goes through the public API

The web frontend MUST call the same `/api/*` endpoints that an external participant would call. There is one backend code path per capability, not two (one for the UI, one for the API). Concretely:

- Anything the UI can do, an API key (master or per-agent) must be able to do via the same endpoint. No browser-session-only routes for capabilities that participants are also entitled to.
- Anything an API client can do appears in `GET /api/help` so participants can discover it. If a frontend page calls a route that isn't documented there, that's the bug, not the docs.
- Auth gating is via `requireCapability` / `requireSelfOrAdmin` / `requireIdentity` over the unified `req.auth` (which resolves master key, agent key, or browser session into the same shape). `requireUser` (browser-session-only) is reserved strictly for endpoints that are intrinsically tied to BetterAuth account state (sign-in, sign-up, password reset, OAuth callbacks). Any other use of `requireUser` is a parity bug.
- Don't add a parallel backend handler for the UI. Reuse the documented endpoint or extend it.

This is what makes "alignment layer for AI and humans" honest: the UI is just one of many participants of the API. A test under `functions/src/__tests__/api-parity.test.ts` enforces this; keep it green.

## Commit and push

After every feature implementation or bug fix, commit and push. Keep commit messages concise and descriptive.

## Keeping the test suite in sync

Run the test suite (`npm test`) before committing anything non-trivial, and always after touching backend logic (metrics engine, auth, workspaces, markets, credits, formulas, templates). `npm test` runs both backend Jest (under `functions/`) and frontend Vitest (root); `npm run test:frontend` runs frontend only. Fix failures before moving on; do not commit with a red suite.

Frontend unit tests live alongside the source they cover, under `__tests__` directories (e.g. `src/lib/__tests__/metrics-chart-model.test.ts`). Use `@testing-library/react` for component tests. Chart.js does not render cleanly under jsdom after state updates. When writing tests for components that embed a chart, stub the chart module via `vi.mock`.

If `tsc` reports impossible errors (an export that obviously exists, an identifier that's clearly imported, references to a previous version of the file), the incremental build cache is stale. Wipe it and rebuild:

```bash
rm -rf functions/lib functions/tsconfig.tsbuildinfo tsconfig.tsbuildinfo && npm run build
```

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
spec or add a new one (use `07-admin/bot-agents-panel.md` as the
gold-standard template). Specs are organised by category subdirectory
(`00-anonymous` … `13-infra-and-abuse`) and run in parallel via
`_runner/run.sh`; see `docs/browse-tests/README.md` for the full index.
Coverage gaps in that directory should match the "Known gaps" notes at
the bottom of each spec; if they don't, fix it in the same commit.

## Testing features locally (user perspective)

To verify features or debug UI/UX issues as the primary user would experience them, use the local dev server:

**Start the local server** (if not already running):
```bash
cd ~/src/telarchy/telarchy-app && npm run dev
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

## Verify each fix end-to-end before reporting it done

Tests passing and types compiling are not proof a fix works in production. Every bug fix or feature change must be observed working before being reported as done. The order:

1. Reproduce the original bug first (so you know the verification step is meaningful and you're not just confirming code shape).
2. Ship the change (commit + push so CI deploys, or run locally).
3. Hit the *live* surface and confirm the bug is gone:
   - Backend fix: `curl` the affected endpoint on the deployed URL and inspect the response (the API help legend at the top of this file is the canonical reference; use the master key for admin paths).
   - Frontend fix: open the page in a browser (or via the `browse` skill), reproduce the original user steps, and confirm the new behaviour.
   - Data-state question (is this market really voided? is this proposal really pending?): query the DB directly via cloud-sql-proxy (the manual migration fallback below has the exact incantation). Do not infer state from API shape; check the row.
4. If you cannot verify (e.g. behaviour depends on a state you don't have), say so explicitly in the wrap-up message rather than claiming success.

This applies even for "obvious" or single-line fixes. The cost of an unverified false-positive is high: the user loses trust, the bug stays in prod, and the next session inherits a stale problem.

## Production deployment

The backend runs on **Google Cloud Run** (service: `api`, region: `us-central1`, project: `telarchy-e0043`). The frontend is served from the same origin (`telarchy.com`).

**Auto-deploy on push to `main`** via `.github/workflows/deploy-cloudrun.yml`. The workflow runs pending Drizzle migrations against the prod DB *before* deploying the new container, so schema and code roll forward together. To deploy by hand (rollback, hotfix offline), `npm run deploy` from the repo root still works and runs the same `gcloud run deploy` command — but it does NOT run migrations, so if you're shipping a schema change, apply migrations first (see the manual fallback below). One-time GCP+GitHub setup is in `docs/infra/deploy.md`.

**Database**: Cloud SQL PostgreSQL (instance: `telarchy-pg`). Migrations are managed by Drizzle Kit and applied automatically by the deploy workflow.

**Manual migration fallback** (rare — used when shipping a schema change by hand or recovering from a failed CI migrate):
```bash
cloud-sql-proxy telarchy-e0043:us-central1:telarchy-pg --port=5435 &
PASSWORD=$(gcloud secrets versions access latest --secret=DATABASE_URL --project=telarchy-e0043 | python3 -c 'import sys,urllib.parse; print(urllib.parse.urlparse(sys.stdin.read().strip()).password)')
cd functions && DATABASE_URL="postgresql://telarchy:${PASSWORD}@127.0.0.1:5435/telarchy" npx drizzle-kit migrate
kill %1
```

If production returns 500/503 after a deploy, the first check is `gcloud run services logs read api --region us-central1 --limit 20` — a missing-table error means the auto-migrate step was skipped or failed.

**Checking production logs**:
```bash
gcloud run services logs read api --region us-central1 --limit 20
```

## Debugging with the API

When uncertain about a bug or data state, use the live API directly before making code changes. Do not guess; verify.

**Base URL**: `https://telarchy.com/api`
**Auth header**: `X-API-Key: $TELARCHY_MASTER_KEY` - the master key is NOT committed to this repo (it may be open-sourced someday). Canonical source: the private `Reblexis/keyring` repo (`keyring/telarchy/master.env` in the telarchy umbrella; `source` it or read it from `cli-agents/_runner/registrars.json`).

Example:
```bash
source ../keyring/telarchy/master.env   # umbrella checkout; sets TELARCHY_MASTER_KEY
curl -s -H "X-API-Key: $TELARCHY_MASTER_KEY" \
  "https://telarchy.com/api/predictions/markets?limit=5"
```

Known working endpoints for debugging:
- `GET /api/status` - system health
- `GET /api/agents` - list participants and balances
- `GET /api/proposals` - list proposals (returns id, title, status)
- `GET /api/predictions/markets` - non-conditional markets (add `?proposalId=X` for conditional)
- `POST /api/predictions/markets/refresh` - trigger market refresh (body: `{}` or `{ proposalId }`)

Important: always rebuild functions before checking compiled output (`npm run build:functions`). The deploy script does this automatically but if you edit `.ts` files and check `lib/*.js` directly, recompile first or the compiled output will be stale.

## Bot trading agents

The production Telarchy agents live in a separate repo: **`~/src/telarchy/telarchy-agents`** (umbrella submodule). The main fleet is `cli-agents/` (prose/script agents: `impact-analyst`, `external-researcher`, `skeptic`, `market-evolver`), which since 2026-06-07 runs **on the kpi-sync Hetzner box** (5.75.140.10, `telarchy` Linux user) as per-agent systemd units `telarchy-agent@<name>` - see `telarchy-agents/deploy/bootstrap-vps.md` for host setup and ops commands. They are managed from the platform-admin **/agents** page on telarchy.com (live health, pause/resume, run-now, per-agent traces), backed by `GET/POST /api/admin/agent-control(s)` plus the agent-telemetry endpoints.

- The older Node/TypeScript service (`src/`, strategies `anchor`, `momentum`, `stabilizer`, `blended`, `ai-analyst`, `ai-researcher`) still exists with local systemd units (`telarchy-agents-prod.service`); its bots push the same telemetry but do NOT poll the control plane, so /agents controls are inert for them.
- Multi-workspace discovery joins public workspaces via `GET /api/marketplace/workspaces/public` + `POST /api/marketplace/:id/join` using each bot's own `X-Agent-Key`, the same flow any third-party agent uses. Trading rights come from the workspace's Public-group capabilities; bots do not self-promote via admin key.

There is no openclaw-based bot trading (the `~/.openclaw` scaffolding is unrelated; the earlier hook-watcher / skill references point at a deprecated integration path). To change cli-agent behaviour, edit the agent's `strategy.md` (or `run` script), push, then `git pull` + `systemctl --user restart 'telarchy-agent@*'` on the box.


If modifying the api capabilities or otherwise changing behaviour of the backend relevant to api communication, always update the documentation and api help endpoint correspondingly as well as the skill description.

## Balance storage convention

Participant balances are stored in PostgreSQL as **integer nanocredits** (`1 credit = 1,000,000,000 units`). Never write raw decimal credits to stored balance fields.

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