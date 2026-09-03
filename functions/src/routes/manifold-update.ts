/**
 * The Manifold update, mounted at /api/admin/manifold-update.
 * Governing doc: docs/manifold-update.md, "Surface".
 *
 * Platform admin only: it is the owner's own comment, and the standings it
 * quotes name people and money.
 */
import { Router } from 'express';
import { AppError } from '../lib/errors';
import { renderManifoldUpdate, type UpdateEntrant } from '../lib/manifold-update';
import { isPlatformAuthorized } from '../lib/platform-admin';
import { currentSeasonId } from '../lib/seasons-current';
import { wrap } from '../lib/wrap';
import { linkedManifoldCount } from '../services/platform-stats';
import { seasonStandingsPayload } from './leaderboard';

export const manifoldUpdateRouter = Router();

manifoldUpdateRouter.get(
  '/',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Platform admin or master key required', 403);
    }
    const linked = await linkedManifoldCount();
    const seasonId = await currentSeasonId();
    if (!seasonId) {
      res.json({
        text: renderManifoldUpdate({ linked, season: null, participants: [] }),
        linked,
        seasonId: null,
        generatedAt: new Date().toISOString(),
      });
      return;
    }
    // The same answer the season page shows, never recomputed here: the
    // comment is a public claim about who is winning money, and it must
    // agree with the page to the cent. 500 entrants is the standings cap.
    const standings = await seasonStandingsPayload(seasonId, 500);
    if (standings.status !== 200) {
      throw new AppError('Season standings unavailable', 502);
    }
    const body = standings.body as {
      season: { id: string; name: string; status: string };
      participants: UpdateEntrant[];
    };
    res.json({
      text: renderManifoldUpdate({ linked, season: body.season, participants: body.participants }),
      linked,
      seasonId,
      generatedAt: new Date().toISOString(),
    });
  }),
);
