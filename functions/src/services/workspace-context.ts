/**
 * The workspace brief: everything a reasoner needs to price this floor, in one
 * read (owner ask 2026-08-20).
 *
 * Two consumers, one body of facts. `POST /api/marketplace/:id/ask` feeds it to
 * Claude so a visitor can ask a question in plain language, and
 * `GET /api/marketplace/:id/context` hands the same thing to anyone else's
 * agent. That is the point: a trader who has to open six tabs to find out what
 * a company sells does not trade, and an outside agent that has to scrape a
 * page to learn the same thing prices worse than one that reads the brief.
 *
 * Nothing here is privileged. The brief obeys the same public-payload contract
 * as the rest of the marketplace surface: private workspaces are refused
 * outright, a workspace whose Public group cannot read keeps the counts-only
 * boundary, and a text source appears only when the Public group was given
 * read on it. Publishing a source is an explicit act by the owner, not a side
 * effect of this endpoint existing.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import {
  announcements,
  markets,
  metricLogs,
  metrics as metricsTable,
  permissionGroups,
  proposalMessages,
  proposals,
  sources,
  workspaces,
} from '../db/schema';
import { consensus } from '../lib/amm';
import { resolutionInstant } from '../lib/date-utils';
import { branchIsShown, horizonSettled } from '../lib/market-pairs';
import { getParticipantDisplayNames } from '../lib/participants';
import { getProposalMarketSummariesForProposal, getTradeCountMap } from './proposals';

/**
 * How much source text one brief may carry. Raised (owner direction
 * 2026-08-20: the floor's market maker "should have access to the whole data
 * room") to the point where every document a real workspace publishes fits
 * whole: LookPilot's data room is 3k characters, and 200k is a book. The cap
 * still exists, because an unbounded brief turns one question into a
 * six-figure-token request, and it truncates visibly rather than silently.
 */
const SOURCE_CHARS_EACH = 120_000;
const SOURCE_CHARS_TOTAL = 200_000;
/** Readings per metric. Enough to see a trend, not a spreadsheet. */
const HISTORY_POINTS = 24;

export interface WorkspaceContext {
  workspaceId: string;
  slug: string | null;
  name: string;
  description: string | null;
  charter: string | null;
  about: string | null;
  runningSince: string | null;
  metrics: Array<{
    name: string;
    description: string;
    value: number;
    resetsEvery: string | null;
    history: Array<{ at: string; value: number }>;
  }>;
  markets: Array<{
    marketId: string;
    metricId: string;
    /** The metric's CURRENT name, never the one frozen into the market row. */
    metricName: string;
    /** False where the market prices a metric the workspace no longer defines. */
    metricDefined: boolean;
    targetDate: string;
    /** The instant this market settles on, so a reader can order it against today. */
    resolvesOn: string | null;
    /** True once that instant has passed: the price is history, not a forecast. */
    settled: boolean;
    consensus: number | null;
    rangeMin: number;
    rangeMax: number;
    liquidity: number;
    /** How many trades made this price. Zero means it is still the seed. */
    trades: number;
  }>;
  contracts: Array<{
    id: string;
    title: string;
    description: string;
    askUsd: number | null;
    status: string;
    proposedBy: string;
    createdAt: string;
    declineReason: string | null;
    /** True while an approval would still change anything, i.e. status pending. */
    decisionOpen: boolean;
    /**
     * Priced impact per horizon: approved consensus minus declined. Live
     * horizons first, largest impact first; a voided pair appears only on a
     * contract the owner has already ruled on (lib/market-pairs.ts).
     */
    impact: Array<{
      metricId: string;
      metricName: string;
      metricDefined: boolean;
      targetDate: string;
      resolvesOn: string | null;
      settled: boolean;
      approved: number | null;
      declined: number | null;
      delta: number | null;
      /** What the floor prices for this metric and date with no contract attached. */
      baseline: number | null;
      /** Trades behind each branch's price. Zero means nobody has traded it. */
      approvedTrades: number | null;
      declinedTrades: number | null;
    }>;
    recentComments: Array<{ from: string; content: string; at: string }>;
  }>;
  announcements: Array<{ body: string; publishedAt: string }>;
  /** Published text sources: the owner's own documents about the business. */
  documents: Array<{ name: string; description: string; content: string; updatedAt: string }>;
}

/** Public workspaces only; the caller decides what to do with null. */
export async function buildWorkspaceContext(workspaceId: string): Promise<WorkspaceContext | null> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) return null;

  const [metricRows, marketRows, proposalRows, announcementRows, groupRows, sourceRows] = await Promise.all([
    db.select().from(metricsTable).where(eq(metricsTable.workspaceId, workspaceId)).orderBy(metricsTable.order),
    db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.active, true))),
    db
      .select()
      .from(proposals)
      .where(eq(proposals.workspaceId, workspaceId))
      .orderBy(desc(proposals.createdAt))
      .limit(25),
    db
      .select()
      .from(announcements)
      .where(eq(announcements.workspaceId, workspaceId))
      .orderBy(desc(announcements.publishedAt))
      .limit(5),
    db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId)),
    db.select().from(sources).where(eq(sources.workspaceId, workspaceId)),
  ]);

  // A source is in the brief only if the PUBLIC group was given read on it.
  const publicGroup = groupRows.find(g => g.type === 'public');
  const publicSourcePerms = (publicGroup?.sourcePermissions as Record<string, { read: boolean }> | null) ?? {};
  let budget = SOURCE_CHARS_TOTAL;
  const documents = sourceRows
    .filter(s => s.type === 'text' && publicSourcePerms[s.id]?.read)
    .map(s => {
      const room = Math.max(0, Math.min(SOURCE_CHARS_EACH, budget));
      const content = s.content.length > room ? `${s.content.slice(0, room)}\n[...truncated]` : s.content;
      budget -= content.length;
      return { name: s.name, description: s.description, content, updatedAt: s.updatedAt.toISOString() };
    })
    .filter(d => d.content.length > 0);

  const logRows =
    metricRows.length === 0
      ? []
      : await db
          .select()
          .from(metricLogs)
          .where(
            and(
              eq(metricLogs.workspaceId, workspaceId),
              inArray(
                metricLogs.metricId,
                metricRows.map(m => m.id),
              ),
            ),
          )
          .orderBy(desc(metricLogs.timestamp))
          .limit(metricRows.length * HISTORY_POINTS);

  const historyOf = (metricId: string) =>
    logRows
      .filter(l => l.metricId === metricId)
      .slice(0, HISTORY_POINTS)
      .reverse()
      .map(l => ({ at: l.timestamp.toISOString().slice(0, 10), value: l.value }));

  const liveProposals = proposalRows.filter(p => p.status !== 'removed');
  const names = await getParticipantDisplayNames(liveProposals.map(p => p.proposedBy));

  const commentRows =
    liveProposals.length === 0
      ? []
      : await db
          .select()
          .from(proposalMessages)
          .where(
            and(
              eq(proposalMessages.workspaceId, workspaceId),
              inArray(
                proposalMessages.proposalId,
                liveProposals.map(p => p.id),
              ),
            ),
          )
          .orderBy(desc(proposalMessages.createdAt))
          .limit(60);
  const commenterNames = await getParticipantDisplayNames(commentRows.map(c => c.from));

  // One metric is one name. A market freezes the metric's name when it spawns
  // and a resolved one keeps it forever, so a renamed metric otherwise reaches
  // a reader under every name it has ever had, reading as several metrics.
  const metricNames = new Map(metricRows.map(m => [m.id, m.name]));
  const nameOf = (metricId: string, stored: string) => metricNames.get(metricId) ?? stored;

  const openMarketRows = marketRows.filter(m => !m.proposalId && !m.voided);
  // A price nobody made is not a consensus. Without this count an untouched
  // seed sitting at mid-range reads exactly like a number the crowd argued to.
  const marketTrades = await getTradeCountMap(
    openMarketRows.map(m => m.id),
    workspaceId,
  );

  const contracts = await Promise.all(
    liveProposals.map(async p => {
      // The priced impact is the ballot's set, filtered by the ballot's rule:
      // a voided pair is the record of a decided contract and dead weight on
      // a pending one (lib/market-pairs.ts). A brief and a page quoting
      // different deltas is the failure this prevents.
      const all = await getProposalMarketSummariesForProposal(p.id, workspaceId);
      const pairs = all
        .map(pair => ({
          ...pair,
          approved: pair.approved && branchIsShown(p.status, pair.approved.voided) ? pair.approved : null,
          declined: pair.declined && branchIsShown(p.status, pair.declined.voided) ? pair.declined : null,
        }))
        .filter(pair => pair.approved || pair.declined)
        .map(pair => {
          const resolvesOn = pair.resolvesOn ?? resolutionInstant(pair.targetDate);
          const approved = pair.approved?.consensus ?? null;
          const declined = pair.declined?.consensus ?? null;
          return {
            metricId: pair.metricId,
            metricName: nameOf(pair.metricId, pair.metricName),
            metricDefined: metricNames.has(pair.metricId),
            targetDate: pair.targetDate,
            resolvesOn,
            settled: horizonSettled(resolvesOn),
            approved,
            declined,
            delta: approved !== null && declined !== null ? approved - declined : null,
            baseline: pair.baselineConsensus,
            approvedTrades: pair.approved?.tradeCount ?? null,
            declinedTrades: pair.declined?.tradeCount ?? null,
          };
        });
      // Live horizons first, biggest mover first inside each group: the reader
      // is deciding, and the top of the list is what a model reads.
      pairs.sort((a, b) => {
        if (a.settled !== b.settled) return a.settled ? 1 : -1;
        return Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0);
      });
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        askUsd: p.askUsd,
        status: p.status,
        proposedBy: names.get(p.proposedBy) ?? p.proposedBy,
        createdAt: p.createdAt.toISOString(),
        declineReason: p.declineReason,
        decisionOpen: p.status === 'pending',
        impact: pairs,
        recentComments: commentRows
          .filter(c => c.proposalId === p.id)
          .slice(0, 6)
          .reverse()
          .map(c => ({
            from: commenterNames.get(c.from) ?? c.from,
            content: c.content,
            at: c.createdAt.toISOString(),
          })),
      };
    }),
  );

  return {
    workspaceId: ws.id,
    slug: ws.slug,
    name: ws.name,
    description: ws.description,
    charter: ws.charter,
    about: ws.subjectAbout,
    runningSince: ws.telarchyStartedOn ? new Date(ws.telarchyStartedOn).toISOString().slice(0, 10) : null,
    metrics: metricRows.map(m => ({
      name: m.name,
      description: m.description,
      value: m.value,
      resetsEvery: m.resetsEvery,
      history: historyOf(m.id),
    })),
    markets: openMarketRows
      .map(m => {
        const resolvesOn = resolutionInstant(m.targetDate);
        return {
          marketId: m.id,
          metricId: m.metricId,
          metricName: nameOf(m.metricId, m.metricName),
          metricDefined: metricNames.has(m.metricId),
          targetDate: m.targetDate,
          resolvesOn,
          settled: horizonSettled(resolvesOn),
          consensus: consensus((m.shares as [number, number]) || [0, 0], m.liquidity, m.rangeMin, m.rangeMax) ?? null,
          rangeMin: m.rangeMin,
          rangeMax: m.rangeMax,
          liquidity: m.liquidity,
          trades: marketTrades.get(m.id) ?? 0,
        };
      })
      .sort((a, b) => {
        if (a.settled !== b.settled) return a.settled ? 1 : -1;
        return a.targetDate.localeCompare(b.targetDate);
      }),
    contracts,
    announcements: announcementRows.map(a => ({ body: a.body, publishedAt: a.publishedAt.toISOString() })),
    documents,
  };
}

function num(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'no price yet';
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 100) / 100);
}

/** A target date is a label; this is the sentence that lets a reader order it. */
function when(resolvesOn: string | null, settled: boolean): string {
  if (!resolvesOn) return settled ? 'Already resolved' : 'No resolution date';
  const day = resolvesOn.slice(0, 10);
  return settled ? `Already resolved on ${day}` : `Resolves ${day}`;
}

/** Zero trades is a seed, not a consensus, and it has to read as one. */
function trades(n: number | null): string {
  if (n === null) return 'No market on this branch';
  if (n === 0) return 'Nobody has traded this yet, so the number is the opening seed rather than a price';
  return `${n} trade${n === 1 ? '' : 's'} behind this price`;
}

function branchTrades(approved: number | null, declined: number | null): string {
  if ((approved ?? 0) === 0 && (declined ?? 0) === 0) {
    return 'Nobody has traded either branch yet, so this difference is the opening seed rather than a price';
  }
  return `${approved ?? 0} trade${approved === 1 ? '' : 's'} on the approved branch, ${declined ?? 0} on the declined`;
}

/**
 * Everything above the contracts: who this floor is, what it is judged on,
 * and what the crowd currently says. Both renderers open with it, because it
 * is the part that is small, slow-moving and useless to fetch piecemeal.
 */
function renderFloorHead(ctx: WorkspaceContext, out: string[]): void {
  out.push(`# ${ctx.name}`);
  if (ctx.description) out.push(ctx.description);
  if (ctx.runningSince) out.push(`Running its numbers through Telarchy since ${ctx.runningSince}.`);
  out.push('');
  out.push(
    'This is a Telarchy floor: the owner publishes the numbers they are judged on, anyone may post a contract (a job with a price), and a market prices what approving each contract would do to those numbers. Traders earn by being right.',
  );

  if (ctx.about) {
    out.push('', '## About', ctx.about);
  }
  if (ctx.charter) {
    out.push('', "## The owner's charter (what they commit to doing with the market's answer)", ctx.charter);
  }

  out.push('', '## The numbers');
  for (const m of ctx.metrics) {
    out.push('', `### ${m.name}`);
    out.push(`Current: ${num(m.value)}${m.resetsEvery ? ` (restarts every ${m.resetsEvery})` : ''}`);
    if (m.description) out.push(`Definition: ${m.description}`);
    if (m.history.length > 0) {
      out.push(`History: ${m.history.map(h => `${h.at}=${num(h.value)}`).join(', ')}`);
    }
  }

  out.push('', '## Open markets (what the crowd currently predicts)');
  if (ctx.markets.length === 0) out.push('None open.');
  for (const m of ctx.markets) {
    out.push(
      `- ${m.metricName}${m.metricDefined ? '' : ' (this metric is no longer defined on the floor)'}, ${m.targetDate}: market says ${num(m.consensus)} (range ${num(m.rangeMin)}-${num(m.rangeMax)}, liquidity ${num(m.liquidity)} credits). ${when(m.resolvesOn, m.settled)}. ${trades(m.trades)}.`,
    );
  }
}

/**
 * The same facts as prose. This is what goes to an OUTSIDE agent: markdown,
 * because that is what every model reads best, and one document rather than a
 * JSON tree, because a reader answering "is this contract worth it" should not
 * have to join three arrays first. Otto is handed renderContextIndex instead;
 * see docs/vision.md, "The workspace brief".
 */
export function renderContextMarkdown(ctx: WorkspaceContext): string {
  const out: string[] = [];
  renderFloorHead(ctx, out);

  // Two lists, because they answer two different questions. A reader looking
  // for "what should the owner approve" must not find a decided contract's
  // number at the top of it, which is exactly the mistake the one-list version
  // invited (notes/otto-brief-misread-2026-08-31.md).
  const open = ctx.contracts.filter(c => c.decisionOpen);
  const decided = ctx.contracts.filter(c => !c.decisionOpen);

  const renderContract = (c: WorkspaceContext['contracts'][number]) => {
    const ask = c.askUsd ? `$${c.askUsd}` : 'no ask';
    out.push('', `### ${c.title} (${ask}, ${c.status}, by ${c.proposedBy})`);
    if (!c.decisionOpen) {
      out.push(
        `This contract was already ${c.status}, so no approval decision is left on it: the prices below are the record of what the market said when the owner ruled.`,
      );
    }
    if (c.description) out.push(c.description);
    for (const i of c.impact) {
      const name = `${i.metricName}${i.metricDefined ? '' : ' (this metric is no longer defined on the floor)'}`;
      const baseline = i.baseline === null ? '' : ` Without this contract the floor prices ${num(i.baseline)}.`;
      out.push(
        `Priced impact on ${name} ${i.targetDate}: if approved ${num(i.approved)}, if declined ${num(i.declined)}, difference ${i.delta === null ? 'not priced yet' : num(i.delta)}. ${when(i.resolvesOn, i.settled)}.${baseline} ${branchTrades(i.approvedTrades, i.declinedTrades)}.`,
      );
    }
    if (c.impact.length === 0) out.push('No market prices this contract yet.');
    if (c.declineReason) out.push(`Declined because: ${c.declineReason}`);
    for (const m of c.recentComments) out.push(`Comment from ${m.from}: ${m.content}`);
  };

  out.push('', '## Contracts open for a decision');
  out.push(
    'These are the only contracts an approval still moves. The difference is what the market says approving would do to the number, against declining it.',
  );
  if (open.length === 0) out.push('None: every contract here has been decided.');
  for (const c of open) renderContract(c);

  out.push('', '## Contracts already decided');
  out.push('The owner has ruled on these. Their prices are history, not an upside anyone can still take.');
  if (decided.length === 0) out.push('None yet.');
  for (const c of decided) renderContract(c);

  renderFloorTail(ctx, out);
  return out.join('\n');
}

/**
 * What the owner said, in their own words: announcements and the documents
 * they published. Both renderers carry it whole. It is the part of a floor
 * that exists nowhere else, so making it a fetch would trade the one thing
 * only this workspace can tell him for a round trip.
 */
function renderFloorTail(ctx: WorkspaceContext, out: string[]): void {
  if (ctx.announcements.length > 0) {
    out.push('', '## Announcements (newest first)');
    for (const a of ctx.announcements) out.push('', `**${a.publishedAt.slice(0, 10)}**`, a.body);
  }

  for (const d of ctx.documents) {
    out.push('', `## ${d.name}${d.description ? ` (${d.description})` : ''}`);
    out.push(`Published by the owner, last updated ${d.updatedAt.slice(0, 10)}.`);
    out.push('', d.content);
  }
}

/**
 * What Otto is handed as fixed context: the floor itself in full, and its
 * contracts as a LIST rather than a priced matrix.
 *
 * A reasoner given every number already flattened onto one page answers from
 * the page. That is measured, not assumed: on 2026-08-31 the answer that got
 * four things wrong was produced with zero tool calls, and five of the
 * previous thirty answers used any tool at all
 * (notes/otto-brief-misread-2026-08-31.md). Removing the prices from what he
 * is handed is what turns "which contract is worth approving" from a question
 * he can answer by scanning into one he has to go and price.
 *
 * The endpoints are named here rather than left to `find_endpoint`, because
 * an assistant that has to search for where the numbers live will decide it
 * already knows where they are.
 */
export function renderContextIndex(ctx: WorkspaceContext): string {
  const out: string[] = [];
  renderFloorHead(ctx, out);

  const ref = ctx.slug ?? ctx.workspaceId;
  const open = ctx.contracts.filter(c => c.decisionOpen);
  const decided = ctx.contracts.filter(c => !c.decisionOpen);
  const line = (c: WorkspaceContext['contracts'][number]) =>
    `- ${c.title} (${c.askUsd ? `$${c.askUsd}` : 'no ask'}, ${c.status}, by ${c.proposedBy}, id ${c.id})`;

  out.push('', '## Contracts');
  out.push(
    'Titles only. No price of a contract is in front of you, deliberately: the market moves and this list does not, so a number you quote from memory is a number you made up. Go and read it.',
  );
  out.push('', `### Open for a decision (${open.length})`);
  if (open.length === 0) out.push('None: every contract here has been decided.');
  for (const c of open) out.push(line(c));
  out.push('', `### Already decided (${decided.length})`);
  if (decided.length === 0) out.push('None yet.');
  for (const c of decided) out.push(line(c));

  out.push('', '### Where the numbers are');
  out.push(
    `- GET /api/marketplace/${ref}/contracts - EVERY contract with its live priced impact, per metric and date, with the baseline and the trades behind each branch. One call, and it fits: start here for "what is worth approving" and do not open contracts one at a time afterwards. Add ?horizons=all for horizons that have already resolved.`,
  );
  out.push(
    '- GET /api/proposals/<id> - one contract in full, when you need its pitch or its conversation rather than its price.',
  );
  out.push(
    `- GET /api/marketplace/${ref}/context - the whole brief, every contract priced, when you genuinely want all of it at once.`,
  );
  out.push(
    'Each of those states, per horizon, when it resolves and whether that has passed, how many trades made the price, and what the floor prices without the contract. Read those before you compare two numbers: a settled horizon, an untraded seed and a live price look identical if you only read the difference.',
  );

  renderFloorTail(ctx, out);
  return out.join('\n');
}
