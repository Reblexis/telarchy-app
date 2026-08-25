#!/usr/bin/env bash
# Refill the beta database from production.
#
# The beta is a separate store (owner ask 2026-08-20), which means it drifts:
# every contract posted and trade placed while testing stays there, and
# production moves on without it. This copies production over the top, so the
# beta is again a faithful place to test against real shapes of data.
#
# It DESTROYS whatever is in the beta store. That is the point, and it is why
# the script names the database it is about to drop and waits for a yes.
#
# Needs: gcloud (secret access), cloud-sql-proxy, and a pg client whose major
# version matches the server (16). Ubuntu's default is 14 and pg_dump refuses
# to talk to a newer server, so this prefers /usr/lib/postgresql/16/bin.
set -euo pipefail

PROJECT=telarchy-e0043
INSTANCE=telarchy-e0043:us-central1:telarchy-pg
PORT=${PORT:-5436}
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DUMP=$(mktemp /tmp/telarchy-prod-XXXX.sql)

[ -x "$PGBIN/pg_dump" ] || { echo "no pg_dump at $PGBIN (apt install postgresql-client-16)"; exit 1; }

read -r -p "This replaces the ENTIRE telarchy_beta database with a copy of production. Type 'yes': " ok
[ "$ok" = "yes" ] || { echo "aborted"; exit 1; }

"$(command -v cloud-sql-proxy)" "$INSTANCE" --port="$PORT" >/tmp/refresh-beta-proxy.log 2>&1 &
PROXY=$!
trap 'kill $PROXY 2>/dev/null || true; rm -f "$DUMP"' EXIT
for _ in $(seq 1 30); do nc -z 127.0.0.1 "$PORT" 2>/dev/null && break; sleep 1; done

PGPASSWORD=$(gcloud secrets versions access latest --secret=DATABASE_URL --project="$PROJECT" \
  | python3 -c 'import sys,urllib.parse; print(urllib.parse.urlparse(sys.stdin.read().strip()).password)')
export PGPASSWORD

echo "dumping production..."
"$PGBIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U telarchy -d telarchy --no-owner --no-acl -f "$DUMP"

echo "replacing the beta store..."
# public is dropped whole rather than truncated: a table that exists only in
# the beta (a migration tried there first) would otherwise survive forever and
# make the beta stop resembling production, which is its only job.
"$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U telarchy -d telarchy_beta -v ON_ERROR_STOP=1 -q \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
"$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U telarchy -d telarchy_beta -v ON_ERROR_STOP=1 -q -f "$DUMP"

echo "beta now mirrors production:"
"$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U telarchy -d telarchy_beta -t \
  -c "select 'workspaces ' || count(*) from workspaces union all select 'proposals ' || count(*) from proposals union all select 'trades ' || count(*) from trades;"
