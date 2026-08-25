# Backend deploy (Cloud Run, via GitHub Actions)

The backend (`api` service on Cloud Run, project `telarchy-e0043`, region
`us-central1`) builds on every push to `main` via
`.github/workflows/deploy-cloudrun.yml`, which deploys a no-traffic
candidate revision for smoke testing; production traffic moves only when a
human publishes that candidate (see "Nothing reaches the public until you
press Publish" below). The workflow and the hand deploy (`npm run deploy`,
which runs `scripts/deploy-managed.sh`) share the same
`gcloud run deploy api --source . --region us-central1 --allow-unauthenticated
--memory 512Mi --cpu 1 --max-instances 4 --set-cloudsql-instances ...
--clear-base-image` command, and both regenerate the data room's change log
(`scripts/build-changelog.mjs`) first. They differ in three ways:

- The workflow lands the revision with `--no-traffic --tag candidate` and
  `--min-instances 1`; the hand deploy passes neither `--no-traffic` nor
  `--tag`, so the revision it lands is not a candidate and does not pass
  through the publish gate, and it uses `--min-instances 0`.
- The workflow passes `--update-env-vars ALLOWED_ORIGIN=https://telarchy.com,
  TRUSTED_ORIGINS=<the candidate tag URL>` and `--update-secrets
  API_KEY=API_KEY:latest,GITHUB_CLIENT_SECRET=GITHUB_CLIENT_SECRET:latest`;
  these are merged into the service's configuration, so every other env var
  and secret set on the service is inherited by the new revision. The hand
  deploy passes no env or secret flags and inherits everything.
- The workflow runs the test suite and the migrations first; the hand deploy
  runs neither.

The hand deploy is for an incident or a hotfix, not the routine path:

```bash
cd telarchy-app
GCP_PROJECT=telarchy-e0043 CLOUDSQL_INSTANCE=telarchy-e0043:us-central1:telarchy-pg npm run deploy
```

`GCP_PROJECT` and `CLOUDSQL_INSTANCE` (`project:region:instance`) are
required by the script; `CLOUD_RUN_REGION` defaults to `us-central1`.

History: notes/decisions/infra-deploy.md.

## Runners

Every job in every workflow under `.github/workflows/` declares
`runs-on: ubuntu-latest`, GitHub's hosted runners. The repository also has
self-hosted runners registered; a job runs on one of them only when it
declares `runs-on: [self-hosted, telarchy]` (plus `x64` to pin the laptop),
and no workflow does.

| Runner | Where | Labels | Takes |
|---|---|---|---|
| `popos-laptop`, `-2`, `-3`, `-4` | Viktor's laptop, systemd system services (`actions.runner.Reblexis-telarchy-app.*`) | `x64, telarchy` | any job tagged `[self-hosted, telarchy]`, with or without `x64` (4 runners = the 4 pipeline jobs in parallel) |
| `kpi-sync-box` | Hetzner box, `telarchy` user, `systemd --user` unit `actions-runner-telarchy-app` | `arm64, telarchy, light` | only jobs tagged `[self-hosted, telarchy]` without `x64`. **MemoryMax=1536M**: the fleet, bank and brain live on that box, and a CI job never gets to eat them |

Rules for a job routed to the self-hosted runners:

- A job on the laptop runners needs the laptop ON. A push while it sleeps
  queues (GitHub holds jobs ~24h) and runs on wake.
- A deploy job on them pins `x64`, because the box has no gcloud and the
  migration step downloads an amd64 cloud-sql-proxy.
- Runner jobs use an isolated gcloud config (`CLOUDSDK_CONFIG` in each
  runner's `.env` points at `~/actions-runners/gcloud-config`), so WIF auth
  from CI never touches Viktor's own `~/.config/gcloud`.
- A docker publish on them pins `x64` so `ghcr.io/reblexis/telarchy-app`
  stays amd64.
- Add/repair a runner: `gh api repos/Reblexis/telarchy-app/actions/runners/registration-token -X POST`
  for a token, then `./config.sh --unattended --url ... --token ... --labels x64,telarchy --replace`
  in the runner directory (`~/actions-runners/telarchy-app*` on the laptop,
  `~/actions-runner-telarchy-app` on the box) and restart its service.

## One-time setup

The workflow supports two auth paths between GitHub and GCP and detects
which one is configured (presence of the `GCP_WORKLOAD_IDENTITY_PROVIDER`
variable). Workload Identity Federation is the path the managed instance
uses (no JSON keys to rotate; see "Keyless deploys"). The service-account-key
fallback exists for getting a fresh setup running in minutes; a setup can
start with Option B and migrate to Option A by adding the variables and
removing the secret.

The deploy job runs in the GitHub `production` environment, whose
deployment-branch rule is `main` only. The workflow reads four repository
variables: `GCP_PROJECT`, `CLOUDSQL_INSTANCE`, and the two WIF variables
below.

### Option A: Workload Identity Federation

One-time GCP setup (replace `<...>`):

```bash
PROJECT_ID=telarchy-e0043
POOL_ID=github
PROVIDER_ID=github
SA_EMAIL=cloudrun-deployer@${PROJECT_ID}.iam.gserviceaccount.com
GITHUB_REPO=Reblexis/telarchy-app

# 1. Create the service account the workflow will impersonate
gcloud iam service-accounts create cloudrun-deployer \
  --display-name="GitHub Actions Cloud Run deployer" \
  --project=$PROJECT_ID

# 2. Grant it what the workflow uses: deploy, build, push the image, read
#    the build bucket, act as the runtime account, tail logs, and (for the
#    migration step) tunnel to Cloud SQL and read DATABASE_URL
for role in run.admin cloudbuild.builds.editor artifactregistry.admin storage.admin \
            storage.objectViewer iam.serviceAccountUser logging.viewer \
            cloudsql.client secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/$role"
done

# 3. Create the WIF pool + provider
gcloud iam workload-identity-pools create $POOL_ID \
  --project=$PROJECT_ID --location=global

gcloud iam workload-identity-pools providers create-oidc $PROVIDER_ID \
  --project=$PROJECT_ID --location=global \
  --workload-identity-pool=$POOL_ID \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == 'Reblexis'"

# 4. Allow the repository, by name, to impersonate the service account
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --project=$PROJECT_ID \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository/$GITHUB_REPO"
```

Then in **GitHub > Settings > Secrets and variables > Actions > Variables**
(variables, not secrets; none of these is sensitive):

| Name | Value |
| --- | --- |
| `GCP_PROJECT` | `telarchy-e0043` |
| `CLOUDSQL_INSTANCE` | `telarchy-e0043:us-central1:telarchy-pg` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/github` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `cloudrun-deployer@telarchy-e0043.iam.gserviceaccount.com` |

The workflow picks up these variables and auths via OIDC. No JSON key
ever leaves GCP.

### Option B: Service-account JSON key (fallback)

```bash
PROJECT_ID=telarchy-e0043
gcloud iam service-accounts create cloudrun-deployer \
  --display-name="GitHub Actions Cloud Run deployer" \
  --project=$PROJECT_ID

SA_EMAIL=cloudrun-deployer@${PROJECT_ID}.iam.gserviceaccount.com
for role in run.admin cloudbuild.builds.editor artifactregistry.admin storage.admin \
            storage.objectViewer iam.serviceAccountUser logging.viewer \
            cloudsql.client secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/$role"
done

gcloud iam service-accounts keys create key.json \
  --iam-account=$SA_EMAIL --project=$PROJECT_ID
```

Then in **GitHub > Settings > Secrets and variables > Actions > Secrets**:

| Name | Value |
| --- | --- |
| `GCP_SA_KEY` | the entire contents of `key.json` (paste as-is) |

Delete `key.json` from the laptop after pasting. Rotate it every ~90
days. `scripts/setup-deploy-auth.sh` automates this option end to end.

## Nothing reaches the public until you press Publish

A push to `main` does not change what a visitor sees. The pipeline lands the
build and stops; telarchy.com keeps serving the previous revision until a
human presses a button.

```
push to main
   ↓
checks + backend suite green          (a red suite deploys nothing)
   ↓
migrations run against prod           (expand/contract, old revision still serving)
   ↓
deploy --no-traffic --tag candidate   (the new build, 0% of traffic)
   ↓
smoke test the candidate's own URL    (fails here = never reachable at all)
   ↓
STOP. The job summary prints where it is.
   ↓
telarchy.com/beta   →  the candidate, whole app, real database, your session
   ↓
[Publish this build] on the beta's stripe

Every internal link inside the beta stays on the beta: the frontend's
internal navigation is basename-aware and enforced by an ownership test
(see "Every internal link is base-aware" in docs/ui-conventions.md), so a
tester can walk the whole app under /beta without silently landing back on
the serving revision.
   ↓
traffic → 100% to that exact revision
```

**The beta is the whole app, not a preview of the frontend.** The candidate
revision serves its own API from its own container, so a beta page's requests
hit the beta's backend. That matters because the backend is where the risk
lives: a frontend-only preview exercises none of the server-side paths where
regressions reach production.

**It has its own database.** `telarchy_beta` is a second database on the same
Cloud SQL instance, mounted as `DATABASE_BETA_URL`, and it starts as a copy of
production so the beta is a faithful place to test rather than an empty one. A
proposal spawned on the beta is spawned in the beta database.

**The store is chosen per REQUEST, never per revision**, and that is the whole
safety argument. The revision serving the beta today is the exact revision
serving telarchy.com tomorrow, because publishing shifts traffic to it rather
than rebuilding it; an environment variable saying "I am the beta" would ride
through that promotion and point live traffic at the beta store. So
`lib/request-env.ts` decides from the request itself: a path under `/beta/`,
or a Host that is not a production host, is the beta, and everything else,
including anything unclear, is production. Mistaking a beta request for a
production one leaves visible test data on the live floor; the reverse
silently drops a real trade into a store nobody reads, so the tie goes to
production.

`db/client.ts` carries the choice in async context and `db` resolves per
query, so every existing call site is unchanged. `GET /api/public-config`
reports which store answered, the response carries `X-Telarchy-Store`, and the
beta stripe prints it: "own database", or "LIVE database" in bold if the beta
is ever wired to production again.

**Two things the beta shares with production.** Authentication (`/api/auth/*`
is not proxied, so sessions and user rows are production's), and therefore who
you are signed in as. A participant row for that user is created in the beta
store on first use.

**Refilling it.** The beta drifts as you test, and production moves on without
it. `scripts/refresh-beta-db.sh` replaces the beta store with a fresh copy of
production; it drops the schema whole rather than truncating, so a table that
exists only in the beta cannot outlive the experiment that made it. CI applies
every migration to both databases in the same step, because a beta whose
schema lags production fails on the code it exists to test.

**And it shares the database's connection budget.** Cloud SQL `telarchy-pg` is
a db-f1-micro with `max_connections=50` (a database flag; Cloud SQL's default
of 25 is not enough for prod and candidate revisions each opening pg's default
10-connection pool while instances failing their startup probe churn). The
standing contract:

- Each API instance opens **at most 4** pooled connections to production, plus
  **1** to the beta store and only if a beta request ever reaches that instance
  (the beta pool is created lazily, so an instance serving the public site
  never opens it). Five per instance either way. Both give up on an acquire
  after 5 seconds instead of queuing forever (`functions/src/db/client.ts`); a
  starved request fails fast as a 500, it does not hang for a minute.
- Cloud Run runs **at most 4 instances** per revision (`--max-instances 4` in
  the CI deploy). Worst case prod + candidate: 2 x 4 x 5 = 40 connections,
  inside the 50 budget with room for cloud-sql-proxy and cron.
- Anything that raises one of these numbers must re-do this arithmetic in the
  same commit. `scale-invariant.test.ts` pins it: prod + candidate at full
  scale must fit in 40.

**The performance posture around that budget:**

- Every response is compressed (`compression` in app.ts; the 615 KB bundle
  ships as ~164 KB) and the frontend splits per route, so only `/` and the
  floor ride in the entry bundle.
- The floor polls every 15 seconds, pauses in hidden tabs, and refreshes on
  focus. Each tick is ~5 endpoints; the cadence is a database-load decision,
  pinned by a test, not a frontend tweak.
- Price-history replays are cached 30s per market and invalidated the moment
  a trade or liquidity event lands (`lib/market-events.ts`). The floor
  payload as a whole is deliberately NOT cached: it carries ballots and
  settings with too many write paths to invalidate honestly.
- In-process scheduled jobs (resolve, limit sweep, refresh, maintenance) run
  on ONE instance per tick via a Postgres advisory lock
  (`lib/singleton-jobs.ts`); every other instance skips.
- Data retention runs in the daily maintenance job (visits 30d, question IPs
  30d, agent traces 90d, traces also capped per-write at 40 rows / 64 KB),
  never on a read path.

**Publish publishes the revision you are looking at**, not "latest". If CI
lands another build while you are reading, that one waits its turn. The button
is on the stripe at the top of every beta page (`BetaBanner`), backed by
`POST /api/admin/publish`, platform-admin only.

### Reaching it

**`telarchy.com/beta` IS the beta.** It is not a redirect. The revision serving
telarchy.com forwards `/beta/*` to whichever revision carries the `candidate`
tag, cookies and all, so:

```
telarchy.com/          published revision, published bundle
telarchy.com/beta/     published revision proxies → candidate revision
telarchy.com/beta/api/ same, so the beta exercises the beta's BACKEND
```

Same origin buys two things that a separate URL could not:

- **Google login works.** Google only redirects to URIs registered on the OAuth
  client, so a beta on its own run.app origin cannot complete a Google
  sign-in (every attempt ends in a redirect_uri error), and registering each
  future preview URL by hand in a console is not a workflow.
- **A tester needs no second session.** One cookie jar, so whoever is signed in
  on telarchy.com is signed in on the beta, and a tester other than the owner
  gets the same.

How it is built. A bundle's asset paths and API base are baked in at build
time, so the frontend is built twice: once at `/` and once with
`BASE_PATH=/beta/ VITE_API_URL=/beta` (`npm run build:beta` → `dist-beta`,
served from `lib/public-beta`). Requests to `/beta/api/*` have the prefix
stripped before routing, so the beta runs the SAME API handlers rather than a
second copy that could drift.

**One thing the beta does NOT run: its own auth.** `/api/auth/*` is not
prefixed, because better-auth's client uses its own base URL rather than ours.
Those calls go to the published backend. That is deliberate and load-bearing:
Google redirects only to `telarchy.com/api/auth/callback/google`, so prefixing
auth would break Google login on the beta. The session and the database are
shared anyway, so a signed-in tester is signed in on both. The gap it leaves is
real and small: a change to authentication itself is not exercised by the
beta, so verify those against the candidate's own run.app URL, where the whole
stack including auth is the new build.

**The proxy must run before the prefix strip.** `/beta/api/*` has its prefix
removed so the beta reuses the same handlers. If the strip ran first, by the
time the proxy looked at a request its path would already be `/api/...` and no
longer recognisable as the beta's, so every API call would be served by the
published backend: the candidate's frontend against production's API, the
exact preview this exists not to be, with nothing on screen saying so (it
shows as a Publish button that never appears, because `isServing` is answered
by production, where it is true by definition). `beta-proxy-order.test.ts`
pins the order. The proxy also has to sit after `express.json()`, or a
forwarded POST arrives with no body.

Note the bootstrap this creates: a change to the proxy itself only takes effect
once it is published, and while it is broken the button that would publish it
does not render. Publish that one from a terminal:
`gcloud run services update-traffic api --region us-central1 --to-latest`.

The prefix is a path SEGMENT: `/betamax` is a workspace slug and stays on the
published site. `beta-surface.test.ts` pins that, because getting it wrong
hands a visitor an unpublished build in place of a market.

The candidate's direct run.app URL still works (it serves its own beta bundle
when it has nothing to forward to) and is printed in the GitHub job summary and
in `GET /api/admin/release`.

### Publishing without the button

```bash
gcloud run services update-traffic api --region us-central1 --to-latest
```

### Rolling back

Same command, naming the revision:

```bash
gcloud run services update-traffic api --region us-central1 \
  --to-revisions <PREVIOUS_REVISION>=100
```

### Logging in on the beta

On `telarchy.com/beta` you are already logged in: same origin, same cookie jar.
That is the main reason the beta lives there.

On the candidate's direct run.app URL it is a different origin with its own
cookie jar, so you sign in again, and Google login does not work there at all
(its redirect URI is not registered). Email and password do. That path only
authenticates because `TRUSTED_ORIGINS` names the beta's origin in the deploy
command. Without it BetterAuth answers every sign-in on the beta with
`403 INVALID_ORIGIN`, nobody can log in, nobody sees the Publish button, and
nothing can be published from it. A cookie-less `curl` does **not** reproduce
the failure, because better-auth runs the origin check only on a request
carrying credentials, so verify this in a browser or not at all.
`beta-origin.test.ts` pins both directions.

`TRUSTED_ORIGINS` is deliberately separate from `ALLOWED_ORIGIN`: the latter
names the published site, and `publicOrigins()` uses it to decide which hosts
get `X-Robots-Tag: noindex`. The beta is trusted enough to log in to and never
indexable.

### The beta is a public URL on production data

Anyone who learns the candidate URL can open it, and it reads and writes the
real database. It is not linked anywhere and it is noindexed, but it is not
secret. If that becomes uncomfortable, the lockdown is to drop the
`allUsers` invoker binding on the service and put the beta behind IAP, at the
cost of the open-the-URL-and-look flow.

### The permission behind the button

The runtime service account (`telarchy-api@telarchy-e0043.iam.gserviceaccount.com`,
see "Runtime identity") holds two grants that Publish depends on, both scoped
to the one resource they concern rather than the project:

- `roles/run.developer` on the `api` service only: the release endpoint
  describes the service and Publish moves traffic.
- `roles/artifactregistry.reader` on the `cloud-run-source-deploy` repository:
  a traffic change re-validates the revision's image, so the runtime account
  needs READ on the image repository. Without it the publish fails with 403
  `artifactregistry.repositories.downloadArtifacts denied on
  cloud-run-source-deploy` and the beta shows "Internal error". Read only: it
  cannot push or delete an image.

Recreate them with:

```bash
gcloud run services add-iam-policy-binding api --region us-central1 \
  --project telarchy-e0043 \
  --member="serviceAccount:telarchy-api@telarchy-e0043.iam.gserviceaccount.com" \
  --role="roles/run.developer"
# A traffic change re-validates the revision's image: read on the image
# repository, and read only.
gcloud artifacts repositories add-iam-policy-binding cloud-run-source-deploy \
  --location us-central1 --project telarchy-e0043 \
  --member="serviceAccount:telarchy-api@telarchy-e0043.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"
```

Off Cloud Run there is no metadata server, so `releaseState()` reads as unknown
and publishing refuses. That is why local dev shows the stripe (localhost is
not the published origin) but no working button.

**Two traps in reading Cloud Run's state.**

- **Revision numbers are not chronological here.** A deploy from a worktree
  can land a low-numbered revision after the pipeline has moved the counter
  far past it, so a higher number can be the older revision. Judge age by
  `metadata.creationTimestamp`, never by the number.
- **A secret attached to the service is not a secret the service can read.**
  `gcloud run services update` accepts `--set-secrets` happily, and the
  revision then fails to become READY with `Permission denied on secret ...
  for Revision service account`. The runtime account
  (`telarchy-api@telarchy-e0043.iam.gserviceaccount.com`) needs
  `roles/secretmanager.secretAccessor` granted ON EACH SECRET:

  ```bash
  gcloud secrets add-iam-policy-binding <NAME> --project telarchy-e0043 \
    --member serviceAccount:telarchy-api@telarchy-e0043.iam.gserviceaccount.com \
    --role roles/secretmanager.secretAccessor
  ```

  This is quiet in the worst way: the deploy workflow goes green (it deployed;
  the revision just never started), production keeps serving the last
  published build so nothing looks broken, and `/beta` silently falls back to
  that build because there is no candidate to forward to. After adding a
  secret, check `gcloud run revisions list` for `STATUS True`.

**The beta shares your ACCOUNT, and only your account.**
`src/lib/auth-client.ts` pins BetterAuth to `window.location.origin` with
`basePath: '/api/auth'`, an absolute path, so a page served at `/beta/` signs
in against PRODUCTION auth while every other call it makes goes to `/beta/api`
and the beta store. That is deliberate in effect if not by design: it is what
makes Google login work on the real domain, which is the reason the beta lives
at telarchy.com/beta instead of on a run.app URL.

What it means in practice:

- Workspaces, metrics, markets, trades, contracts and credits on the beta are
  the beta's own. Nothing you do to them touches the live floor.
- Anything that writes to the ACCOUNT is live: signing up, password changes,
  profile edits, notification settings. Test those on the beta and you have
  changed your real account.
- A beta workspace is owned by your production user id, which is why it is
  there when you log in and why the participant row is created in the beta
  store on demand.

The banner says "own data, real account" rather than "own database" for this
reason. Do not "fix" the auth path without deciding what happens to Google
login on the beta first.

**The server has to agree with the browser about this.** `db/client.ts`
exports `authDb` (the account store, which never follows the swap) and
`auth.ts` binds BetterAuth to it, never to the per-request `db` handle:
otherwise a session created against production auth is looked up in the BETA
store on every `/beta/api` call, found nothing, and the caller comes back
anonymous while the page says signed in. `auth-store-binding.test.ts` fails if
that is tidied back. Everything else stays per-store, so a beta workspace is
real beta data keyed by the real account id.

## What the workflow does

On `push` to `main` (or `workflow_dispatch`); pushes touching only `**/*.md`,
`docs/**` or the self-sync workflow do not trigger it:

1. `checks`: type check, frontend suite, production bundle (`npm run build`).
2. `backend`: the backend suite in three shards (`npm run test:ci --shard=N/3`).
3. `deploy` (needs both, GitHub environment `production`): auths to GCP (WIF
   if configured, SA key otherwise), runs the migrations against production
   and then the beta database, regenerates the change log, and runs
   `gcloud run deploy --no-traffic --tag candidate`.
4. Smoke-tests the candidate (`/api/public-config` on the candidate's own URL
   must answer 200 within 20 tries) and stops without promoting.

Cloud Build does the actual image build server-side (faster than running
`docker build` on the runner because Cloud Build caches layers per-project).
Typical end-to-end time: ~3-5 minutes.

The workflow runs in concurrency group `cloud-run-deploy` with
`cancel-in-progress: false`: one deploy at a time, and the in-flight run is
never cancelled, it always finishes and lands a candidate. While it runs, a
new push is held pending and GitHub cancels any older pending run, so only the
newest queued commit waits and runs next. Forward progress is guaranteed and
the build that runs next is always the latest. Two builds never run at once:
there is a single shared `candidate` tag that two concurrent deploys would
clobber.

`.github/workflows/deploy-autorecover.yml` re-runs the failed jobs of a deploy
run that ends in `failure` (a runner dying mid-test, not a red suite) while
`run_attempt < 5`, so a transient runner death self-heals within minutes and a
genuinely red suite is still left red for a human after four retries. A run
that loses the concurrency race ends as `cancelled`, not `failure`, so it never
triggers this.

## Other workflows

- `docker-publish.yml` runs in parallel on every push to `main` and pushes the
  image to `ghcr.io/reblexis/telarchy-app` (tags `latest` and `sha-<short>`;
  concurrency `cancel-in-progress: true`, a newer push supersedes a queued or
  running build; the newest 8 versions are kept and older ones deleted so the
  package never crawls toward the ghcr storage quota). That image is redundant
  for production (Cloud Build does its own build) but it is what
  `docker-compose.yml` pulls for self-hosting and what `docker run` deploys
  use. Leave it.
- The production frontend is served by the same Cloud Run container as the
  backend (the Dockerfile copies the built bundle into `lib/public`); there is
  no separately hosted frontend.
- `telarchy-self-sync.yml` pushes the dogfooding workspace's hero metric daily
  at 23:40 UTC.

## The container

`Dockerfile` builds the backend (`functions/`), the frontend at `/`, and the
frontend a second time at `/beta/` (`npm run build:beta`, see "Reaching it").
The second bundle is built by default (`ARG BUILD_BETA=true`) because the
managed deploy (`gcloud run deploy --source`) passes no build args and an
empty `dist-beta` makes `/beta` serve the main bundle with the wrong asset
paths; self-hosters may pass `--build-arg BUILD_BETA=false` to skip it. The
container listens on port `8080` (`PORT=8080`).

The entrypoint is `docker-entrypoint.sh`: with `AUTO_MIGRATE=true` it runs the
database migrations (`node lib/migrate.js`) before starting the server, so
`docker compose up` on an empty database yields a working instance
(`docker-compose.yml` sets it). The managed deploy leaves `AUTO_MIGRATE`
unset and migrates in the deploy workflow instead, before the revision lands.
Required env: `DATABASE_URL`, `API_KEY`, `BETTER_AUTH_SECRET`; everything
else is documented in `.env.example`.

## Runtime identity

The API runs as `telarchy-api@telarchy-e0043.iam.gserviceaccount.com`, not the
default compute service account (which holds project Editor and still exists for
Cloud Build). Its grants are the smallest set the app uses: project roles
`cloudsql.client`, `logging.logWriter`, `monitoring.metricWriter`,
`cloudtrace.agent`; `secretmanager.secretAccessor` on each secret the service
references (a NEW secret needs the same binding or the revision fails to start);
`run.developer` on the `api` service itself and `artifactregistry.reader` on
the image repository (see "The permission behind the button").
`cloudrun-deployer` holds `iam.serviceAccountUser` so deploys can set it. A
change of runtime account is done the same way as any other change: a
no-traffic revision under the new account, smoke-tested through its own tag
URL (DB, secrets, master key, release describe, `/beta`), then
`update-traffic`. The default compute account keeps project Editor because
Cloud Build (`deploy --source`) uses it; removing it is a separate step.

## Keyless deploys

The deploy workflow authenticates with Workload Identity Federation: pool
`github`, OIDC provider `github` (issuer token.actions.githubusercontent.com,
attribute condition `repository_owner == 'Reblexis'`), and
`cloudrun-deployer@telarchy-e0043.iam.gserviceaccount.com` bound with
`iam.workloadIdentityUser` to the repository `Reblexis/telarchy-app` (by name,
so a public repository of the same name is covered). Repository variables
`GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT` select this
path in `deploy-cloudrun.yml`. No `GCP_SA_KEY` secret exists in the repository
and `cloudrun-deployer` carries no user-managed key; the JSON-key path is only
a bootstrap fallback, deleted from the repository and from the service account
once a WIF deploy succeeds.

## Master key rotation

The master key (`API_KEY`) is read by exactly one function, `isMasterKey` in
`functions/src/lib/master-key.ts`, which also accepts `API_KEY_PREVIOUS` when it
is set. That is the grace window: rotation is not a simultaneous cutover of every
reader (Cloud Run env, `registrars.json` on the box and the laptop, `master.env`
in the keyring, `_runner/claude_cycle.py`, the cron caller).

1. Generate the new key. Store it in the keyring (`keyring/telarchy/master.env`) as the
   new value and keep the old one beside it for the window.
2. Update Cloud Run with `--update-secrets` (Secret Manager references), never
   `--update-env-vars`: an env var value lands in revision history in plaintext.
   Set `API_KEY=<new>` and `API_KEY_PREVIOUS=<old>`.
3. Move every caller to the new key: fleet `registrars.json` (box and laptop),
   `master.env`, the runner, collectors, any Cloud Scheduler job that passes the key.
   The fleet instance has its own key and is unaffected.
4. After 24 hours (and never mid-cycle: cut over between weekly market pairs during a
   season), unset `API_KEY_PREVIOUS`. The old key then returns 401 everywhere.

## Cron schedule (Cloud Scheduler)

The market lifecycle is driven by two endpoints, `POST /api/cron/resolve` and
`POST /api/cron/refresh`, called with the master key. Both are idempotent and
cheap when there is nothing to do, and the refresh holds a per-workspace
cooldown lock. Who calls them depends on the instance:

- **Managed instance**: two Cloud Scheduler jobs (project `telarchy-e0043`,
  region `us-central1`, legacy `firebase-schedule-*` names):

  | Job | Schedule | Endpoint |
  |---|---|---|
  | `firebase-schedule-dailyResolve-us-central1` | `*/10 * * * *` (every 10 minutes) | `POST /api/cron/resolve` |
  | `firebase-schedule-dailyMarketRefresh-us-central1` | `10 * * * *` (hourly) | `POST /api/cron/refresh` |

  Hour-granularity markets (`YYYY-MM-DDTHH` target dates, `+Nh` custom
  horizons) need at least hourly resolution and rolling, so the managed
  cadence is never coarser than hourly.
- **Self-hosted instance**: nothing schedules itself. The operator triggers
  the same endpoints from crontab or any scheduler; `.env.example` ("Cron
  (self-hosted)") gives the daily template (`0 0 * * *` resolve, `10 0 * * *`
  refresh), which suits day-granularity markets; hour markets need the hourly
  cadence above.

Cloud Scheduler invocation time drifts (observed +12s to +80min past the
hour). That only delays payout, never changes the settled value: resolution
settles each market on the metric's value **as of `resolvesOn`** (last
`metric_logs` row at-or-before the period-end boundary), not the live value
at cron time, so a cron racing a metric push at the boundary cannot resolve a
market against the wrong hour's reading.

Rollback to daily:

```bash
gcloud scheduler jobs update http firebase-schedule-dailyResolve-us-central1 \
  --location=us-central1 --project=telarchy-e0043 --schedule="0 0 * * *"
gcloud scheduler jobs update http firebase-schedule-dailyMarketRefresh-us-central1 \
  --location=us-central1 --project=telarchy-e0043 --schedule="10 0 * * *"
```

## Owner notifications (Resend)

The `api` service sends mail through Resend (`functions/src/lib/notify.ts`):
owner notifications (new waitlist signup, new proposal) and participant
notifications (a comment under your contract, a reply in your thread, and
opt-in new-contract alerts; see docs/vision.md, "Participant email
notifications"). Two pieces of service config, set once on Cloud Run and
inherited by every CI deploy (the workflow's `--update-env-vars` and
`--update-secrets` are merged into the service's configuration and name only
`ALLOWED_ORIGIN`, `TRUSTED_ORIGINS`, `API_KEY` and `GITHUB_CLIENT_SECRET`, so
revisions keep everything else):

- `RESEND_API_KEY`: mounted from Secret Manager secret `resend-api-key`
  (source of truth: the keyring repo, `laptop/secrets/resend.env`).
- `OWNER_NOTIFY_EMAIL`: plain env var, the owner's inbox.

They are set with `gcloud secrets create resend-api-key` +
`gcloud run services update api --update-secrets=RESEND_API_KEY=resend-api-key:latest
--update-env-vars=OWNER_NOTIFY_EMAIL=... --no-traffic` (see the next
paragraph for why `--no-traffic`). With `RESEND_API_KEY` unset no
mail leaves at all, and with only `OWNER_NOTIFY_EMAIL` unset the owner's
own two notifications are off while participant mail still goes out; it
never fails the calling request either way. That is what local dev and the
test suite run on, so nothing under test can write to a real person. The
sending domain `telarchy.com` is verified in Resend.

**Changing a service-level env var PUBLISHES whatever is latest.** `gcloud run
services update --update-secrets=...` creates a new revision from the newest
image and routes 100% of traffic to it, which walks straight through the
publish gate and promotes whatever unpublished build is latest. Add
`--no-traffic` when you only mean to change configuration, then publish
deliberately from the beta.

`AI_GATEWAY_API_KEY` (Secret Manager secret `ai-gateway-api-key`) powers
the floor's Ask field (`POST /api/marketplace/:idOrSlug/ask`). It is a
**Vercel AI Gateway** key named `telarchy-floor-ask`, created against the
`agent-economy` team with a hard $50 budget and no refresh, so the spend
cannot run away: once it is gone the gateway answers 402, the endpoint
answers 502, and the floor simply stops offering answers. Unset means 503
and no field at all, which is what local dev and tests run on.

The model is `openai/gpt-5.6-luna` ($0.20 in / $1.20 out per million
tokens, about a tenth of a cent per question); `ASK_MODEL` overrides it
with any gateway slug without a deploy. `ASK_LIMIT_MAX` (default 6 per 5
minutes per IP) is the second ceiling and does not exempt API-key callers.

To read the remaining budget, or to top it up:

```bash
source ~/keyring/secrets/vercel-ai-gateway.env   # VERCEL_AI_GATEWAY_API_KEY
ENTITY=api_key_id_<the key id>
curl -s -H "Authorization: Bearer $VERCEL_AI_GATEWAY_API_KEY" \
  "https://ai-gateway.vercel.sh/v1/quotas?quotaEntityId=$ENTITY"
curl -s -X PATCH -H "Authorization: Bearer $VERCEL_AI_GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' -d '{"limitAmount":100}' \
  "https://ai-gateway.vercel.sh/v1/quotas?quotaEntityId=$ENTITY"
```

The same create-key-with-a-budget call is what `key-desk` in the
agent-economy umbrella does for agents; this is one more key on that team.

Participant mail also needs `BETTER_AUTH_URL` (or it falls back to
`https://telarchy.com`), because every one of those emails carries a link
back to the floor and a link to the account settings that switch it off.

## Memory

**512Mi.** At 256Mi the container is OOM-killed on almost no traffic, and
Cloud Run answers a killed instance's in-flight requests with 503; the
endpoint that takes it most often is `GET /api/marketplace/:slug`, i.e. the
public floor's own payload, so a visitor arriving from a shared link meets an
error page. Cloud Run names the cause itself in the logs ("the container
instance was found to be using too much memory and was terminated").

The limit is set in two places and they must agree: `scripts/deploy-managed.sh`
(the hand deploy, `npm run deploy`) and `.github/workflows/deploy-cloudrun.yml`
(the pipeline). Changing one without the other means the next pipeline deploy
silently reverts a hand fix.

To check whether it is still happening:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="api" AND textPayload:"too much memory"' \
  --project=telarchy-e0043 --freshness=6h --format='value(timestamp)' | wc -l
```

Raising the ceiling is not the same as fixing the footprint. The known hogs
are the board aggregates over a 348k-row `trades` table (see the cache note in
`functions/src/routes/leaderboard.ts`) and the share-card PNG renderer. If the
count above climbs again at 512Mi, profile before raising further.
