import { randomUUID } from 'crypto';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import {
  agentControls,
  agentHeartbeats,
  agents,
  agentTraces,
  authUser,
  floorQuestions,
  markets,
  pageVisits,
  proposals,
  waitlist,
  workspaces,
} from '../db/schema';
import { resolutionInstant } from '../lib/date-utils';
import { AppError } from '../lib/errors';
import { classifyIps } from '../lib/ip-classify';
import { getParticipantDisplayNames } from '../lib/participants';
import { isPlatformAuthorized } from '../lib/platform-admin';
import { humanVisitFilter } from '../lib/visit-log';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { ACTIVITY_TYPES, type ActivityType, getActivityFeed } from '../services/activity';
import { BuildNotConfiguredError, buildConfigured, dispatchBuild, listBranches } from '../services/branches';
import { earnRuleHistoryFor, listEarnRules, setEarnRule } from '../services/earnRules';
import { PublishRefusedError, publishRevision, releaseState } from '../services/release';

export const adminRouter = Router();

function parseIsoDate(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

function parseTypes(raw: unknown): ActivityType[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const parts = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
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
 * The IP and country stay for the same 30-day window as page_visits. The
 * durable scrub runs in the daily maintenance job (services/maintenance.ts);
 * the response below additionally masks anything the job has not reached
 * yet, so this endpoint can never return an IP older than the window. The
 * question and its answer stay, because the gap a question names outlives
 * the visit that asked it.
 */
adminRouter.get(
  '/questions',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Platform admin or master key required', 403);
    }
    const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 500) : 100;

    const rows = await db
      .select({
        id: floorQuestions.id,
        workspaceId: floorQuestions.workspaceId,
        question: floorQuestions.question,
        answer: floorQuestions.answer,
        askedBy: floorQuestions.askedBy,
        country: floorQuestions.country,
        costUsd: floorQuestions.costUsd,
        model: floorQuestions.model,
        error: floorQuestions.error,
        /** What Otto did about it, with this asker's own credentials. */
        toolCalls: floorQuestions.toolCalls,
        createdAt: floorQuestions.createdAt,
        slug: workspaces.slug,
        workspaceName: workspaces.name,
      })
      .from(floorQuestions)
      .leftJoin(workspaces, eq(workspaces.id, floorQuestions.workspaceId))
      .orderBy(desc(floorQuestions.createdAt))
      .limit(limit);

    const names = await getParticipantDisplayNames(rows.map(r => r.askedBy).filter((x): x is string => !!x));
    const spent = await db
      .select({ total: sql<number>`coalesce(sum(${floorQuestions.costUsd}), 0)::float` })
      .from(floorQuestions);

    res.json({
      totalCostUsd: spent[0]?.total ?? 0,
      questions: rows.map(r => ({
        ...r,
        // Past the retention window the durable scrub may not have run yet
        // (daily job); never let this response outlive the policy either way.
        country: r.createdAt < monthAgo ? null : r.country,
        // A handle where there is one, "anonymous" where there is not: most
        // askers have no account yet, which is who the field is for.
        askedByName: r.askedBy ? (names.get(r.askedBy) ?? r.askedBy) : null,
      })),
    });
  }),
);

/**
 * Launch dashboard (owner ask 2026-08-11): visitors and signups in one
 * place. Visits come from the server-side document-load log (purged
 * past 30 days on every read, per the privacy policy's request-log
 * window); signups from the auth user table; the floor's contact
 * requests from the waitlist.
 */
adminRouter.get(
  '/floor-stats',
  wrap(async (req, res) => {
    // Platform-admin only, NOT workspace `manage`: this response is
    // platform-global (every user's email, the waitlist, and every visitor's
    // IP), so a mere workspace owner/admin must not read it. Gated like the
    // other platform routes in this file (agent-controls, markets/featured).
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Platform admin or master key required', 403);
    }
    const _monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    // Retention (the 30-day purge) moved to the daily maintenance job
    // (services/maintenance.ts): a DELETE inside every cockpit read made the
    // reader pay for hygiene. Every window below is <= 30 days, so nothing
    // past the policy can surface here regardless of when the job last ran.

    // Human filter (owner ask 2026-08-11): before launch the log is almost
    // all crawlers and vuln scanners, so a raw count is meaningless. The rule
    // itself lives in lib/visit-log.ts because the public data room publishes
    // the same count, and two surfaces showing one fact must derive it from
    // one place.
    const humanish = humanVisitFilter();

    const window = (base: Date) => and(gte(pageVisits.ts, base), humanish);

    const visitsByDay = await db
      .select({
        day: sql<string>`to_char(${pageVisits.ts}, 'YYYY-MM-DD')`,
        visits: sql<number>`count(*)::int`,
        uniques: sql<number>`count(distinct ${pageVisits.ip})::int`,
      })
      .from(pageVisits)
      .where(window(twoWeeksAgo))
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // Referer grouped by DOMAIN so a launch channel (manifold.markets,
    // reddit.com, news.ycombinator.com, discord) aggregates into one row
    // rather than scattering across full URLs. Own-domain and empty referers
    // collapse to "direct / on-site".
    const topReferers = await db
      .select({
        source: sql<string>`
      case
        when ${pageVisits.referer} is null or ${pageVisits.referer} = '' then 'direct'
        when ${pageVisits.referer} ~* 'telarchy\\.com' then 'direct'
        else coalesce(substring(${pageVisits.referer} from '://([^/]+)'), ${pageVisits.referer})
      end`,
        visits: sql<number>`count(*)::int`,
      })
      .from(pageVisits)
      .where(window(twoWeeksAgo))
      .groupBy(sql`1`)
      .orderBy(desc(sql`count(*)`))
      .limit(12);

    const topPaths = await db
      .select({
        path: pageVisits.path,
        visits: sql<number>`count(*)::int`,
      })
      .from(pageVisits)
      .where(window(twoWeeksAgo))
      .groupBy(pageVisits.path)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    // Country of origin (owner ask 2026-08-11): where human launch traffic
    // comes from, from the offline IP->country lookup done at log time.
    // Unknown/private IPs (null country) collapse to '??'.
    const topCountries = await db
      .select({
        country: sql<string>`coalesce(${pageVisits.country}, '??')`,
        visits: sql<number>`count(*)::int`,
        uniques: sql<number>`count(distinct ${pageVisits.ip})::int`,
      })
      .from(pageVisits)
      .where(window(twoWeeksAgo))
      .groupBy(sql`1`)
      .orderBy(desc(sql`count(*)`))
      .limit(20);

    // Specific visitor IPs (owner ask 2026-08-11): one row per address with
    // its best-known country (max() ignores nulls, so a resolved country
    // wins over the '??' of older rows logged before geolocation existed),
    // most-recent first, so a repeat visitor or a specific launch click can
    // be inspected. Humanish only.
    const recentVisitors = await db
      .select({
        ip: pageVisits.ip,
        country: sql<string>`coalesce(max(${pageVisits.country}), '??')`,
        visits: sql<number>`count(*)::int`,
        lastSeen: sql<string>`max(${pageVisits.ts})`,
      })
      .from(pageVisits)
      .where(and(window(twoWeeksAgo), sql`${pageVisits.ip} is not null`))
      .groupBy(pageVisits.ip)
      .orderBy(desc(sql`max(${pageVisits.ts})`))
      .limit(50);

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

    const [{ visits: visits24h, uniques: uniques24h }] = await db
      .select({
        visits: sql<number>`count(*)::int`,
        uniques: sql<number>`count(distinct ${pageVisits.ip})::int`,
      })
      .from(pageVisits)
      .where(window(dayAgo));

    const [{ botVisits }] = await db
      .select({
        botVisits: sql<number>`count(*)::int`,
      })
      .from(pageVisits)
      .where(and(gte(pageVisits.ts, twoWeeksAgo), sql`not (${humanish})`));

    const signupsByDay = await db
      .select({
        day: sql<string>`to_char(${authUser.createdAt}, 'YYYY-MM-DD')`,
        signups: sql<number>`count(*)::int`,
      })
      .from(authUser)
      .where(gte(authUser.createdAt, twoWeeksAgo))
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const recentSignups = await db
      .select({
        email: authUser.email,
        name: authUser.name,
        createdAt: authUser.createdAt,
      })
      .from(authUser)
      .orderBy(desc(authUser.createdAt))
      .limit(25);

    // Every signup, not the last 50 (owner ask 2026-08-15: "essentially all
    // waitlist signups"). This is the list the owner works through by hand, so
    // a cap silently hides people who are waiting on a reply. The bound is
    // generous rather than absent: a page that has to render 5,000 rows is a
    // different design problem, and hitting it is itself the signal to solve it.
    const waitlistRows = await db.select().from(waitlist).orderBy(desc(waitlist.createdAt)).limit(1000);

    const [{ n: totalUsers }] = await db.select({ n: sql<number>`count(*)::int` }).from(authUser);

    res.json({
      visits24h: Number(visits24h),
      uniques24h: Number(uniques24h),
      botVisits: Number(botVisits),
      visitsByDay,
      topReferers,
      topPaths,
      topCountries,
      recentVisitors: visitors,
      visitorSummary,
      signupsByDay,
      recentSignups,
      totalUsers,
      waitlist: waitlistRows,
    });
  }),
);

adminRouter.get(
  '/activity',
  requireCapability('manage'),
  wrap(async (req, res) => {
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
  }),
);

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

adminRouter.post(
  '/agent-traces',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const workspaceId = reqStr(body, 'workspaceId');
    const agentId = reqStr(body, 'agentId');
    const strategy = reqStr(body, 'strategy');
    const startedAt = optDate(body, 'startedAt') ?? new Date();
    const endedAt = optDate(body, 'endedAt') ?? new Date();
    const entries = Array.isArray(body.entries) ? (body.entries as unknown[]) : [];
    // The "~25 most-informative rows" convention in /api/help is now enforced
    // (with headroom), not just documented: agent_traces reached 2.9 GB with no
    // cap and no retention. Size guard too — 25 rows of unbounded reasoning
    // prose would pass a count check and still be megabytes.
    if (entries.length > 40) {
      throw new AppError('entries: at most 40 rows per trace (send the most informative ones)', 400);
    }
    if (JSON.stringify(entries).length > 64 * 1024) {
      throw new AppError('entries: at most 64 KB of JSON per trace', 400);
    }

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
  }),
);

adminRouter.get(
  '/agent-traces',
  requireCapability('manage'),
  wrap(async (req, res) => {
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

    const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

    const rows = await (where ? db.select().from(agentTraces).where(where) : db.select().from(agentTraces))
      .orderBy(desc(agentTraces.startedAt))
      .limit(limit);

    // Resolve human-readable workspace names in one query so the panel doesn't
    // need a separate fetch + lookup just to render the trace rows.
    const wsIds = Array.from(new Set(rows.map(r => r.workspaceId).filter((s): s is string => !!s)));
    const wsRows =
      wsIds.length > 0
        ? await db
            .select({ id: workspaces.id, name: workspaces.name })
            .from(workspaces)
            .where(inArray(workspaces.id, wsIds))
        : [];
    const nameById = Object.fromEntries(wsRows.map(w => [w.id, w.name]));
    const enriched = rows.map(r => ({ ...r, workspaceName: nameById[r.workspaceId] ?? null }));

    res.json({ traces: enriched, scope, isPlatformAdmin: isPlatform });
  }),
);

adminRouter.post(
  '/agent-heartbeat',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const agentId = reqStr(body, 'agentId');
    const status = optStr(body, 'status') ?? 'idle';
    const now = new Date();

    await db
      .insert(agentHeartbeats)
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
  }),
);

adminRouter.get(
  '/agent-heartbeats',
  requireCapability('manage'),
  wrap(async (req, res) => {
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
    const wsRows =
      wsIds.length > 0
        ? await db
            .select({ id: workspaces.id, name: workspaces.name })
            .from(workspaces)
            .where(inArray(workspaces.id, wsIds))
        : [];
    const nameById = Object.fromEntries(wsRows.map(w => [w.id, w.name]));
    const enriched = rows.map(r => ({ ...r, workspaceName: r.workspaceId ? (nameById[r.workspaceId] ?? null) : null }));

    res.json({ heartbeats: enriched, isPlatformAdmin: isPlatform });
  }),
);

// ---------------------------------------------------------------------------
// Agent control plane: desired state (enabled/paused) + cycle triggers for
// the out-of-process agent runners. The /agents admin UI writes; each runner
// polls GET /agent-controls every tick and obeys. Pull-based so the server
// never needs inbound access to the host running the agents. A trigger fires
// when triggerRequestedAt > triggerAckedAt; the runner acks after firing.
// ---------------------------------------------------------------------------

adminRouter.get(
  '/agent-controls',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Platform admin or master key required', 403);
    }
    const rows = await db.select().from(agentControls).orderBy(agentControls.agentId);
    res.json({ controls: rows });
  }),
);

adminRouter.post(
  '/agent-control',
  wrap(async (req, res) => {
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

    const [row] = await db
      .insert(agentControls)
      .values({ agentId, ...set })
      .onConflictDoUpdate({ target: agentControls.agentId, set })
      .returning();
    res.json(row);
  }),
);

/**
 * Platform curation: flip the `featured` flag on a market. Featured markets
 * appear on the public /benchmark surface and via GET /api/marketplace/featured.
 * Platform-admin / master-key only (this is global curation, not workspace-scoped).
 */
adminRouter.post(
  '/markets/featured',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Platform admin or master key required', 403);
    }
    const { marketId, workspaceId, featured } = req.body ?? {};
    if (typeof marketId !== 'string' || !marketId) throw new AppError('marketId required', 400);
    if (typeof workspaceId !== 'string' || !workspaceId) throw new AppError('workspaceId required', 400);
    if (typeof featured !== 'boolean') throw new AppError('featured (boolean) required', 400);

    const updated = await db
      .update(markets)
      .set({ featured })
      .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)))
      .returning({ id: markets.id, workspaceId: markets.workspaceId, featured: markets.featured });

    if (updated.length === 0) throw new AppError('Market not found', 404);
    res.json(updated[0]);
  }),
);

/** List all featured markets (across all workspaces, including private), for admin curation. */
adminRouter.get(
  '/markets/featured',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Platform admin or master key required', 403);
    }
    const rows = await db
      .select({
        marketId: markets.id,
        workspaceId: markets.workspaceId,
        metricName: markets.metricName,
        targetDate: markets.targetDate,
        resolved: markets.resolved,
        active: markets.active,
      })
      .from(markets)
      .where(eq(markets.featured, true));
    res.json(rows.map(r => ({ ...r, resolvesOn: resolutionInstant(r.targetDate) })));
  }),
);

/**
 * What is published, and what is waiting (owner ask 2026-08-20: "i think
 * deploying to prod is too easy").
 *
 * CI lands every green build as a no-traffic revision and stops; this says
 * whether one is waiting, where to look at it, and whether the process
 * answering you IS the published site. `/beta` reads it to find the door;
 * `/admin` reads it to decide whether to offer the button.
 */
adminRouter.get(
  '/release',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Platform admin or master key required', 403);
    }
    res.json(await releaseState());
  }),
);

/**
 * Publish: give the revision answering this request 100% of the traffic.
 *
 * Deliberately not "promote latest". The button lives on the beta, so the
 * thing published is the thing the owner just looked at; if CI landed another
 * build while they were reading, that one waits its turn rather than riding
 * along unseen.
 */
adminRouter.post(
  '/publish',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Platform admin or master key required', 403);
    }
    const state = await releaseState();
    if (state.isServing) {
      throw new AppError('This revision is already serving telarchy.com; there is nothing to publish', 409);
    }
    const revision = typeof req.body?.revision === 'string' && req.body.revision ? req.body.revision : undefined;
    try {
      const result = await publishRevision(revision);
      console.log('release: published', result.published, 'by', req.auth?.uid ?? req.auth?.agentId ?? 'master-key');
      res.json({ ok: true, ...result });
    } catch (e) {
      if (e instanceof PublishRefusedError) throw new AppError(e.message, 409);
      throw new AppError((e as Error).message, 502);
    }
  }),
);

/**
 * Every branch of the repository and whether it is built as a preview, for
 * the picker on the beta stripe (docs/infra/deploy.md, "Any branch can be
 * built").
 */
adminRouter.get(
  '/branches',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Platform admin or master key required', 403);
    }
    const { branches, error } = await listBranches();
    res.json({ branches, error, buildConfigured: buildConfigured() });
  }),
);

/**
 * Build a branch as a preview: dispatch the deploy workflow on that ref. The
 * branch name travels in the body because names carry slashes (`oss/lane-i`).
 * 501 with the terminal command when this instance holds no token.
 */
adminRouter.post(
  '/branches/build',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Platform admin or master key required', 403);
    }
    const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';
    if (!branch || branch === 'main' || !/^[\w./-]{1,120}$/.test(branch)) {
      throw new AppError('Name a branch other than main', 400);
    }
    try {
      const result = await dispatchBuild(branch);
      console.log('preview: build dispatched for', branch, 'by', req.auth?.uid ?? 'master-key');
      res.json({ ok: true, ...result });
    } catch (e) {
      if (e instanceof BuildNotConfiguredError) throw new AppError(e.message, 501);
      throw new AppError((e as Error).message, 502);
    }
  }),
);

/**
 * Who to pay, and where. Platform admin only, and deliberately only here.
 *
 * The owner approves a contract and then has to send real money to a stranger.
 * Until now that meant reading the database by hand, because payout details are
 * stripped from every participant route that is not the participant themselves
 * (`routes/agents.ts`), which is the right default and the reason this needed
 * its own door rather than a loosened one.
 *
 * Owner ask 2026-08-20: "make sure its admin gated, actually make it only at
 * the /admin endpoint just to be sure". So it lives under `/api/admin`, behind
 * `isPlatformAuthorized`, which a workspace admin does not pass and an agent
 * key cannot reach: it needs the master key or a browser session belonging to a
 * platform admin. No workspace scoping, because paying someone is a platform
 * act and the money is the owner's own.
 *
 * It carries what you need to actually send the money and nothing else: the
 * handle, the structured method behind it, and what has been approved to them
 * so the amount is not looked up in a second place. Not their trades, not their
 * positions, not their balance history.
 *
 * Never logged. A payout handle in a log line is a payout handle in every log
 * sink downstream of it, forever.
 */
adminRouter.get(
  '/participants',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Platform admin or master key required', 403);
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 25;

    // A blank search answers the people most likely to be owed something rather
    // than the whole table: everyone with a payout handle on file, newest first.
    const rows = await db
      .select({
        id: agents.id,
        nickname: agents.nickname,
        payoutHandle: agents.payoutHandle,
        payoutMethod: agents.payoutMethod,
        walletAddress: agents.walletAddress,
        platformOperated: agents.platformOperated,
        createdAt: agents.createdAt,
        email: authUser.email,
      })
      .from(agents)
      .leftJoin(authUser, eq(agents.authUserId, authUser.id))
      .orderBy(desc(agents.createdAt));

    const matched = rows
      .filter(r => {
        if (!q) return !!r.payoutHandle;
        return [r.id, r.nickname, r.email].some(v => (v ?? '').toLowerCase().includes(q));
      })
      .slice(0, limit);

    if (matched.length === 0) {
      res.json({ participants: [] });
      return;
    }

    // What has been approved to each of them, so "who do I owe and how much" is
    // one answer and not two lookups that can disagree.
    const owed = await db
      .select({
        proposedBy: proposals.proposedBy,
        title: proposals.title,
        askUsd: proposals.askUsd,
        resolvedAt: proposals.resolvedAt,
      })
      .from(proposals)
      .where(
        and(
          inArray(
            proposals.proposedBy,
            matched.map(m => m.id),
          ),
          eq(proposals.status, 'approved'),
        ),
      )
      .orderBy(desc(proposals.resolvedAt));

    const byPerson = new Map<string, typeof owed>();
    for (const row of owed) {
      if (!byPerson.has(row.proposedBy)) byPerson.set(row.proposedBy, []);
      byPerson.get(row.proposedBy)!.push(row);
    }

    res.json({
      participants: matched.map(m => {
        const theirs = byPerson.get(m.id) ?? [];
        return {
          ...m,
          approvedContracts: theirs.map(t => ({
            title: t.title,
            askUsd: t.askUsd ?? 0,
            approvedAt: t.resolvedAt,
          })),
          approvedUsd: theirs.reduce((sum, t) => sum + (t.askUsd ?? 0), 0),
        };
      }),
    });
  }),
);

/**
 * The earn table, as the operator sees and edits it (owner decision
 * 2026-08-30: "we will edit it dynamically it should be in db.. and can
 * change midseason"). GET carries the disabled rows and the last-changed
 * stamp that the public view omits; PATCH edits one price and appends to
 * the append-only history, so a mid-season change stays reconstructable.
 */
adminRouter.get(
  '/earn',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) throw new AppError('Platform admin or master key required', 403);
    res.json({ rules: await listEarnRules() });
  }),
);

adminRouter.get(
  '/earn/:key/history',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) throw new AppError('Platform admin or master key required', 403);
    res.json({ key: req.params.key, history: await earnRuleHistoryFor(req.params.key as string) });
  }),
);

adminRouter.patch(
  '/earn/:key',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) throw new AppError('Platform admin or master key required', 403);
    const { credits, enabled, note, label } = req.body ?? {};
    if (credits === undefined && enabled === undefined && note === undefined && label === undefined) {
      throw new AppError('Nothing to change', 400);
    }
    const rule = await setEarnRule(
      req.params.key as string,
      {
        credits: credits === undefined ? undefined : Number(credits),
        enabled: enabled === undefined ? undefined : enabled === true,
        note: typeof note === 'string' ? note : undefined,
        label: typeof label === 'string' ? label : undefined,
      },
      req.auth?.agentId ?? req.auth?.uid ?? null,
    );
    res.json({ rule });
  }),
);
