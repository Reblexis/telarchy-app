import { Router } from 'express';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { getActivityFeed, ACTIVITY_TYPES, type ActivityType } from '../services/activity';
import { db } from '../db/client';
import { agents, agentTraces, agentHeartbeats, agentControls, markets, workspaces, pageVisits, authUser, waitlist, floorQuestions } from '../db/schema';
import { and, desc, eq, gte, lte, inArray, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { AppError } from '../lib/errors';
import { resolutionInstant } from '../lib/date-utils';
import { classifyIps } from '../lib/ip-classify';
import { isPlatformAuthorized } from '../lib/platform-admin';
import { getParticipantDisplayNames } from '../lib/participants';

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

/**
 * Every question a visitor asked a floor, newest first (owner ask
 * 2026-08-20: "this is really useful data").
 *
 * It is the highest-signal thing a pre-launch floor produces: each row is
 * something a visitor wanted to know and could not find on the page, in
 * their own words, and the rows with an `error` are the ones nobody could
 * answer at all. Platform-admin only, like the rest of this file: the rows
 * carry visitor IPs.
 *
 * The IP and country are purged on the same 30-day window as page_visits,
 * on read, exactly as the visit log is; the question and its answer stay,
 * because the gap a question names outlives the visit that asked it.
 */
adminRouter.get('/questions', wrap(async (req, res) => {
  if (!(await isPlatformAuthorized(req))) {
    throw new AppError('Platform admin or master key required', 403);
  }
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  await db.update(floorQuestions).set({ ip: null, country: null })
    .where(lt(floorQuestions.createdAt, monthAgo));

  const raw = Number(req.query.limit);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 500) : 100;

  const rows = await db.select({
    id: floorQuestions.id,
    workspaceId: floorQuestions.workspaceId,
    question: floorQuestions.question,
    answer: floorQuestions.answer,
    askedBy: floorQuestions.askedBy,
    country: floorQuestions.country,
    costUsd: floorQuestions.costUsd,
    model: floorQuestions.model,
    error: floorQuestions.error,
    createdAt: floorQuestions.createdAt,
    slug: workspaces.slug,
    workspaceName: workspaces.name,
  }).from(floorQuestions)
    .leftJoin(workspaces, eq(workspaces.id, floorQuestions.workspaceId))
    .orderBy(desc(floorQuestions.createdAt))
    .limit(limit);

  const names = await getParticipantDisplayNames(rows.map(r => r.askedBy).filter((x): x is string => !!x));
  const spent = await db.select({ total: sql<number>`coalesce(sum(${floorQuestions.costUsd}), 0)::float` })
    .from(floorQuestions);

  res.json({
    totalCostUsd: spent[0]?.total ?? 0,
    questions: rows.map(r => ({
      ...r,
      // A handle where there is one, "anonymous" where there is not: most
      // askers have no account yet, which is who the field is for.
      askedByName: r.askedBy ? (names.get(r.askedBy) ?? r.askedBy) : null,
    })),
  });
}));

/**
 * Launch dashboard (owner ask 2026-08-11): visitors and signups in one
 * place. Visits come from the server-side document-load log (purged
 * past 30 days on every read, per the privacy policy's request-log
 * window); signups from the auth user table; the floor's contact
 * requests from the waitlist.
 */
adminRouter.get('/floor-stats', wrap(async (req, res) => {
  // Platform-admin only, NOT workspace `manage`: this response is
  // platform-global (every user's email, the waitlist, and every visitor's
  // IP), so a mere workspace owner/admin must not read it. Gated like the
  // other platform routes in this file (agent-controls, markets/featured).
  if (!(await isPlatformAuthorized(req))) {
    throw new AppError('Platform admin or master key required', 403);
  }
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  await db.delete(pageVisits).where(lt(pageVisits.ts, monthAgo));

  // Human filter (owner ask 2026-08-11): before launch the log is almost
  // all crawlers and vuln scanners, so a raw count is meaningless. Drop
  // anything whose user-agent looks like a bot, and the scanner probe
  // paths (/wp-admin, /.env, /.git). This is a heuristic, not perfect,
  // but it turns the numbers into "did a person show up".
  const humanish = and(
    sql`coalesce(${pageVisits.userAgent}, '') !~* '(bot|crawl|spider|slurp|bingpreview|facebookexternalhit|python-requests|curl/|wget|headless|scan)'`,
    sql`${pageVisits.path} !~* '(wp-admin|wp-login|\\.env|\\.git|phpmyadmin|xmlrpc)'`,
  );

  const window = (base: Date) => and(gte(pageVisits.ts, base), humanish);

  const visitsByDay = await db.select({
    day: sql<string>`to_char(${pageVisits.ts}, 'YYYY-MM-DD')`,
    visits: sql<number>`count(*)::int`,
    uniques: sql<number>`count(distinct ${pageVisits.ip})::int`,
  }).from(pageVisits).where(window(twoWeeksAgo))
    .groupBy(sql`1`).orderBy(sql`1`);

  // Referer grouped by DOMAIN so a launch channel (manifold.markets,
  // reddit.com, news.ycombinator.com, discord) aggregates into one row
  // rather than scattering across full URLs. Own-domain and empty referers
  // collapse to "direct / on-site".
  const topReferers = await db.select({
    source: sql<string>`
      case
        when ${pageVisits.referer} is null or ${pageVisits.referer} = '' then 'direct'
        when ${pageVisits.referer} ~* 'telarchy\\.com' then 'direct'
        else coalesce(substring(${pageVisits.referer} from '://([^/]+)'), ${pageVisits.referer})
      end`,
    visits: sql<number>`count(*)::int`,
  }).from(pageVisits).where(window(twoWeeksAgo))
    .groupBy(sql`1`).orderBy(desc(sql`count(*)`)).limit(12);

  const topPaths = await db.select({
    path: pageVisits.path, visits: sql<number>`count(*)::int`,
  }).from(pageVisits).where(window(twoWeeksAgo))
    .groupBy(pageVisits.path).orderBy(desc(sql`count(*)`)).limit(10);

  // Country of origin (owner ask 2026-08-11): where human launch traffic
  // comes from, from the offline IP->country lookup done at log time.
  // Unknown/private IPs (null country) collapse to '??'.
  const topCountries = await db.select({
    country: sql<string>`coalesce(${pageVisits.country}, '??')`,
    visits: sql<number>`count(*)::int`,
    uniques: sql<number>`count(distinct ${pageVisits.ip})::int`,
  }).from(pageVisits).where(window(twoWeeksAgo))
    .groupBy(sql`1`).orderBy(desc(sql`count(*)`)).limit(20);

  // Specific visitor IPs (owner ask 2026-08-11): one row per address with
  // its best-known country (max() ignores nulls, so a resolved country
  // wins over the '??' of older rows logged before geolocation existed),
  // most-recent first, so a repeat visitor or a specific launch click can
  // be inspected. Humanish only.
  const recentVisitors = await db.select({
    ip: pageVisits.ip,
    country: sql<string>`coalesce(max(${pageVisits.country}), '??')`,
    visits: sql<number>`count(*)::int`,
    lastSeen: sql<string>`max(${pageVisits.ts})`,
  }).from(pageVisits).where(and(window(twoWeeksAgo), sql`${pageVisits.ip} is not null`))
    .groupBy(pageVisits.ip)
    .orderBy(desc(sql`max(${pageVisits.ts})`)).limit(50);

  // Label each visitor IP person vs server/bot by IP type (hosting/proxy),
  // the signal the user-agent filter can't catch (a headless bot on a
  // cloud IP can spoof a browser UA). Cached + degrades to 'unknown'.
  const ipInfo = await classifyIps(recentVisitors.map(v => v.ip!).filter(Boolean));
  const visitors = recentVisitors.map(v => {
    const info = (v.ip && ipInfo.get(v.ip)) || { kind: 'unknown' as const, org: '' };
    return { ...v, kind: info.kind, org: info.org };
  });
  const visitorSummary = {
    people: visitors.filter(v => v.kind === 'person').length,
    servers: visitors.filter(v => v.kind === 'server').length,
    proxies: visitors.filter(v => v.kind === 'proxy').length,
  };

  const [{ visits: visits24h, uniques: uniques24h }] = await db.select({
    visits: sql<number>`count(*)::int`,
    uniques: sql<number>`count(distinct ${pageVisits.ip})::int`,
  }).from(pageVisits).where(window(dayAgo));

  const [{ botVisits }] = await db.select({
    botVisits: sql<number>`count(*)::int`,
  }).from(pageVisits).where(and(gte(pageVisits.ts, twoWeeksAgo), sql`not (${humanish})`));

  const signupsByDay = await db.select({
    day: sql<string>`to_char(${authUser.createdAt}, 'YYYY-MM-DD')`,
    signups: sql<number>`count(*)::int`,
  }).from(authUser).where(gte(authUser.createdAt, twoWeeksAgo))
    .groupBy(sql`1`).orderBy(sql`1`);

  const recentSignups = await db.select({
    email: authUser.email, name: authUser.name, createdAt: authUser.createdAt,
  }).from(authUser).orderBy(desc(authUser.createdAt)).limit(25);

  // Every signup, not the last 50 (owner ask 2026-08-15: "essentially all
  // waitlist signups"). This is the list the owner works through by hand, so
  // a cap silently hides people who are waiting on a reply. The bound is
  // generous rather than absent: a page that has to render 5,000 rows is a
  // different design problem, and hitting it is itself the signal to solve it.
  const waitlistRows = await db.select().from(waitlist).orderBy(desc(waitlist.createdAt)).limit(1000);

  const [{ n: totalUsers }] = await db.select({ n: sql<number>`count(*)::int` }).from(authUser);

  res.json({
    visits24h: Number(visits24h), uniques24h: Number(uniques24h), botVisits: Number(botVisits),
    visitsByDay, topReferers, topPaths, topCountries,
    recentVisitors: visitors, visitorSummary,
    signupsByDay, recentSignups, totalUsers,
    waitlist: waitlistRows,
  });
}));

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

// ---------------------------------------------------------------------------
// Agent control plane: desired state (enabled/paused) + cycle triggers for
// the out-of-process agent runners. The /agents admin UI writes; each runner
// polls GET /agent-controls every tick and obeys. Pull-based so the server
// never needs inbound access to the host running the agents. A trigger fires
// when triggerRequestedAt > triggerAckedAt; the runner acks after firing.
// ---------------------------------------------------------------------------

adminRouter.get('/agent-controls', wrap(async (req, res) => {
  if (!(await isPlatformAuthorized(req))) {
    throw new AppError('Platform admin or master key required', 403);
  }
  const rows = await db.select().from(agentControls).orderBy(agentControls.agentId);
  res.json({ controls: rows });
}));

adminRouter.post('/agent-control', wrap(async (req, res) => {
  if (!(await isPlatformAuthorized(req))) {
    throw new AppError('Platform admin or master key required', 403);
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const agentId = reqStr(body, 'agentId');

  const set: Partial<typeof agentControls.$inferInsert> = { updatedAt: new Date() };
  if (body.desiredState !== undefined) {
    if (body.desiredState !== 'enabled' && body.desiredState !== 'paused') {
      throw new AppError("desiredState must be 'enabled' or 'paused'", 400);
    }
    set.desiredState = body.desiredState;
  }
  if (body.trigger === true) set.triggerRequestedAt = new Date();
  if (body.ackTrigger === true) set.triggerAckedAt = new Date();
  if (set.desiredState === undefined && set.triggerRequestedAt === undefined && set.triggerAckedAt === undefined) {
    throw new AppError('Nothing to do: pass desiredState, trigger, or ackTrigger', 400);
  }

  const [row] = await db.insert(agentControls)
    .values({ agentId, ...set })
    .onConflictDoUpdate({ target: agentControls.agentId, set })
    .returning();
  res.json(row);
}));

/**
 * Platform curation: flip the `featured` flag on a market. Featured markets
 * appear on the public /benchmark surface and via GET /api/marketplace/featured.
 * Platform-admin / master-key only (this is global curation, not workspace-scoped).
 */
adminRouter.post('/markets/featured', wrap(async (req, res) => {
  if (!(await isPlatformAuthorized(req))) {
    throw new AppError('Platform admin or master key required', 403);
  }
  const { marketId, workspaceId, featured } = req.body ?? {};
  if (typeof marketId !== 'string' || !marketId) throw new AppError('marketId required', 400);
  if (typeof workspaceId !== 'string' || !workspaceId) throw new AppError('workspaceId required', 400);
  if (typeof featured !== 'boolean') throw new AppError('featured (boolean) required', 400);

  const updated = await db.update(markets)
    .set({ featured })
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)))
    .returning({ id: markets.id, workspaceId: markets.workspaceId, featured: markets.featured });

  if (updated.length === 0) throw new AppError('Market not found', 404);
  res.json(updated[0]);
}));

/** List all featured markets (across all workspaces, including private), for admin curation. */
adminRouter.get('/markets/featured', wrap(async (req, res) => {
  if (!(await isPlatformAuthorized(req))) {
    throw new AppError('Platform admin or master key required', 403);
  }
  const rows = await db.select({
    marketId: markets.id,
    workspaceId: markets.workspaceId,
    metricName: markets.metricName,
    targetDate: markets.targetDate,
    resolved: markets.resolved,
    active: markets.active,
  }).from(markets).where(eq(markets.featured, true));
  res.json(rows.map(r => ({ ...r, resolvesOn: resolutionInstant(r.targetDate) })));
}));
