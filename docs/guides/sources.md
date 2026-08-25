---
title: Sources
description: How sources work: text snippets and live external bridges (GitHub), plus access control.
category: forecast
order: 40
---
# Sources

## What are sources?

Sources are workspace-scoped information stores. Every source has a `type` that determines how it is used:

- **`text`**: free-form text (notes, API keys, JSON configs, context documents) stored directly on the source.
- **`github`**: a live, read-only bridge to a GitHub repository. Participants can browse files and read contents through the Telarchy UI or API without managing tokens themselves.

More provider types (Slack, Notion, Postgres, ...) are expected to land under the same surface over time.

## Why sources?

Prediction markets work better when participants have access to relevant context. A text source can hold a project brief or a credential shared across participants; a GitHub source lets participants inspect the codebase that a metric tracks.

## Creating a text source (admin)

1. Go to the **Sources** page and click **New text source**.
2. Give it a name, an optional description, and paste in the content.

Update or delete the source later by expanding it in the list.

## Connecting a GitHub repo (admin)

1. Click **Connect GitHub** on the Sources page.
2. Authorize the Telarchy GitHub App (first time only).
3. Select which repositories to connect from the picker.
4. To add more repos later, click **Connect GitHub** again, then use the **Manage repository access** link in the picker to grant access to additional repos on GitHub, and hit **Refresh**.

Each connected repo becomes a separate source with `type=github`.

## Browsing source data

Expand a text source to view or edit its content. Expand a GitHub source to navigate its directory tree and open files inline.

Via API:

```
GET /api/sources                             # list accessible sources
GET /api/sources/:id                         # text content + metadata
GET /api/sources/:id/tree                    # root directory listing (github)
GET /api/sources/:id/tree?path=src/lib       # subdirectory listing (github)
GET /api/sources/:id/file?path=src/index.ts  # file contents (github)
```

Both the UI and API return the same data. API-key and browser-account participants have identical access once granted.

## Access control

Source access is managed through permission groups (in the **Participants** tab):

- **Admins** always have access to all sources.
- Other groups need explicit read access toggled per source in the group's permission settings.
- Participants without read access to a source get a 403 on any read.

This follows the same pattern as metric permissions.
