---
id: 10-guides-auth-and-keys
tags: [api-only, fast]
isolation: global
parallel-safe: true
needs: []
timeout: 30s
goal-horizon: short
goal-statement: |
  As an integrator, I can read /guides/auth-and-keys, /guides/recipes, and
  /guides/api-reference and get a complete reference for the API surface
  without leaving the docs site. Each section is in the guide index and
  loads as markdown.
---

# Browse test: API documentation guide sections

## What this tests

Three new guide sections (`auth-and-keys`, `recipes`, `api-reference`) are
the canonical reference for the new API tab features. This spec just
verifies they exist, are listed in `/api/guides`, return non-empty
markdown, and that the `agent-api` section was extended with code samples
in Python and Node.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
```

## Tests

### T1. The new sections appear in /api/guides

```bash
idx=$(curl -sf "$TT_BASE_URL/api/guides")
for id in auth-and-keys recipes api-reference; do
  jq -e --arg id "$id" 'any(.[]; .id==$id)' <<<"$idx" >/dev/null \
    || { echo "missing guide: $id"; exit 1; }
done
```

### T1b. Each section carries a category and an order field

```bash
idx=$(curl -sf "$TT_BASE_URL/api/guides")
# All four categories come back from the metadata endpoint.
cats=$(curl -sf "$TT_BASE_URL/api/guides/_categories" | jq -r '.[].id' | sort | xargs)
[ "$cats" = "api forecast metrics start" ] || { echo "categories: $cats"; exit 1; }
# Every section item has both fields, both are non-empty / numeric.
jq -e 'all(.[]; (.category | type == "string" and length > 0) and (.order | type == "number"))' <<<"$idx" >/dev/null
# auth-and-keys, recipes, api-reference all live under the api category.
for id in auth-and-keys recipes api-reference; do
  cat=$(jq -r --arg id "$id" '.[] | select(.id==$id) | .category' <<<"$idx")
  [ "$cat" = "api" ] || { echo "$id is in $cat, expected api"; exit 1; }
done
```

### T2. Each new section returns non-trivial markdown

```bash
for id in auth-and-keys recipes api-reference; do
  body=$(curl -sf "$TT_BASE_URL/api/guides/$id")
  # Title line is `# <something>` — verify the section actually has content
  # past the title so a typo'd empty file fails the build.
  bytes=$(wc -c <<<"$body")
  [ "$bytes" -gt 1000 ] || { echo "guide $id is suspiciously short: $bytes bytes"; exit 1; }
  grep -q '^# ' <<<"$body" || { echo "guide $id has no h1"; exit 1; }
done
```

### T3. auth-and-keys covers the documented vocabulary

```bash
body=$(curl -sf "$TT_BASE_URL/api/guides/auth-and-keys")
for term in workspace:read workspace:trade workspace:manage \
            account:read account:write account:wallet \
            account:keys account:agents account:feedback \
            'X-Agent-Key' 'X-Workspace-Id' 'X-API-Key'; do
  grep -q -F "$term" <<<"$body" || { echo "auth-and-keys missing $term"; exit 1; }
done
```

### T4. recipes ships with at least three end-to-end examples

```bash
body=$(curl -sf "$TT_BASE_URL/api/guides/recipes")
# Each recipe is preceded by `## Recipe N — ...`
n=$(grep -cE '^## Recipe [0-9]+' <<<"$body")
[ "$n" -ge 3 ] || { echo "expected ≥3 recipes, got $n"; exit 1; }
# Recipes mix curl + Python so integrators can pick.
grep -q '```python' <<<"$body" || { echo "recipes missing python sample"; exit 1; }
```

### T5. agent-api was extended with non-curl code samples

```bash
body=$(curl -sf "$TT_BASE_URL/api/guides/agent-api")
grep -q '```python' <<<"$body" || { echo "agent-api missing python"; exit 1; }
grep -q '```js'     <<<"$body" || { echo "agent-api missing node sample"; exit 1; }
```

### T6. api-reference lists the new key endpoints

```bash
body=$(curl -sf "$TT_BASE_URL/api/guides/api-reference")
for path in '/api/agents/:id/keys' '/api/agents/:id/keys/:keyId' '/api/agents'; do
  grep -q -F "$path" <<<"$body" || { echo "api-reference missing $path"; exit 1; }
done
```

### T7. The /api/help description still enumerates every section

```bash
help=$(curl -sf "$TT_BASE_URL/api/help")
guides_blurb=$(jq -r '.guides' <<<"$help")
for id in auth-and-keys recipes api-reference agent-api; do
  grep -q -F "$id" <<<"$guides_blurb" || { echo "help.guides drops $id"; exit 1; }
done
```
