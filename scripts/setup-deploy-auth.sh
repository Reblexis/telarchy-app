#!/usr/bin/env bash
#
# One-shot: create the GCP service account the deploy workflow needs, grant
# it the right roles, mint a key, push it to GitHub as GCP_SA_KEY, and fire
# the first deploy.
#
# Re-runnable. If the SA already exists or roles are already granted, those
# steps are no-ops. The key file is deleted from disk after upload.
#
# Prereqs:
#   - gcloud CLI installed and logged into a GCP account with project owner
#     access on telarchy-e0043 (run `gcloud auth login` if needed).
#   - gh CLI installed and authed to the GitHub account that has push access
#     to Reblexis/metrics-tracker (run `gh auth login` if needed).
#
# Usage:
#   cd metrics-tracker
#   bash scripts/setup-deploy-auth.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-telarchy-e0043}"
SERVICE_ACCOUNT_NAME="cloudrun-deployer"
SA_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
REPO="${REPO:-Reblexis/metrics-tracker}"
ROLES=(
  "roles/run.admin"
  "roles/cloudbuild.builds.editor"
  "roles/storage.objectViewer"
  "roles/iam.serviceAccountUser"
  "roles/logging.viewer"
)
KEY_FILE="$(mktemp -t cloudrun-deployer-key.XXXXXX.json)"
trap 'rm -f "$KEY_FILE"' EXIT

c_blue='\033[0;34m' ; c_green='\033[0;32m' ; c_yellow='\033[0;33m' ; c_reset='\033[0m'
step() { printf "${c_blue}→${c_reset} %s\n" "$*"; }
ok()   { printf "${c_green}✓${c_reset} %s\n" "$*"; }
warn() { printf "${c_yellow}!${c_reset} %s\n" "$*"; }

# ── 0. Sanity checks ──────────────────────────────────────────────────────
step "Checking prerequisites"
command -v gcloud >/dev/null || { echo "gcloud not installed. https://cloud.google.com/sdk/docs/install"; exit 1; }
command -v gh     >/dev/null || { echo "gh not installed. https://cli.github.com/"; exit 1; }

gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q . \
  || { echo "Not logged into gcloud. Run: gcloud auth login"; exit 1; }
gh auth status >/dev/null 2>&1 \
  || { echo "Not logged into gh. Run: gh auth login"; exit 1; }

# Confirm the gcloud account can see the project
gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 \
  || { echo "Can't see GCP project $PROJECT_ID with current gcloud account."; exit 1; }
ok "gcloud + gh are ready; project $PROJECT_ID is reachable"

# ── 1. Service account ────────────────────────────────────────────────────
step "Ensuring service account $SA_EMAIL exists"
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  ok "service account already exists"
else
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --display-name="GitHub Actions Cloud Run deployer" \
    --project="$PROJECT_ID" >/dev/null
  ok "created"
fi

# ── 2. Roles ──────────────────────────────────────────────────────────────
step "Granting roles (idempotent)"
for role in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$role" \
    --condition=None \
    --quiet >/dev/null
  ok "  $role"
done

# ── 3. Mint key ───────────────────────────────────────────────────────────
step "Minting a new service-account key"
gcloud iam service-accounts keys create "$KEY_FILE" \
  --iam-account="$SA_EMAIL" \
  --project="$PROJECT_ID" >/dev/null
ok "key created at temp path (will be deleted at script exit)"

# ── 4. Upload to GitHub ───────────────────────────────────────────────────
step "Uploading key to GitHub as secret GCP_SA_KEY on $REPO"
gh secret set GCP_SA_KEY --repo="$REPO" --body "$(cat "$KEY_FILE")"
ok "secret set"

# ── 5. Trigger the deploy ────────────────────────────────────────────────
step "Firing the deploy workflow on $REPO@main"
if gh workflow run deploy-cloudrun.yml --repo="$REPO" --ref=main 2>/dev/null; then
  ok "deploy started"
else
  warn "couldn't trigger via 'gh workflow run' (maybe the workflow isn't enabled in the UI yet). The next push to main will deploy automatically."
fi

# ── 6. Optional cleanup of old SA keys ────────────────────────────────────
step "Listing existing keys on the service account (you may want to rotate old ones)"
gcloud iam service-accounts keys list \
  --iam-account="$SA_EMAIL" --project="$PROJECT_ID" \
  --filter="keyType=USER_MANAGED" --format="table(name.basename(),validAfterTime)" || true

echo
ok "Setup complete."
echo "Watch the deploy: gh -R $REPO run watch \$(gh -R $REPO run list --workflow=deploy-cloudrun.yml --limit=1 --json databaseId -q '.[0].databaseId')"
