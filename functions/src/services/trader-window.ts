import { and, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, earnClaims, liquidityPurchases, proposals, trades, workspaces } from '../db/schema';
import { loadSeasonMarked } from '../lib/board';
import { MANIFOLD_PAID_KEY, PROFITABLE_FORECASTER_MIN_CREDITS, WEEKLY_TRADER_MIN_CREDITS } from './platform-stats';

/**
 * The window: the rows that already determine part of the next reading.
 *
 * Spec: docs/data-room.md, "The window is the rows behind the next reading".
 * Every priced number counts a trailing window, so a forecaster pricing the
 * next reading is partly pricing rows that exist today. This publishes those
 * rows one unit at a time rather than a summary of them: the summary is
 * visible in the shape of a sorted list, and the tail is not recoverable from
 * a count.
 *
 * Two rules hold it together. It reads the SAME definitions the metrics do
 * (the thresholds and the verified set come from platform-stats.ts), so a
 * reader can never find the block and the number disagreeing. And it names
 * nobody: a participant is an entry in a list of numbers, a payment is an
 * amount and a date, and the only identity in it is a public workspace's own
 * slug, which that workspace's floor already publishes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const LAPSE_DAYS = 7;
const REVENUE_WINDOW_DAYS = 30;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface TraderWindow {
  /** The instant the window was computed for, so a cached copy is readable. */
  at: string;
  traders: {
    threshold: number;
    /** Credits traded in the trailing seven days, one entry per verified
     *  participant, high to low, zeroes included. */
    spend: number[];
    /** The day each counted trader's own window falls under the threshold if
     *  they never trade again, earliest first. Always inside the seven days:
     *  a window that takes in nothing new always empties. */
    lapses: string[];
  };
  forecasters: {
    threshold: number;
    /** Marked profit, one entry per participant, house excluded, high to low. */
    profit: number[];
  };
  owners: {
    /** One row per public, outside workspace holding an undecided proposal:
     *  the ceiling on how far "outside owners deciding" can rise. */
    pending: Array<{ slug: string | null; title: string; decideBy: string | null }>;
  };
  revenue: {
    /** Every payment on the revenue rail inside the window, completed or not. */
    payments: Array<{ usd: number; status: string; at: string }>;
  };
}

/** Credits traded in the trailing week, per verified participant, and the day
 *  each counted trader falls out of their own window. */
async function tradersBlock(now: Date): Promise<TraderWindow['traders']> {
  const weekAgo = new Date(now.getTime() - LAPSE_DAYS * DAY_MS);

  const claims = await db
    .select({ agentId: earnClaims.agentId })
    .from(earnClaims)
    .where(eq(earnClaims.key, MANIFOLD_PAID_KEY));
  const verified = [...new Set(claims.map(c => c.agentId))];
  if (verified.length === 0) return { threshold: WEEKLY_TRADER_MIN_CREDITS, spend: [], lapses: [] };

  // No filter on `kind`: the metric sums every row in the window and this has
  // to count exactly what the metric counts.
  const rows = await db
    .select({ agentId: trades.agentId, cost: trades.cost, createdAt: trades.createdAt })
    .from(trades)
    .where(and(gt(trades.createdAt, weekAgo), inArray(trades.agentId, verified)));

  const byAgent = new Map<string, Array<{ at: Date; credits: number }>>();
  for (const r of rows) {
    const list = byAgent.get(r.agentId) ?? [];
    list.push({ at: new Date(r.createdAt), credits: Math.abs(Number(r.cost)) });
    byAgent.set(r.agentId, list);
  }

  const spendOf = (id: string) => (byAgent.get(id) ?? []).reduce((sum, t) => sum + t.credits, 0);
  const spend = verified.map(id => round2(spendOf(id))).sort((a, b) => b - a);

  const lapses: string[] = [];
  for (const id of verified) {
    if (spendOf(id) < WEEKLY_TRADER_MIN_CREDITS) continue;
    const own = byAgent.get(id) ?? [];
    for (let d = 1; d <= LAPSE_DAYS; d++) {
      const then = new Date(now.getTime() + d * DAY_MS);
      const cutoff = new Date(then.getTime() - LAPSE_DAYS * DAY_MS);
      const held = own.filter(t => t.at > cutoff).reduce((sum, t) => sum + t.credits, 0);
      if (held < WEEKLY_TRADER_MIN_CREDITS) {
        lapses.push(isoDay(then));
        break;
      }
    }
  }
  lapses.sort();

  return { threshold: WEEKLY_TRADER_MIN_CREDITS, spend, lapses };
}

/** Marked profit per participant, over the same window the metric marks. */
async function forecastersBlock(now: Date): Promise<TraderWindow['forecasters']> {
  const windowStart = new Date(now.getTime() - 30 * DAY_MS);
  const windowEnd = new Date(now.getTime() + 366 * DAY_MS);
  const [allWs, house] = await Promise.all([
    db.select({ id: workspaces.id }).from(workspaces),
    db.select({ id: agents.id, admin: agents.platformAdmin, operated: agents.platformOperated }).from(agents),
  ]);
  const houseIds = new Set(house.filter(h => h.admin === true || h.operated === true).map(h => h.id));
  const marked = await loadSeasonMarked(
    allWs.map(w => w.id),
    windowStart,
    windowEnd,
  );
  const profit = [...marked.entries()]
    .filter(([agentId]) => !houseIds.has(agentId))
    .map(([, p]) => Math.round(p))
    .sort((a, b) => b - a);
  return { threshold: PROFITABLE_FORECASTER_MIN_CREDITS, profit };
}

/** Every undecided proposal on a public floor an outside owner runs. */
async function ownersBlock(): Promise<TraderWindow['owners']> {
  const rows = await db
    .select({
      slug: workspaces.slug,
      title: proposals.title,
      decideBy: proposals.decideBy,
      admin: agents.platformAdmin,
      operated: agents.platformOperated,
    })
    .from(proposals)
    .innerJoin(workspaces, eq(workspaces.id, proposals.workspaceId))
    .leftJoin(agents, eq(agents.id, workspaces.createdBy))
    .where(and(eq(proposals.status, 'pending'), eq(workspaces.visibility, 'public')));

  const pending = rows
    .filter(r => r.admin !== true && r.operated !== true)
    .map(r => ({ slug: r.slug, title: r.title, decideBy: r.decideBy ? isoDay(new Date(r.decideBy)) : null }))
    // Soonest first; a proposal with no deadline sits after the dated ones.
    .sort((a, b) => (a.decideBy ?? '9999').localeCompare(b.decideBy ?? '9999'));
  return { pending };
}

/** Every payment on the rail inside the revenue window, house excluded. */
async function revenueBlock(now: Date): Promise<TraderWindow['revenue']> {
  const monthAgo = new Date(now.getTime() - REVENUE_WINDOW_DAYS * DAY_MS);
  const rows = await db
    .select({
      usdAmount: liquidityPurchases.usdAmount,
      status: liquidityPurchases.status,
      createdAt: liquidityPurchases.createdAt,
      completedAt: liquidityPurchases.completedAt,
      house: agents.platformAdmin,
    })
    .from(liquidityPurchases)
    .leftJoin(agents, eq(agents.id, liquidityPurchases.agentId));

  const payments = rows
    .filter(r => r.house !== true)
    .map(r => ({ usd: round2(Number(r.usdAmount)), status: r.status, on: new Date(r.completedAt ?? r.createdAt) }))
    .filter(r => r.on >= monthAgo)
    .sort((a, b) => b.on.getTime() - a.on.getTime())
    .map(r => ({ usd: r.usd, status: r.status, at: isoDay(r.on) }));
  return { payments };
}

export async function buildTraderWindow(now = new Date()): Promise<TraderWindow> {
  const [traders, forecasters, owners, revenue] = await Promise.all([
    tradersBlock(now),
    forecastersBlock(now),
    ownersBlock(),
    revenueBlock(now),
  ]);
  return { at: now.toISOString(), traders, forecasters, owners, revenue };
}
