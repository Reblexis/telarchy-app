import { Router } from 'express';
import { wrap } from '../lib/wrap';
import { buildDataRoomFeed } from '../services/data-room';

/**
 * The data room, telarchy.com/data-room: Telarchy's own books in one public
 * read (spec: docs/data-room.md).
 *
 * Anonymous and uncredentialed on purpose: the page's whole claim is that a
 * visitor can fetch the same URL the page fetches and check it. The payload
 * itself is built in services/data-room.ts, because Otto reads the same object
 * when a visitor asks him about the platform, and two builders would let his
 * answers and the page quote different numbers.
 */
export const dataRoomRouter = Router();

dataRoomRouter.get(
  '/',
  wrap(async (_req, res) => {
    res.json(await buildDataRoomFeed());
  }),
);
