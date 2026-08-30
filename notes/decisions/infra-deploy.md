# Decisions and records: docs/infra/deploy.md

Records evicted from `docs/infra/deploy.md` on 2026-08-25; the doc states the resulting rules in present tense.

## 2026-08-28: The Publish button had been broken since the identity cutover

Found while shipping the settled-scoring amendment (PR #25): every press of
Publish answered "Cloud Run refused the publish (403)" since the 2026-08-25
runtime-identity cutover to `telarchy-api@`. The 2026-08-25 record below had
already noticed the loose end ("the custom `telarchyReleasePublisher` role
remains bound only to the old default compute account") but the real gap was
narrower than the role: `publishRevision` PUTs the whole service object, the
object's template names the runtime account, and Cloud Run demands
`iam.serviceaccounts.actAs` on any named account for ANY service update,
traffic-only included. `run.developer` on the service does not contain it,
and nothing granted `telarchy-api@` actAs on itself.

Diagnosed by impersonating `telarchy-api@` and replaying the exact GET+PUT
publishRevision performs (a no-op PUT of the unchanged object): 403 naming
`iam.serviceaccounts.actAs`. Fixed 2026-08-28 by an SA-level binding of
`roles/iam.serviceAccountUser` on `telarchy-api@` with `telarchy-api@`
itself as the member; the same no-op PUT then answered 200. The temporary
`serviceAccountTokenCreator` grant used for the diagnosis was removed after.
The settled-scoring build itself was published by hand
(`gcloud run services update-traffic api --region us-central1 --to-latest`)
before the fix, after verifying the candidate through /beta. The
`telarchyReleasePublisher` binding on the old compute account is now inert
and can be dropped whenever that account's project-Editor role is next
reviewed.

## 2026-08-27: The beta is admin only, and any branch can be built

Owner: "also it should be possible for me to load up any branch i might just have to rebuild or whatever.. and also make sure that /beta is admin gated.. not availble to everyoen", then, doubting the second half, "if that even helps considering its opensource..". Answer recorded in docs/infra/deploy.md ("The beta is admin only"): the code is public, a running unpublished build on a copy of production data is not. Result: `lib/beta-gate.ts` on both surfaces, `GET /api/admin/branches` + `POST /api/admin/branches/:name/build` behind an optional `GITHUB_ACTIONS_TOKEN`, the picker lists every branch.

## 2026-08-27: Main takes pull requests only

Owner: "poleasemake sure that all agents working on telarchy have to work onb ranches rather than main drieclty". Enforced twice: a GitHub ruleset on main (pull request required, the four CI checks required, no force push, no deletion, no bypass actors, created 2026-08-27 via the API, id 21649333) and `scripts/check-not-main.sh` in the pre-commit hook. The `git push origin <branch>:main` fast-forward of 2026-08-26 is gone; the ship is `gh pr merge --rebase --auto --delete-branch`.

## 2026-08-26: Branch previews at /beta

Owner: "could you add suppport to telarchy.com/beta to view different branches? how complex would that be?" On the connection budget: "how many connections would be needed? then I gues swe should go with raising, but at the same time we should cap and only show lets say 3 latest  or something like that". Trigger chosen: every pushed branch. Result: the "Branch previews" section of docs/infra/deploy.md; `max_connections` on telarchy-pg raised from 50 to 100 (the arithmetic is in "connection budget"); the cap is 3 previews. The flag was patched on 2026-08-26 at 12:56:34Z (`gcloud sql instances patch telarchy-pg --database-flags max_connections=100`, RUNNABLE again by 12:57:13Z, production answering). Follows the same-day adoption of branches and worktrees for all development (AGENTS.md, "Commit and push").

## 2026-08-25: The permission behind the button

Comment inside the IAM recreate block, beside the `gcloud artifacts repositories add-iam-policy-binding` command:

```
# Added 2026-08-25: a traffic change re-validates the revision's image, so the
# runtime account also needs READ on the image repository. Without it the
# publish fails with 403 "artifactregistry.repositories.downloadArtifacts
# denied on cloud-run-source-deploy" and the beta shows "Internal error"
# (owner report 2026-08-25). Read only: it cannot push or delete an image.
```

## 2026-08-25: Runtime identity (C2, done 2026-08-25)

Heading stamp: "(C2, done 2026-08-25)". C2 and C3 are finding ids from the launch security review (C2: the API ran as the default compute service account, which holds project Editor; C3: the long-lived `cloudrun-deployer` JSON key). The cutover narrative:

The cutover was done by
landing a no-traffic revision of the published image under the new account,
smoke-testing it through its own tag URL (DB, secrets, master key, release
describe, `/beta`), then `update-traffic`. Removing Editor from the compute
account is a separate step: Cloud Build (`deploy --source`) still uses it.

The section also said the account holds `run.developer` on the `api` service. Live state on 2026-08-25: `telarchy-api@` holds `roles/run.developer` on the service and `roles/artifactregistry.reader` on `cloud-run-source-deploy`; the custom `telarchyReleasePublisher` role (see the undated entry below) remains bound only to the old default compute account.

## 2026-08-25: Keyless deploys (C3, done 2026-08-25)

Heading stamp: "(C3, done 2026-08-25)". The key-fallback sentence:

the
`GCP_SA_KEY` JSON key is the fallback only until the first WIF deploy succeeds,
then it is deleted from the repository and from the service account.

Verified 2026-08-25: no `GCP_SA_KEY` secret in the repository, no user-managed key on `cloudrun-deployer`. The parenthesis "(by name, so the public repository of the same name after the rename is covered)" referred to the `metrics-tracker` to `telarchy-app` rename.

## 2026-08-24: The permission behind the button (Two traps in reading Cloud Run's state)

**Two traps in reading Cloud Run's state (2026-08-24).**

- **Revision numbers are not chronological here.** A deploy from a worktree
  landed `api-00437-6gs` at 21:33 while pipeline builds sat in the 005xx
  range, so `api-00542-vex` (17:46 the same day) is OLDER than 437 despite the
  higher number. Judge age by `metadata.creationTimestamp`, never by the
  number. I read the numbers once and reported a rollback that had not
  happened.
- **A secret attached to the service is not a secret the service can read.**
  [...] The runtime account
  (`429618975282-compute@developer.gserviceaccount.com`) needs
  `roles/secretmanager.secretAccessor` granted ON EACH SECRET:

  ```bash
  gcloud secrets add-iam-policy-binding <NAME> --project telarchy-e0043 \
    --member serviceAccount:429618975282-compute@developer.gserviceaccount.com \
    --role roles/secretmanager.secretAccessor
  ```

  [...] Every deploy for
  half a day in August 2026 was dead on arrival this way.

(The account named here was the runtime account until the 2026-08-25 cutover to `telarchy-api@`; the doc now names `telarchy-api@`.)

## 2026-08-24: The permission behind the button (The server has to agree with the browser)

**The server has to agree with the browser about this (fixed 2026-08-24).**
BetterAuth was built on the per-request `db` handle, so a session created
against production auth was looked up in the BETA store on every `/beta/api`
call, found nothing, and the caller came back anonymous. The page said signed
in and the API said stranger: on the operator door that surfaced as Otto
insisting "you are not signed in" underneath a note reading "Otto acts with
your account". `db/client.ts` now exports `authDb` (the account store, which
never follows the swap) and `auth.ts` binds to it; `auth-store-binding.test.ts`
fails if that is tidied back. Everything else stays per-store, so a beta
workspace is real beta data keyed by the real account id.

## 2026-08-24: Master key rotation

**Added 2026-08-24.** The master key (`API_KEY`) is read by exactly one function,
`isMasterKey` in `functions/src/lib/master-key.ts`, which also accepts
`API_KEY_PREVIOUS` when it is set. That is the grace window: rotation is no longer a
simultaneous cutover of every reader [...]

Step 2 gave the reason for `--update-secrets` over `--update-env-vars` as: "an env var value lands in revision history in plaintext, which is
exactly how the previous key leaked."

## 2026-08-23: The permission behind the button (The beta shares your ACCOUNT)

Heading stamp: "**The beta shares your ACCOUNT, and only your account (recorded 2026-08-23).**"

## 2026-08-21: The runners are ours (2026-08-21)

Section heading: "## The runners are ours (2026-08-21)". Its opening:

Every workflow runs on **self-hosted runners**, not GitHub's metered ones.
Reason: the repo is private, hosted minutes are billed per-minute there, and
on 2026-08-20 the GitHub spending wall stopped every job mid-incident
("recent account payments have failed or your spending limit needs to be
increased") - CI died exactly when it was needed. Self-hosted runners are
free without limit, and the laptop finishes a shard faster than a hosted
runner anyway.

The runner table said of `popos-laptop`: "everything: tests, typecheck, docker publish, gh-pages, the Cloud Run deploy (4 runners = the 4 pipeline jobs in parallel)" and of `kpi-sync-box`: "only jobs tagged `[self-hosted, telarchy]` without `x64` - today that is the scheduled self-sync, so it fires even with the laptop off." The consequences list said:

- Tests, docker and deploys need the laptop ON. A push while it sleeps
  queues (GitHub holds jobs ~24h) and runs on wake. That is the honest
  price of free; the alternative was a metered bill that failed closed.
- The deploy job pins `x64` because the box has no gcloud and the migration
  step downloads an amd64 cloud-sql-proxy.
- The docker publish runs on x64 so `ghcr.io/reblexis/metrics-tracker-server`
  stays amd64.

Superseded: on 2026-08-25 every job in every workflow under `.github/workflows/` declares `runs-on: ubuntu-latest` (`deploy-cloudrun.yml:45, 69, 87`, `test.yml:33, 60, 80`, `docker-publish.yml:20`, `telarchy-self-sync.yml:25`, `deploy-autorecover.yml:47`, `fresh-clone.yml:15`); the workflows' own comments still describe the self-hosted runners.

## 2026-08-20: Nothing reaches the public until you press Publish

**Changed 2026-08-20 (owner: "i think deploying to prod is too easy").** A push
to `main` no longer changes what a visitor sees. The pipeline lands the build
and stops; telarchy.com keeps serving the previous revision until a human
presses a button.

The three-bugs anecdote under "The beta is the whole app":

That matters because the backend is where the risk
lives: the three bugs that reached production in the week before this gate
existed (a marking convention, an anchored price replay, a voided market slot)
were all server-side, and a frontend-only preview would have caught none of
them.

The database owner ask:

**It has its own database** (owner ask 2026-08-20: "if we spawn a proposal
there it should be spawned in a beta version of db").

The connection-budget incident:

Cloud SQL `telarchy-pg` is
a db-f1-micro with `max_connections=50` (flag set 2026-08-20; the default 25
took the site down that evening: prod and candidate revisions each opened pg's
default 10-connection pool, instances failing their startup probe kept
churning, and every slot was gone).

The per-instance ceiling was described as "Five per instance either way, the same ceiling as before the
split."

The performance posture was headed:

**The performance posture around that budget (perf plan 2026-08-20,
`telarchy` umbrella `notes/perf-plan-2026-08-20.md`):**

## 2026-08-20: Reaching it

**`telarchy.com/beta` IS the beta** (owner ask 2026-08-20: "couldnt u just host
it directly on telarchy.com/beta? this way it would also better support other
testers than me").

On Google login: "On its own run.app origin the beta answered every Google sign-in with
a redirect_uri error, and registering each future preview URL by hand in a
console is not a workflow." On auth prefixing: "so prefixing
auth would break Google login on the beta all over again."

The proxy-order incident:

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

## 2026-08-20: Logging in on the beta

On `telarchy.com/beta` you are already logged in: same origin, same cookie jar.
That is the main reason it moved there (2026-08-20).

[...] nobody can log in, nobody sees the Publish button, and
nothing can be published from it. Found by trying it (2026-08-20).

## 2026-08-20: Owner notifications (Resend)

**Changing a service-level env var PUBLISHES whatever is latest.** `gcloud run
services update --update-secrets=...` creates a new revision from the newest
image and routes 100% of traffic to it, which walks straight through the
publish gate (done by accident on 2026-08-20 while mounting the beta database:
it promoted the unpublished Otto build to the live site).

## 2026-08-20: Memory

**512Mi (raised from 256Mi on 2026-08-20).** At 256Mi the container was
OOM-killed nine times in six hours on almost no traffic, and Cloud Run
answers a killed instance's in-flight requests with 503. The endpoint that
took it most often was `GET /api/marketplace/:slug`, i.e. the public floor's
own payload: a visitor arriving from a shared link had a real chance of
meeting an error page.

The two places were named as "the `deploy` script in
`package.json` (the hand deploy)"; that script runs `scripts/deploy-managed.sh`, which carries the value.

## 2026-08-10: Owner notifications (Resend)

Set up 2026-08-10 via `gcloud secrets create resend-api-key` +
`gcloud run services update api --update-secrets=RESEND_API_KEY=resend-api-key:latest
--update-env-vars=OWNER_NOTIFY_EMAIL=...`.

## 2026-06-06: Cron schedule (Cloud Scheduler)

Cloud Scheduler invocation time drifts (observed +12s to +80min past the
hour). Since 2026-06-06 this only delays payout, never changes the settled
value: resolution settles each market on the metric's value **as of
`resolvesOn`** (last `metric_logs` row at-or-before the period-end
boundary), not the live value at cron time. Before that fix, 6 of the
first 15 hour markets resolved against the wrong hour's reading because
the cron raced the metric push at the boundary.

## 2026-06-05: Cron schedule (Cloud Scheduler)

The table listed `firebase-schedule-dailyResolve-us-central1` at `0 * * * *` (hourly) and `firebase-schedule-dailyMarketRefresh-us-central1` at `10 * * * *` (hourly), then:

Both ran daily until 2026-06-05; they were switched to hourly when
hour-granularity markets (`YYYY-MM-DDTHH` target dates, `+Nh` custom
horizons) shipped, since those need hourly resolution and rolling.

Live Cloud Scheduler on 2026-08-25: `dailyResolve` runs `*/10 * * * *`, `dailyMarketRefresh` runs `10 * * * *`; no doc or note records when or why resolve moved from hourly to every 10 minutes. The doc states the live schedule.

## undated: Backend deploy (intro)

The
workflow is a one-for-one mirror of `npm run deploy` in `package.json`
(`gcloud run deploy api --source . ...`), so behavior matches what you get
when you run the deploy locally.

[...] It's the same command the workflow runs.

Superseded: the workflow passes `--no-traffic --tag candidate`, `--min-instances 1`, `--update-env-vars` and `--update-secrets` and runs tests and migrations; `scripts/deploy-managed.sh` has `--min-instances 0` and none of the rest, and needs `GCP_PROJECT` and `CLOUDSQL_INSTANCE`.

## undated: One-time setup, Option A

The Option A script and variable table used pool `github-actions`, provider `github-actions-provider`, repository `Reblexis/metrics-tracker`, attribute condition `assertion.repository == '${GITHUB_REPO}'`, and granted only `run.admin cloudbuild.builds.editor storage.objectViewer iam.serviceAccountUser`; the variable value was `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-actions/providers/github-actions-provider`. Superseded by the "Keyless deploys" configuration (pool `github`, provider `github`, condition `repository_owner == 'Reblexis'`, repository `Reblexis/telarchy-app`), which is the live pool on 2026-08-25; the role list now matches `scripts/setup-deploy-auth.sh` and the deployer's live project grants (the migration step needs `cloudsql.client` and `secretmanager.secretAccessor`).

## undated: The permission behind the button (custom role)

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

Superseded by the runtime-identity cutover: the current runtime account `telarchy-api@` holds `roles/run.developer` on the service (live 2026-08-25); the custom role stays bound to the old compute account. `functions/src/services/release.ts:50, 192` and `functions/src/lib/help-catalog.ts:972` still name the custom role in comments and error text.

## undated: What the workflow does

The workflow is configured with `concurrency: cancel-in-progress` so if
several pushes land in a row, only the newest one actually deploys —
production always ends up on the latest commit, not a stale intermediate.

Superseded: `deploy-cloudrun.yml:32-34` sets group `cloud-run-deploy` with `cancel-in-progress: false` (owner ask 2026-08-22 in the workflow comment, "one that does not stop until a build is finished").

## undated: What this replaces

- `docker-publish.yml` still runs in parallel and pushes the image to
  `ghcr.io/reblexis/metrics-tracker-server:latest`. That image is now
  redundant for production (Cloud Build does its own build), but it's
  useful for `docker run` deploys and CI smoke tests. Leave it.
- `deploy.yml` (Deploy to GitHub Pages) is separate — it builds the
  static frontend bundle and pushes it to the `gh-pages` branch. That
  bundle isn't what telarchy.com serves; the production frontend is
  served by the same Cloud Run container as the backend. The gh-pages
  build is for embeddable / docs use cases.

Superseded: the image is `ghcr.io/reblexis/telarchy-app` (`docker-publish.yml:36`, `docker-compose.yml:31`); no `deploy.yml` exists under `.github/workflows/` (only `deploy-cloudrun.yml`'s `paths-ignore` still names it).

## undated: Owner notifications (Resend)

"Two pieces of service config, set once on Cloud Run and
inherited by every CI deploy (the workflow passes no env flags, so
revisions keep them)". Superseded: `deploy-cloudrun.yml:244-245` passes `--update-env-vars ALLOWED_ORIGIN,TRUSTED_ORIGINS` and `--update-secrets API_KEY,GITHUB_CLIENT_SECRET`; they merge, so everything else is inherited.

## 2026-08-30: the self-sync cron moved from GitHub Actions to Cloud Scheduler

GitHub's `schedule` trigger cannot hold an hourly cadence on this repository.
Measured over five consecutive days, a `40 23 * * *` cron fired at 23:54, 04:59,
07:03, 04:17 and 01:36 UTC - delayed by up to seven hours, every run green - and
after the cron was changed to `40 * * * *` it produced no run in the next four
and a half hours. A scheduled job that reports its own success while firing a
fifth as often as promised is the same failure shape as the
`dailyresolve`/`dailymarketrefresh` jobs that 500'd for months: the scheduler is
happy, nothing else watches.

New Cloud Scheduler job `telarchy-self-sync` (`40 * * * *`, `POST /api/cron/self-sync`,
master key in `X-API-Key`), and `SELF_SYNC_WORKSPACE_ID` set on the `api`
service. Rationale for the metric behaviour is in notes/decisions/metrics.md.
