#!/bin/sh
# Manual deploy of the MANAGED instance (telarchy.com) to Cloud Run. Not for
# self-hosting; self-hosters run `docker compose up`. The normal path is the
# deploy workflow in .github/workflows (docs/infra/deploy.md); this is the
# by-hand fallback it documents. Project and instance come from the environment
# so nothing here is specific to one GCP project.
set -eu
: "${GCP_PROJECT:?set GCP_PROJECT (the managed instance's project id)}"
: "${CLOUDSQL_INSTANCE:?set CLOUDSQL_INSTANCE (project:region:instance)}"
REGION="${CLOUD_RUN_REGION:-us-central1}"
node scripts/build-changelog.mjs
gcloud run deploy api --project "$GCP_PROJECT" --source . --region "$REGION" \
  --allow-unauthenticated --memory 512Mi --cpu 1 --min-instances 0 --max-instances 4 --no-cpu-throttling \
  --set-cloudsql-instances "$CLOUDSQL_INSTANCE" --clear-base-image
