import { Router } from 'express';
import { wrap } from '../lib/wrap';
import { buildActions, parseActionsQuery } from '../services/actions';
import { buildDataRoomFeed } from '../services/data-room';

/**
 * The data room, telarchy.com/data-room: the public actions log (spec:
 * docs/data-room.md).
 *
 * Anonymous and uncredentialed on purpose: the page's whole claim is that a
 * visitor can fetch the same URL the page fetches, with the same filters, and
 * an agent reads the same list. `/` is the room as a document (prose plus the
 * first page); `/actions` is the log with filters.
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
