import { Router } from 'express';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { getActivityFeed, ACTIVITY_TYPES, type ActivityType } from '../services/activity';
import { db } from '../db/client';
import { agents, agentTraces, agentHeartbeats, workspaces } from '../db/schema';
import { and, desc, eq, gte, lte, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { AppError } from '../lib/errors';

/** True if the caller is the master key OR a platform admin. */
async function isPlatformAuthorized(req: { auth?: { isMasterKey?: boolean; uid?: string } }): Promise<boolean> {
  if (!req.auth) return false;
  if (req.auth.isMasterKey) return true;
  if (!req.auth.uid) return false;
  const [agent] = await db.select({ platformAdmin: agents.platformAdmin })
    .from(agents)
    .where(eq(agents.authUserId, req.auth.uid));
  return agent?.platformAdmin === true;
}

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
  const proposalId = typeof req.query.proposalId === 'string' ? req.query.proposalId : undefined;

  const activities = await getActivityFeed(workspaceId, {
    since,
    until,
    limit: Number.isFinite(limit) ? limit : undefined,
    types,
    participantId,
    marketId,
    metricId,
    proposalId,
  });

  const nextCursor = activities.length > 0 ? activities[0].timestamp : (until ?? new Date()).toISOString();
  res.json({
    activities,
    supportedTypes: ACTIVITY_TYPES,
    nextCursor,
  });
}));

// ---------------------------------------------------------------------------
// Agent telemetry: heartbeats + per-session decision traces.
// Pushed by the out-of-process telarchy-agents service (master key) and read
// by the admin UI.
// ---------------------------------------------------------------------------

function reqStr(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !v) throw new AppError(`${key} required`, 400);
  return v;
}

function optNum(body: Record<string, unknown>, key: string, fallback = 0): number {
  const v = body[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function optStr(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  return typeof v === 'string' && v ? v : null;
}

function optDate(body: Record<string, unknown>, key: string): Date | null {
  const v = body[key];
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

adminRouter.post('/agent-traces', requireCapability('manage'), wrap(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const workspaceId = reqStr(body, 'workspaceId');
  const agentId = reqStr(body, 'agentId');
  const strategy = reqStr(body, 'strategy');
  const startedAt = optDate(body, 'startedAt') ?? new Date();
  const endedAt = optDate(body, 'endedAt') ?? new Date();
  const entries = Array.isArray(body.entries) ? body.entries as unknown[] : [];

  const id = randomUUID();
  await db.insert(agentTraces).values({
    id,
    workspaceId,
    agentId,
    strategy,
    startedAt,
    endedAt,
    model: optStr(body, 'model'),
    tokensIn: optNum(body, 'tokensIn'),
    tokensOut: optNum(body, 'tokensOut'),
    cacheRead: optNum(body, 'cacheRead'),
    cacheWrite: optNum(body, 'cacheWrite'),
    candidates: optNum(body, 'candidates'),
    traded: optNum(body, 'traded'),
    skipped: optNum(body, 'skipped'),
    errors: optNum(body, 'errors'),
    costUsd: optNum(body, 'costUsd'),
    entries,
  });

  res.status(201).json({ id });
}));

adminRouter.get('/agent-traces', requireCapability('manage'), wrap(async (req, res) => {
  const callerWorkspaceId = req.auth!.workspaceId;
  const requestedScope = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  const isPlatform = await isPlatformAuthorized(req);

  // Platform admin / master key may scope to any single workspace, or pass
  // 'all' for a cross-workspace view. Workspace-only admins are pinned to
  // their own workspace.
  let scope: string | 'all';
  if (requestedScope && isPlatform) {
    scope = requestedScope;
  } else {
    scope = callerWorkspaceId;
  }

  const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
  const limit = Math.min(
    typeof req.query.limit === 'string' ? Math.max(1, parseInt(req.query.limit, 10) || 0) : 50,
    200,
  );
  const since = parseIsoDate(req.query.since);
  const until = parseIsoDate(req.query.until);

  const conds = [];
  if (scope !== 'all') conds.push(eq(agentTraces.workspaceId, scope));
  if (agentId) conds.push(eq(agentTraces.agentId, agentId));
  if (since) conds.push(gte(agentTraces.startedAt, since));
  if (until) conds.push(lte(agentTraces.startedAt, until));

  const where = conds.length === 0 ? undefined
    : conds.length === 1 ? conds[0]
    : and(...conds);

  const rows = await (where
    ? db.select().from(agentTraces).where(where)
    : db.select().from(agentTraces)
  )
    .orderBy(desc(agentTraces.startedAt))
    .limit(limit);

  // Resolve human-readable workspace names in one query so the panel doesn't
  // need a separate fetch + lookup just to render the trace rows.
  const wsIds = Array.from(new Set(rows.map(r => r.workspaceId).filter((s): s is string => !!s)));
  const wsRows = wsIds.length > 0
    ? await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(inArray(workspaces.id, wsIds))
    : [];
  const nameById = Object.fromEntries(wsRows.map(w => [w.id, w.name]));
  const enriched = rows.map(r => ({ ...r, workspaceName: nameById[r.workspaceId] ?? null }));

  res.json({ traces: enriched, scope, isPlatformAdmin: isPlatform });
}));

adminRouter.post('/agent-heartbeat', requireCapability('manage'), wrap(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const agentId = reqStr(body, 'agentId');
  const status = optStr(body, 'status') ?? 'idle';
  const now = new Date();

  await db.insert(agentHeartbeats)
    .values({
      agentId,
      status,
      workspaceId: optStr(body, 'workspaceId'),
      strategy: optStr(body, 'strategy'),
      lastCycleStartedAt: optDate(body, 'lastCycleStartedAt'),
      lastCycleEndedAt: optDate(body, 'lastCycleEndedAt'),
      nextCycleAt: optDate(body, 'nextCycleAt'),
      pollIntervalSeconds: optNum(body, 'pollIntervalSeconds'),
      workspacesVisited: optNum(body, 'workspacesVisited'),
      lastTraded: optNum(body, 'lastTraded'),
      lastSkipped: optNum(body, 'lastSkipped'),
      lastErrors: optNum(body, 'lastErrors'),
      lastError: optStr(body, 'lastError'),
      balance: typeof body.balance === 'number' ? body.balance : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: agentHeartbeats.agentId,
      set: {
        status,
        workspaceId: optStr(body, 'workspaceId'),
        strategy: optStr(body, 'strategy'),
        lastCycleStartedAt: optDate(body, 'lastCycleStartedAt'),
        lastCycleEndedAt: optDate(body, 'lastCycleEndedAt'),
        nextCycleAt: optDate(body, 'nextCycleAt'),
        pollIntervalSeconds: optNum(body, 'pollIntervalSeconds'),
        workspacesVisited: optNum(body, 'workspacesVisited'),
        lastTraded: optNum(body, 'lastTraded'),
        lastSkipped: optNum(body, 'lastSkipped'),
        lastErrors: optNum(body, 'lastErrors'),
        lastError: optStr(body, 'lastError'),
        balance: typeof body.balance === 'number' ? body.balance : null,
        updatedAt: now,
      },
    });

  res.status(204).end();
}));

adminRouter.get('/agent-heartbeats', requireCapability('manage'), wrap(async (req, res) => {
  // Heartbeats are global by design (one row per bot, identifies which
  // workspace the bot last visited). Platform admin / master key sees all;
  // workspace admins see only the bots that visited their workspace.
  const isPlatform = await isPlatformAuthorized(req);
  const callerWorkspaceId = req.auth!.workspaceId;

  const where = isPlatform ? undefined : eq(agentHeartbeats.workspaceId, callerWorkspaceId);

  const rows = await (where
    ? db.select().from(agentHeartbeats).where(where)
    : db.select().from(agentHeartbeats)
  ).orderBy(desc(agentHeartbeats.updatedAt));

  const wsIds = Array.from(new Set(rows.map(r => r.workspaceId).filter((s): s is string => !!s)));
  const wsRows = wsIds.length > 0
    ? await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(inArray(workspaces.id, wsIds))
    : [];
  const nameById = Object.fromEntries(wsRows.map(w => [w.id, w.name]));
  const enriched = rows.map(r => ({ ...r, workspaceName: r.workspaceId ? (nameById[r.workspaceId] ?? null) : null }));

  res.json({ heartbeats: enriched, isPlatformAdmin: isPlatform });
}));
