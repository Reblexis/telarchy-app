---
id: 09-sources-text-source-crud
tags: [browse]
isolation: workspace
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a workspace admin, I can create a text source, edit its content, set
  per-group read permissions, and confirm a non-admin participant sees
  only what they're entitled to.
---

# Browse test: Sources (text + GitHub)

## What this tests

The `/sources` UI: creating a text source, granting per-group read access,
verifying the source content shows up where expected, and walking the
GitHub-bridge installation flow up to the OAuth handoff (the OAuth itself
is human-only).

Maps to `mvp-evaluation/plan.md` Section 15.3.

## Preconditions

- Workspace owner / admin (manage capability).
- For the GitHub flow: the GitHub App is configured in env (`GITHUB_APP_ID`,
  client id/secret). If not, skip T4–T6.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B goto "$TT_FRONTEND_URL/sources"
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-sources-baseline.png"
```

## Tests

### T1. Create a text source

**Steps:**
1. `$B snapshot -i` and find "New source" / equivalent.
2. Fill: name `Test source`, description `automated`, content `Hello world`.
3. Submit.
4. `$B text` and verify the source appears in the list.

**Expected:** `POST /api/sources` returned 201; source visible.

### T2. Edit text source content persists

**Steps:** Open the source, edit content to `Hello world v2`, save, reload,
verify content.

**Expected:** Persists across reload; `PUT /api/sources/<id>` returned 200.

### T3. Per-group source read permission

**Steps:**
1. From `/groups`, grant the Public group `read` on the test source.
2. As a non-admin participant, `$B goto /sources/<id>` and verify content is visible.
3. Revoke the permission. Verify the same participant gets a forbidden state.

**Expected:** Visibility flips with the permission grant.

### T4. GitHub install flow lands at GitHub `(human handoff)`

**Steps:**
1. Click "Connect GitHub" / equivalent.
2. `$B url` should redirect to `github.com/apps/...`.
3. `$B handoff "Complete GitHub install"` and ask the human to finish.
4. `$B resume` after they confirm.

**Expected:** Returns to `/sources/github/repos?state=...` with a list of
accessible repos.

### T5. Connect a repo and browse its tree

**Steps:**
1. From the repo list, select one repo, submit.
2. `$B goto /sources/<github-source-id>/tree?path=` and verify directory
   listing.
3. Pick a file: `$B goto .../file?path=README.md` and verify content.

**Expected:** Tree + file render; underlying API endpoints return 200.

## Cleanup

Delete the test text source after T3. Leave the GitHub installation in place
unless instructed otherwise.

## Known gaps

- No coverage of credential rotation for GitHub.
- No coverage of source pagination / large repos.
- No coverage of binary file rejection in the file viewer.
