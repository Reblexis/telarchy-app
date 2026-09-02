import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  agentApiKeys,
  announcements,
  markets,
  metricLogs,
  metrics,
  permissionGroups,
  proposals,
  sources,
  trades,
  workspaces,
} from '../db/schema';
import { consensus, sharesForBudget } from '../lib/amm';
import { type DecisionId, SETUP_SPEC } from '../lib/setup-spec';

/**
 * What is actually decided on a floor, read from the database
 * (owner direction 2026-08-23).
 *
 * The handoff prompt is written by a model and is true when it is written. An
 * agent picking it up an hour later needs a way to ask what is still open
 * WITHOUT trusting that text, and their operator needs a way to see progress
 * that does not depend on Otto remembering. This is that: the spec in
 * lib/setup-spec.ts, answered against the real rows.
 *
 * Every status is evidence-based. "Decided" means something in the database
 * could only be there because someone chose it, never "the default looks
 * plausible": telling an operator they have settled a question they have not
 * even read is the failure that makes a checklist worse than nothing.
 */

export interface ChecklistItem {
  id: DecisionId;
  label: string;
  question: string;
  why: string;
  options: string[];
  api: string;
  status: 'done' | 'open';
  /** What the database says right now, in one line. */
  note: string;
}

/** Enough of the market to draw it. The page's hero IS the instrument, and it
 *  fills in as the setup goes; every field here comes from the market row, so
 *  what the operator watches sharpen is the real thing rather than an
 *  illustration of it. */
export interface ChecklistMarket {
  metricName: string;
  rangeMin: number;
  rangeMax: number;
  targetDate: string;
  /** Where the market currently sits inside the band, or null when it holds
   *  nothing and therefore predicts nothing. */
  consensus: number | null;
  /** Credits behind it, which is what decides whether that number means
   *  anything (see the shove test above). */
  pool: number;
}

export interface Checklist {
  workspace: { id: string; name: string; slug: string | null; visibility: string } | null;
  /** The market the hero draws, when one exists. */
  market: ChecklistMarket | null;
  items: ChecklistItem[];
  /** Things that stop the floor working AT ALL, in the order they bite. A
   *  market with no liquidity is the loud one: it renders, it looks finished,
   *  and every trade against it is refused. */
  blocking: string[];
}

const count = sql<number>`count(*)::int`;

export async function buildChecklist(workspaceId: string): Promise<Checklist> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) return { workspace: null, market: null, items: [], blocking: [] };

  const metricRows = await db.select().from(metrics).where(eq(metrics.workspaceId, workspaceId));
  const leafMetrics = metricRows.filter(m => !m.formula || m.formula.trim() === '0');

  const openMarkets = await db
    .select({
      id: markets.id,
      metricId: markets.metricId,
      liquidity: markets.liquidity,
      shares: markets.shares,
      rangeMin: markets.rangeMin,
      rangeMax: markets.rangeMax,
      targetDate: markets.targetDate,
      proposalId: markets.proposalId,
    })
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false), eq(markets.voided, false)));
  const baseMarkets = openMarkets.filter(m => !m.proposalId);
  const contractMarkets = openMarkets.filter(m => m.proposalId);
  const fundedBase = baseMarkets.filter(m => (m.liquidity ?? 0) > 0);

  const [logCount] = await db.select({ n: count }).from(metricLogs).where(eq(metricLogs.workspaceId, workspaceId));
  const [sourceCount] = await db.select({ n: count }).from(sources).where(eq(sources.workspaceId, workspaceId));
  const [keyCount] = await db.select({ n: count }).from(agentApiKeys).where(eq(agentApiKeys.workspaceId, workspaceId));
  const [announceCount] = await db
    .select({ n: count })
    .from(announcements)
    .where(eq(announcements.workspaceId, workspaceId));
  const [decidedCount] = await db
    .select({ n: count })
    .from(proposals)
    .where(and(eq(proposals.workspaceId, workspaceId), ne(proposals.status, 'pending')));
  const [proposalCount] = await db.select({ n: count }).from(proposals).where(eq(proposals.workspaceId, workspaceId));
  const [outsideTrades] = await db
    .select({ n: count })
    .from(trades)
    .where(and(eq(trades.workspaceId, workspaceId), ne(trades.agentId, ws.createdBy)));
  const [publicGroup] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, workspaceId), eq(permissionGroups.type, 'public')));
  const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];

  const withHorizon = leafMetrics.filter(m => {
    const tp = m.timePreference as { enabled?: boolean; customHorizons?: string[] } | null;
    return Boolean(tp?.enabled) || (tp?.customHorizons?.length ?? 0) > 0;
  });
  const described = leafMetrics.filter(m => (m.description ?? '').trim().length > 0);

  const poolCredits = (b: number) => Math.round(b * Math.LN2 * 100) / 100;
  const totalPool = poolCredits(baseMarkets.reduce((sum, m) => sum + (m.liquidity ?? 0), 0));

  /**
   * What a five-credit trade does to this market's forecast, as a share of the
   * band. This is the honest test of whether a market says anything, and it is
   * here because "funded" turned out to be the wrong question: a workspace
   * auto-funds 0.5 credits per market, which is not zero, so every trade is
   * accepted and the first five-credit trade moves the forecast from the
   * middle of the band to its ceiling (measured on beta, 2026-08-23). A market
   * anyone can pin for pocket change is a decoration, and reporting it as
   * settled is how an operator ends up trusting a number nobody defended.
   */
  const SHOVE_CREDITS = 5;
  function shoveShare(m: { shares: unknown; liquidity: number; rangeMin: number; rangeMax: number }): number {
    const b = m.liquidity ?? 0;
    if (b <= 0) return 1;
    const held = (m.shares ?? [0, 0]) as [number, number];
    const before = consensus(held, b, m.rangeMin, m.rangeMax);
    const { amount } = sharesForBudget(held, 1, SHOVE_CREDITS, b);
    const after = consensus([held[0], held[1] + amount], b, m.rangeMin, m.rangeMax);
    if (before === undefined || after === undefined) return 1;
    const band = m.rangeMax - m.rangeMin;
    return band > 0 ? Math.abs(after - before) / band : 1;
  }
  /** A market a five-credit trade cannot move by more than a fifth of its
   *  band is a market worth reading. */
  const meaningful = baseMarkets.filter(m => (m.liquidity ?? 0) > 0 && shoveShare(m) <= 0.2);
  const shovable = baseMarkets.filter(m => (m.liquidity ?? 0) > 0 && shoveShare(m) > 0.2);

  const decided: Record<DecisionId, { status: 'done' | 'open'; note: string }> = {
    subject: (ws.description ?? '').trim()
      ? { status: 'done', note: `${ws.name}: "${(ws.description ?? '').trim().slice(0, 80)}"` }
      : {
          status: 'open',
          note: `${ws.name} has no one-line description, so a cold visitor sees a number and no company.`,
        },

    number:
      leafMetrics.length === 0
        ? { status: 'open', note: 'No number yet.' }
        : withHorizon.length === 0
          ? {
              status: 'open',
              note: `${leafMetrics.length} metric(s), none with a horizon, so no market exists to trade.`,
            }
          : described.length === 0
            ? {
                status: 'open',
                note: `${withHorizon.length} market(s) open, but nothing says what the number counts, and that text is what it settles on.`,
              }
            : {
                status: 'done',
                note: `${withHorizon.map(m => m.name).join(', ')}, ${baseMarkets.length} open market(s).`,
              },

    updates:
      (sourceCount?.n ?? 0) > 0
        ? { status: 'done', note: `${sourceCount?.n} source(s) configured to pull the value.` }
        : (keyCount?.n ?? 0) > 0
          ? {
              status: 'done',
              note: `${keyCount?.n} participant key(s) in this workspace, so something can push the value.`,
            }
          : (logCount?.n ?? 0) > leafMetrics.length
            ? { status: 'done', note: 'The number has been updated by hand at least once.' }
            : {
                status: 'open',
                note: 'Nothing has updated the number since it was created, and no key or source exists to do it.',
              },

    context:
      (ws.subjectAbout ?? '').trim() ||
      (ws.charter ?? '').trim() ||
      (sourceCount?.n ?? 0) > 0 ||
      (announceCount?.n ?? 0) > 0
        ? {
            status: 'done',
            note: [
              (ws.subjectAbout ?? '').trim() ? 'a "what is this" blurb' : '',
              (ws.charter ?? '').trim() ? 'a charter' : '',
              (sourceCount?.n ?? 0) > 0 ? `${sourceCount?.n} source(s)` : '',
              (announceCount?.n ?? 0) > 0 ? `${announceCount?.n} announcement(s)` : '',
            ]
              .filter(Boolean)
              .join(', '),
          }
        : { status: 'open', note: 'Nothing published beyond the number itself, so a forecaster is guessing.' },

    liquidity:
      meaningful.length > 0
        ? {
            status: 'done',
            note: `${totalPool} credits across ${fundedBase.length} of ${baseMarkets.length} market(s).`,
          }
        : shovable.length > 0
          ? {
              status: 'open',
              note: `${totalPool} credits in total, which is a decoration: ${SHOVE_CREDITS} credits moves the forecast by more than a fifth of the band, so the price says nothing.`,
            }
          : {
              status: 'open',
              note: baseMarkets.length
                ? 'Every market holds zero, so no trade can be placed against any of them.'
                : 'No market to fund yet.',
            },

    contracts:
      ws.autoFundNewMarkets && (ws.newMarketLiquidityCredits ?? 0) >= SHOVE_CREDITS
        ? { status: 'done', note: `Auto-funding every new market with ${ws.newMarketLiquidityCredits} credits.` }
        : contractMarkets.some(m => (m.liquidity ?? 0) > 0)
          ? { status: 'done', note: 'Proposal markets are funded by hand or by an agent.' }
          : ws.autoFundNewMarkets && (ws.newMarketLiquidityCredits ?? 0) > 0
            ? {
                status: 'open',
                note: `Auto-funding ${ws.newMarketLiquidityCredits} credits per market, which is too thin to price anything. Raise it or fund proposals deliberately.`,
              }
            : {
                status: 'open',
                note: proposalCount?.n
                  ? `${proposalCount?.n} proposal(s) posted and their markets hold nothing.`
                  : 'No rule yet for funding a proposal market when one arrives.',
              },

    participation: publicCaps.includes('trade')
      ? { status: 'done', note: `Open: anyone can join and trade (${ws.visibility}).` }
      : ws.visibility === 'private'
        ? { status: 'done', note: 'Private: only participants you add.' }
        : {
            status: 'open',
            note: `${ws.visibility}, and the Public group is read-only, so a visitor can watch but not trade.`,
          },

    decisions:
      (ws.charter ?? '').trim() || (decidedCount?.n ?? 0) > 0
        ? {
            status: 'done',
            note:
              (decidedCount?.n ?? 0) > 0
                ? `${decidedCount?.n} proposal(s) decided${(ws.charter ?? '').trim() ? ' and a charter published' : ''}.`
                : 'A charter says what you will do with the price.',
          }
        : { status: 'open', note: 'No charter and nothing decided yet, so nobody knows what a price buys them.' },

    reach:
      (outsideTrades?.n ?? 0) > 0
        ? { status: 'done', note: `${outsideTrades?.n} trade(s) from someone other than you.` }
        : { status: 'open', note: 'Nobody but you has traded here yet.' },
  };

  const items: ChecklistItem[] = SETUP_SPEC.map(d => ({
    ...d,
    status: decided[d.id].status,
    note: decided[d.id].note,
  }));

  const blocking: string[] = [];
  if (leafMetrics.length === 0) {
    blocking.push('There is no number, so there is nothing to trade.');
  } else if (withHorizon.length === 0) {
    blocking.push('The number has no horizon, so no market was created. Add customHorizons to the metric.');
  } else if (fundedBase.length === 0) {
    blocking.push(
      'Every market holds zero liquidity, so every trade against them is refused. Fund at least one: POST /api/predictions/markets/:id/liquidity { amount }.',
    );
  } else if (meaningful.length === 0) {
    blocking.push(
      `Every market is thin enough that ${SHOVE_CREDITS} credits moves its forecast by more than a fifth of the band. It will trade, and the price will mean nothing. Fund the one you actually decide on: POST /api/predictions/markets/:id/liquidity { amount }.`,
    );
  }
  if (!publicCaps.includes('trade') && ws.visibility !== 'private') {
    blocking.push(
      'The Public group cannot trade, so a visitor who joins can only watch. Grant trade on the Public group, or add participants by hand.',
    );
  }

  // The soonest open market on the floor's own number: the one the page draws.
  const drawn = [...baseMarkets].sort((a, b) => a.targetDate.localeCompare(b.targetDate))[0] ?? null;
  const market: ChecklistMarket | null = drawn
    ? {
        metricName: metricRows.find(m => m.id === drawn.metricId)?.name ?? '',
        rangeMin: drawn.rangeMin,
        rangeMax: drawn.rangeMax,
        targetDate: drawn.targetDate,
        consensus:
          (drawn.liquidity ?? 0) > 0
            ? (consensus(
                (drawn.shares ?? [0, 0]) as [number, number],
                drawn.liquidity,
                drawn.rangeMin,
                drawn.rangeMax,
              ) ?? null)
            : null,
        pool: poolCredits(drawn.liquidity ?? 0),
      }
    : null;

  return {
    workspace: { id: ws.id, name: ws.name, slug: ws.slug, visibility: ws.visibility },
    market,
    items,
    blocking,
  };
}
