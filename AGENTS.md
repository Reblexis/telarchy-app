For more info about this project look into docs/vision.md.

## Canonical positioning (do not drift)

**Current slogan (owner decision 2026-08-25, Viktor: "ok im using this line.. can you save it everywhere as the current slogan"):** "Approve on evidence, not on who argued best. See what each proposal does to your KPIs before you say yes." This is the line for the X bio, the site title and share cards, and any headline slot aimed at people inside companies who want better decisions. It was chosen by a 20-profile simulation over 20 candidates (telarchy umbrella `notes/slogan-simulation-2026-08-25.md`): it names the pain instead of describing the mechanism, was the favourite of six of twenty readers and misread by the fewest, while the previous bio line ("the alignment layer for AI and humans") was misread by all twenty. The alignment line stays the mission-register zoom-out below; it is no longer the slogan.

**Headline wedge (updated 2026-07-11, Viktor): "the approval layer for AI agents."** Lead everywhere with the approval-layer framing: your agent proposes an action, a market prices its expected impact on your KPI, and you approve on a calibrated number. **Never lead with "prediction markets"**: the term reads as gambling/crypto to AI buyers and drags the regulatory question to the front of every conversation; name the mechanism only after the job. "Alignment layer for AI and humans" remains the mission-level framing (the zoom-out), and the participant-symmetry rules below still hold. Campaign context and audience-specific pitches: the SF master plan record in the telarchy umbrella, `notes/sf-master-plan-2026-07.md`.

**Noted 2026-08-10 (Viktor): the public floor's mission line uses the alignment framing** ("Telarchy is the alignment layer for companies: everyone, human or AI, earns by being right about the numbers the owner actually cares about"). This is the canon applied, not changed: the floor's about section is a mission-register slot, and the mechanism beats directly above it ground the word. The sales wedge stays approval-first per the 2026-07-11 decision; flipping the wedge itself remains on the table only if real conversations demand it.

**Revised 2026-08-10 (Viktor): the mission names COMPANIES, and "startup" is out.** The mission framing is "the alignment layer for companies", not "for a startup" or "for startups": there is no reason to narrow the claim to startups specifically. And LookPilot is described as "a real company, run in the open"; user-facing copy avoids the word "startup" (internal template ids and historical docs are unaffected).

**Revised 2026-08-11 (Viktor): the floor carries no mission line.** The about section's closing sentence ("Telarchy is the alignment layer for companies... LookPilot is the first company running on it") was removed at the owner's direction; the three mechanism beats and the email door stand on their own. The alignment framing remains canon for mission-register copy elsewhere; the floor simply no longer has a mission-register slot.

**Approved 2026-08-18 (Viktor): the floor leads with the company, not the market.** The identity block heads the floor: the company's name as the page's `h1` (serif, a real title, not the grey eyebrow it was earlier that day) with the workspace `description` under it as the one line of what the business sells. The metric name drops to a caption over the number, with a leading copy of the company's name stripped ("LookPilot net 2026" reads as "NET 2026"). The reason is the cold visitor: they arrive from a link about the company, not about Telarchy, and cannot parse a metric question as a first impression. The tagline is company prose in the top slot, which is close to the 2026-08-11 "no mission line" direction; it is allowed because it is factual and about the company, never about Telarchy. A mission-register sentence there is still out.

**Confirmed 2026-07-12 (Viktor): the wedge never stands alone.** "Approval layer" spoken bare collides with the permission-gating / HITL-approval-queue category and undersells the market. Whenever the wedge is used, the calibrated-number clause is mandatory in the same breath ("...and you approve on a calibrated number", or equivalent naming that the approval is priced, not a checkbox). Alignment stays the mission framing; approval stays the wedge; a swap is only on the table if real conversations keep triggering the permission-gating read despite the full sentence.

Telarchy is an alignment layer for AI and humans. You define the metrics that matter; participants, human or AI, forecast how each proposed action will move them, before you commit.

- **Scope:** company governance is the headline use case (founders pricing decisions against KPIs and OKRs); individuals use the same mechanism on personal goals and are first-class from day one.
- **Participant = human or AI:** humans sign up with email or OAuth; automated participants register for an API key. Once identity is established, signup path does not matter. The API and schema keep the word `agent`; in docs, UI, and outward copy use **participant**.
- **Never write "AI agents" in isolation** in user-facing prose where the same statement applies to humans. Use "participants" or "participants, human or AI." The symmetry is load-bearing. Exception: when a sentence is specifically about the AI moment (e.g. the "why now" line "AI agents can already act, but you cannot tell which actions are good"), naming AI alone is fine.
- **Open source, precisely.** The repository is public under AGPL-3.0-only since 2026-08-25 (`github.com/Reblexis/telarchy-app`; decision record in the telarchy umbrella's notes). Say so where it links the code (the /about page, the agent guides, the footer Source link) and nowhere as a slogan: it is a trust signal for people already interested, not a reason to visit. Never "open core", never a licence other than the one in LICENSE.
- **Alignment layer for AI and humans is the load-bearing positioning.** The mechanism is prediction markets; the product is an alignment layer that prices proposed actions, whether the proposer is an AI agent or a human teammate. Owners say what they want; participants (human or AI) propose actions; markets price the actions against the owner's metrics; owner approves with calibrated confidence. The realistic alternatives a founder uses today are a generic chatbot (for AI proposals) or a gut call / the loudest voice in the room (for human proposals). See `docs/vision.md` ("Telarchy as an alignment layer for AI and humans") and the go-to-market note (private) on why 'alignment layer' is the load-bearing framing. Do not drift back to "alignment layer for AI" alone (it understates scope, since the system also prices human proposals) or to "private prediction markets" framing (it loses the wedge).
- **Why now** (the timing argument, used in marketing copy): two compounding facts. (1) Intelligence is now the cheapest it has ever been; prediction markets thrive in cheap intelligence because every proposal can be evaluated by many forecasters at near-zero per-forecast cost. (2) AI participants grant privacy that human forecasters cannot: a founder will not put a sensitive KPI or unannounced strategic move in front of human teammates or a public market, but an AI participant inside a private workspace can forecast it without leaking it. Together these unlock pricing decisions that previously had no realistic forum.

When rewriting user-facing copy, always check that the four commitments above (dual-scope, participant symmetry, no OSS claim, alignment-layer framing) hold. If a change makes any of them slippery, flag it.

## Writing style

Do not use em dashes. Use commas, periods, semicolons, parentheses, or "i.e."/"e.g." instead. This applies to code comments, docs, commit messages, and all generated text.

## UI conventions

Frontend layout, type, color, and component patterns live in `docs/ui-conventions.md`. When adding or restyling a page, read it first. **The old console GUI was deleted on 2026-08-19** (owner: "could you get completely rid of the old gui for now?"): there is no `AppLayout`, no sidebar, no workspace tabs, no /agents page, no guides or tutorials, no agent portal, no alpha wall. `/admin` came back on 2026-08-19 as a standalone `.pubws` page (the owner's cockpit: traffic, signups, waitlist, reports), rewritten in this design language rather than restored. Key invariants: every page is a standalone `.pubws` page carrying its own top bar; the column is 660px (poster), 760px (document) or 26rem (a door), and horizontal padding belongs to that column, never to the blocks inside it; sections use tiny uppercase labels, not large bold headers; lists use 1px hairlines, not cards; the product is monochrome plus a single accent (no per-category color coding). If you want a sidebar, you are rebuilding the thing that was deleted.

## Reading is open, acting needs a key

**Owner direction 2026-08-20: "only placing trades or writing comments should
require api key... you know the user action stuff".** An anonymous caller that
sends `X-Workspace-Id` (an id or a slug) gets every `read` endpoint of a PUBLIC
workspace: markets, metrics, proposals, status, market history and trades. No
registration, no key. An agent can look before it decides to join, and the
documented API stops being the locked door onto data `/api/marketplace/*`
already published.

The line, held in `functions/src/lib/public-read.ts` and pinned by
`public-read-no-key.test.ts`:

- **Anonymous gets `read`, and only `read`**, even on an Open workspace whose
  Public group also grants `trade` (which is what makes a self-join enough to
  trade). A trade needs an account to debit and a comment needs an author, so
  every action requires an identity.
- **Private workspaces answer nothing anonymously**, whatever their groups say.
  Visibility is the owner's own statement about who this is for.
- **Two reads stay identity-only** because they are workspace plumbing rather
  than market data: `GET /api/groups` (who is in which group) and
  `GET /api/sources*` (what an integration is configured with). They carry
  `requireIdentity` explicitly at the call site.

## Participant symmetry

Human users and AI users must have the same effective platform permissions and workspace access. Treat them as two signup/auth methods for the same kind of participant, not as separate capability tiers: a human user should be able to do everything an API-key user can do, and vice versa, once identity is established.

## Frontend goes through the public API

The web frontend MUST call the same `/api/*` endpoints that an external participant would call. There is one backend code path per capability, not two (one for the UI, one for the API). Concretely:

- Anything the UI can do, an API key (master or per-agent) must be able to do via the same endpoint. No browser-session-only routes for capabilities that participants are also entitled to.
- Anything an API client can do appears in `GET /api/help` so participants can discover it. If a frontend page calls a route that isn't documented there, that's the bug, not the docs.
- Auth gating is via `requireCapability` / `requireSelfOrAdmin` / `requireIdentity` over the unified `req.auth` (which resolves master key, agent key, or browser session into the same shape). `requireUser` (browser-session-only) is reserved strictly for endpoints that are intrinsically tied to BetterAuth account state (sign-in, sign-up, password reset, OAuth callbacks). Any other use of `requireUser` is a parity bug.
- Don't add a parallel backend handler for the UI. Reuse the documented endpoint or extend it.
- **`src/lib/api.ts` is the only frontend module allowed to call `fetch`** (2026-08-21). A component that talks to the server directly is invisible to the parity checks, which read that one file; eight such calls had accumulated by the time this rule was made executable (the waitlist in four places, the Manifold import in two, guides, legal, public-config). Add a method there and call it. `api-parity.test.ts` fails the build on a stray `fetch(`, and the same rule is what makes an assistant acting with a visitor's session able to do exactly what the visitor's own UI can do, and nothing else.

This is what makes "alignment layer for AI and humans" honest: the UI is just one of many participants of the API. A test under `functions/src/__tests__/api-parity.test.ts` enforces this; keep it green.

## Commit and push

After every feature implementation or bug fix, commit and push. Keep commit messages concise and descriptive.

**Branches and worktrees (adopted 2026-08-26, Viktor).** Work on a branch in its own worktree (`git worktree add ~/src/worktrees/telarchy-app/<branch> -b <branch> main` from the canonical checkout, symlink `node_modules` and `functions/node_modules` in), never switch the canonical checkout (`~/src/telarchy/telarchy-app`) to another branch: around twenty sessions share it, and a switch moves every one of them. Check `git rev-parse --show-toplevel` and `git branch --show-current` before every edit or git write. Main cannot be pushed to directly (owner ask 2026-08-27): the GitHub ruleset "main: branches only, green CI, no force push" requires a pull request whose CI is green, and `scripts/check-not-main.sh` refuses a commit on main before it happens (the hook is installed by `sh scripts/install-hooks.sh`; `npm run prepare` cannot write it into a submodule or worktree checkout, whose `.git` is a file). Ship (`gh pr create --fill`, then `gh pr merge --rebase --auto --delete-branch`, which merges when the checks pass and retires the branch; then `git merge --ff-only origin/main` in the canonical checkout) only when the change is finished, verified, and what the owner asked for in that session; otherwise leave it on its pushed branch and name it in the reply together with its preview, `https://telarchy.com/beta?branch=br-<name>`, which CI puts up for every pushed branch (docs/infra/deploy.md, "Branch previews"). In the canonical checkout, commit only by path (`git commit -- <paths>`), never `git add -A` or `commit -a`. The full procedure is the telarchy umbrella's `CLAUDE.md`, "Branches and worktrees".

## Keeping the test suite in sync

**The suite is the deploy gate (owner ask 2026-08-15).** `.github/workflows/deploy-cloudrun.yml` runs `checks` (type check + frontend suite + production `vite build`, since tsc alone misses a broken import path or a bundler failure) and `backend` (the jest suite sharded three ways), and the deploy job needs both, so a red suite means main does not ship and the previous revision keeps serving. The sharding is not cosmetic: every backend suite boots its own pglite and applies every migration, and one runner holding all 82 died with SIGTERM around eight minutes, taking the gate down with it. `.github/workflows/test.yml` runs the same thing on every push and pull request. A tag-then-promote smoke test only proves the container boots; it cannot catch a market anchored at the wrong price, which is exactly what reached production twice in one afternoon. Never route around the gate by deploying by hand.

Auth is deny by default: every `/api` route is authenticated unless its prefix is in `OPTIONAL_AUTH_PREFIXES` (`functions/src/middleware/route-policy.ts`); `route-auth-guard.test.ts` enforces the rule and `route-auth-matrix.test.ts` pins every route's status for anonymous, agent-key and master-key callers (regenerate deliberately with `UPDATE_AUTH_MATRIX=1` and read the diff). See `ARCHITECTURE.md`.

Run the test suite (`npm test`) before committing anything non-trivial, and always after touching backend logic (metrics engine, auth, workspaces, markets, credits, formulas, templates). `npm test` runs both backend Jest (under `functions/`) and frontend Vitest (root); `npm run test:frontend` runs frontend only; `npm run test:ci` is what CI runs (bounded workers, long hook timeout). Fix failures before moving on; do not commit with a red suite.

**Every bug that reached production leaves a test behind.** Not a test that the fix compiles: one that FAILS against the old code and describes the user-visible symptom in its name. Before writing it, check that it fails, by reverting the fix or mutating the constant. A test that cannot fail is worse than none, because it reads as coverage. Recent examples to imitate: `conditional-open.test.ts` (a pair's opening price, after three separate ways it went wrong in one day), `void-refund.test.ts` (what a cancelled market pays back), `waitlist-source.test.ts` (where a signup came from).

**Prefer the cheapest test that can catch the bug.** Most of these failures were arithmetic or a wrong argument at a call site, so a pure function test with no database beats an HTTP test: it runs in milliseconds, so there is no excuse to skip it, and it fails with the number rather than a status code. Reach for the pglite harness when the behaviour IS the database (settlement, refunds, migrations, auth), and for `@testing-library/react` when it is what a visitor sees.

**Two surfaces that show the same fact must derive it from the same place.** Not by convention: by having one function that answers the question, and a test that fails if a second copy appears. Every visible floor bug in the week of 2026-08-11 was one field disagreeing with another inside one screen - a price series drawn under the wrong market, a caption calling the decision "speed", an impact unit taken from a stale end-of-array convention - and each was reported by the owner rather than caught by CI. `src/lib/floor-horizons.ts` is the pattern: it owns the order of the horizons, the role of each, its labels, its metric history, and the lookup of a price series BY MARKET ID; `src/lib/__tests__/floor-horizons-ownership.test.ts` greps the frontend and fails if any other file reads the inline price replay, reverses `markets`, end-indexes it to mean "the primary", or defines a second `currencyOf`. When you find yourself computing "which one is the real one" at a call site, that computation belongs in a model with a name.

**A migration exists only if `drizzle/meta/_journal.json` names it.** drizzle-kit applies the journal, in idx order; a hand-written .sql file that nobody journalled never runs in production. Writing the file is half the job - append the entry (`idx` next, `tag` equal to the filename without .sql, `when` after the previous one). The test harness replays the journal too, so an omission fails locally instead of shipping: it used to glob the directory, which is how an unjournalled `ADD COLUMN resets_every` passed 820 tests and then 500'd every public floor the moment the code reading that column deployed (2026-08-17). `migrations-journal.test.ts` pins both directions of the contract.

**Payload coherence gets its own suite.** `functions/src/__tests__/floor-payload-coherence.test.ts` builds a production-shaped floor (two clocks, contracts in every state, trades, readings) and asserts the cross-field invariants a reader depends on: a price inside its band, `resolvesOn` equal to the target period's settle instant, the list soonest-first, the inline replay naming a market that exists and ending where that market currently is, one history row per open market with its own readings, `periodStart` matching its target date, and every contract pair sitting on a horizon the floor still has. Add a field to that payload, add its invariant there. This is the file that would have caught four of the five bugs above before a human saw them.

**Pin the invariant, not the implementation.** "An untraded pair predicts nothing" survives a refactor; "anchoredMarketState returns 63.9" does not. When a number appears in an assertion, say where it comes from in a comment, so the next person can tell a broken expectation from a broken product.

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

Any commit that changes a file under `docs/` regenerates the human-readable mirror in the same commit: `python3 scripts/build-docs-mirror.py` rewrites `browse/index.html` deterministically from `docs/` (needs `markdown-it-py`). A stale mirror is a divergence; the markdown wins.

## Browser-driven test specs

`qa/browse/` is the repo's browser-driven acceptance-test suite: a derived
test artifact (spec scripts plus the `_runner/`), not governing docs, which
is why it lives under `qa/` and not `./docs` (per the docs-driven practice,
tests live outside `./docs`; the behavioral guarantees they enforce belong
in the governing docs). When verifying UI features, prefer these structured
specs over ad-hoc browsing. Each file is a per-feature script of `browse`
(`$B`) commands and expected results, runnable end-to-end without inferring
intent. The master index is `qa/browse/README.md`.

When you ship a UI-affecting change, either update the relevant existing
spec or add a new one (use `07-admin/cockpit-page.md` as the
gold-standard template; `bot-agents-panel.md` went with the console), and, when the change adds or alters a behavioral
guarantee, promote that guarantee into the governing doc that owns it (not
only into the test). Specs are organised by category subdirectory
(`00-anonymous` … `13-infra-and-abuse`) and run in parallel via
`_runner/run.sh`; see `qa/browse/README.md` for the full index.
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
- The admin account's credentials live in the private keyring only
  (`keyring/telarchy/admin.env`, `ADMIN_EMAIL` / `ADMIN_PASSWORD`). Never commit them
  anywhere in this repo; `functions/src/__tests__/no-committed-secrets.test.ts` fails the
  build on a password literal.

**The public trading floor** (the `telarchy.com/lookpilot` page) can be
iterated locally with hot reload instead of a ~8 minute deploy per look:
`node scripts/seed-local-floor.mjs` (dev servers running) seeds a local
mirror workspace (slug `lookpilot`, hero metric with the production range
and horizon, seeded price history, an open Public group so silent-join
grants trading, and one sample job with branch markets); then iterate at
`http://localhost:5173/lookpilot`. The script is resume-safe; its market
maker's key persists in `scripts/.local-floor-maker.json` (gitignored).

Use a browser or a headless tool to navigate the app as this user. This account has admin/owner access to the primary workspace, so all features should be accessible.

When debugging a UI bug or feature, always reproduce it at this URL with these credentials before drawing conclusions from code alone.

**API access as this user** (for backend debugging):
```bash
# Sign in and save session cookie
curl -s -c /tmp/cookies.txt -X POST http://localhost:8080/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"

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

## Debugging with the API

When uncertain about a bug or data state, use the live API directly before making code changes. Do not guess; verify.

**Base URL**: `https://telarchy.com/api`
**Auth header**: `X-API-Key: $TELARCHY_MASTER_KEY` - the master key is NOT committed to this repo (it is public). Canonical source: the private `Reblexis/keyring` repo (`keyring/telarchy/master.env` in the telarchy umbrella; `source` it or read it from `cli-agents/_runner/registrars.json`).

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

The production Telarchy agents live in a separate repo: **`~/src/telarchy/telarchy-agents`** (umbrella submodule). The main fleet is `cli-agents/` (prose/script agents: `impact-analyst`, `external-researcher`, `skeptic`, `market-evolver`), which since 2026-06-07 runs **on the kpi-sync Hetzner box** (5.75.140.10, `telarchy` Linux user) as per-agent systemd units `telarchy-agent@<name>` - see `telarchy-agents/deploy/bootstrap-vps.md` for host setup and ops commands. They are managed through `GET/POST /api/admin/agent-control(s)` plus the agent-telemetry endpoints, with the master key. The platform-admin **/agents** page that used to drive those endpoints was deleted with the rest of the console on 2026-08-19; the control plane itself is untouched, so pause/resume/run-now is a curl away until a surface for it exists in the floor's design language.

- The older Node/TypeScript service (`src/`, strategies `anchor`, `momentum`, `stabilizer`, `blended`, `ai-analyst`, `ai-researcher`) still exists with local systemd units (`telarchy-agents-prod.service`); its bots push the same telemetry but do NOT poll the control plane, so the control endpoints are inert for them.
- Multi-workspace discovery joins public workspaces via `GET /api/marketplace/workspaces/public` + `POST /api/marketplace/:id/join` using each bot's own `X-Agent-Key`, the same flow any third-party agent uses. Trading rights come from the workspace's Public-group capabilities; bots do not self-promote via admin key.

There is no openclaw-based bot trading (the `~/.openclaw` scaffolding is unrelated; the earlier hook-watcher / skill references point at a deprecated integration path). To change cli-agent behaviour, edit the agent's `strategy.md` (or `run` script), push, then `git pull` + `systemctl --user restart 'telarchy-agent@*'` on the box.


If modifying the api capabilities or otherwise changing behaviour of the backend relevant to api communication, always update the documentation and api help endpoint correspondingly as well as the skill description.

**The first season is SEASON 0 (renamed 2026-08-19), and its page carries an
"experimental, expect bugs, reports appreciated" notice above the entry
button.** Rules are `/legal/season-0`; `/legal/season-1` keeps serving them
permanently, because a rules URL that has been quoted must not 404. Entry
collects a contact email (an API-registered participant has none anywhere else,
and an unreachable winner's prize expires quietly) and an 18-or-older
confirmation, both recorded with their instant; the payouts endpoint returns
the email so the owner can actually notify winners.

**The prize competition has its own page, `/season` (owner direction
2026-08-19).** `SeasonPage` carries the countdown, the pool and ladder, how
scoring works, the rules link, the entry button and the standings. The home
page, a market page's rail and `/leaderboard` carry ONE line and a link; do
not grow the season back into them, because their job is the market and the
board. The home page's strip (`SeasonDoor` in `FloorsPage`, added 2026-08-21)
is the exception that earns its space: the season is the recruiting mechanism,
so every post pointing at `telarchy.com` has to land on a page that tells a
trader there is money and where to go. It renders nothing when no season
exists rather than an empty frame. Entry
requires `acceptedRules: true` and nothing else, recorded as
`season_entries.rulesAcceptedAt` and never cleared. A payment-details gate was
added and removed the same day: entry stays one click for a cold visitor and
winners are asked at claim time.

**A season starts itself (owner direction 2026-08-20: "make it automatic").**
`POST /api/cron/seasons` starts every draft whose published `startsAt` has
passed; Cloud Scheduler job `seasons-autostart` calls it every 10 minutes.
Late is fine, early is impossible, and the due-check has a test that fails if
it is dropped. The start logic lives in `services/seasons.ts` so the endpoint
and the scheduler run the same function; do not inline it back into the route.
Note the legacy `dailyresolve` / `dailymarketrefresh` Cloud Run services are
SEPARATE deployments from `api`, so adding work to `/api/cron/resolve` does not
put it on that schedule.

**Season entry opens before the season starts (owner direction 2026-08-18).**
`isOpenForEntry` returns true for a `draft` season, `GET/PUT /api/seasons/me`
resolve the running season OR the next draft, and `POST /:id/start` carries
`optedIn`/`enteredAt` across instead of rebuilding the entry table from the
board (it used to `delete` every row, which would have silently un-entered
everyone who signed up early). Fairness is unchanged: the baseline is still
read for everyone at the start instant. All four surfaces that show the
countdown take it from `src/lib/season-clock.ts`;
`season-clock-ownership.test.ts` fails if a second copy appears.

**The market list is the home page (owner direction 2026-08-20).**
`telarchy.com` renders `FloorsPage`; `/marketplace` redirects to it and the
catch-all lands there too, so an unknown address shows the whole list rather
than one company's market. The page carries NO title: "Marketplace" labelled
the furniture, and a first-time visitor needs to know what any of this is. The
claim is the `h1` instead, in the display face, with one supporting line under
it. Keep that copy dual-scope ("someone", not "a company"): individuals run
personal goals here and are first-class.

## Market integrity (Season 0)

Governing doc: `docs/market-integrity.md`. Three rules, all owner decisions of
2026-08-18, all with tests that fail against the old behaviour:

1. **Editing a metric's name or description never voids its markets.** It
   writes an append-only `metric_definition_revisions` row instead, rendered on
   the floor beside the definition. Editing its `formula` or `marketRangeMax`
   is refused with 409 while any market on it is open, because that is what an
   open market prices inside. Do not reintroduce void-and-respawn on edit.
2. **Nothing takes money off a participant who did not agree.** Voiding a
   market and deleting a metric are refused once anyone has traded; deleting a
   workspace is refused while a running prize season names it. These guards sit
   at the ROUTE layer, never inside `voidMarket`, because six of its nine
   callers are the engine's own lifecycle. `POST /api/system/reset-economy` was
   deleted outright rather than guarded.
3. **`services/credits.ts` is the only code allowed to write `agents.balance`.**
   `applyCredits` moves the money and writes the `credit_ledger` row in one
   transaction. `credit-ledger-ownership.test.ts` fails the build if a second
   writer appears, and `credit-ledger-reconciliation.test.ts` proves the
   ledger sums to the balance.

## The ledgers are append-only

`trades` and `liquidity_events` are the record a market settles on: every
price, payout and refund is derived from them, so an edit rewrites what a
market settled on and nothing in the app would notice. A database trigger
(migration 0055) refuses UPDATE and DELETE on both, so a hand-written
statement in a psql session is as constrained as the app. This exists
because a stray smoke-test trade was removed from production with exactly
such a DELETE on 2026-08-15.

To correct history, add a row that supersedes it (an unwinding trade, a
compensating injection), never an edit. The handful of operations that
genuinely destroy history (deleting a workspace or a participant,
resetting a workspace, re-attributing an LP row to whoever funded it) call
`allowLedgerAdmin(tx)` first, which unlocks the tables for that one
transaction and nothing beyond it. If you reach for that helper in new
code, answer first why the history should disappear rather than be
superseded.

Known gap, not yet closed: deleting a participant unwinds their positions
by moving the market's shares and pool directly, so the price moves and no
row explains it. Removing that history is currently sanctioned; recording
the unwind as real trades would be better.

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