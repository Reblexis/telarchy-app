# Launch security review + safe-deploy plan (2026-08-12)

Pre-traffic hardening pass for telarchy.com. Three parallel audits (auth/authz,
input/attack-surface, infra/deploy) plus live verification against the prod
Cloud Run service and Cloud SQL. This doc is the remediation tracker; the
governing deploy procedure lives in `deploy.md` and is updated as items land.

Status legend: **[ ] open**, **[~] in progress**, **[x] fixed**.

## Headline

The code is in good shape on the classic web-app risks: **no SQL injection, no
XSS surface (no `dangerouslySetInnerHTML` anywhere), strong workspace isolation
(no IDOR found), no client-trusted identity/role, keys hashed + compared in
constant time, and no secret ships to the browser bundle.** The real exposure
is in two places: (1) one code path that lets a workspace admin run arbitrary
code on the server (formula evaluation), and (2) the cloud posture around
blast-radius and recoverability (over-privileged service accounts, a long-lived
deploy key, no point-in-time recovery, secrets stored inline). None of these is
anonymously exploitable on the public floor *today* because workspace creation
is invite-only and real-money cash-out is off (`USDC_SETTLEMENT_ENABLED=false`,
verified) - but they must be closed before self-serve signup or a second tenant.

## Findings (ranked)

### CRITICAL

**C1 - Server-side RCE via metric formula evaluation.** `[ ]`
`functions/src/lib/metrics-engine.ts` runs user-authored formulas with the
`Function()` constructor and no character allowlist; `validateFormula` only
warns. Any workspace owner/admin can store a formula that executes arbitrary
Node on the shared server the next time metrics recalc (any `GET /api/metrics`,
market refresh, or resolve). Combined with C2 this yields project-wide takeover.
Reachable by every design-partner workspace admin now; by everyone the moment
self-serve workspace creation opens.
Fix: replace `Function()` with a whitelisted expression evaluator (AST or strict
tokenizer); make `validateFormula` failures blocking at the write path
(`routes/metrics.ts`). Highest priority.

**C2 - Public Cloud Run service runs as the default compute SA, which has
project `Editor`.** `[ ]` `api` runs as `429618975282-compute@…` with
`roles/editor` project-wide, and is internet-exposed. Any RCE/SSRF (see C1)
mints a project-Editor token: read every secret, drop the DB, redeploy code.
Fix: dedicated least-privilege runtime SA (`cloudsql.client` + per-secret
`secretAccessor` on the ~10 secrets it reads), then
`gcloud run services update api --service-account=…`.

**C3 - Deploy pipeline uses a long-lived, broadly-privileged SA JSON key.** `[ ]`
No Workload Identity pool; CI authenticates with the `GCP_SA_KEY` secret.
`cloudrun-deployer` has two never-expiring user-managed keys and holds
`run.admin`, `storage.admin`, `artifactregistry.admin`, project-wide
`secretmanager.secretAccessor`, etc. A leaked GitHub secret = full prod
compromise. Fix: migrate to WIF (commands already in `deploy.md` Option A),
delete the `GCP_SA_KEY` secret and both user-managed keys, scope the deployer's
`secretAccessor` down to `DATABASE_URL` only.

### HIGH

**H1 - `GET /api/admin/floor-stats` leaks all-user PII to any workspace-level
manager.** `[x] fixed 2026-08-12` The handler was gated by
`requireCapability('manage')` (a *workspace* capability) but returns
*platform-global* data: every user's email + name + signup time, the full
waitlist with emails, and every visitor IP/country/referer/UA. Any non-admin
who owns/administers any workspace could harvest it. Fixed by gating on
`isPlatformAuthorized()` like the sibling admin routes.

**H2 - No point-in-time recovery + no deletion protection on Cloud SQL.** `[x]
fixed 2026-08-12` `telarchy-pg` had nightly backups only and was deletable. Since
migrations run against prod, a bad migration was recoverable only to the last
nightly backup (~24h loss). Enabled PITR + deletion protection.

**H3 - Unthrottled anonymous `POST /api/agents/register`.** `[x] fixed 2026-08-12` Not behind
`registrationLimiter` (only the ~600/min global anon limiter). Each call mints an
identity with `SIGNUP_CREDITS` and a full-scope key and auto-joins the Public
group. Free unlimited identities defeat the per-identity market-manipulation
caps on the public floor (the cap's own logic assumes identities are scarce).
Cash-out is off today, so no direct treasury drain, but the floor is
manipulable. Fix: mount `registrationLimiter` on `/api/agents/register`; add a
captcha/proof-of-work before self-serve launch.

**H4 - Master key + GitHub OAuth secret stored as inline plaintext env on Cloud
Run.** `[~] secret-backed 2026-08-12; rotation pending` Verified: `API_KEY` (the platform master key) and
`GITHUB_CLIENT_SECRET` are inline env values (not Secret Manager refs like the
other secrets), visible to anyone with `run.viewer` and retained in revision
history. Fix: move both to Secret Manager via `--update-secrets`, then rotate
the master key (it has been sitting in plaintext; rotation needs a keyring +
agents/cron coordination).

### MEDIUM

**M1 - CORS reflects any origin with credentials; BetterAuth `trustedOrigins:
['*']`.** `[x] fixed 2026-08-12` Verified live: an arbitrary `Origin` is reflected with
`Allow-Credentials: true`. Not a live session-theft hole because the session
cookie is `SameSite=Lax`, but the whole protection rests on that one cookie
attribute, and `['*']` weakens BetterAuth's CSRF defense now. Frontend is
same-origin, so the wildcard is unnecessary. Fix: set
`ALLOWED_ORIGIN=https://telarchy.com` on the service (and add it to the deploy
workflow so it persists).

**M2 - Workspace `manage` can mint globally-fungible credits.** `[ ]`
`POST /api/agents/:id/credit` is `manage`-gated but `agents.balance` is a single
platform-global balance, so a workspace admin's mint is spendable across every
workspace's markets. Cash-out off today limits it to market distortion. Fix:
gate `credit` on `isPlatformAuthorized`, or scope balances per-workspace.

**M3 - Trade inputs not checked for finiteness.** `[x] fixed 2026-08-12`
`routes/predictions.ts` / `services/trading.ts` check `typeof === 'number'` and
`<= 0` but not `Number.isFinite`, so `NaN` passes the guards (transfers and
proposals already check finiteness; trade is the inconsistent one). No
persistent corruption today - the `bigint` balance column rejects NaN and rolls
the txn back - but the caller gets a 500 instead of a clean 400. Fix: reject
`!Number.isFinite(...)` at the trade handler.

**M4 - Cloud SQL does not enforce SSL** (`ALLOW_UNENCRYPTED_AND_ENCRYPTED`). `[ ]`
App connects via the encrypted Auth Proxy socket, so no live impact; tighten to
`ENCRYPTED_ONLY`.

### LOW

**L1 - 500 error messages leak internal detail.** `[x] fixed 2026-08-12` The global handler
returns `err.message` for all errors including non-`AppError` 500s (raw driver/
Postgres text can reach the client; no stack trace though). Fix: generic
"Internal error" for `status >= 500`, keep detail server-side.

**L2 - Cross-workspace telemetry injection.** `[ ]`
`POST /api/admin/agent-traces` and `/agent-heartbeat` take `workspaceId`/
`agentId` from the body, so a workspace admin can forge telemetry rows for other
workspaces. Read paths are correctly scoped, so this is integrity only. Fix:
derive `workspaceId` from `req.auth`.

**L3 - Visitor-IP disclosure over plaintext HTTP.** `[ ]`
`functions/src/lib/ip-classify.ts` POSTs visitor IPs to `http://ip-api.com`
(cleartext, third party; admin-only path, not SSRF). Fix: use HTTPS; disclose in
the privacy policy.

### Addendum: public-surface review (2026-08-12, second pass)

A targeted review of the publicly reachable surface (the /lookpilot floor,
participant profiles, signup doors, and every endpoint reachable anonymously or
with a self-registered agent key) found four authorization-boundary gaps. All
four are **fixed** in commit `84daebc`; regression tests live in
`functions/src/__tests__/security-boundaries.test.ts`.

**S1 - Anonymous register into private workspaces.** `[x] fixed 2026-08-12`
`POST /api/agents/register` did no visibility check and auto-added the new
identity to the target workspace's Public (read) group, so anyone holding a
private workspace's UUID could mint a key and read its metrics, markets,
proposals, and activity. Now 404s private workspaces (same rule and same
unprobeable response as the join routes); callers holding `manage` in the
workspace (its owner registering a bot, or the master key) may still register
into it.

**S2 - Cross-tenant participant deletion.** `[x] fixed 2026-08-12`
`DELETE /api/agents/:id` was gated on workspace `manage` but looked the target
up globally, so manage rights in any workspace deleted any participant
platform-wide (agents row, keys, trades, deposits, withdrawals). Now requires
the target to be a member of the caller's workspace, mirroring the
`/:id/credit` guard.

**S3 - Workspace lifecycle routes acted on the path id without re-checking
it.** `[x] fixed 2026-08-12` `DELETE /api/workspaces/:id` and
`PUT /api/workspaces/:id/settings` verified the capability against the
`X-Workspace-Id` header workspace but operated on `req.params.id`, so an admin
of workspace A could delete or reconfigure workspace B. Both now re-verify the
capability against the path workspace.

**S4 - Agent reads leaked payment rails and identity bindings.** `[x] fixed
2026-08-12` `GET /api/agents` and `GET /api/agents/:id` stripped only
`apiKeyHash`, returning every co-member's `payoutMethod`, `payoutHandle`,
`walletAddress`, `authUserId`, and unconsumed `claimTokenHash` to any workspace
`manage` holder. Both now strip payment and identity fields for viewers other
than the participant itself, its registered owner, or the master key;
`claimTokenHash` never leaves the API for anyone.

This narrows the "workspace IDOR: verified clean" negative result below: it
held for the by-id read paths of markets/metrics/proposals, but the account and
lifecycle routes above were exceptions.

### Verified clean (negative results)

SQL injection (all `sql\`\`` interpolations bind params); XSS (no
`dangerouslySetInnerHTML`; share-meta HTML-escapes; share card renders to PNG;
emails are plaintext); workspace IDOR (every by-id handler filters on the
caller's `workspaceId`); privilege escalation (no client-trusted role/identity;
`X-Workspace-Id` only selects among real memberships; sub-keys can't exceed
granter scopes); key handling (`timingSafeEqual`, SHA-256-hashed agent keys,
256-bit entropy, never logged); no secret in the browser bundle
(`VITE_*` only; `DATABASE_URL`/master key never client-side); avatar URL
validation strict; no mass-assignment (explicit field allowlists).

## Remediation order

1. **Ship-blockers, before ANY meaningful traffic:** C1 (formula RCE), C2
   (runtime SA), C3 (WIF), H2 (done), H3 (register throttle), H4 (secret-back +
   rotate master key).
2. **Before a second tenant / self-serve signup:** H1 (done), M1 (CORS), M2
   (credit gate). Note self-serve is what turns the CRITICALs from
   "trusted-partner risk" into "anyone".
3. **Hardening sweep:** M3, M4, L1, L2, L3.

## Safe-deploy / staging plan

**Today's hazard:** push-to-`main` runs `drizzle-kit migrate` against **prod**
and then deploys to **100% traffic** in one shot. A bad migration or build hits
every user at once, and (pre-H2) a destructive migration was unrecoverable past
the last nightly backup.

### Minimal viable version (adopt now - real protection, ~1h setup)

1. **Recoverability floor** - PITR + deletion protection. **`[x] done 2026-08-12`**
2. **Tag-then-promote instead of deploy-to-100%.** **`[x] done 2026-08-12`** The
   deploy workflow now deploys with `--no-traffic --tag candidate`, smoke-tests
   the isolated candidate URL (`/api/status`), and promotes only on success; a
   bad build is never promoted and the previous revision keeps serving. Instant
   rollback: `gcloud run services update-traffic api --to-revisions=<prev>=100`.
   The workflow also declares `ALLOWED_ORIGIN` and the master-key/GitHub secret
   refs so the hardened config is reproducible in code.
3. **Test migrations on a throwaway clone before prod.** `[ ]` In CI, before
   touching prod: `gcloud sql instances clone telarchy-pg telarchy-pg-ci-$SHA`,
   run `drizzle-kit migrate` against the clone, delete it, and only then migrate
   prod. Needs `cloudsql.admin` on the deploy SA and adds ~2-3 min/deploy; PITR
   (item 1) already makes a bad prod migration recoverable, so this is the next
   increment, not a blocker.
4. **Required status checks on `main`:** `[ ]` `npm test` + the `qa/browse`
   acceptance suite green before merge (branch protection). Zero new infra.

**Migration discipline this depends on (expand/contract):** because the old
revision keeps serving during the `--no-traffic` window, migrations must be
backward-compatible - additive (new nullable columns/tables) in the same deploy;
destructive (drop/rename) split across two deploys (stop using the column, then
later drop it). This is what makes the canary window and rollback real.

### Full version (grow into it)

A persistent `api-staging` service + `telarchy-pg-staging` DB: `main`
auto-deploys to staging (migrations always hit staging first), promotion to prod
is a manual `workflow_dispatch`/tag. Periodically refresh staging from a prod
backup so migration tests run against realistic data. Overkill for day one; add
when shipping cadence rises.
