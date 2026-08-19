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

## What the workflow does

On `push` to `main` (or `workflow_dispatch`):

1. Checks out the repo.
2. Auths to GCP (WIF if configured, SA key otherwise).
3. Runs the same `gcloud run deploy` command as `npm run deploy`.

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

Participant mail also needs `BETTER_AUTH_URL` (or it falls back to
`https://telarchy.com`), because every one of those emails carries a link
back to the floor and a link to the account settings that switch it off.
