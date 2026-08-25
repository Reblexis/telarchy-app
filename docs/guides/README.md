# Guides

These files ARE the guides the API serves: `GET /api/guides` lists them and
`GET /api/guides/<id>` returns the markdown, where `<id>` is the file name.
Edit the markdown here; nothing else holds the text.

`scripts/build-guides.mjs` generates `functions/src/content/guides.ts` from this
directory (`npm run build` runs it; `npm run build:guides` runs it alone). The
generated module is committed, and `functions/src/__tests__/guides-content.test.ts`
fails when it is out of date, so a guide edit is a two-file diff: the markdown and
the regenerated module.

Each file starts with a front-matter block:

```
---
title: Overview
description: Core concepts: what metrics are and how to track them.
category: start          # start | metrics | forecast | api (functions/src/routes/guides.ts)
order: 10                # position within the category; 10/20/30 so inserts need no renumbering
---
```

followed by the markdown body. Categories and their order are defined in
`functions/src/routes/guides.ts` (`GUIDE_CATEGORIES`).
