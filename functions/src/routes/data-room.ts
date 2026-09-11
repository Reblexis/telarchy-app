import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { workspaces } from '../db/schema';
import { wrap } from '../lib/wrap';
import { buildActions, parseActionsQuery } from '../services/actions';
import { buildDataRoomFeed } from '../services/data-room';
import { buildTimeline } from '../services/timeline';

/**
 * The data room, telarchy.com/data-room: the public actions log (spec:
 * docs/data-room.md).
 *
 * Anonymous and uncredentialed on purpose: the page's whole claim is that a
 * visitor can fetch the same URL the page fetches, with the same filters, and
 * an agent reads the same list. `/` is the room as a document (prose plus the
 * first page); `/actions` is the log with filters; `/planned` is the platform
 * floor's calendar (docs/data-room.md, "What is planned").
 */
export const dataRoomRouter = Router();

dataRoomRouter.get(
  '/',
  wrap(async (_req, res) => {
    res.json(await buildDataRoomFeed());
  }),
);

dataRoomRouter.get(
  '/actions',
  wrap(async (req, res) => {
    res.json(await buildActions(parseActionsQuery(req.query as Record<string, unknown>)));
  }),
);

/**
 * GET /api/data-room/planned
 *
 * What the owner of Telarchy has committed to and by when: the calendar of
 * ONE floor, the platform's own, named by DATA_ROOM_WORKSPACE_SLUG (default
 * "telarchy"). The items are buildTimeline's, the same function behind
 * GET /api/marketplace/:idOrSlug/timeline, so a bar the room draws is the bar
 * the floor would draw. The floor is named in the response so the page can
 * say whose calendar this is.
 *
 * A fresh instance has no such floor, and a private one must not be
 * disclosed through the room: both answer 200 with a null workspace and no
 * items, because the room must never fail to open over a missing calendar.
 */
dataRoomRouter.get(
  '/planned',
  wrap(async (_req, res) => {
    const slug = process.env.DATA_ROOM_WORKSPACE_SLUG || 'telarchy';
    const now = new Date();
    const [ws] = await db
      .select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name })
      .from(workspaces)
      .where(
        // The room is public, so only a public floor's calendar is printed
        // on it; an unlisted or private floor with the slug answers null.
        sql`lower(${workspaces.slug}) = lower(${slug}) and ${workspaces.visibility} = 'public'`,
      )
      .limit(1);
    if (!ws || !ws.slug) {
      res.json({ workspace: null, now: now.toISOString(), items: [] });
      return;
    }
    const items = await buildTimeline(db, { id: ws.id, slug: ws.slug }, now);
    res.json({ workspace: { id: ws.id, slug: ws.slug, name: ws.name }, now: now.toISOString(), items });
  }),
);
