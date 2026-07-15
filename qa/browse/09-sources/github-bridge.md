---
id: 09-sources-github-bridge
tags: [browse, human]
isolation: workspace
parallel-safe: false
needs: [auth, master-key, browse, github-app]
timeout: 600s
goal-horizon: short
goal-statement: |
  As a workspace admin, I can install the GitHub App, pick repos, browse
  the file tree, and read individual files inside a connected source.
---

# Browse test: GitHub bridge

## What this tests

`/api/sources/github/*`. The OAuth handoff to GitHub itself is human-only,
so this spec uses `$B handoff` mid-run.

## Preconditions

- GitHub App configured: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
  `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
  `GITHUB_APP_PRIVATE_KEY` env set in the running backend.
- The GitHub App's OAuth "Callback URL" and post-install "Setup URL" both
  point at `<origin>/api/sources/github/callback`. The callback handles both
  the OAuth `code` handoff and the post-install `installation_id` /
  `setup_action` return, then redirects to the canonical
  `/{ownerHandle}/{slug}/sources?state=` repo picker. For localhost testing
  add `http://localhost:8080/api/sources/github/callback` to the App's
  callback URLs, or GitHub rejects the redirect_uri.
- A real GitHub account with at least one repo.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
$B viewport 1440x900
$B stop
EMAIL="qa+gh-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "GhUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
tt_add_member "$WS" "$MUID" "admin"
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
```

## Tests

### T1. /sources Connect-GitHub reaches github.com/apps

```bash
$B goto "$TT_FRONTEND_URL/sources" && $B wait --networkidle
$B click 'button:has-text("Connect GitHub"), a:has-text("Connect GitHub")'
$B wait --networkidle
url=$($B url)
[[ "$url" == *"github.com/apps"* ]] || [[ "$url" == *"github.com/login"* ]] \
  || { echo "did not reach GitHub: $url"; exit 1; }
$B handoff "Install the GitHub App on at least one repo, then return."
```

### T2. After handoff, /api/sources/github/repos returns ≥1 repo

```bash
n=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/sources/github/repos" | jq 'length')
[ "$n" -ge 1 ]
```

### T3. Connect a repo creates a source

```bash
repo=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/sources/github/repos" | jq -r '.[0]')
out=$(curl -sf -b "$JAR" -H 'Content-Type: application/json' \
  -H "X-Workspace-Id: $WS" -X POST -d "$repo" \
  "$TT_BASE_URL/api/sources/github/connect")
SID=$(jq -r '.id // .sourceId' <<<"$out")
[ -n "$SID" ]
```

### T4. /sources/:id/tree returns the repo root

```bash
out=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/sources/$SID/tree?path=")
echo "$out" | jq -e '.entries // .' >/dev/null
n=$(echo "$out" | jq 'if type=="array" then length else (.entries | length) end')
[ "$n" -ge 1 ]
```

### T5. /sources/:id/file returns a known file's content

```bash
# Pick the first .md or .txt at root
file=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/sources/$SID/tree?path=" \
  | jq -r 'if type=="array" then .[] else .entries[] end | select(.type=="file" and (.path | endswith(".md"))) | .path' \
  | head -1)
[ -z "$file" ] && { echo "skip: no .md at root"; exit 0; }
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -b "$JAR" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/sources/$SID/file?path=$file")
[ "$status" = "200" ]
```

### T6. Non-admin cannot connect

```bash
read AID KEY < <(tt_mkagent "$WS" rando)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{}' \
  "$TT_BASE_URL/api/sources/github/connect")
[ "$status" = "403" ]
```

## Cleanup

Auto via workspace teardown. The GitHub App install on the user's account
remains; uninstall manually if desired.

## Known gaps

- No coverage of binary file rejection.
- No coverage of repo permission revocation (after install, what happens if
  the user revokes the app?).
