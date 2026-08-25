import { Router } from 'express';
import { wrap } from '../lib/wrap';
import { getUpdates } from '../services/metrics';

export const updatesRouter = Router();

updatesRouter.get(
  '/',
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    res.json(await getUpdates(limit, workspaceId));
  }),
);
