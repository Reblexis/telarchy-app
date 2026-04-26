#!/usr/bin/env bash
# Shared helpers for browse-test specs.
#
# Source this from any spec or runner that needs:
#   - per-test isolation (workspace + user namespaces derived from $TT_RUN_ID)
#   - browse daemon lookup
#   - HTTP helpers against $TT_BASE_URL with the right auth
#   - cleanup hooks
#
# The conventions are documented in _runner/isolation.md.

set -uo pipefail

# ---------- environment ----------------------------------------------------

# TT_BASE_URL: target of all API calls. Defaults to local dev.
: "${TT_BASE_URL:=http://localhost:8080}"
# TT_FRONTEND_URL: target of all browse-driven UI calls. Defaults to local Vite.
: "${TT_FRONTEND_URL:=http://localhost:5173}"
# TT_ADMIN_KEY: master key used for admin-only setup steps. Required for any
# spec that creates fixtures (workspaces, agents, balances).
: "${TT_ADMIN_KEY:=}"
# TT_RUN_ID: unique per test process. Used to namespace every fixture so
# parallel runs cannot collide on a name.
: "${TT_RUN_ID:=$(date +%s)-$$}"
# TT_TEST_ID: unique per spec file. Set by the runner. Falls back to a slug of
# the calling script.
: "${TT_TEST_ID:=$(basename "${BASH_SOURCE[1]:-spec}" .md | tr '/.' '__')}"

# Namespace prefix every fixture created by a spec gets. The full TT_NS
# stays human-readable as `tt-<test-id>-<run-id>`; truncating the run-id is
# what previously caused cross-run collisions when test_id was long, so we
# keep enough room for both. 96 is well under any API limit.
TT_NS="tt-${TT_TEST_ID%%[!a-zA-Z0-9_-]*}-${TT_RUN_ID}"
TT_NS="${TT_NS:0:96}"

# Browse binary lookup: prefer the project-vendored install, fall back to the
# user-global one. Re-uses the formula in browse-tests/README.md.
_resolve_browse() {
  local root
  root=$(git rev-parse --show-toplevel 2>/dev/null || true)
  if [ -n "$root" ] && [ -x "$root/.claude/skills/gstack/browse/dist/browse" ]; then
    echo "$root/.claude/skills/gstack/browse/dist/browse"; return
  fi
  if [ -x "$HOME/.claude/skills/gstack/browse/dist/browse" ]; then
    echo "$HOME/.claude/skills/gstack/browse/dist/browse"; return
  fi
  return 1
}

# Set $B once per spec. Idempotent.
tt_browse_init() {
  if [ -z "${B:-}" ]; then
    B=$(_resolve_browse) || { echo "browse not found; install gstack" >&2; return 1; }
    export B
  fi
}

# ---------- HTTP helpers ---------------------------------------------------

# All helpers exit non-zero with a short diagnostic on a 4xx/5xx. They print
# the response body to stdout on success.

# Master-key request (admin-only). Always carries X-Workspace-Id.
tt_admin_curl() {
  [ -z "$TT_ADMIN_KEY" ] && { echo "TT_ADMIN_KEY not set" >&2; return 2; }
  local ws="${1:-default}"; shift
  curl -sf -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $ws" "$@" \
    || { echo "tt_admin_curl failed: $* (ws=$ws)" >&2; return 1; }
}

# Agent-key request. Args: <agent-key> <workspace-id> [curl-args...]
tt_agent_curl() {
  local key="$1" ws="$2"; shift 2
  curl -sf -H "X-Agent-Key: $key" -H "X-Workspace-Id: $ws" "$@" \
    || { echo "tt_agent_curl failed: $* (ws=$ws)" >&2; return 1; }
}

# Cookie-jar request (browser session). Args: <cookie-file> [curl-args...]
tt_user_curl() {
  local jar="$1"; shift
  curl -sf -b "$jar" -c "$jar" "$@" \
    || { echo "tt_user_curl failed: $*" >&2; return 1; }
}

# ---------- fixtures -------------------------------------------------------

# Create a fresh workspace for this spec. Echoes the workspace id.
# Args: [template] [visibility]
#
# NOTE: The live `PUT /api/workspaces/:id/settings` route requires the caller
# to be the signed-in workspace *owner* to change `autoFundNewMarkets`,
# `newMarketLiquidityCredits`, or `visibility`. Master-key callers (which is
# what this helper uses) are explicitly rejected. Tests that need to mutate
# those settings must set up an owner session themselves; this helper does
# not attempt to.
tt_mkworkspace() {
  local tpl="${1:-blank}" vis="${2:-public}"
  local name="$TT_NS-ws"
  local body
  body=$(printf '{"name":"%s","template":"%s","visibility":"%s"}' "$name" "$tpl" "$vis")
  tt_admin_curl default -H "Content-Type: application/json" \
    -X POST -d "$body" "$TT_BASE_URL/api/workspaces" \
    | jq -r '.id'
}

# Register a new agent participant, echoes "agentId apiKey" on stdout.
# Args: <workspace-id> [tag]
#
# The live API enforces `agentId` ≤ 64 chars and rejects duplicates with
# "Agent already registered". `agents` is a top-level table (no workspace
# FK) so workspace cleanup doesn't cascade-delete agents from prior runs;
# we add a 4-digit suffix to keep collisions virtually impossible across
# back-to-back retries within the same run-id.
tt_mkagent() {
  local ws="$1" tag="${2:-bot}"
  local rand="$RANDOM"
  local agentId="$TT_NS-$tag-$rand"
  if [ "${#agentId}" -gt 64 ]; then
    local keep_tag="-${tag}-${rand}"
    local prefix_max=$((64 - ${#keep_tag}))
    agentId="${TT_NS:0:$prefix_max}${keep_tag}"
  fi
  local body
  body=$(printf '{"agentId":"%s","workspaceId":"%s"}' "$agentId" "$ws")
  local res
  res=$(curl -sf -H "Content-Type: application/json" -X POST -d "$body" \
    "$TT_BASE_URL/api/agents/register") \
    || { echo "tt_mkagent failed (agentId=$agentId)" >&2; return 1; }
  printf '%s %s\n' "$(echo "$res" | jq -r '.agentId')" "$(echo "$res" | jq -r '.apiKey')"
}

# Sign up a fresh browser-session user. Echoes the cookie-jar path.
# Args: <email> <password> <displayName>
tt_mkuser() {
  local email="$1" pw="$2" name="$3"
  local jar="/tmp/$TT_NS-$(echo "$email" | tr '@' '_').jar"
  curl -sf -c "$jar" -X POST -H "Content-Type: application/json" \
    -d "$(jq -nc --arg e "$email" --arg p "$pw" --arg n "$name" \
        '{email:$e, password:$p, name:$n, consent:true}')" \
    "$TT_BASE_URL/api/auth/sign-up/email" >/dev/null \
    || { echo "tt_mkuser failed (email=$email)" >&2; return 1; }
  printf '%s\n' "$jar"
}

# Like tt_mkuser, but echoes "<jar> <uid>" so callers can use the user's
# id as `participantId` when adding them to a workspace via
# POST /api/workspaces/:id/members.
# Args: <email> <password> <displayName>
tt_mkuser_uid() {
  local jar; jar=$(tt_mkuser "$1" "$2" "$3") || return 1
  # /api/auth/me returns a flat shape: { uid, email, participantId, ... }
  # — no `.user` nesting. participantId == uid for sign-up users.
  local uid
  uid=$(curl -sf -b "$jar" "$TT_BASE_URL/api/auth/me" | jq -r '.uid // .participantId // empty')
  [ -n "$uid" ] || { echo "tt_mkuser_uid: empty uid for $1" >&2; return 1; }
  printf '%s %s\n' "$jar" "$uid"
}

# Add a participant (agent or user UID) to a workspace with a given role.
# Args: <workspace-id> <participant-id> <role>  (role: owner|admin|trader|viewer)
tt_add_member() {
  local ws="$1" pid="$2" role="$3"
  tt_admin_curl "$ws" -H 'Content-Type: application/json' \
    -X POST -d "$(jq -nc --arg p "$pid" --arg r "$role" '{participantId:$p, role:$r}')" \
    "$TT_BASE_URL/api/workspaces/$ws/members" >/dev/null
}

# Credit an agent or user balance. Args: <workspace-id> <agentId> <credits>
tt_credit() {
  local ws="$1" id="$2" cr="$3"
  tt_admin_curl "$ws" -H "Content-Type: application/json" \
    -X POST -d "$(jq -nc --argjson c "$cr" '{amount:$c}')" \
    "$TT_BASE_URL/api/agents/$id/credit" >/dev/null
}

# Create a market for a metric. Args: <ws> <metricId> <targetISO>
# Always sends `skipAutoLiquidity: true` because the master-key caller has no
# agent record; auto-funding from a workspace with autoFundNewMarkets=true
# would otherwise fail with "Workspace owner has no agent record".
tt_mkmarket() {
  local ws="$1" mid="$2" iso="$3"
  tt_admin_curl "$ws" -H "Content-Type: application/json" \
    -X POST -d "$(jq -nc --arg m "$mid" --arg t "$iso" \
        '{metricId:$m, targetDate:$t, skipAutoLiquidity:true}')" \
    "$TT_BASE_URL/api/predictions/markets" \
    | jq -r '.id'
}

# Place a trade. Args: <auth-args (-H ...)> <marketId> <direction higher|lower> <amount>
# Pass auth via TT_TRADE_HEADERS (associative or string) — use tt_admin_curl-style
# header strings and call this with the headers prebuilt. Echoes new consensus.
tt_trade() {
  local headers=("${TT_TRADE_HEADERS[@]}") mid="$1" dir="$2" amt="$3"
  curl -sf "${headers[@]}" -H "Content-Type: application/json" \
    -X POST -d "$(jq -nc --arg id "$mid" --arg d "$dir" --argjson a "$amt" \
        '{marketId:$id, direction:$d, amount:$a}')" \
    "$TT_BASE_URL/api/predictions/trade" \
    | jq -r '.consensus'
}

# ---------- cleanup --------------------------------------------------------

# Register a cleanup callback. Last-in-first-out at TRAP EXIT.
TT_CLEANUP_FUNCS=()
tt_on_cleanup() { TT_CLEANUP_FUNCS+=("$1"); }

_tt_run_cleanup() {
  local code=$?
  local i
  for ((i=${#TT_CLEANUP_FUNCS[@]}-1; i>=0; i--)); do
    eval "${TT_CLEANUP_FUNCS[$i]}" 2>/dev/null || true
  done
  exit "$code"
}
trap _tt_run_cleanup EXIT

# Drop a workspace and everything inside it (markets void+refund cascade).
tt_rm_workspace() {
  local ws="$1"
  tt_admin_curl "$ws" -X DELETE "$TT_BASE_URL/api/workspaces/$ws" >/dev/null || true
}

# Delete an agent and its auth row.
tt_rm_agent() {
  local ws="$1" id="$2"
  tt_admin_curl "$ws" -X DELETE "$TT_BASE_URL/api/agents/$id" >/dev/null || true
}

# Delete the cookie-jar, then DELETE /api/auth/me to remove the BetterAuth row.
tt_rm_user() {
  local jar="$1"
  curl -sf -b "$jar" -X DELETE "$TT_BASE_URL/api/auth/me" >/dev/null || true
  rm -f "$jar"
}

# ---------- frontmatter ----------------------------------------------------

# Read YAML frontmatter from the first --- block of a spec file. Echoes
# `key=value` lines suitable for `eval` or grep. Only flat scalars supported.
tt_frontmatter() {
  awk 'NR==1 && $0=="---" { in_fm=1; next }
       in_fm && $0=="---" { exit }
       in_fm && /^[a-zA-Z_-]+: / {
         k=$1; sub(/:$/, "", k);
         val=$0; sub(/^[^:]+: */, "", val);
         gsub(/[ \t]+$/, "", val);
         printf "%s=%s\n", k, val
       }' "$1"
}

# ---------- assertions -----------------------------------------------------

# Args: <expected> <actual> [message]
tt_assert_eq() {
  if [ "$1" != "$2" ]; then
    echo "FAIL ${3:-assertion}: expected '$1', got '$2'" >&2; return 1
  fi
}

# Args: <expected-substring> <haystack> [message]
tt_assert_contains() {
  if ! grep -qF -- "$1" <<<"$2"; then
    echo "FAIL ${3:-assertion}: '$1' not found in output" >&2; return 1
  fi
}

# Args: <http-status> <url> [curl-args...]
tt_assert_status() {
  local want="$1" url="$2"; shift 2
  local got
  got=$(curl -s -o /dev/null -w '%{http_code}' "$@" "$url")
  tt_assert_eq "$want" "$got" "$url"
}

# ---------- log helpers ----------------------------------------------------

tt_log()  { printf '[%s] %s\n' "$TT_TEST_ID" "$*"; }
tt_step() { printf '\n--- %s ---\n' "$*"; }
