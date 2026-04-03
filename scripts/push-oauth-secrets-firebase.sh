#!/usr/bin/env bash
# Push OAuth env vars from functions/.env into Firebase/Google Secret Manager.
# Requires: firebase login, project selected (firebase use), and non-empty values in .env.
# Run from repo root: ./scripts/push-oauth-secrets-firebase.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVFILE="$ROOT/functions/.env"
if [[ ! -f "$ENVFILE" ]]; then
  echo "Missing $ENVFILE — copy from functions/.env.example and fill OAuth keys."
  exit 1
fi

get_val() {
  local key="$1"
  local line
  line=$(grep -E "^${key}=" "$ENVFILE" | tail -1) || true
  if [[ -z "$line" ]]; then
    echo "Missing line ${key}=... in $ENVFILE"
    exit 1
  fi
  local val="${line#*=}"
  val="${val%$'\r'}"
  if [[ "$val" == \"*\" ]]; then
    val="${val#\"}"
    val="${val%\"}"
  elif [[ "$val" == \'*\' ]]; then
    val="${val#\'}"
    val="${val%\'}"
  fi
  if [[ -z "$val" ]]; then
    echo "Empty value for $key in $ENVFILE"
    exit 1
  fi
  printf '%s' "$val"
}

push_if_present() {
  local key="$1"
  local line
  line=$(grep -E "^${key}=" "$ENVFILE" | tail -1) || true
  [[ -z "$line" ]] && return 0
  local val="${line#*=}"
  val="${val%$'\r'}"
  if [[ "$val" == \"*\" ]]; then val="${val#\"}"; val="${val%\"}"; fi
  [[ -z "$val" ]] && return 0
  echo "Setting secret $key ..."
  printf '%s' "$val" | firebase functions:secrets:set "$key" --data-file=-
}

for key in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  echo "Setting secret $key ..."
  get_val "$key" | firebase functions:secrets:set "$key" --data-file=-
done
for key in GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET; do
  push_if_present "$key"
done
echo "Done. Run firebase deploy."
