import { Router, type Request } from 'express';
import { db } from '../db/client';
import { agents, agentApiKeys, deposits, withdrawals, systemConfig, workspaces, positions, trades, markets, permissionGroups } from '../db/schema';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { hashKey, authMiddleware, optionalAuthMiddleware, getAuthWorkspaceMemberships } from '../middleware/auth';
import { requireCapability, requireSelfOrAdmin, requireIdentity } from '../middleware/roles';
import { getMarkets } from '../services/predictions';
import {
  sendUsdc,
  getTreasuryBalances,
  getTreasuryAddress,
  validateWalletAddress,
  verifyUsdcDeposit,
  USDC_ON_BASE_MAINNET,
} from '../lib/usdc';
import { AppError } from '../lib/errors';
import { creditsIssuedForUsdcDeposit, depositBuyRateUsd } from '../lib/economy';
import { resolutionInstant } from '../lib/date-utils';
import { validateAgentId, validateTxHash, sufficientBalance, toUnits, fromUnits, SIGNUP_CREDITS } from '../lib/validation';
import { listParticipantsForWorkspace, claimNickname } from '../lib/participants';
import { isUsdcSettlementEnabled } from '../lib/settlement';
import { directionSellProceeds, resolutionPayouts, pHigher, consensus } from '../lib/amm';
import { getAllMetrics } from '../services/metrics';
import { computeCapabilities } from '../middleware/capabilities';
import { requireScope } from '../middleware/roles';
import { parseScopesInput, granterCoversScopes, SCOPE_PRESETS } from '../lib/scopes';

export const agentsRouter = Router();

const USDC_DISABLED_MESSAGE =
  'USDC settlement is disabled on this instance. Credits on this instance are for simulation and have no redemption value.';

function requireUsdcEnabled(res: import('express').Response): boolean {
  if (isUsdcSettlementEnabled()) return true;
  res.status(503).json({ error: USDC_DISABLED_MESSAGE });
  return false;
}

function resolveRouteAgentId(req: Request): string | null {
  if ((req.params.id as string) === 'me') return req.auth?.agentId ?? null;
  return req.params.id as string;
}

agentsRouter.post('/register', optionalAuthMiddleware, wrap(async (req, res) => {
  const { agentId, workspaceId, nickname } = req.body;
  const agentIdError = validateAgentId(agentId);
  if (agentIdError) { res.status(400).json({ error: agentIdError }); return; }

  if (!workspaceId || typeof workspaceId !== 'string') {
    res.status(400).json({ error: 'workspaceId is required' }); return;
  }

  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const [existing] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (existing) { res.status(409).json({ error: 'Agent already registered' }); return; }

  const rawKey = randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyId = randomUUID();

  await db.transaction(async tx => {
    await tx.insert(agents).values({
      id: agentId, apiKeyHash: keyHash, balance: toUnits(SIGNUP_CREDITS),
      authUserId: req.auth?.uid ?? null, createdAt: new Date(), approvedAt: new Date(),
    });
    // Third-party registration keeps the legacy wildcard scope so existing
    // bots that POST /register and expect full access aren't broken. Scoped
    // keys are minted from the authenticated /api/agents and /api/agents/:id/keys
    // endpoints (see lib/scopes.ts).
    await tx.insert(agentApiKeys).values({ hash: keyHash, keyId, agentId, workspaceId, scopes: ['*'] });
    if (nickname !== undefined && nickname !== null && nickname !== '') {
      await claimNickname(tx, agentId, nickname);
    }
  });

  // Auto-add to the workspace Public group only. Trading rights, if any,
  // come from the Public group's own capabilities (Open workspaces grant
  // 'trade' on Public); auto-adding to Trader would bypass the workspace
  // owner's permission policy.
  const { permissionGroups } = await import('../db/schema');
  const sysGroups = await db.select().from(permissionGroups)
    .where(eq(permissionGroups.workspaceId, workspaceId));
  const publicGroup = sysGroups.find(g => g.type === 'public');
  if (publicGroup) {
    const currentIds = (publicGroup.memberIds as string[]) ?? [];
    if (!currentIds.includes(agentId)) {
      await db.update(permissionGroups)
        .set({ memberIds: [...currentIds, agentId] })
        .where(and(eq(permissionGroups.id, publicGroup.id), eq(permissionGroups.workspaceId, workspaceId)));
    }
  }

  res.status(201).json({ agentId, apiKey: rawKey, nickname: nickname || null });
}));

agentsRouter.get('/mine', authMiddleware, requireIdentity, requireScope('account:read'), wrap(async (req, res) => {
  const { uid, agentId: authAgentId } = req.auth!;

  if (uid) {
    // Two senses of "mine" for a human:
    //   1. The agent that IS this human (authUserId = uid). Always at most one.
    //   2. Bots they registered via POST /api/agents (ownerUserId = uid). Any number.
    // Both surface here so the API page can split primary vs owned bots.
    const { or } = await import('drizzle-orm');
    const rows = await db.select().from(agents)
      .where(or(eq(agents.authUserId, uid), eq(agents.ownerUserId, uid)));
    res.json(rows.map(row => {
      const { apiKeyHash: _, ...data } = row;
      return { ...data, balance: fromUnits(data.balance as number) };
    }));
  } else {
    const [agent] = await db.select().from(agents).where(eq(agents.id, authAgentId!));
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { apiKeyHash: _, ...data } = agent;
    res.json([{ ...data, balance: fromUnits(data.balance as number) }]);
  }
}));

/** Public: treasury receive address for USDC deposits (no balances; does not require auth). */
agentsRouter.get('/deposit-address', (_req, res) => {
  if (!requireUsdcEnabled(res)) return;
  try {
    const address = getTreasuryAddress();
    res.json({
      address,
      chain: 'base',
      asset: 'USDC',
      usdcContract: USDC_ON_BASE_MAINNET,
    });
  } catch {
    res.status(503).json({ error: 'Treasury is not configured on this server' });
  }
});

/**
 * Public participant profile. Resolves :idOrNickname against agents.id first,
 * then case-insensitively against agents.nickname. Stats are aggregated only
 * over public-visibility workspaces (privacy contract shared with
 * /api/leaderboard and /api/marketplace).
 *
 * Uses optionalAuthMiddleware so the response can include per-position and
 * per-trade detail visible to the caller: public workspaces are always
 * included, plus any workspace where the caller has 'read' capability (a
 * master key or platform admin sees everything). Anonymous callers get only
 * public-workspace detail.
 */
agentsRouter.get('/:idOrNickname/public', optionalAuthMiddleware, wrap(async (req, res) => {
  const { computeLeaderboard } = await import('../lib/leaderboard');
  const idOrNickname = req.params.idOrNickname as string;

  let [agent] = await db.select().from(agents).where(eq(agents.id, idOrNickname)).limit(1);
  if (!agent) {
    [agent] = await db.select().from(agents)
      .where(sql`LOWER(${agents.nickname}) = ${idOrNickname.toLowerCase()}`)
      .limit(1);
  }
  if (!agent) { res.status(404).json({ error: 'Participant not found' }); return; }

  const allWs = await db.select({ id: workspaces.id, name: workspaces.name, visibility: workspaces.visibility })
    .from(workspaces);
  const wsNameById = new Map(allWs.map(w => [w.id, w.name]));
  const publicWsIds = allWs.filter(w => w.visibility === 'public').map(w => w.id);

  // Resolve which workspaces the *caller* can see beyond public ones. Master
  // key sees everything; otherwise check 'read' capability per candidate. Read
  // capabilities only get computed for workspaces the caller actually has a
  // membership in, so this scales with the caller's reach, not all workspaces.
  const viewerWsIds = new Set<string>(publicWsIds);
  if (req.auth?.isMasterKey) {
    for (const w of allWs) viewerWsIds.add(w.id);
  } else if (req.auth?.uid || req.auth?.agentId) {
    const memberships = await getAuthWorkspaceMemberships({ uid: req.auth?.uid, agentId: req.auth?.agentId });
    const candidate = memberships.map(m => m.workspaceId).filter(id => !viewerWsIds.has(id));
    if (candidate.length > 0) {
      const caps = await Promise.all(candidate.map(id =>
        computeCapabilities({ workspaceId: id, uid: req.auth?.uid, agentId: req.auth?.agentId })
      ));
      candidate.forEach((id, i) => { if (caps[i].has('read')) viewerWsIds.add(id); });
    }
  }

  const emptyStats = {
    rank: null as number | null,
    calibration: null as number | null,
    accuracy: null as number | null,
    totalEarnings: 0,
    resolvedMarkets: 0,
    totalTrades: 0,
    lastTradeAt: null as string | null,
  };

  // Agent-to-agent lineage: the participant that created this one via
  // POST /api/agents with an agent key, and any participants this one
  // created the same way. Public information (ids are public handles).
  const parentRow = agent.ownerAgentId
    ? (await db.select({ id: agents.id, nickname: agents.nickname }).from(agents)
        .where(eq(agents.id, agent.ownerAgentId)).limit(1))[0] ?? null
    : null;
  const childRows = await db.select({ id: agents.id, nickname: agents.nickname }).from(agents)
    .where(eq(agents.ownerAgentId, agent.id))
    .orderBy(agents.id);
  const lineage = {
    parent: parentRow ? { id: parentRow.id, nickname: parentRow.nickname } : null,
    children: childRows.map(c => ({ id: c.id, nickname: c.nickname })),
  };

  if (publicWsIds.length === 0 && viewerWsIds.size === 0) {
    res.json({
      id: agent.id,
      nickname: agent.nickname,
      intent: agent.intent,
      joinedAt: agent.createdAt,
      parent: lineage.parent,
      children: lineage.children,
      stats: emptyStats,
      activeWorkspaces: [],
      openPositions: [],
      recentTrades: [],
    });
    return;
  }

  // Stats are still aggregated over public workspaces only (the documented
  // privacy contract for this endpoint). Per-position and per-trade detail
  // expands to viewerWsIds.
  const statsScope = publicWsIds;
  const detailScope = Array.from(viewerWsIds);

  const queryScope = Array.from(new Set([...statsScope, ...detailScope]));
  const wsMarkets = queryScope.length > 0
    ? await db.select({
        id: markets.id,
        workspaceId: markets.workspaceId,
        metricName: markets.metricName,
        targetDate: markets.targetDate,
        rangeMin: markets.rangeMin,
        rangeMax: markets.rangeMax,
        liquidity: markets.liquidity,
        shares: markets.shares,
        active: markets.active,
        resolved: markets.resolved,
        actualValue: markets.actualValue,
        proposalId: markets.proposalId,
      }).from(markets).where(and(
        inArray(markets.workspaceId, queryScope),
        eq(markets.voided, false),
      ))
    : [];
  const marketById = new Map(wsMarkets.map(m => [m.id, m]));

  const [tradeRows, positionRows] = await Promise.all([
    queryScope.length > 0
      ? db.select({
          id: trades.id,
          agentId: trades.agentId,
          workspaceId: trades.workspaceId,
          marketId: trades.marketId,
          direction: trades.direction,
          shares: trades.shares,
          cost: trades.cost,
          createdAt: trades.createdAt,
        }).from(trades).where(inArray(trades.workspaceId, queryScope))
      : Promise.resolve([] as Array<{
          id: string; agentId: string; workspaceId: string; marketId: string;
          direction: string; shares: number; cost: number; createdAt: Date;
        }>),
    queryScope.length > 0
      ? db.select({
          agentId: positions.agentId,
          workspaceId: positions.workspaceId,
          marketId: positions.marketId,
          direction: positions.direction,
          shares: positions.shares,
          totalCost: positions.totalCost,
        }).from(positions).where(inArray(positions.workspaceId, queryScope))
      : Promise.resolve([] as Array<{
          agentId: string; workspaceId: string; marketId: string;
          direction: string; shares: number; totalCost: number;
        }>),
  ]);

  // Stats: same shape and source as before, restricted to public workspaces.
  let entry: ReturnType<typeof computeLeaderboard>[number] | undefined;
  if (statsScope.length > 0) {
    const statsWsSet = new Set(statsScope);
    const statsMarkets = wsMarkets.filter(m => statsWsSet.has(m.workspaceId));
    const statsTrades = tradeRows.filter(t => statsWsSet.has(t.workspaceId))
      .map(t => ({ agentId: t.agentId, workspaceId: t.workspaceId, marketId: t.marketId, cost: t.cost, createdAt: t.createdAt }));
    const statsPositions = positionRows.filter(p => statsWsSet.has(p.workspaceId))
      .map(p => ({ agentId: p.agentId, workspaceId: p.workspaceId, marketId: p.marketId, direction: p.direction, shares: p.shares }));
    const seenIds = new Set<string>();
    for (const t of statsTrades) seenIds.add(t.agentId);
    for (const p of statsPositions) seenIds.add(p.agentId);
    const seenAgents = seenIds.size > 0
      ? await db.select({ id: agents.id, nickname: agents.nickname })
          .from(agents).where(inArray(agents.id, Array.from(seenIds)))
      : [];
    const nicknameById = new Map(seenAgents.map(a => [a.id, a.nickname]));
    const ranked = computeLeaderboard(statsMarkets, statsTrades, statsPositions, nicknameById, 1_000_000);
    entry = ranked.find(e => e.id === agent.id);
  }

  // activeWorkspaces stays public-only so anonymous callers see the same
  // "where they trade publicly" list they always have. Detail-level lists
  // (open positions, recent trades) expand for authenticated viewers.
  const publicWsIdSet = new Set(publicWsIds);
  const activeWorkspaceIds = new Set<string>();
  for (const t of tradeRows) if (t.agentId === agent.id && publicWsIdSet.has(t.workspaceId)) activeWorkspaceIds.add(t.workspaceId);
  for (const p of positionRows) if (p.agentId === agent.id && publicWsIdSet.has(p.workspaceId)) activeWorkspaceIds.add(p.workspaceId);
  const activeWorkspaces = Array.from(activeWorkspaceIds)
    .map(id => ({ id, name: wsNameById.get(id) ?? id }));

  const ownerTrades = tradeRows.filter(t => t.agentId === agent.id && viewerWsIds.has(t.workspaceId));
  const ownerPositions = positionRows.filter(p => p.agentId === agent.id && p.shares > 0 && viewerWsIds.has(p.workspaceId));

  // Skip positions whose market isn't in marketById: the only way that
  // happens with our filter is a voided market, and voided positions are
  // refunded out of band so reporting them as "open" would be wrong.
  // A conditional market (proposalId set) is reported with status 'conditional'
  // when its proposal is still pending, since it only resolves on
  // approve/decline and isn't tradeable from the regular /markets tab.
  const openPositions = ownerPositions.flatMap(p => {
    const m = marketById.get(p.marketId);
    if (!m) return [];
    const mShares = (m.shares as [number, number]) ?? [0, 0];
    const liq = m.liquidity;
    const status: 'open' | 'closed' | 'resolved' | 'conditional' =
      m.resolved ? 'resolved'
      : m.active === false ? 'closed'
      : m.proposalId ? 'conditional'
      : 'open';
    return [{
      workspaceId: p.workspaceId,
      workspaceName: wsNameById.get(p.workspaceId) ?? p.workspaceId,
      marketId: p.marketId,
      proposalId: m.proposalId ?? null,
      metricName: m.metricName,
      targetDate: m.targetDate,
      resolvesOn: resolutionInstant(m.targetDate),
      direction: p.direction as 'higher' | 'lower',
      shares: p.shares,
      totalCost: p.totalCost,
      status,
      probabilityHigher: liq > 0 ? Math.round(pHigher(mShares, liq) * 10000) / 10000 : null,
      consensus: consensus(mShares, liq, m.rangeMin, m.rangeMax) ?? null,
      actualValue: m.actualValue ?? null,
    }];
  });
  // Open first (heaviest exposure first within open), then conditional, then closed, then resolved.
  const statusRank = (s: 'open' | 'conditional' | 'closed' | 'resolved') =>
    s === 'open' ? 0 : s === 'conditional' ? 1 : s === 'closed' ? 2 : 3;
  openPositions.sort((a, b) => {
    const r = statusRank(a.status) - statusRank(b.status);
    if (r !== 0) return r;
    return Math.abs(b.shares) - Math.abs(a.shares);
  });

  const RECENT_TRADES_LIMIT = 20;
  const recentTrades = ownerTrades
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, RECENT_TRADES_LIMIT)
    .map(t => {
      const m = marketById.get(t.marketId);
      return {
        id: t.id,
        workspaceId: t.workspaceId,
        workspaceName: wsNameById.get(t.workspaceId) ?? t.workspaceId,
        marketId: t.marketId,
        proposalId: m?.proposalId ?? null,
        metricName: m?.metricName ?? null,
        targetDate: m?.targetDate ?? null,
        resolvesOn: m?.targetDate ? resolutionInstant(m.targetDate) : null,
        direction: t.direction as 'higher' | 'lower',
        // trades.shares is negative for sells.
        kind: (t.shares < 0 ? 'sell' : 'buy') as 'buy' | 'sell',
        shares: Math.abs(t.shares),
        cost: t.cost,
        createdAt: t.createdAt,
      };
    });

  res.json({
    id: agent.id,
    nickname: agent.nickname,
    intent: agent.intent,
    joinedAt: agent.createdAt,
    parent: lineage.parent,
    children: lineage.children,
    stats: entry ?? emptyStats,
    activeWorkspaces,
    openPositions,
    recentTrades,
  });
}));

agentsRouter.use(authMiddleware);

/**
 * Authenticated agent creation. Used by the API page to register a bot agent
 * under the caller's ownership and add it to one or more workspaces in a
 * single call. Differs from POST /register (unauthenticated, third-party
 * signup) in three ways:
 *
 *   1. The new agent's authUserId is set to the caller's uid when the caller
 *      is a browser session, recording ownership for /agents/mine.
 *   2. memberships[] lets you add the agent to multiple workspaces' groups in
 *      one shot. Caller must hold `manage` in each workspace; group ids must
 *      belong to that workspace.
 *   3. The first key's scopes are settable. Default is the Trader preset
 *      (workspace:read + workspace:trade) so a freshly minted bot key can do
 *      what a bot is normally for, but can't, for example, drain the wallet.
 */
agentsRouter.post('/', requireScope('account:agents'), wrap(async (req, res) => {
  const { agentId, nickname, keyLabel, keyScopes, memberships } = req.body ?? {};
  const agentIdError = validateAgentId(agentId);
  if (agentIdError) { res.status(400).json({ error: agentIdError }); return; }

  // Caller-can-grant scope check (only meaningful for agent-key callers; users
  // and master keys can grant any scope).
  let scopes = SCOPE_PRESETS.trader.scopes.slice();
  if (keyScopes !== undefined) {
    const parsed = parseScopesInput(keyScopes);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
    if (req.auth!.scopes && !granterCoversScopes(req.auth!.scopes, parsed.scopes)) {
      res.status(403).json({ error: 'Cannot grant scopes broader than your own key' }); return;
    }
    scopes = parsed.scopes;
  }

  // Existing agent? bail out before generating a key.
  const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
  if (existing) { res.status(409).json({ error: 'Agent already registered' }); return; }

  // Validate memberships: caller must have manage in each workspace, and the
  // listed groups must belong to that workspace. We do all checks before any
  // writes so a partial failure can't leave a half-registered agent.
  type Membership = { workspaceId: string; groupIds: string[] };
  const membershipList: Membership[] = Array.isArray(memberships) ? memberships : [];
  for (const m of membershipList) {
    if (!m || typeof m !== 'object' || typeof m.workspaceId !== 'string' || !Array.isArray(m.groupIds)) {
      res.status(400).json({ error: 'memberships[] entries need { workspaceId, groupIds: string[] }' }); return;
    }
    if (m.groupIds.some(id => typeof id !== 'string')) {
      res.status(400).json({ error: 'groupIds must be an array of strings' }); return;
    }
  }

  // Authorization: the caller needs manage capability in every listed
  // workspace. Master key has it implicitly; for browser session and agent
  // key, look it up via computeCapabilities so the result mirrors what
  // requireCapability would do for that workspace.
  for (const m of membershipList) {
    if (!req.auth!.isMasterKey) {
      const caps = await computeCapabilities({
        workspaceId: m.workspaceId,
        uid: req.auth!.uid,
        agentId: req.auth!.agentId,
      });
      if (!caps.has('manage')) {
        res.status(403).json({ error: `You do not have manage capability in workspace ${m.workspaceId}` }); return;
      }
    }
    // Confirm every requested group belongs to this workspace.
    if (m.groupIds.length > 0) {
      const groupRows = await db.select({ id: permissionGroups.id }).from(permissionGroups)
        .where(and(eq(permissionGroups.workspaceId, m.workspaceId), inArray(permissionGroups.id, m.groupIds)));
      const found = new Set(groupRows.map(r => r.id));
      const missing = m.groupIds.filter(id => !found.has(id));
      if (missing.length > 0) {
        res.status(400).json({ error: `Group ids not in workspace ${m.workspaceId}: ${missing.join(', ')}` }); return;
      }
    }
  }

  // Default key registration workspace: first listed membership, else fall
  // back to the caller's own workspace. agent_api_keys.workspace_id is just
  // the default workspace the key resolves into when no X-Workspace-Id is
  // present; the agent's effective access in any workspace is governed by
  // group membership, not by this field.
  const defaultWorkspaceId = membershipList[0]?.workspaceId ?? req.auth!.workspaceId;
  if (!defaultWorkspaceId) {
    res.status(400).json({ error: 'memberships[] must include at least one workspace, or the caller must be in a workspace' }); return;
  }

  const rawKey = randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyId = randomUUID();

  await db.transaction(async tx => {
    // The new bot is its own participant; ownership is recorded via
    // ownerUserId, not authUserId (which means "this human IS this
    // participant" and is unique-per-user). Leaving authUserId null means
    // /api/auth/me for the bot's own key resolves it as a standalone
    // identity, not as the registering user.
    await tx.insert(agents).values({
      id: agentId,
      apiKeyHash: keyHash,
      balance: toUnits(SIGNUP_CREDITS),
      authUserId: null,
      ownerUserId: req.auth!.uid ?? null,
      // Agent-key callers own their sub-bots by agent id (parent/children
      // lineage on the public profile). Master key sets neither.
      ownerAgentId: !req.auth!.uid && !req.auth!.isMasterKey ? req.auth!.agentId ?? null : null,
      createdAt: new Date(),
      approvedAt: new Date(),
    });
    await tx.insert(agentApiKeys).values({
      hash: keyHash,
      keyId,
      agentId,
      workspaceId: defaultWorkspaceId,
      label: typeof keyLabel === 'string' && keyLabel.trim() ? keyLabel.trim() : null,
      scopes,
      createdAt: new Date(),
    });
    if (typeof nickname === 'string' && nickname !== '') {
      await claimNickname(tx, agentId, nickname);
    }
    for (const m of membershipList) {
      if (m.groupIds.length === 0) continue;
      const groupRows = await tx.select().from(permissionGroups)
        .where(and(eq(permissionGroups.workspaceId, m.workspaceId), inArray(permissionGroups.id, m.groupIds)));
      for (const group of groupRows) {
        const current = (group.memberIds as string[]) ?? [];
        if (current.includes(agentId)) continue;
        await tx.update(permissionGroups)
          .set({ memberIds: [...current, agentId] })
          .where(and(eq(permissionGroups.id, group.id), eq(permissionGroups.workspaceId, m.workspaceId)));
      }
    }
  });

  res.status(201).json({
    agentId,
    apiKey: rawKey,
    keyId,
    scopes,
    label: typeof keyLabel === 'string' && keyLabel.trim() ? keyLabel.trim() : null,
    memberships: membershipList,
  });
}));

agentsRouter.get('/treasury', requireCapability('manage'), wrap(async (req, res) => {
  if (!requireUsdcEnabled(res)) return;
  res.json(await getTreasuryBalances());
}));

agentsRouter.get('/:id', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  const { apiKeyHash: _, ...data } = agent;
  res.json({ ...data, balance: fromUnits(data.balance as number) });
}));

agentsRouter.get('/:id/balance', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  res.json({ balance: fromUnits(agent.balance as number) });
}));

agentsRouter.get('/:id/dashboard', requireSelfOrAdmin, wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }

  const [agent, mkts] = await Promise.all([
    db.select().from(agents).where(eq(agents.id, id)).then(r => r[0]),
    getMarkets({ active: true, minLiquidity: 0.01, limit }, undefined, workspaceId),
  ]);

  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  res.json({ balance: fromUnits(agent.balance as number), markets: mkts });
}));

agentsRouter.get('/:id/market-pnl', requireSelfOrAdmin, wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }

  const [tradeRows, posRows] = await Promise.all([
    db.select({ marketId: trades.marketId, cost: trades.cost, shares: trades.shares, direction: trades.direction })
      .from(trades).where(and(eq(trades.workspaceId, workspaceId), eq(trades.agentId, id))),
    db.select().from(positions).where(and(eq(positions.workspaceId, workspaceId), eq(positions.agentId, id))),
  ]);

  const marketIds = [...new Set([...tradeRows.map(t => t.marketId), ...posRows.map(p => p.marketId)])];
  if (marketIds.length === 0) { res.json([]); return; }

  const [marketRows, allMetrics] = await Promise.all([
    db.select().from(markets).where(and(eq(markets.workspaceId, workspaceId), inArray(markets.id, marketIds))),
    getAllMetrics(workspaceId),
  ]);
  const metricMap = new Map(allMetrics.map(m => [m.id, m]));

  // Exclude voided markets: their trade costs were refunded via position
  // totalCost (not recorded as trades), so netCash from trades alone is wrong.
  const nonVoidedMarkets = marketRows.filter(m => !m.voided);

  const cashByMarket = new Map<string, number>();
  for (const t of tradeRows) {
    cashByMarket.set(t.marketId, (cashByMarket.get(t.marketId) ?? 0) - t.cost);
  }

  const result = nonVoidedMarkets.map(m => {
    const netCash = cashByMarket.get(m.id) ?? 0;
    const mktShares = (m.shares as [number, number]) || [0, 0];
    const b = m.liquidity;
    const agentPos = posRows.filter(p => p.marketId === m.id);
    const higherShares = agentPos.find(p => p.direction === 'higher')?.shares ?? 0;
    const lowerShares = agentPos.find(p => p.direction === 'lower')?.shares ?? 0;

    // Mark-to-market via LMSR sell proceeds (what you'd get if you unwound now).
    const sellHi = higherShares > 0 ? directionSellProceeds(mktShares, 1, higherShares, b) : 0;
    const sellLo = lowerShares > 0 ? directionSellProceeds(mktShares, 0, lowerShares, b) : 0;
    const markValueConsensus = sellHi + sellLo;
    const pnlConsensus = netCash + markValueConsensus;

    let pnlMetric: number | null = null;
    let metricValue: number | null = null;
    let metricPayoutValue: number | null = null;
    if (m.resolved && m.actualValue !== null) {
      const [lowerPay, higherPay] = resolutionPayouts(Math.min(m.actualValue, m.rangeMax), m.rangeMin, m.rangeMax);
      metricPayoutValue = higherShares * higherPay + lowerShares * lowerPay;
      pnlMetric = netCash + metricPayoutValue;
      metricValue = m.actualValue;
    } else {
      const metric = metricMap.get(m.metricId);
      if (metric?.total !== null && metric?.total !== undefined) {
        metricValue = metric.total;
        const clamped = Math.min(Math.max(metric.total, m.rangeMin), m.rangeMax);
        const [lowerPay, higherPay] = resolutionPayouts(clamped, m.rangeMin, m.rangeMax);
        metricPayoutValue = higherShares * higherPay + lowerShares * lowerPay;
        pnlMetric = netCash + metricPayoutValue;
      }
    }

    return {
      marketId: m.id,
      metricId: m.metricId,
      metricName: m.metricName,
      targetDate: m.targetDate,
      resolvesOn: resolutionInstant(m.targetDate),
      status: m.voided ? 'voided' : m.resolved ? 'resolved' : (m.active === false ? 'closed' : 'open'),
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      consensus: consensus(mktShares, b, m.rangeMin, m.rangeMax) ?? null,
      probabilityHigher: pHigher(mktShares, b),
      metricValue,
      higherShares,
      lowerShares,
      netCash,
      markValueConsensus,
      metricPayoutValue,
      pnlConsensus,
      pnlMetric,
    };
  });

  // Sort: open first, then by absolute PnL magnitude desc.
  result.sort((a, b) => {
    const rank = (s: string) => s === 'open' ? 0 : s === 'closed' ? 1 : 2;
    const rd = rank(a.status) - rank(b.status);
    if (rd !== 0) return rd;
    return Math.abs(b.pnlConsensus) - Math.abs(a.pnlConsensus);
  });

  res.json(result);
}));

agentsRouter.get('/:id/trades', requireSelfOrAdmin, wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const limit = typeof req.query.limit === 'string' ? Math.min(parseInt(req.query.limit, 10) || 100, 500) : 100;

  const rows = await db.select({
    id: trades.id,
    marketId: trades.marketId,
    direction: trades.direction,
    shares: trades.shares,
    cost: trades.cost,
    createdAt: trades.createdAt,
    metricName: markets.metricName,
    targetDate: markets.targetDate,
    resolved: markets.resolved,
    voided: markets.voided,
  })
    .from(trades)
    .leftJoin(markets, and(eq(markets.id, trades.marketId), eq(markets.workspaceId, workspaceId)))
    .where(and(eq(trades.workspaceId, workspaceId), eq(trades.agentId, id)))
    .orderBy(desc(trades.createdAt))
    .limit(limit);

  res.json(rows.map(r => ({
    id: r.id,
    marketId: r.marketId,
    metricName: r.metricName,
    targetDate: r.targetDate,
    resolvesOn: r.targetDate ? resolutionInstant(r.targetDate) : null,
    direction: r.direction,
    // trades.shares is negative for sells; surface sign + absolute amount.
    kind: r.shares < 0 ? 'sell' : 'buy',
    shares: Math.abs(r.shares),
    cost: r.cost,
    marketStatus: r.voided ? 'voided' : r.resolved ? 'resolved' : 'open',
    createdAt: r.createdAt,
  })));
}));

agentsRouter.get('/', requireCapability('manage'), wrap(async (_req, res) => {
  const workspaceId = _req.auth!.workspaceId;
  const rows = await listParticipantsForWorkspace(workspaceId);

  // Realized PnL per agent = net cash flow from trades on resolved (non-voided)
  // markets + resolution payouts received. Open/voided markets don't count.
  const resolvedMarkets = await db.select({
    id: markets.id,
    rangeMin: markets.rangeMin,
    rangeMax: markets.rangeMax,
    actualValue: markets.actualValue,
  }).from(markets).where(and(
    eq(markets.workspaceId, workspaceId),
    eq(markets.resolved, true),
    eq(markets.voided, false),
  ));

  const realizedPnl = new Map<string, number>();
  if (resolvedMarkets.length > 0) {
    const marketIds = resolvedMarkets.map(m => m.id);
    const payFactorsById = new Map<string, [number, number]>();
    for (const m of resolvedMarkets) {
      if (m.actualValue === null) continue;
      const actual = Math.min(m.actualValue, m.rangeMax);
      payFactorsById.set(m.id, resolutionPayouts(actual, m.rangeMin, m.rangeMax));
    }

    const [tradeRows, posRows] = await Promise.all([
      db.select({ agentId: trades.agentId, cost: trades.cost }).from(trades)
        .where(and(eq(trades.workspaceId, workspaceId), inArray(trades.marketId, marketIds))),
      db.select({ agentId: positions.agentId, marketId: positions.marketId, direction: positions.direction, shares: positions.shares }).from(positions)
        .where(and(eq(positions.workspaceId, workspaceId), inArray(positions.marketId, marketIds))),
    ]);

    for (const t of tradeRows) {
      realizedPnl.set(t.agentId, (realizedPnl.get(t.agentId) ?? 0) - t.cost);
    }
    for (const p of posRows) {
      if (p.shares <= 0) continue;
      const pay = payFactorsById.get(p.marketId);
      if (!pay) continue;
      const factor = p.direction === 'higher' ? pay[1] : pay[0];
      const payout = p.shares * factor;
      realizedPnl.set(p.agentId, (realizedPnl.get(p.agentId) ?? 0) + payout);
    }
  }

  // Aggregate per-agent PnL @ consensus and PnL @ metric across every
  // non-voided market the agent has traded or holds positions on.
  // Voided markets are excluded: their trade costs were refunded via position
  // totalCost (not recorded as trades), so summing trades alone is incorrect.
  const pnlConsensusByAgent = new Map<string, number>();
  const pnlMetricByAgent = new Map<string, number>();
  const [allMarkets, allMetricsList, allTrades, allPositions] = await Promise.all([
    db.select().from(markets).where(and(eq(markets.workspaceId, workspaceId), eq(markets.voided, false))),
    getAllMetrics(workspaceId),
    db.select({ agentId: trades.agentId, marketId: trades.marketId, cost: trades.cost }).from(trades)
      .where(eq(trades.workspaceId, workspaceId)),
    db.select({ agentId: positions.agentId, marketId: positions.marketId, direction: positions.direction, shares: positions.shares }).from(positions)
      .where(eq(positions.workspaceId, workspaceId)),
  ]);
  const marketById = new Map(allMarkets.map(m => [m.id, m]));
  const metricById = new Map(allMetricsList.map(m => [m.id, m]));

  // Net cash per (agent, market), excluding voided markets.
  const nonVoidedMarketIds = new Set(allMarkets.map(m => m.id));
  const cashKey = (a: string, mId: string) => `${a}\u0000${mId}`;
  const netCashBy = new Map<string, number>();
  for (const t of allTrades) {
    if (!nonVoidedMarketIds.has(t.marketId)) continue;
    const k = cashKey(t.agentId, t.marketId);
    netCashBy.set(k, (netCashBy.get(k) ?? 0) - t.cost);
  }

  // Mark-to-market + metric-payout per (agent, market) from position rows.
  const touched = new Set<string>();
  const markByAgentMarket = new Map<string, number>();
  const metricPayByAgentMarket = new Map<string, number>();
  for (const p of allPositions) {
    if (p.shares <= 0) continue;
    const m = marketById.get(p.marketId);
    if (!m) continue;
    const mktShares = (m.shares as [number, number]) || [0, 0];
    const dirIdx: 0 | 1 = p.direction === 'higher' ? 1 : 0;
    const sell = directionSellProceeds(mktShares, dirIdx, p.shares, m.liquidity);
    const k = cashKey(p.agentId, p.marketId);
    markByAgentMarket.set(k, (markByAgentMarket.get(k) ?? 0) + sell);
    touched.add(k);

    let settleValue: number | null = null;
    if (m.resolved && m.actualValue !== null) {
      const [lo, hi] = resolutionPayouts(Math.min(m.actualValue, m.rangeMax), m.rangeMin, m.rangeMax);
      settleValue = p.direction === 'higher' ? p.shares * hi : p.shares * lo;
    } else {
      const metric = metricById.get(m.metricId);
      if (metric?.total !== null && metric?.total !== undefined) {
        const clamped = Math.min(Math.max(metric.total, m.rangeMin), m.rangeMax);
        const [lo, hi] = resolutionPayouts(clamped, m.rangeMin, m.rangeMax);
        settleValue = p.direction === 'higher' ? p.shares * hi : p.shares * lo;
      }
    }
    if (settleValue !== null) {
      metricPayByAgentMarket.set(k, (metricPayByAgentMarket.get(k) ?? 0) + settleValue);
    }
  }
  for (const [k] of netCashBy) touched.add(k);

  for (const k of touched) {
    const [agentId] = k.split('\u0000');
    const cash = netCashBy.get(k) ?? 0;
    const mark = markByAgentMarket.get(k) ?? 0;
    const metricPay = metricPayByAgentMarket.get(k) ?? 0;
    pnlConsensusByAgent.set(agentId, (pnlConsensusByAgent.get(agentId) ?? 0) + cash + mark);
    pnlMetricByAgent.set(agentId, (pnlMetricByAgent.get(agentId) ?? 0) + cash + metricPay);
  }

  res.json(rows.map(a => {
    const { apiKeyHash: _, ...data } = a;
    return {
      ...data,
      balance: fromUnits(data.balance as number),
      realizedPnl: realizedPnl.get(a.id) ?? 0,
      pnlConsensus: pnlConsensusByAgent.get(a.id) ?? 0,
      pnlMetric: pnlMetricByAgent.get(a.id) ?? 0,
    };
  }));
}));


agentsRouter.post('/:id/spend', requireSelfOrAdmin, requireScope('account:wallet'), wrap(async (req, res) => {
  const { amount, reason, type } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' }); return;
  }
  const validTypes = ['betting', 'tokens', 'purchase'];
  if (!type || !validTypes.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` }); return;
  }
  if (type === 'betting' && !req.auth!.capabilities.has('manage')) {
    res.status(403).json({ error: 'type "betting" is reserved for admin use' }); return;
  }
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  if (!sufficientBalance(agent.balance as number, amount)) {
    res.status(400).json({ error: 'Insufficient balance', balance: fromUnits(agent.balance as number) }); return;
  }

  const field = type === 'betting' ? 'spentBetting' : 'spentTokens';
  await db.update(agents).set({
    balance: sql`${agents.balance} - ${toUnits(amount)}`,
    [field]: sql`${agents[field as keyof typeof agents]} + ${amount}`,
  }).where(eq(agents.id, id));
  res.json({ ok: true, spent: amount, type, reason: reason || '' });
}));

agentsRouter.post('/:id/credit', requireCapability('manage'), wrap(async (req, res) => {
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(400).json({ error: 'Agent not found' }); return; }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  const members = await listParticipantsForWorkspace(req.auth!.workspaceId);
  if (!members.some(m => m.id === id)) { res.status(403).json({ error: 'Agent is not in your workspace' }); return; }
  const { amount, reason = 'admin credit' } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' }); return;
  }
  await db.update(agents).set({ balance: sql`${agents.balance} + ${toUnits(amount)}` }).where(eq(agents.id, id));
  const [updated] = await db.select({ balance: agents.balance }).from(agents).where(eq(agents.id, id));
  const newBalance = fromUnits(updated.balance as number);
  console.log(`[admin credit] ${id} +${amount} credits (${reason}). New balance: ${newBalance}`);
  res.json({ ok: true, credited: amount, balance: newBalance });
}));

agentsRouter.post('/:id/deposit', requireSelfOrAdmin, requireScope('account:wallet'), wrap(async (req, res) => {
  if (!requireUsdcEnabled(res)) return;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const { txHash } = req.body;
  const txHashError = validateTxHash(txHash);
  if (txHashError) { res.status(400).json({ error: txHashError }); return; }

  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

  const [existing] = await db.select().from(deposits).where(eq(deposits.txHash, txHash));
  if (existing) { res.status(409).json({ error: 'This transaction has already been used to purchase credits' }); return; }

  const [economy] = await db.select().from(systemConfig).where(eq(systemConfig.key, 'economy'));
  const economyData = (economy?.value as { creditValueUsd?: number; buyFeePercent?: number }) ?? {};
  const creditValueUsd = economyData.creditValueUsd ?? 1;
  const buyFeePercent = economyData.buyFeePercent ?? 0;
  const buyRate = depositBuyRateUsd(creditValueUsd, buyFeePercent);

  const { usdcAmount, from } = await verifyUsdcDeposit(txHash);
  const credits = creditsIssuedForUsdcDeposit(usdcAmount, creditValueUsd, buyFeePercent);

  if (credits <= 0) {
    res.status(400).json({ error: `Deposit too small. Minimum: ${buyRate.toFixed(6)} USDC for 1 credit` }); return;
  }

  await db.transaction(async tx => {
    await tx.insert(deposits).values({ txHash, agentId: id, from, usdcAmount, credits, buyRate, createdAt: new Date() });
    await tx.update(agents).set({ balance: sql`${agents.balance} + ${toUnits(credits)}` }).where(eq(agents.id, id));
  });

  res.status(201).json({ ok: true, usdcAmount, credits, buyRate, from });
}));

agentsRouter.put('/:id/wallet', requireSelfOrAdmin, requireScope('account:wallet'), wrap(async (req, res) => {
  if (!requireUsdcEnabled(res)) return;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const { walletAddress } = req.body;
  if (!walletAddress || typeof walletAddress !== 'string') {
    res.status(400).json({ error: 'walletAddress is required' }); return;
  }
  const checksummed = validateWalletAddress(walletAddress);
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  await db.update(agents).set({ walletAddress: checksummed }).where(eq(agents.id, id));
  res.json({ ok: true, walletAddress: checksummed });
}));

agentsRouter.post('/:id/withdraw', requireSelfOrAdmin, requireScope('account:wallet'), wrap(async (req, res) => {
  if (!requireUsdcEnabled(res)) return;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const { amount } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' }); return;
  }

  const [economy] = await db.select().from(systemConfig).where(eq(systemConfig.key, 'economy'));
  const economyData = (economy?.value as { creditValueUsd?: number }) ?? {};
  const creditValueUsd = economyData.creditValueUsd ?? null;
  if (!creditValueUsd) throw new AppError('creditValueUsd is not configured', 500);

  let walletAddress!: string;
  await db.transaction(async tx => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, id)).for('update');
    if (!agent) throw new AppError('Agent not found', 404);
    if (!agent.walletAddress) throw new AppError('Agent has no registered wallet address', 400);
    if (!sufficientBalance(agent.balance as number, amount)) {
      throw new AppError(`Insufficient balance (have ${fromUnits(agent.balance as number)}, need ${amount})`, 400);
    }
    walletAddress = agent.walletAddress;
    await tx.update(agents).set({ balance: sql`${agents.balance} - ${toUnits(amount)}` }).where(eq(agents.id, id));
  });

  const usdcAmount = Math.round(amount * creditValueUsd * 1e6) / 1e6;

  let txHash: string;
  try {
    txHash = await sendUsdc(walletAddress, usdcAmount);
  } catch (err) {
    await db.update(agents).set({ balance: sql`${agents.balance} + ${toUnits(amount)}` }).where(eq(agents.id, id));
    console.error(`[withdraw] USDC send failed for agent ${id}, re-credited ${amount} credits:`, err);
    throw new AppError('On-chain transfer failed; credits have been restored', 502);
  }

  const withdrawalId = randomUUID();
  await Promise.all([
    db.insert(withdrawals).values({
      id: withdrawalId, agentId: id, credits: amount, usdcAmount,
      toAddress: walletAddress, txHash, createdAt: new Date(),
    }),
    db.update(agents).set({ withdrawnUsdc: sql`${agents.withdrawnUsdc} + ${usdcAmount}` }).where(eq(agents.id, id)),
  ]);

  res.json({ ok: true, credits: amount, usdcAmount, txHash, toAddress: walletAddress });
}));

/**
 * List API keys for an agent. Never returns the hash; the keyId column is the
 * opaque public handle for revoke/rotate. hashPrefix is shown so the user can
 * identify keys at a glance ("which one is `agnt_a1b2…` again?").
 */
agentsRouter.get('/:id/keys', requireSelfOrAdmin, requireScope('account:keys'), wrap(async (req, res) => {
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const rows = await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, id));
  res.json(rows.map(r => ({
    keyId: r.keyId,
    label: r.label,
    scopes: (r.scopes as string[] | null) ?? ['*'],
    workspaceId: r.workspaceId,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    hashPrefix: r.hash.slice(0, 8),
  })));
}));

/**
 * Mint an additional API key for an agent. Body: { label?, scopes?, workspaceId? }.
 * Default scopes = Trader preset (least-privilege relative to wildcard). When
 * the caller is itself an agent-key, they cannot grant scopes broader than
 * their own (granterCoversScopes), preventing self-elevation. The raw key is
 * shown once in this response and never again.
 */
agentsRouter.post('/:id/keys', requireSelfOrAdmin, requireScope('account:keys'), wrap(async (req, res) => {
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }

  const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

  let scopes = SCOPE_PRESETS.trader.scopes.slice();
  if (req.body?.scopes !== undefined) {
    const parsed = parseScopesInput(req.body.scopes);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
    if (req.auth!.scopes && !granterCoversScopes(req.auth!.scopes, parsed.scopes)) {
      res.status(403).json({ error: 'Cannot grant scopes broader than your own key' }); return;
    }
    scopes = parsed.scopes;
  }

  const label = typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim() : null;
  const workspaceId = typeof req.body?.workspaceId === 'string' && req.body.workspaceId
    ? req.body.workspaceId
    : req.auth!.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' }); return;
  }

  const rawKey = randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyId = randomUUID();
  await db.insert(agentApiKeys).values({
    hash: keyHash,
    keyId,
    agentId: id,
    workspaceId,
    label,
    scopes,
    createdAt: new Date(),
  });
  res.status(201).json({ keyId, apiKey: rawKey, label, scopes, workspaceId, createdAt: new Date() });
}));

/**
 * Update label or scopes on an existing key without regenerating it. Same
 * caller-can-grant-scopes rule as POST. Useful when you want to widen or
 * narrow a deployed bot's permissions without rolling its key.
 */
agentsRouter.patch('/:id/keys/:keyId', requireSelfOrAdmin, requireScope('account:keys'), wrap(async (req, res) => {
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const keyId = req.params.keyId as string;

  const [keyRow] = await db.select().from(agentApiKeys)
    .where(and(eq(agentApiKeys.keyId, keyId), eq(agentApiKeys.agentId, id)));
  if (!keyRow) { res.status(404).json({ error: 'Key not found for this agent' }); return; }

  const update: { label?: string | null; scopes?: string[] } = {};
  if (req.body?.label !== undefined) {
    if (req.body.label === null || req.body.label === '') update.label = null;
    else if (typeof req.body.label !== 'string') { res.status(400).json({ error: 'label must be a string or null' }); return; }
    else update.label = req.body.label.trim();
  }
  if (req.body?.scopes !== undefined) {
    const parsed = parseScopesInput(req.body.scopes);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
    if (req.auth!.scopes && !granterCoversScopes(req.auth!.scopes, parsed.scopes)) {
      res.status(403).json({ error: 'Cannot grant scopes broader than your own key' }); return;
    }
    update.scopes = parsed.scopes;
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'No fields to update (allowed: label, scopes)' }); return;
  }
  await db.update(agentApiKeys).set(update)
    .where(and(eq(agentApiKeys.keyId, keyId), eq(agentApiKeys.agentId, id)));
  res.json({ ok: true, keyId, ...update });
}));

/**
 * Revoke a key. The hash row is deleted; subsequent requests with the raw
 * key fail at the auth middleware with 401. The route refuses to revoke the
 * very key that authorized the current request, so callers don't accidentally
 * brick their own session.
 */
agentsRouter.delete('/:id/keys/:keyId', requireSelfOrAdmin, requireScope('account:keys'), wrap(async (req, res) => {
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const keyId = req.params.keyId as string;
  const [keyRow] = await db.select({ hash: agentApiKeys.hash }).from(agentApiKeys)
    .where(and(eq(agentApiKeys.keyId, keyId), eq(agentApiKeys.agentId, id)));
  if (!keyRow) { res.status(404).json({ error: 'Key not found for this agent' }); return; }
  if (req.auth!.keyId === keyId) {
    res.status(400).json({ error: 'Cannot revoke the key that authorized this request' }); return;
  }
  await db.delete(agentApiKeys)
    .where(and(eq(agentApiKeys.keyId, keyId), eq(agentApiKeys.agentId, id)));
  res.status(204).send();
}));

agentsRouter.delete('/:id', requireCapability('manage'), wrap(async (req, res) => {
  const id = req.params.id as string;
  const workspaceId = req.auth!.workspaceId;
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

  // Unwind positions: sell all shares at current market rates to restore LMSR state
  const agentPositions = await db.select().from(positions)
    .where(and(eq(positions.agentId, id), eq(positions.workspaceId, workspaceId)));

  let positionsUnwound = 0;
  await db.transaction(async tx => {
    for (const pos of agentPositions) {
      if (pos.shares <= 0) continue;
      const [market] = await tx.select().from(markets)
        .where(and(eq(markets.id, pos.marketId), eq(markets.workspaceId, workspaceId)));
      if (!market) continue;

      const mktShares = market.shares as [number, number];
      const dirIdx: 0 | 1 = pos.direction === 'higher' ? 1 : 0;
      const proceeds = directionSellProceeds(mktShares, dirIdx, pos.shares, market.liquidity);

      // Update market shares (remove this agent's shares)
      const newShares: [number, number] = [mktShares[0], mktShares[1]];
      newShares[dirIdx] -= pos.shares;
      await tx.update(markets).set({
        shares: newShares,
        pool: sql`${markets.pool} - ${proceeds}`,
      }).where(and(eq(markets.id, pos.marketId), eq(markets.workspaceId, workspaceId)));

      positionsUnwound++;
    }

    // Remove from permission groups
    const groups = await tx.select().from(permissionGroups)
      .where(eq(permissionGroups.workspaceId, workspaceId));
    for (const group of groups) {
      const memberIds = (group.memberIds as string[]) ?? [];
      if (memberIds.includes(id)) {
        await tx.update(permissionGroups)
          .set({ memberIds: memberIds.filter(m => m !== id) })
          .where(and(eq(permissionGroups.id, group.id), eq(permissionGroups.workspaceId, workspaceId)));
      }
    }

    // Delete all agent data
    await tx.delete(trades).where(eq(trades.agentId, id));
    await tx.delete(positions).where(eq(positions.agentId, id));
    await tx.delete(deposits).where(eq(deposits.agentId, id));
    await tx.delete(withdrawals).where(eq(withdrawals.agentId, id));
    await tx.delete(agentApiKeys).where(eq(agentApiKeys.agentId, id));
    await tx.delete(agents).where(eq(agents.id, id));
  });

  console.log(`[agent delete] ${id}: unwound ${positionsUnwound} positions, removed from groups, deleted`);
  res.json({ ok: true, positionsUnwound });
}));
