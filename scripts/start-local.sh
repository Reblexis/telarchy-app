#!/usr/bin/env bash
# Build current assets and start the local Telarchy server.
# Run from the repo root.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_DIR/.env"

[[ -f "$ENV_FILE" ]] || { echo "Error: .env not found. Run scripts/setup.sh first."; exit 1; }

source "$ENV_FILE"

PUBLIC_DIR="$REPO_DIR/functions/lib/public"

echo "Building frontend..."
cd "$REPO_DIR"
npm run build

echo "Refreshing local static bundle..."
rm -rf "$PUBLIC_DIR"
mkdir -p "$PUBLIC_DIR"
cp -r "$REPO_DIR/dist/." "$PUBLIC_DIR/"

echo "Building backend..."
npm run build:functions

# Ensure the DB container is running
DB_CONTAINER="metrics-tracker-db"
if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  echo "Starting PostgreSQL..."
  docker start "$DB_CONTAINER" 2>/dev/null || docker run -d \
    --name "$DB_CONTAINER" \
    --network metrics-tracker_default \
    -e POSTGRES_DB=telarchy \
    -e POSTGRES_USER=telarchy \
    -e POSTGRES_PASSWORD="${DB_PASSWORD}" \
    -v metrics-tracker_db_data:/var/lib/postgresql/data \
    -p 127.0.0.1:5433:5432 \
    postgres:16-alpine
  sleep 3
fi

fuser -k 8080/tcp 2>/dev/null || true
sleep 1

cd "$REPO_DIR/functions"
DATABASE_URL="$DATABASE_URL" \
API_KEY="$API_KEY" \
BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
ADMIN_EMAILS="$ADMIN_EMAILS" \
TREASURY_PRIVATE_KEY="${TREASURY_PRIVATE_KEY:-}" \
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-*}" \
BETTER_AUTH_URL="http://localhost:${PORT:-8080}" \
PORT="${PORT:-8080}" \
  node lib/server.js
