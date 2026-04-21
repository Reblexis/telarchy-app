import { Router } from 'express';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { getActivityFeed, ACTIVITY_TYPES, type ActivityType } from '../services/activity';

export const adminRouter = Router();

function parseIsoDate(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

function parseTypes(raw: unknown): ActivityType[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const known = ACTIVITY_TYPES as readonly string[];
  const filtered = parts.filter((t): t is ActivityType => known.includes(t));
  return filtered.length > 0 ? filtered : undefined;
}

adminRouter.get('/activity', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const since = parseIsoDate(req.query.since);
  const until = parseIsoDate(req.query.until);
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
  const types = parseTypes(req.query.types);
  const participantId = typeof req.query.participantId === 'string' ? req.query.participantId : undefined;
  const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
  const metricId = typeof req.query.metricId === 'string' ? req.query.metricId : undefined;
  const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;

  const activities = await getActivityFeed(workspaceId, {
    since,
    until,
    limit: Number.isFinite(limit) ? limit : undefined,
    types,
    participantId,
    marketId,
    metricId,
    taskId,
  });

  const nextCursor = activities.length > 0 ? activities[0].timestamp : (until ?? new Date()).toISOString();
  res.json({
    activities,
    supportedTypes: ACTIVITY_TYPES,
    nextCursor,
  });
}));
