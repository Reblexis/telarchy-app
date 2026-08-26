/**
 * Workspace prize pools (docs/workspace-pools.md): one workspace, one
 * calendar month, the owner's money, paid by Telarchy to traders by settled
 * profit. The arithmetic lives in lib/workspace-pools.ts; this file is the
 * database side: pool rows, the live board, the frozen rules page,
 * settlement, payout accrual.
 */

import { randomUUID } from 'crypto';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  agents,
  markets,
  payouts,
  permissionGroups,
  trades,
  workspacePoolResults,
  workspacePools,
  workspaces,
} from '../db/schema';
import { AppError } from '../lib/errors';
import { finalWeekStart, MIN_PAYOUT_CENTS, monthBounds, monthKey, nextMonthKey, parseMonthKey } from '../lib/funding';
import { platformOperatedIds, resolveWorkspaceOwnerAgentId } from '../lib/participants';
import { toUnits } from '../lib/validation';
import {
  ACTIVITY_FLOOR,
  distributePool,
  type PoolEntry,
  type PoolExclusion,
  payoutFingerprint,
  scorePoolTrades,
} from '../lib/workspace-pools';

type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/** Add cents to a month's pool. Only a scheduled month accepts money; a running one is fixed. */
export async function addToScheduledPool(tx: DbOrTx, workspaceId: string, month: string, cents: number): Promise<void> {
  if (!parseMonthKey(month)) throw new AppError(`bad month ${month}`, 400);
  const [existing] = await tx
    .select()
    .from(workspacePools)
    .where(and(eq(workspacePools.workspaceId, workspaceId), eq(workspacePools.month, month)));
  if (!existing) {
    await tx.insert(workspacePools).values({ workspaceId, month, poolCents: cents, status: 'scheduled' });
    return;
  }
  if (existing.status !== 'scheduled') {
    throw new AppError(`Pool ${workspaceId}/${month} is ${existing.status}; its amount is fixed`, 409);
  }
  await tx
    .update(workspacePools)
    .set({ poolCents: sql`${workspacePools.poolCents} + ${cents}` })
    .where(and(eq(workspacePools.workspaceId, workspaceId), eq(workspacePools.month, month)));
}

export interface PoolRules {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string | null;
  month: string;
  startsAt: string;
  endsAt: string;
  poolCents: number;
  rolloverCents: number;
  totalCents: number;
  scoring: string;
  distribution: string;
  activityFloor: typeof ACTIVITY_FLOOR;
  eligibility: string[];
  minPayoutCents: number;
  payment: string;
  tax: string;
  frozenAt: string;
}

function buildRules(
  ws: { id: string; name: string; slug: string | null },
  pool: typeof workspacePools.$inferSelect,
  at: Date,
): PoolRules {
  const { start, end } = monthBounds(pool.month);
  return {
    workspaceId: ws.id,
    workspaceName: ws.name,
    workspaceSlug: ws.slug,
    month: pool.month,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    poolCents: pool.poolCents,
    rolloverCents: pool.rolloverCents,
    totalCents: pool.poolCents + pool.rolloverCents,
    scoring:
      'Net settled profit: for each market of this workspace that resolved inside the month, only the trades you executed inside the month count; the settlement value of the net shares those trades acquired, plus any refund on them, minus the net cash those trades paid. Shares held from before the month, and cash from selling them, are outside the score. A voided market contributes zero. Open positions are never marked.',
    distribution:
      'Eligible traders with a positive score share the pool in proportion to the square of their score. Ties share the rungs concerned. Nothing is paid for a non-positive score.',
    activityFloor: ACTIVITY_FLOOR,
    eligibility: [
      'An account that owns or administers any public workspace, or that shares payout details with such an account, is shown on the board and takes nothing.',
      'Participants operated by Telarchy take nothing.',
      'One account per person; accounts we determine, acting reasonably, to be one person as several, or to collude to distort prices, are excluded.',
      'You must be at least 18 years old. Void where prohibited. Residents of sanctioned countries are excluded.',
      `At least ${ACTIVITY_FLOOR.trades} trades on at least ${ACTIVITY_FLOOR.markets} of this workspace's markets during the month, at least ${ACTIVITY_FLOOR.earlyTrades} of them before its final week.`,
    ],
    minPayoutCents: MIN_PAYOUT_CENTS,
    payment:
      'Telarchy is the operator of this contest and pays prizes from its own funds by bank transfer to the payout details stored on your account, within 30 days of your accrued total becoming payable. Amounts accrue from settlement and are transferred once the accrued total reaches the minimum payout; small wins are deferred, never lost.',
    tax: 'Winners are responsible for their own taxes. Where Czech law requires it, 15% is withheld on a single payout above CZK 50,000; until withholding is set up no single transfer exceeds that amount and the excess stays accrued.',
    frozenAt: at.toISOString(),
  };
}

/** Markdown of a frozen rules page, served at /api/legal/pools/:slug/:month. */
export function rulesMarkdown(r: PoolRules): string {
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  return `# ${r.workspaceName}: prize pool for ${r.month}

_Rules frozen ${r.frozenAt.slice(0, 10)}. Sponsor: the workspace "${r.workspaceName}". Operator and payer: Telarchy._

## Period and pool

The pool runs from ${r.startsAt} to ${r.endsAt} (UTC). The pool is ${usd(r.totalCents)}${
    r.rolloverCents > 0 ? ` (${usd(r.poolCents)} sponsored this month plus ${usd(r.rolloverCents)} rolled over)` : ''
  }, fixed for the month. Entry is free: nobody pays anything or stakes anything to compete, and credits on the Service keep no cash value.

## Scoring

${r.scoring}

## Distribution

${r.distribution} Activity floor: at least ${r.activityFloor.trades} trades on at least ${r.activityFloor.markets} markets, ${r.activityFloor.earlyTrades} of them before the final week.

## Eligibility

${r.eligibility.map(e => `- ${e}`).join('\n')}

## Getting paid

${r.payment} Minimum payout: ${usd(r.minPayoutCents)}.

${r.tax}

## The operator's side

We may void this month for a declared error, announced here; its pool then rolls into the next month. Disputes: write to us through the feedback channel in the app; we answer, and we publish any correction rather than making it silently.
`;
}

/** Move every scheduled pool whose month has begun to running, freezing its rules. */
export async function startDuePools(now: Date = new Date()): Promise<{ started: string[] }> {
  const current = monthKey(now);
  const due = await db
    .select()
    .from(workspacePools)
    .where(and(eq(workspacePools.status, 'scheduled'), sql`${workspacePools.month} <= ${current}`));
  const started: string[] = [];
  for (const pool of due) {
    const [ws] = await db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, pool.workspaceId));
    if (!ws) continue;
    const rules = buildRules(ws, pool, now);
    const updated = await db
      .update(workspacePools)
      .set({ status: 'running', rules, frozenAt: now })
      .where(
        and(
          eq(workspacePools.workspaceId, pool.workspaceId),
          eq(workspacePools.month, pool.month),
          eq(workspacePools.status, 'scheduled'),
        ),
      )
      .returning({ month: workspacePools.month });
    if (updated.length) started.push(`${pool.workspaceId}/${pool.month}`);
  }
  return { started };
}

/** Accounts that own or administer any public workspace, plus platform admins. */
async function ownerAndAdminIds(): Promise<Set<string>> {
  const out = new Set<string>();
  const publicWs = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(inArray(workspaces.visibility, ['public', 'unlisted']));
  const ids = publicWs.map(w => w.id);
  for (const id of ids) {
    const owner = await resolveWorkspaceOwnerAgentId(id);
    if (owner) out.add(owner);
  }
  if (ids.length) {
    const groups = await db
      .select()
      .from(permissionGroups)
      .where(and(inArray(permissionGroups.workspaceId, ids), eq(permissionGroups.type, 'admin')));
    for (const g of groups) for (const m of (g.memberIds as string[] | null) ?? []) out.add(m);
  }
  const admins = await db.select({ id: agents.id }).from(agents).where(eq(agents.platformAdmin, true));
  for (const a of admins) out.add(a.id);
  return out;
}

export interface PoolBoard {
  workspaceId: string;
  month: string;
  status: string;
  poolCents: number;
  rolloverCents: number;
  totalCents: number;
  monthStart: string;
  monthEnd: string;
  entries: PoolEntry[];
  final: boolean;
}

/** The board: live while running (recomputed), stored once settled. */
export async function computePoolBoard(workspaceId: string, month: string): Promise<PoolBoard | null> {
  const [pool] = await db
    .select()
    .from(workspacePools)
    .where(and(eq(workspacePools.workspaceId, workspaceId), eq(workspacePools.month, month)));
  if (!pool) return null;
  const { start, end } = monthBounds(month);
  const base = {
    workspaceId,
    month,
    status: pool.status,
    poolCents: pool.poolCents,
    rolloverCents: pool.rolloverCents,
    totalCents: pool.poolCents + pool.rolloverCents,
    monthStart: start.toISOString(),
    monthEnd: end.toISOString(),
  };
  if (pool.status === 'settled' || pool.status === 'voided') {
    const rows = await db
      .select()
      .from(workspacePoolResults)
      .where(and(eq(workspacePoolResults.workspaceId, workspaceId), eq(workspacePoolResults.month, month)));
    const entries: PoolEntry[] = rows
      .map(r => ({
        agentId: r.agentId,
        score: Number(r.scoreUnits) / 1e9,
        tradeCount: r.tradeCount,
        marketCount: r.marketCount,
        earlyTradeCount: r.earlyTradeCount,
        eligible: r.eligible,
        exclusion: (r.exclusion as PoolExclusion | null) ?? null,
        share: r.share,
        payoutCents: r.payoutCents,
        rank: r.rank,
      }))
      .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId));
    return { ...base, entries, final: true };
  }
  const entries = await liveEntries(workspaceId, month, pool.poolCents + pool.rolloverCents);
  return { ...base, entries, final: false };
}

async function liveEntries(workspaceId: string, month: string, totalCents: number): Promise<PoolEntry[]> {
  const { start, end } = monthBounds(month);
  const marketRows = await db
    .select({
      id: markets.id,
      voided: markets.voided,
      actualValue: markets.actualValue,
      rangeMin: markets.rangeMin,
      rangeMax: markets.rangeMax,
    })
    .from(markets)
    .where(
      and(
        eq(markets.workspaceId, workspaceId),
        eq(markets.resolved, true),
        gte(markets.resolvedAt, start),
        lt(markets.resolvedAt, end),
      ),
    );
  if (marketRows.length === 0) return [];
  const marketsById = new Map(
    marketRows.map(m => [
      m.id,
      {
        marketId: m.id,
        voided: Boolean(m.voided),
        actualValue: m.actualValue,
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
      },
    ]),
  );
  const tradeRows = await db
    .select({
      agentId: trades.agentId,
      marketId: trades.marketId,
      direction: trades.direction,
      shares: trades.shares,
      cost: trades.cost,
      createdAt: trades.createdAt,
    })
    .from(trades)
    .where(
      and(
        eq(trades.workspaceId, workspaceId),
        inArray(trades.marketId, [...marketsById.keys()]),
        gte(trades.createdAt, start),
        lt(trades.createdAt, end),
      ),
    );
  const scores = scorePoolTrades(
    tradeRows
      .filter(t => t.agentId)
      .map(t => ({
        agentId: t.agentId as string,
        marketId: t.marketId,
        direction: t.direction === 'higher' ? 'higher' : 'lower',
        shares: t.shares,
        cost: t.cost,
        createdAt: t.createdAt,
      })),
    marketsById,
    finalWeekStart(month),
  );
  const exclusions = await hardExclusions(scores.map(s => s.agentId));
  return distributePool(scores, totalCents, exclusions);
}

/** Owner/admin, shared payout details, platform-operated: the platform rules. */
async function hardExclusions(
  agentIds: string[],
): Promise<Map<string, Exclude<PoolExclusion, 'activity_floor' | 'non_positive'>>> {
  const out = new Map<string, Exclude<PoolExclusion, 'activity_floor' | 'non_positive'>>();
  if (agentIds.length === 0) return out;
  const insiders = await ownerAndAdminIds();
  const operated = await platformOperatedIds(agentIds);
  for (const id of agentIds) {
    if (operated.has(id)) out.set(id, 'platform_operated');
    else if (insiders.has(id)) out.set(id, 'owner_or_admin');
  }
  // Shared payout details with an insider: fingerprint both sets.
  const lookup = [...new Set([...agentIds, ...insiders])];
  const rows = lookup.length
    ? await db
        .select({ id: agents.id, payoutMethod: agents.payoutMethod })
        .from(agents)
        .where(inArray(agents.id, lookup))
    : [];
  const insiderPrints = new Set<string>();
  const printById = new Map<string, string | null>();
  for (const r of rows) {
    const fp = payoutFingerprint(r.payoutMethod);
    printById.set(r.id, fp);
    if (fp && insiders.has(r.id)) insiderPrints.add(fp);
  }
  for (const id of agentIds) {
    if (out.has(id)) continue;
    const fp = printById.get(id);
    if (fp && insiderPrints.has(fp)) out.set(id, 'shared_payout');
  }
  return out;
}

/**
 * Settle every running pool whose month has ended: compute the board once,
 * store it, accrue payouts, roll an undistributable pool forward. A settled
 * pool is never recomputed.
 */
export async function settleDuePools(now: Date = new Date()): Promise<{ settled: string[] }> {
  const current = monthKey(now);
  const due = await db
    .select()
    .from(workspacePools)
    .where(and(eq(workspacePools.status, 'running'), lt(workspacePools.month, current)));
  const settled: string[] = [];
  for (const pool of due) {
    const total = pool.poolCents + pool.rolloverCents;
    const entries = await liveEntries(pool.workspaceId, pool.month, total);
    const distributed = entries.reduce((sum, e) => sum + e.payoutCents, 0);
    await db.transaction(async tx => {
      const flipped = await tx
        .update(workspacePools)
        .set({ status: 'settled', settledAt: now, distributedCents: distributed })
        .where(
          and(
            eq(workspacePools.workspaceId, pool.workspaceId),
            eq(workspacePools.month, pool.month),
            eq(workspacePools.status, 'running'),
          ),
        )
        .returning({ month: workspacePools.month });
      if (!flipped.length) return;
      if (entries.length) {
        await tx.insert(workspacePoolResults).values(
          entries.map(e => ({
            workspaceId: pool.workspaceId,
            month: pool.month,
            agentId: e.agentId,
            scoreUnits: toUnits(e.score),
            tradeCount: e.tradeCount,
            marketCount: e.marketCount,
            earlyTradeCount: e.earlyTradeCount,
            eligible: e.eligible,
            exclusion: e.exclusion,
            share: e.share,
            payoutCents: e.payoutCents,
            rank: e.rank,
          })),
        );
        const paid = entries.filter(e => e.payoutCents > 0);
        if (paid.length) {
          await tx.insert(payouts).values(
            paid.map(e => ({
              id: randomUUID(),
              agentId: e.agentId,
              amountCents: e.payoutCents,
              sourceType: 'workspace_pool',
              sourceRef: `${pool.workspaceId}/${pool.month}`,
              state: 'accrued',
            })),
          );
        }
      }
      const remainder = total - distributed;
      if (remainder > 0) {
        const next = nextMonthKey(pool.month);
        const [nextPool] = await tx
          .select()
          .from(workspacePools)
          .where(and(eq(workspacePools.workspaceId, pool.workspaceId), eq(workspacePools.month, next)));
        if (!nextPool) {
          await tx.insert(workspacePools).values({
            workspaceId: pool.workspaceId,
            month: next,
            poolCents: 0,
            rolloverCents: remainder,
            status: 'scheduled',
          });
        } else {
          await tx
            .update(workspacePools)
            .set({ rolloverCents: sql`${workspacePools.rolloverCents} + ${remainder}` })
            .where(and(eq(workspacePools.workspaceId, pool.workspaceId), eq(workspacePools.month, next)));
        }
      }
      settled.push(`${pool.workspaceId}/${pool.month}`);
    });
  }
  return { settled };
}

/** A participant's accrued and paid cash, and whether a transfer is due. */
export async function payoutSummary(agentId: string): Promise<{
  accruedCents: number;
  paidCents: number;
  payable: boolean;
  minPayoutCents: number;
  items: Array<{
    id: string;
    amountCents: number;
    sourceType: string;
    sourceRef: string;
    state: string;
    createdAt: string;
    paidAt: string | null;
  }>;
}> {
  const rows = await db.select().from(payouts).where(eq(payouts.agentId, agentId));
  const accruedCents = rows.filter(r => r.state === 'accrued').reduce((s, r) => s + r.amountCents, 0);
  const paidCents = rows.filter(r => r.state === 'paid').reduce((s, r) => s + r.amountCents, 0);
  const [agent] = await db.select({ payoutMethod: agents.payoutMethod }).from(agents).where(eq(agents.id, agentId));
  return {
    accruedCents,
    paidCents,
    payable: accruedCents >= MIN_PAYOUT_CENTS && Boolean(agent?.payoutMethod),
    minPayoutCents: MIN_PAYOUT_CENTS,
    items: rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(r => ({
        id: r.id,
        amountCents: r.amountCents,
        sourceType: r.sourceType,
        sourceRef: r.sourceRef,
        state: r.state,
        createdAt: r.createdAt.toISOString(),
        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      })),
  };
}

/** Operator marks every accrued payout of one participant paid (one transfer). */
export async function markPayoutsPaid(
  agentId: string,
  note: string | null,
  now: Date = new Date(),
): Promise<{ paidCents: number }> {
  const rows = await db
    .update(payouts)
    .set({ state: 'paid', paidAt: now, paidNote: note })
    .where(and(eq(payouts.agentId, agentId), eq(payouts.state, 'accrued')))
    .returning({ amountCents: payouts.amountCents });
  return { paidCents: rows.reduce((s, r) => s + r.amountCents, 0) };
}

/** Every participant with something accrued, for the operator's payout run. */
export async function listAccruedPayouts(): Promise<
  Array<{
    agentId: string;
    nickname: string | null;
    accruedCents: number;
    payable: boolean;
    payoutHandle: string | null;
  }>
> {
  const rows = await db
    .select({
      agentId: payouts.agentId,
      accruedCents: sql<number>`sum(${payouts.amountCents})`.mapWith(Number),
    })
    .from(payouts)
    .where(eq(payouts.state, 'accrued'))
    .groupBy(payouts.agentId);
  if (rows.length === 0) return [];
  const people = await db
    .select({
      id: agents.id,
      nickname: agents.nickname,
      payoutHandle: agents.payoutHandle,
      payoutMethod: agents.payoutMethod,
    })
    .from(agents)
    .where(
      inArray(
        agents.id,
        rows.map(r => r.agentId),
      ),
    );
  const byId = new Map(people.map(p => [p.id, p]));
  return rows.map(r => {
    const p = byId.get(r.agentId);
    return {
      agentId: r.agentId,
      nickname: p?.nickname ?? null,
      accruedCents: r.accruedCents,
      payable: r.accruedCents >= MIN_PAYOUT_CENTS && Boolean(p?.payoutMethod),
      payoutHandle: p?.payoutHandle ?? null,
    };
  });
}

export async function listPools(workspaceId: string): Promise<Array<typeof workspacePools.$inferSelect>> {
  return db
    .select()
    .from(workspacePools)
    .where(eq(workspacePools.workspaceId, workspaceId))
    .orderBy(sql`${workspacePools.month} desc`);
}
