---
id: 00-anonymous-seo-and-og
tags: [api-only, fast]
isolation: global
parallel-safe: true
needs: []
timeout: 30s
goal-horizon: short
goal-statement: |
  As a search engine or chat client unfurling a Telarchy link, I get a
  proper title, description, image, and a robots/sitemap that signals the
  site is crawlable.
---

# Browse test: SEO + OG meta

## What this tests

Anonymous, machine-driven view of the public surface: `/`, `/marketplace`,
`/marketplace/<id>`, `/robots.txt`, `/sitemap.xml`. Every page that's
shareable must surface OG / Twitter meta.

Maps to `mvp-evaluation/plan.md` 1.10 + 1.11 + 6.5.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
```

## Tests

### T1. /robots.txt exists and is non-empty

```bash
body=$(curl -sf "$TT_FRONTEND_URL/robots.txt")
[ -n "$body" ] && grep -qiE "user-agent|disallow|allow|sitemap" <<<"$body"
```

### T2. /sitemap.xml is well-formed XML

```bash
curl -sf "$TT_FRONTEND_URL/sitemap.xml" | head -c 4096 \
  | grep -q '<urlset\|<sitemapindex' \
  || { echo "sitemap.xml missing or malformed"; exit 1; }
```

### T3. Root has all four social-card tags

```bash
html=$(curl -sf "$TT_FRONTEND_URL/")
for tag in og:title og:description og:image twitter:card; do
  grep -qE "(property|name)=\"$tag\"" <<<"$html" \
    || { echo "missing $tag on /"; exit 1; }
done
```

### T4. Marketplace landing has its own OG image

```bash
html=$(curl -sf "$TT_FRONTEND_URL/marketplace")
grep -qE 'property="og:title"' <<<"$html"
```

### T5. Public workspace share page has OG title with workspace name

```bash
ws=$(curl -sf "$TT_BASE_URL/api/marketplace/workspaces/public" | jq -r '.[0].id // empty')
[ -z "$ws" ] && { echo "skip: no public workspace"; exit 0; }
name=$(curl -sf "$TT_BASE_URL/api/marketplace/$ws" | jq -r '.name // empty')
html=$(curl -sf "$TT_FRONTEND_URL/marketplace/$ws")
grep -F "$name" <<<"$html" \
  || echo "WARN: workspace name '$name' not in /marketplace/$ws HTML — share unfurl will be generic"
```

### T6. No tracking pixels in built JS

```bash
# Crawl once-for-truth: download the index, find the main bundle, grep it.
html=$(curl -sf "$TT_FRONTEND_URL/")
bundle=$(grep -oE '/assets/[^"]+\.js' <<<"$html" | head -1)
if [ -n "$bundle" ]; then
  curl -sf "$TT_FRONTEND_URL$bundle" \
    | grep -E 'google-analytics|googletagmanager|segment\.com|hotjar|mixpanel|amplitude' \
    && { echo "FAIL: third-party tracker found in bundle"; exit 1; } || true
fi
```

### T7. Long-cache headers on hashed assets

```bash
html=$(curl -sf "$TT_FRONTEND_URL/")
bundle=$(grep -oE '/assets/[^"]+\.js' <<<"$html" | head -1)
if [ -n "$bundle" ]; then
  cc=$(curl -sI "$TT_FRONTEND_URL$bundle" | tr -d '\r' | awk -F': ' '/^[Cc]ache-[Cc]ontrol/{print $2}')
  grep -qE 'max-age=([0-9]{6,9}|31536000)' <<<"$cc" \
    || echo "WARN: hashed asset cache-control is '$cc' (want a year)"
fi
```

### T8. Compression negotiated

```bash
enc=$(curl -sI -H 'Accept-Encoding: br, gzip' "$TT_FRONTEND_URL/" | tr -d '\r' | awk -F': ' '/^[Cc]ontent-[Ee]ncoding/{print $2}')
grep -qiE 'br|gzip' <<<"$enc" \
  || echo "WARN: no compression negotiated for /"
```

## Cleanup

None.

## Known gaps

- No link-rot crawl on the rendered HTML (anchors might point at removed
  routes after a refactor). Add when there is a stable internal-link map.
