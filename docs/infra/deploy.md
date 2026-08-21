# Backend deploy (Cloud Run, via GitHub Actions)

The backend (`api` service on Cloud Run, project `telarchy-e0043`, region
`us-central1`) auto-deploys on every push to `main` via
`.github/workflows/deploy-cloudrun.yml`. The workflow is a one-for-one
mirror of `npm run deploy` in `package.json` — `gcloud run deploy api
--source . ...` — so behavior matches what you get when you run the
deploy locally.

If you ever need to deploy by hand (incident, rollback, hotfix from a
laptop offline), just run:

```bash
cd metrics-tracker
npm run deploy
```

It's the same command the workflow runs.

## The runners are ours (2026-08-21)

Every workflow runs on **self-hosted runners**, not GitHub's metered ones.
Reason: the repo is private, hosted minutes are billed per-minute there, and
on 2026-08-20 the GitHub spending wall stopped every job mid-incident
("recent account payments have failed or your spending limit needs to be
increased") - CI died exactly when it was needed. Self-hosted runners are
free without limit, and the laptop finishes a shard faster than a hosted
runner anyway.

| Runner | Where | Labels | Takes |
|---|---|---|---|
| `popos-laptop`, `-2`, `-3`, `-4` | Viktor's laptop, systemd system services (`actions.runner.Reblexis-telarchy-app.*`) | `x64, telarchy` | everything: tests, typecheck, docker publish, gh-pages, the Cloud Run deploy (4 runners = the 4 pipeline jobs in parallel) |
| `kpi-sync-box` | Hetzner box, `telarchy` user, `systemd --user` unit `actions-runner-telarchy-app` | `arm64, telarchy, light` | only jobs tagged `[self-hosted, telarchy]` without `x64` - today that is the scheduled self-sync, so it fires even with the laptop off. **MemoryMax=1536M**: the fleet, bank and brain live on that box, and a CI job never gets to eat them |

Consequences to know:

- Tests, docker and deploys need the laptop ON. A push while it sleeps
  queues (GitHub holds jobs ~24h) and runs on wake. That is the honest
  price of free; the alternative was a metered bill that failed closed.
- The deploy job pins `x64` because the box has no gcloud and the migration
  step downloads an amd64 cloud-sql-proxy.
- Runner jobs use an isolated gcloud config (`CLOUDSDK_CONFIG` in each
  runner's `.env` points at `~/actions-runners/gcloud-config`), so WIF auth
  from CI never touches Viktor's own `~/.config/gcloud`.
- The docker publish runs on x64 so `ghcr.io/reblexis/metrics-tracker-server`
  stays amd64.
- Add/repair a runner: `gh api repos/Reblexis/telarchy-app/actions/runners/registration-token -X POST`
  for a token, then `./config.sh --unattended --url ... --token ... --labels x64,telarchy --replace`
  in the runner directory (`~/actions-runners/telarchy-app*` on the laptop,
  `~/actions-runner-telarchy-app` on the box) and restart its service.

## One-time setup

You need to pick one of two auth paths between GitHub and GCP. Workload
Identity Federation is the recommended modern path (no JSON keys to
rotate). The service-account-key fallback works too if you need to get
this running in 5 minutes.

### Option A — Workload Identity Federation (recommended)

One-time GCP setup (replace `<...>`):

```bash
PROJECT_ID=telarchy-e0043
POOL_ID=github-actions
PROVIDER_ID=github-actions-provider
SA_EMAIL=cloudrun-deployer@${PROJECT_ID}.iam.gserviceaccount.com
GITHUB_REPO=Reblexis/metrics-tracker

# 1. Create the service account the workflow will impersonate
gcloud iam service-accounts create cloudrun-deployer \
  --display-name="GitHub Actions Cloud Run deployer" \
  --project=$PROJECT_ID

# 2. Grant it just enough to deploy
for role in run.admin cloudbuild.builds.editor storage.objectViewer iam.serviceAccountUser; do
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
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '${GITHUB_REPO}'"

# 4. Allow the WIF pool to impersonate the service account
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --project=$PROJECT_ID \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository/$GITHUB_REPO"
```

Then in **GitHub → Settings → Secrets and variables → Actions → Variables**
(yes, variables, not secrets — these aren't sensitive):

| Name | Value |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-actions/providers/github-actions-provider` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `cloudrun-deployer@telarchy-e0043.iam.gserviceaccount.com` |

The workflow picks up these variables and auths via OIDC. No JSON key
ever leaves GCP.

### Option B — Service-account JSON key (faster setup)

```bash
PROJECT_ID=telarchy-e0043
gcloud iam service-accounts create cloudrun-deployer \
  --display-name="GitHub Actions Cloud Run deployer" \
  --project=$PROJECT_ID

SA_EMAIL=cloudrun-deployer@${PROJECT_ID}.iam.gserviceaccount.com
for role in run.admin cloudbuild.builds.editor storage.objectViewer iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/$role"
done

gcloud iam service-accounts keys create key.json \
  --iam-account=$SA_EMAIL --project=$PROJECT_ID
```

Then in **GitHub → Settings → Secrets and variables → Actions → Secrets**:

| Name | Value |
| --- | --- |
| `GCP_SA_KEY` | the entire contents of `key.json` (paste as-is) |

Delete `key.json` from your laptop after pasting. Rotate it every ~90
days.

The workflow detects automatically which path you set up (presence of
the `GCP_WORKLOAD_IDENTITY_PROVIDER` variable), so you can start with
Option B and migrate to Option A later by adding the variables and
removing the secret.

## Nothing reaches the public until you press Publish

**Changed 2026-08-20 (owner: "i think deploying to prod is too easy").** A push
to `main` no longer changes what a visitor sees. The pipeline lands the build
and stops; telarchy.com keeps serving the previous revision until a human
presses a button.

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
   ↓
traffic → 100% to that exact revision
```

**The beta is the whole app, not a preview of the frontend.** The candidate
revision serves its own API from its own container, so a beta page's requests
hit the beta's backend. That matters because the backend is where the risk
lives: the three bugs that reached production in the week before this gate
existed (a marking convention, an anchored price replay, a voided market slot)
were all server-side, and a frontend-only preview would have caught none of
them.

**It shares the production database.** A contract you post or a trade you place
while testing on the beta is real and appears on the live floor. That is the
price of testing against real data; there is no second database.

**And it shares the database's connection budget.** Cloud SQL `telarchy-pg` is
a db-f1-micro with `max_connections=50` (flag set 2026-08-20; the default 25
took the site down that evening: prod and candidate revisions each opened pg's
default 10-connection pool, instances failing their startup probe kept
churning, and every slot was gone). The standing contract:

- Each API instance opens **at most 5** pooled connections and gives up on an
  acquire after 5 seconds instead of queuing forever
  (`functions/src/db/client.ts`); a starved request fails fast as a 500, it
  does not hang for a minute.
- Cloud Run runs **at most 4 instances** per revision (`--max-instances 4` in
  the CI deploy). Worst case prod + candidate: 2 x 4 x 5 = 40 connections,
  inside the 50 budget with room for cloud-sql-proxy and cron.
- Anything that raises one of these numbers must re-do this arithmetic in the
  same commit. `scale-invariant.test.ts` pins it: prod + candidate at full
  scale must fit in 40.

**The performance posture around that budget (perf plan 2026-08-20,
`telarchy` umbrella `notes/perf-plan-2026-08-20.md`):**

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

**`telarchy.com/beta` IS the beta** (owner ask 2026-08-20: "couldnt u just host
it directly on telarchy.com/beta? this way it would also better support other
testers than me"). It is not a redirect. The revision serving telarchy.com
forwards `/beta/*` to whichever revision carries the `candidate` tag, cookies
and all, so:

```
telarchy.com/          published revision, published bundle
telarchy.com/beta/     published revision proxies → candidate revision
telarchy.com/beta/api/ same, so the beta exercises the beta's BACKEND
```

Same origin buys two things that a separate URL could not:

- **Google login works.** Google only redirects to URIs registered on the OAuth
  client. On its own run.app origin the beta answered every Google sign-in with
  a redirect_uri error, and registering each future preview URL by hand in a
  console is not a workflow.
- **A tester needs no second session.** One cookie jar, so whoever is signed in
  on telarchy.com is signed in on the beta.

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
auth would break Google login on the beta all over again. The session and the
database are shared anyway, so a signed-in tester is signed in on both. The
gap it leaves is real and small: a change to authentication itself is not
exercised by the beta, so verify those against the candidate's own run.app URL,
where the whole stack including auth is the new build.

**The proxy must run before the prefix strip.** `/beta/api/*` has its prefix
removed so the beta reuses the same handlers, and for one evening that strip
was registered first: by the time the proxy looked at a request its path was
already `/api/...` and no longer recognisable as the beta's, so every API call
was served by the published backend. The beta was the candidate's frontend
against production's API, the exact preview this exists not to be, and nothing
on screen said so. It surfaced as a Publish button that never appeared, because
`isServing` was being answered by production, where it is true by definition.
`beta-proxy-order.test.ts` pins the order. The proxy also has to sit after
`express.json()`, or a forwarded POST arrives with no body.

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
That is the main reason it moved there (2026-08-20).

On the candidate's direct run.app URL it is a different origin with its own
cookie jar, so you sign in again, and Google login does not work there at all
(its redirect URI is not registered). Email and password do. That path only
authenticates because `TRUSTED_ORIGINS` names the beta's origin in the deploy
command. Without it BetterAuth answers every sign-in on the beta with
`403 INVALID_ORIGIN`, nobody can log in, nobody sees the Publish button, and
nothing can be published from it. Found by trying it (2026-08-20). A
cookie-less `curl` does **not** reproduce the failure, because better-auth runs
the origin check only on a request carrying credentials, so verify this in a
browser or not at all. `beta-origin.test.ts` pins both directions.

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

The runtime service account holds a custom project role,
`telarchyReleasePublisher` (`run.services.get`, `run.services.update`,
`run.revisions.get`, `run.revisions.list`), bound **on the `api` service
only**. It deliberately is not `roles/run.admin`, which would also let a
compromised admin session delete the service. Recreate it with:

```bash
gcloud iam roles create telarchyReleasePublisher --project=telarchy-e0043 \
  --title="Telarchy release publisher" --stage=GA \
  --permissions=run.services.get,run.services.update,run.revisions.get,run.revisions.list
gcloud run services add-iam-policy-binding api --region us-central1 \
  --member="serviceAccount:429618975282-compute@developer.gserviceaccount.com" \
  --role="projects/telarchy-e0043/roles/telarchyReleasePublisher"
```

Off Cloud Run there is no metadata server, so `releaseState()` reads as unknown
and publishing refuses. That is why local dev shows the stripe (localhost is
not the published origin) but no working button.

## What the workflow does

On `push` to `main` (or `workflow_dispatch`):

1. Checks out the repo.
2. Auths to GCP (WIF if configured, SA key otherwise).
3. Runs the tests, the migrations, and `gcloud run deploy --no-traffic --tag candidate`.
4. Smoke-tests the candidate and stops without promoting.

That's it. Cloud Build does the actual image build server-side (faster
than running `docker build` on the GitHub runner because Cloud Build
caches layers per-project). Typical end-to-end time: ~3-5 minutes.

The workflow is configured with `concurrency: cancel-in-progress` so if
several pushes land in a row, only the newest one actually deploys —
production always ends up on the latest commit, not a stale intermediate.

## What this replaces

- `docker-publish.yml` still runs in parallel and pushes the image to
  `ghcr.io/reblexis/metrics-tracker-server:latest`. That image is now
  redundant for production (Cloud Build does its own build), but it's
  useful for `docker run` deploys and CI smoke tests. Leave it.
- `deploy.yml` (Deploy to GitHub Pages) is separate — it builds the
  static frontend bundle and pushes it to the `gh-pages` branch. That
  bundle isn't what telarchy.com serves; the production frontend is
  served by the same Cloud Run container as the backend. The gh-pages
  build is for embeddable / docs use cases.

## Cron schedule (Cloud Scheduler)

Two Cloud Scheduler jobs (project `telarchy-e0043`, region `us-central1`,
legacy `firebase-schedule-*` names) drive the market lifecycle:

| Job | Schedule | Endpoint |
|---|---|---|
| `firebase-schedule-dailyResolve-us-central1` | `0 * * * *` (hourly) | `POST /api/cron/resolve` |
| `firebase-schedule-dailyMarketRefresh-us-central1` | `10 * * * *` (hourly) | `POST /api/cron/refresh` |

Both ran daily until 2026-06-05; they were switched to hourly when
hour-granularity markets (`YYYY-MM-DDTHH` target dates, `+Nh` custom
horizons) shipped, since those need hourly resolution and rolling. Both
endpoints are idempotent and cheap when there is nothing to do, and the
refresh holds a per-workspace cooldown lock.

Cloud Scheduler invocation time drifts (observed +12s to +80min past the
hour). Since 2026-06-06 this only delays payout, never changes the settled
value: resolution settles each market on the metric's value **as of
`resolvesOn`** (last `metric_logs` row at-or-before the period-end
boundary), not the live value at cron time. Before that fix, 6 of the
first 15 hour markets resolved against the wrong hour's reading because
the cron raced the metric push at the boundary.

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
inherited by every CI deploy (the workflow passes no env flags, so
revisions keep them):

- `RESEND_API_KEY`: mounted from Secret Manager secret `resend-api-key`
  (source of truth: the keyring repo, `laptop/secrets/resend.env`).
- `OWNER_NOTIFY_EMAIL`: plain env var, the owner's inbox.

Set up 2026-08-10 via `gcloud secrets create resend-api-key` +
`gcloud run services update api --update-secrets=RESEND_API_KEY=resend-api-key:latest
--update-env-vars=OWNER_NOTIFY_EMAIL=...`. With `RESEND_API_KEY` unset no
mail leaves at all, and with only `OWNER_NOTIFY_EMAIL` unset the owner's
own two notifications are off while participant mail still goes out; it
never fails the calling request either way. That is what local dev and the
test suite run on, so nothing under test can write to a real person. The
sending domain `telarchy.com` is verified in Resend.

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

**512Mi (raised from 256Mi on 2026-08-20).** At 256Mi the container was
OOM-killed nine times in six hours on almost no traffic, and Cloud Run
answers a killed instance's in-flight requests with 503. The endpoint that
took it most often was `GET /api/marketplace/:slug`, i.e. the public floor's
own payload: a visitor arriving from a shared link had a real chance of
meeting an error page. Cloud Run names the cause itself in the logs ("the
container instance was found to be using too much memory and was
terminated").

The limit is set in two places and they must agree: the `deploy` script in
`package.json` (the hand deploy) and `.github/workflows/deploy-cloudrun.yml`
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
