#!/bin/sh
# Container entrypoint. With AUTO_MIGRATE=true (docker compose sets it) the
# database migrations run before the server starts, so `docker compose up` on an
# empty database yields a working instance. The managed deploy leaves it unset
# and migrates in its deploy workflow instead (docs/infra/deploy.md).
set -e
if [ "$AUTO_MIGRATE" = "true" ]; then
  echo "[entrypoint] AUTO_MIGRATE=true: applying database migrations"
  node lib/migrate.js
fi
exec "$@"
