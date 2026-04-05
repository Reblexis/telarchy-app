#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Telarchy local self-hosted setup
# Migrates data from Firestore (vcihal) and starts the full stack.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# ── Colours ──────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[1;34m'; NC='\033[0m'
info()  { echo -e "${B}▸ $*${NC}"; }
ok()    { echo -e "${G}✓ $*${NC}"; }
warn()  { echo -e "${Y}⚠ $*${NC}"; }
die()   { echo -e "${R}✗ $*${NC}" >&2; exit 1; }

echo ""
echo -e "${B}╔════════════════════════════════════════╗${NC}"
echo -e "${B}║   Telarchy — local self-hosted setup   ║${NC}"
echo -e "${B}╚════════════════════════════════════════╝${NC}"
echo ""

# ── Prerequisites ─────────────────────────────────────────────────
info "Checking prerequisites..."
command -v docker        >/dev/null 2>&1 || die "Docker is not installed. Install it from https://docs.docker.com/get-docker/"
command -v docker-compose >/dev/null 2>&1 || die "docker-compose is not installed."
command -v node          >/dev/null 2>&1 || die "Node.js is not installed."
ok "All prerequisites found"

# ── Collect inputs ────────────────────────────────────────────────
echo ""
info "You need two things before continuing:"
echo "  1. A Firebase service account JSON for the vcihal project"
echo "     → Firebase Console → vcihal → Project Settings → Service Accounts"
echo "       → Generate new private key → save the JSON file"
echo "  2. Your email address (used as platform admin)"
echo ""

read -rp "Path to Firebase service account JSON: " SA_KEY_PATH
SA_KEY_PATH="${SA_KEY_PATH/#\~/$HOME}"
[[ -f "$SA_KEY_PATH" ]] || die "File not found: $SA_KEY_PATH"
ok "Service account key found"

read -rp "Your email address: " ADMIN_EMAIL
[[ -n "$ADMIN_EMAIL" ]] || die "Email is required"
ok "Email: $ADMIN_EMAIL"
echo ""

# ── Generate secrets ─────────────────────────────────────────────
info "Generating secrets..."
DB_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
API_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
BETTER_AUTH_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
ok "Secrets generated"

# ── Write .env ───────────────────────────────────────────────────
info "Writing .env..."
cat > "$REPO_DIR/.env" <<EOF
DB_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgres://telarchy:${DB_PASSWORD}@localhost:5432/telarchy
API_KEY=$API_KEY
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
INITIAL_ADMIN_EMAIL=$ADMIN_EMAIL
BETTER_AUTH_URL=http://localhost:8080
ALLOWED_ORIGIN=*
PORT=8080
EOF
ok ".env created"

# ── Install dependencies ─────────────────────────────────────────
info "Installing backend dependencies..."
cd "$REPO_DIR/functions" && npm install --silent 2>&1 | tail -3
ok "Backend dependencies installed"

info "Installing frontend dependencies..."
cd "$REPO_DIR" && npm install --silent 2>&1 | tail -3
ok "Frontend dependencies installed"

# ── Start PostgreSQL ─────────────────────────────────────────────
cd "$REPO_DIR"
info "Starting PostgreSQL..."
docker-compose up -d db
echo -n "  Waiting for PostgreSQL to be ready"
for i in $(seq 1 30); do
  if docker-compose exec -T db pg_isready -U telarchy >/dev/null 2>&1; then
    echo ""; ok "PostgreSQL ready"; break
  fi
  echo -n "."; sleep 1
  [[ $i -eq 30 ]] && die "PostgreSQL failed to start after 30s"
done

# ── Run schema migrations ─────────────────────────────────────────
info "Running database migrations..."
cd "$REPO_DIR/functions"
DATABASE_URL="postgres://telarchy:${DB_PASSWORD}@localhost:5432/telarchy" \
  npm run db:migrate 2>&1 | tail -5
ok "Schema created"

# ── Migrate Firestore data ────────────────────────────────────────
info "Migrating data from Firestore (vcihal)..."
echo "  This reads your metrics, markets, agents, and history from Firestore"
echo "  and imports them into the local PostgreSQL database."
echo ""
FIRESTORE_PROJECT_ID=vcihal \
DATABASE_URL="postgres://telarchy:${DB_PASSWORD}@localhost:5432/telarchy" \
GOOGLE_APPLICATION_CREDENTIALS="$SA_KEY_PATH" \
  npx ts-node --transpile-only ../scripts/migrate-firestore-to-pg.ts
echo ""
ok "Firestore data migrated"

# ── Build backend ─────────────────────────────────────────────────
info "Building backend..."
cd "$REPO_DIR/functions"
npm run build 2>&1 | tail -3
ok "Backend built"

# ── Build frontend ────────────────────────────────────────────────
info "Building frontend..."
cd "$REPO_DIR"
VITE_API_URL="" npm run build 2>&1 | tail -3
ok "Frontend built"

# ── Bundle frontend into backend public/ ─────────────────────────
info "Bundling frontend into server..."
mkdir -p "$REPO_DIR/functions/lib/public"
cp -r "$REPO_DIR/dist/." "$REPO_DIR/functions/lib/public/"
ok "Frontend bundled"

# ── Start the app ─────────────────────────────────────────────────
info "Starting Telarchy server..."
cd "$REPO_DIR"
# Write a docker-compose override with the built assets
cat > /tmp/telarchy-run.env <<EOF
DATABASE_URL=postgres://telarchy:${DB_PASSWORD}@localhost:5432/telarchy
API_KEY=${API_KEY}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
INITIAL_ADMIN_EMAIL=${ADMIN_EMAIL}
BETTER_AUTH_URL=http://localhost:8080
ALLOWED_ORIGIN=*
PORT=8080
EOF

# Run node directly (the docker-compose app service builds via Dockerfile;
# for local dev we run the compiled server directly instead)
pkill -f "node lib/server.js" 2>/dev/null || true
cd "$REPO_DIR/functions"
env $(cat /tmp/telarchy-run.env | xargs) node lib/server.js &
SERVER_PID=$!

echo -n "  Waiting for server to start"
for i in $(seq 1 15); do
  if curl -s http://localhost:8080/api/status >/dev/null 2>&1; then
    echo ""; ok "Server started (PID $SERVER_PID)"; break
  fi
  echo -n "."; sleep 1
  [[ $i -eq 15 ]] && die "Server failed to start. Check: cd functions && node lib/server.js"
done

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo -e "${G}╔════════════════════════════════════════════╗${NC}"
echo -e "${G}║              Setup complete!               ║${NC}"
echo -e "${G}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${B}App URL:${NC}     http://localhost:8080"
echo -e "  ${B}API Key:${NC}     ${API_KEY}"
echo ""
echo -e "  ${Y}Next steps:${NC}"
echo "  1. Go to http://localhost:8080/login"
echo "  2. Sign in with: $ADMIN_EMAIL (password printed in server output above)"
echo ""
echo -e "  ${Y}To restart later:${NC}"
echo "  cd $REPO_DIR/functions"
echo "  $(cat /tmp/telarchy-run.env | tr '\n' ' ') node lib/server.js"
echo ""
echo -e "  ${Y}Save these secrets — they're also in .env:${NC}"
echo "  API_KEY=$API_KEY"
echo "  DB_PASSWORD=$DB_PASSWORD"
echo "  BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET"
echo ""
