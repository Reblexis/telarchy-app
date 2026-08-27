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
import { getParticipantDisplayNames } from '../lib/participants';
import { getProposalMarketSummariesForProposal } from './proposals';

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
    /** Null is an explicit N/A reading. */
    value: number | null;
    resetsEvery: string | null;
    history: Array<{ at: string; value: number | null }>;
  }>;
  markets: Array<{
    marketId: string;
    metricName: string;
    targetDate: string;
    consensus: number | null;
    rangeMin: number;
    rangeMax: number;
    liquidity: number;
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
    /** Priced impact per horizon: approved consensus minus declined. */
    impact: Array<{
      metricName: string;
      targetDate: string;
      approved: number | null;
      declined: number | null;
      delta: number | null;
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

  const contracts = await Promise.all(
    liveProposals.map(async p => {
      // The priced impact comes from the same function the floor's own ballot
      // reads, so a brief and a page can never quote different deltas.
      const pairs = await getProposalMarketSummariesForProposal(p.id, workspaceId);
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        askUsd: p.askUsd,
        status: p.status,
        proposedBy: names.get(p.proposedBy) ?? p.proposedBy,
        createdAt: p.createdAt.toISOString(),
        declineReason: p.declineReason,
        impact: pairs.map(pair => ({
          metricName: pair.metricName,
          targetDate: pair.targetDate,
          approved: pair.approved?.consensus ?? null,
          declined: pair.declined?.consensus ?? null,
          delta: pair.delta,
        })),
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
    markets: marketRows
      .filter(m => !m.proposalId && !m.voided)
      .map(m => ({
        marketId: m.id,
        metricName: m.metricName,
        targetDate: m.targetDate,
        consensus: consensus((m.shares as [number, number]) || [0, 0], m.liquidity, m.rangeMin, m.rangeMax) ?? null,
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
        liquidity: m.liquidity,
      }))
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate)),
    contracts,
    announcements: announcementRows.map(a => ({ body: a.body, publishedAt: a.publishedAt.toISOString() })),
    documents,
  };
}

function num(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'no price yet';
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 100) / 100);
}

/**
 * The same facts as prose. This is what goes to a model (ours or someone
 * else's): markdown, because that is what every model reads best, and one
 * document rather than a JSON tree, because a reader answering "is this
 * contract worth it" should not have to join three arrays first.
 */
export function renderContextMarkdown(ctx: WorkspaceContext): string {
  const out: string[] = [];
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
    out.push(
      `Current: ${m.value === null ? 'N/A (no reading exists)' : num(m.value)}${m.resetsEvery ? ` (restarts every ${m.resetsEvery})` : ''}`,
    );
    if (m.description) out.push(`Definition: ${m.description}`);
    if (m.history.length > 0) {
      out.push(`History: ${m.history.map(h => `${h.at}=${num(h.value)}`).join(', ')}`);
    }
  }

  out.push('', '## Open markets (what the crowd currently predicts)');
  if (ctx.markets.length === 0) out.push('None open.');
  for (const m of ctx.markets) {
    out.push(
      `- ${m.metricName}, ${m.targetDate}: market says ${num(m.consensus)} (range ${num(m.rangeMin)}-${num(m.rangeMax)}, liquidity ${num(m.liquidity)} credits)`,
    );
  }

  out.push('', '## Contracts');
  if (ctx.contracts.length === 0) out.push('None yet.');
  for (const c of ctx.contracts) {
    const ask = c.askUsd ? `$${c.askUsd}` : 'no ask';
    out.push('', `### ${c.title} (${ask}, ${c.status}, by ${c.proposedBy})`);
    if (c.description) out.push(c.description);
    for (const i of c.impact) {
      out.push(
        `Priced impact on ${i.metricName} ${i.targetDate}: if approved ${num(i.approved)}, if declined ${num(i.declined)}, difference ${i.delta === null ? 'not priced yet' : num(i.delta)}.`,
      );
    }
    if (c.declineReason) out.push(`Declined because: ${c.declineReason}`);
    for (const m of c.recentComments) out.push(`Comment from ${m.from}: ${m.content}`);
  }

  if (ctx.announcements.length > 0) {
    out.push('', '## Announcements (newest first)');
    for (const a of ctx.announcements) out.push('', `**${a.publishedAt.slice(0, 10)}**`, a.body);
  }

  for (const d of ctx.documents) {
    out.push('', `## ${d.name}${d.description ? ` (${d.description})` : ''}`);
    out.push(`Published by the owner, last updated ${d.updatedAt.slice(0, 10)}.`);
    out.push('', d.content);
  }

  return out.join('\n');
}
