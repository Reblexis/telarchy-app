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
category: start          # start | forecast | run | api (functions/src/routes/guides.ts)
order: 10                # position within the category; 10/20/30 so inserts need no renumbering
---
```

followed by the markdown body. Categories and their order are defined in
`functions/src/routes/guides.ts` (`GUIDE_CATEGORIES`).

The four categories are the reader's job, not the product's parts. Someone
arrives either wanting to forecast and earn (`forecast`) or wanting their own
numbers priced (`run`); `start` orients them and sends them down one of the
two, and `api` is the reference behind both for whoever is building a
participant. Put a new guide where its reader is, never where its subsystem
lives.

A guide states what the product does today. When the code and a guide
disagree the guide is wrong, and `/api/help` is the authority on the API
surface. The set was rebuilt on 2026-08-30 after the owner pointed out that
it described a product that no longer existed: the guides still explained a
deleted admin UI, claimed metric edits voided markets, and never mentioned
seasons, limit orders or the Manifold import. Facts that move (credit grants,
prize structure) are better linked than quoted: `GET /api/earn` publishes the
grants, and `/legal/season-0` is the authority on the season.
