import { Router } from 'express';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { ACTIVITY_TYPES, type ActivityItem, type ActivityType, getActivityFeed } from '../services/activity';

export const activityRouter = Router();

function parseIsoDate(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

function parseTypes(raw: unknown): ActivityType[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const known = ACTIVITY_TYPES as readonly string[];
  const filtered = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter((t): t is ActivityType => known.includes(t));
  return filtered.length > 0 ? filtered : undefined;
}

export const MEMBER_HIDDEN_TYPES = new Set<ActivityType>(['deposit', 'withdrawal']);
export const MEMBER_VISIBLE_TYPES: ActivityType[] = ACTIVITY_TYPES.filter(t => !MEMBER_HIDDEN_TYPES.has(t));

export function applyMemberPolicy(items: ActivityItem[]): ActivityItem[] {
  const filtered: ActivityItem[] = [];
  for (const item of items) {
    if (MEMBER_HIDDEN_TYPES.has(item.type)) continue;
    if (item.type === 'trade') {
      filtered.push({ ...item, actor: null });
    } else {
      filtered.push(item);
    }
  }
  return filtered;
}

activityRouter.get(
  '/',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId, capabilities } = req.auth!;
    const isAdmin = capabilities.has('manage');

    const requestedTypes = parseTypes(req.query.types);
    const allowedTypes: ActivityType[] = isAdmin
      ? (ACTIVITY_TYPES as readonly ActivityType[]).slice()
      : MEMBER_VISIBLE_TYPES;
    const types = requestedTypes ? requestedTypes.filter(t => allowedTypes.includes(t)) : allowedTypes;

    const since = parseIsoDate(req.query.since);
    const until = parseIsoDate(req.query.until);
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    const participantId = typeof req.query.participantId === 'string' ? req.query.participantId : undefined;
    const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
    const metricId = typeof req.query.metricId === 'string' ? req.query.metricId : undefined;
    const proposalId = typeof req.query.proposalId === 'string' ? req.query.proposalId : undefined;

    const raw = await getActivityFeed(workspaceId, {
      since,
      until,
      limit: Number.isFinite(limit) ? limit : undefined,
      types,
      participantId,
      marketId,
      metricId,
      proposalId,
    });

    const activities = isAdmin ? raw : applyMemberPolicy(raw);
    const nextCursor = activities.length > 0 ? activities[0].timestamp : (until ?? new Date()).toISOString();

    res.json({
      activities,
      supportedTypes: allowedTypes,
      nextCursor,
    });
  }),
);
