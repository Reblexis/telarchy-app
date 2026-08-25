import { and, desc, eq, gt, inArray, lte } from 'drizzle-orm';
import { db } from '../db/client';
import {
  deposits,
  liquidityEvents,
  markets,
  metrics as metricsTable,
  proposalMessages,
  proposals,
  trades,
  updates,
  withdrawals,
} from '../db/schema';
import { resolutionInstant } from '../lib/date-utils';
import { getParticipantDisplayNames, listParticipantsForWorkspace } from '../lib/participants';

export const ACTIVITY_TYPES = [
  'trade',
  'deposit',
  'withdrawal',
  'market_created',
  'market_resolved',
  'metric_update',
  'proposal_created',
  'proposal_message',
  'liquidity',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityItem {
  id: string;
  type: ActivityType;
  timestamp: string;
  actor: { id: string; label: string } | null;
  marketId?: string;
  metricId?: string;
  proposalId?: string;
  data: Record<string, unknown>;
}

export interface ActivityQuery {
  since?: Date;
  until?: Date;
  limit?: number;
  types?: ActivityType[];
  participantId?: string;
  marketId?: string;
  metricId?: string;
  proposalId?: string;
}

function want(types: ActivityType[] | undefined, t: ActivityType): boolean {
  return !types || types.includes(t);
}

export async function getActivityFeed(workspaceId: string, opts: ActivityQuery): Promise<ActivityItem[]> {
  const since = opts.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const until = opts.until ?? new Date();
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 500);
  const types = opts.types;

  const members = await listParticipantsForWorkspace(workspaceId);
  const memberIds = members.map(m => m.id);
  const memberSet = new Set(memberIds);

  const matchesParticipant = (id: string | null | undefined) => {
    if (!opts.participantId) return true;
    return id === opts.participantId;
  };

  const tradesQuery =
    want(types, 'trade') && memberIds.length > 0
      ? db
          .select()
          .from(trades)
          .where(
            and(
              eq(trades.workspaceId, workspaceId),
              gt(trades.createdAt, since),
              lte(trades.createdAt, until),
              ...(opts.marketId ? [eq(trades.marketId, opts.marketId)] : []),
              ...(opts.participantId ? [eq(trades.agentId, opts.participantId)] : []),
            ),
          )
          .orderBy(desc(trades.createdAt))
          .limit(limit)
      : Promise.resolve([]);

  const depositsQuery =
    want(types, 'deposit') && memberIds.length > 0
      ? db
          .select()
          .from(deposits)
          .where(
            and(
              inArray(deposits.agentId, opts.participantId ? [opts.participantId] : memberIds),
              gt(deposits.createdAt, since),
              lte(deposits.createdAt, until),
            ),
          )
          .orderBy(desc(deposits.createdAt))
          .limit(limit)
      : Promise.resolve([]);

  const withdrawalsQuery =
    want(types, 'withdrawal') && memberIds.length > 0
      ? db
          .select()
          .from(withdrawals)
          .where(
            and(
              inArray(withdrawals.agentId, opts.participantId ? [opts.participantId] : memberIds),
              gt(withdrawals.createdAt, since),
              lte(withdrawals.createdAt, until),
            ),
          )
          .orderBy(desc(withdrawals.createdAt))
          .limit(limit)
      : Promise.resolve([]);

  const marketsCreatedQuery = want(types, 'market_created')
    ? db
        .select()
        .from(markets)
        .where(
          and(
            eq(markets.workspaceId, workspaceId),
            gt(markets.createdAt, since),
            lte(markets.createdAt, until),
            ...(opts.marketId ? [eq(markets.id, opts.marketId)] : []),
            ...(opts.metricId ? [eq(markets.metricId, opts.metricId)] : []),
          ),
        )
        .orderBy(desc(markets.createdAt))
        .limit(limit)
    : Promise.resolve([]);

  const marketsResolvedQuery = want(types, 'market_resolved')
    ? db
        .select()
        .from(markets)
        .where(
          and(
            eq(markets.workspaceId, workspaceId),
            eq(markets.resolved, true),
            ...(opts.marketId ? [eq(markets.id, opts.marketId)] : []),
            ...(opts.metricId ? [eq(markets.metricId, opts.metricId)] : []),
          ),
        )
        .orderBy(desc(markets.resolvedAt))
        .limit(limit)
    : Promise.resolve([]);

  const updatesQuery = want(types, 'metric_update')
    ? db
        .select()
        .from(updates)
        .where(and(eq(updates.workspaceId, workspaceId), gt(updates.timestamp, since), lte(updates.timestamp, until)))
        .orderBy(desc(updates.timestamp))
        .limit(limit)
    : Promise.resolve([]);

  const proposalsQuery = want(types, 'proposal_created')
    ? db
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.workspaceId, workspaceId),
            gt(proposals.createdAt, since),
            lte(proposals.createdAt, until),
            ...(opts.proposalId ? [eq(proposals.id, opts.proposalId)] : []),
            ...(opts.participantId ? [eq(proposals.proposedBy, opts.participantId)] : []),
          ),
        )
        .orderBy(desc(proposals.createdAt))
        .limit(limit)
    : Promise.resolve([]);

  const proposalMessagesQuery = want(types, 'proposal_message')
    ? db
        .select()
        .from(proposalMessages)
        .where(
          and(
            eq(proposalMessages.workspaceId, workspaceId),
            gt(proposalMessages.createdAt, since),
            lte(proposalMessages.createdAt, until),
            ...(opts.proposalId ? [eq(proposalMessages.proposalId, opts.proposalId)] : []),
            ...(opts.participantId ? [eq(proposalMessages.from, opts.participantId)] : []),
          ),
        )
        .orderBy(desc(proposalMessages.createdAt))
        .limit(limit)
    : Promise.resolve([]);

  const liquidityQuery = want(types, 'liquidity')
    ? db
        .select()
        .from(liquidityEvents)
        .where(
          and(
            eq(liquidityEvents.workspaceId, workspaceId),
            gt(liquidityEvents.createdAt, since),
            lte(liquidityEvents.createdAt, until),
            ...(opts.marketId ? [eq(liquidityEvents.marketId, opts.marketId)] : []),
          ),
        )
        .orderBy(desc(liquidityEvents.createdAt))
        .limit(limit)
    : Promise.resolve([]);

  const [
    tradeRows,
    depositRows,
    withdrawalRows,
    marketCreatedRows,
    marketResolvedRows,
    updateRows,
    proposalRows,
    proposalMessageRows,
    liquidityRows,
  ] = await Promise.all([
    tradesQuery,
    depositsQuery,
    withdrawalsQuery,
    marketsCreatedQuery,
    marketsResolvedQuery,
    updatesQuery,
    proposalsQuery,
    proposalMessagesQuery,
    liquidityQuery,
  ]);

  // Metric name -> id resolution for metric_update (updates table only stores name)
  const metricRows = await db
    .select({ id: metricsTable.id, name: metricsTable.name })
    .from(metricsTable)
    .where(eq(metricsTable.workspaceId, workspaceId));
  const metricIdByName = new Map(metricRows.map(r => [r.name, r.id]));

  // Market lookup so trade/liquidity rows can surface metricName + targetDate
  // (their own tables only carry marketId, hence "a metric" in the feed).
  const marketIdsForLookup = new Set<string>();
  for (const t of tradeRows) marketIdsForLookup.add(t.marketId);
  for (const e of liquidityRows) marketIdsForLookup.add(e.marketId);
  const marketLookup = new Map<string, { metricId: string; metricName: string; targetDate: string }>();
  if (marketIdsForLookup.size > 0) {
    const rows = await db
      .select({
        id: markets.id,
        metricId: markets.metricId,
        metricName: markets.metricName,
        targetDate: markets.targetDate,
      })
      .from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), inArray(markets.id, Array.from(marketIdsForLookup))));
    for (const r of rows) {
      marketLookup.set(r.id, { metricId: r.metricId, metricName: r.metricName, targetDate: r.targetDate });
    }
  }

  const items: ActivityItem[] = [];

  for (const t of tradeRows) {
    if (!memberSet.has(t.agentId)) continue;
    const mkt = marketLookup.get(t.marketId);
    items.push({
      id: `trade:${t.id}`,
      type: 'trade',
      timestamp: t.createdAt.toISOString(),
      actor: { id: t.agentId, label: t.agentId },
      marketId: t.marketId,
      metricId: mkt?.metricId,
      data: {
        direction: t.direction,
        shares: t.shares,
        cost: t.cost,
        metricName: mkt?.metricName,
        targetDate: mkt?.targetDate,
        resolvesOn: mkt?.targetDate ? resolutionInstant(mkt.targetDate) : undefined,
      },
    });
  }

  for (const d of depositRows) {
    if (!matchesParticipant(d.agentId)) continue;
    items.push({
      id: `deposit:${d.txHash}`,
      type: 'deposit',
      timestamp: d.createdAt.toISOString(),
      actor: { id: d.agentId, label: d.agentId },
      data: { credits: d.credits, usdcAmount: d.usdcAmount, from: d.from, txHash: d.txHash },
    });
  }

  for (const w of withdrawalRows) {
    if (!matchesParticipant(w.agentId)) continue;
    items.push({
      id: `withdrawal:${w.id}`,
      type: 'withdrawal',
      timestamp: w.createdAt.toISOString(),
      actor: { id: w.agentId, label: w.agentId },
      data: { credits: w.credits, usdcAmount: w.usdcAmount, toAddress: w.toAddress, txHash: w.txHash },
    });
  }

  for (const m of marketCreatedRows) {
    items.push({
      id: `market_created:${m.id}`,
      type: 'market_created',
      timestamp: m.createdAt.toISOString(),
      actor: null,
      marketId: m.id,
      metricId: m.metricId,
      proposalId: m.proposalId ?? undefined,
      data: {
        metricName: m.metricName,
        targetDate: m.targetDate,
        resolvesOn: resolutionInstant(m.targetDate),
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
      },
    });
  }

  for (const m of marketResolvedRows) {
    if (!m.resolvedAt) continue;
    if (m.resolvedAt < since || m.resolvedAt > until) continue;
    items.push({
      id: `market_resolved:${m.id}`,
      type: 'market_resolved',
      timestamp: m.resolvedAt.toISOString(),
      actor: null,
      marketId: m.id,
      metricId: m.metricId,
      data: {
        metricName: m.metricName,
        targetDate: m.targetDate,
        resolvesOn: resolutionInstant(m.targetDate),
        actualValue: m.actualValue,
        voided: m.voided,
      },
    });
  }

  for (const u of updateRows) {
    const metricId = metricIdByName.get(u.metricName);
    if (opts.metricId && metricId !== opts.metricId) continue;
    items.push({
      id: `metric_update:${u.id}`,
      type: 'metric_update',
      timestamp: u.timestamp.toISOString(),
      actor: null,
      metricId,
      data: {
        metricName: u.metricName,
        oldValue: u.oldValue,
        newValue: u.newValue,
        description: u.description,
      },
    });
  }

  for (const t of proposalRows) {
    items.push({
      id: `proposal_created:${t.id}`,
      type: 'proposal_created',
      timestamp: t.createdAt.toISOString(),
      actor: { id: t.proposedBy, label: t.proposedBy },
      proposalId: t.id,
      data: {
        title: t.title,
        status: t.status,
      },
    });
  }

  for (const msg of proposalMessageRows) {
    items.push({
      id: `proposal_message:${msg.id}`,
      type: 'proposal_message',
      timestamp: msg.createdAt.toISOString(),
      actor: { id: msg.from, label: msg.from },
      proposalId: msg.proposalId,
      data: { content: msg.content },
    });
  }

  for (const e of liquidityRows) {
    const mkt = marketLookup.get(e.marketId);
    items.push({
      id: `liquidity:${e.id}`,
      type: 'liquidity',
      timestamp: e.createdAt.toISOString(),
      actor: e.agentId ? { id: e.agentId, label: e.agentId } : null,
      marketId: e.marketId,
      metricId: mkt?.metricId,
      data: {
        amount: e.amount,
        totalLiquidity: e.totalLiquidity,
        kind: e.type,
        poolContribution: e.poolContribution,
        metricName: mkt?.metricName,
        targetDate: mkt?.targetDate,
        resolvesOn: mkt?.targetDate ? resolutionInstant(mkt.targetDate) : undefined,
      },
    });
  }

  // Resolve display names for all actors in one round-trip.
  const actorIds = items.map(i => i.actor?.id).filter((x): x is string => !!x);
  const names = await getParticipantDisplayNames(actorIds);
  for (const item of items) {
    if (item.actor) {
      const label = names.get(item.actor.id);
      if (label) item.actor.label = label;
      else item.actor.label = shortenId(item.actor.id);
    }
  }

  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return items.slice(0, limit);
}

function shortenId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}
