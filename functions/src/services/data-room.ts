import { and, asc, count, eq, gte, isNull, like, ne, sql } from 'drizzle-orm';
import { CHANGE_DAYS, CHANGELOG_BUILT_AT, CHANGES, TOTAL_CHANGES } from '../content/changelog';
import { type BlockName, CONTENT_UPDATED_AT, DATA_ROOM_MARKDOWN, KNOWN_BLOCKS } from '../content/data-room';
import { db } from '../db/client';
import {
  agents,
  authUser,
  markets,
  metricLogs,
  metrics,
  pageVisits,
  proposals,
  systemConfig,
  trades,
  trafficDaily,
  workspaces,
} from '../db/schema';
import { consensus } from '../lib/amm';
import { resolutionInstant } from '../lib/date-utils';
import { ttlCache } from '../lib/ttl-cache';
import { humanVisitFilter } from '../lib/visit-log';
import { platformStats } from './platform-stats';

/**
 * The data room: Telarchy's own books, prose and numbers in one payload.
 *
 * Spec: docs/data-room.md. Everything here is computed at request time from
 * the tables the product runs on, because an export step is a second pipeline
 * and a second pipeline is a thing that can quietly stop. The one exception is
 * the change log, which is generated from git at deploy time and dated.
 *
 * Two callers share it, which is why it is a service rather than a route body:
 * `GET /api/data-room`, which the page renders, and Otto, who opens sections of
 * it on his own when a visitor asks something the floor's brief cannot answer.
 */

/** The workspace whose floor this page is the evidence for. */
const SELF_SLUG = 'telarchy';

/** How long one computed feed is served to everybody. A data room is read by
 *  strangers arriving in bursts, and none of these numbers move in a minute. */
const CACHE_MS = 60_000;

export interface DataRoomSection {
  id: string;
  title: string;
  /** The prose, verbatim, with the block directives removed. */
  markdown: string;
  /** Which blocks belong to this section, in source order. */
  blocks: BlockName[];
}

/**
 * Split the content module into sections on `## ` headings and pull out the
 * `block:name` directives.
 *
 * An unknown block name throws, at module load, rather than rendering an empty
 * space on a public page: this is the check that keeps a renamed block from
 * silently deleting a number from the document.
 */
export function parseDataRoomContent(markdown: string): DataRoomSection[] {
  const parts = markdown.split(/^## /m).filter(p => p.trim());
  const sections = parts.map(part => {
    const nl = part.indexOf('\n');
    const title = (nl < 0 ? part : part.slice(0, nl)).trim();
    const body = nl < 0 ? '' : part.slice(nl + 1);
    const blocks: BlockName[] = [];
    for (const m of body.matchAll(/^block:([a-z]+)$/gm)) {
      const name = m[1];
      if (!(KNOWN_BLOCKS as readonly string[]).includes(name)) {
        throw new Error(
          `data room: section "${title}" names unknown block "${name}". ` + `Known blocks: ${KNOWN_BLOCKS.join(', ')}`,
        );
      }
      blocks.push(name as BlockName);
    }
    return {
      id: title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      title,
      markdown: body
        .replace(/^block:[a-z]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      blocks,
    };
  });
  if (!sections.length) throw new Error('data room: content has no "## " sections');
  return sections;
}

/** Parsed once, at boot, so a bad directive fails the deploy gate rather than
 *  a visitor's page load. */
const SECTIONS = parseDataRoomContent(DATA_ROOM_MARKDOWN);

/**
 * Roll yesterday and the days still in the visit log into `traffic_daily`.
 *
 * The visit log is purged at thirty days by the privacy policy, so without
 * this the published history would be a sliding window forever. The rollup
 * carries two counts and a date, nothing else, which is what makes keeping it
 * indefinitely compatible with deleting the rows it came from.
 *
 * It runs on read rather than on a schedule: a cron that stops is a history
 * with a hole in it, and this is cheap and idempotent.
 */
export async function rollUpTraffic(): Promise<void> {
  const rows = await db
    .select({
      day: sql<string>`to_char(${pageVisits.ts}, 'YYYY-MM-DD')`,
      visits: sql<number>`count(*)::int`,
      uniques: sql<number>`count(distinct ${pageVisits.ip})::int`,
    })
    .from(pageVisits)
    .where(humanVisitFilter())
    .groupBy(sql`1`);

  for (const r of rows) {
    await db
      .insert(trafficDaily)
      .values({ day: r.day, visits: Number(r.visits), uniques: Number(r.uniques) })
      // A day already rolled up can only grow while it is still in the log,
      // and once the rows are purged the stored count is the record.
      .onConflictDoUpdate({
        target: trafficDaily.day,
        set: {
          visits: sql`greatest(${trafficDaily.visits}, excluded.visits)`,
          uniques: sql`greatest(${trafficDaily.uniques}, excluded.uniques)`,
        },
      });
  }
}

/** The floor this page is the evidence for: its market, its price, and the
 *  readings the market settles against. Null when the workspace is missing,
 *  which is what a self-hosted instance without it looks like. */
async function selfFloor() {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, SELF_SLUG)).limit(1);
  if (!ws) return null;

  const open = await db
    .select()
    .from(markets)
    .where(
      and(
        eq(markets.workspaceId, ws.id),
        eq(markets.resolved, false),
        eq(markets.active, true),
        isNull(markets.proposalId), // the baseline market, not a contract's branch
      ),
    )
    .orderBy(asc(markets.targetDate));
  const m = open[0];
  if (!m) return { workspaceId: ws.id, name: ws.name, slug: ws.slug, market: null };

  const [metric] = await db
    .select()
    .from(metrics)
    .where(and(eq(metrics.workspaceId, ws.id), eq(metrics.id, m.metricId)))
    .limit(1);

  const logs = await db
    .select({ at: metricLogs.timestamp, value: metricLogs.value })
    .from(metricLogs)
    .where(and(eq(metricLogs.workspaceId, ws.id), eq(metricLogs.metricId, m.metricId)))
    .orderBy(asc(metricLogs.timestamp))
    .limit(400);

  return {
    workspaceId: ws.id,
    name: ws.name,
    slug: ws.slug,
    market: {
      metricName: m.metricName,
      metricDescription: metric?.description ?? null,
      /** The market's call. Undefined from the AMM means it cannot be priced,
       *  which is published as null rather than as a number. */
      // consensus() takes the LMSR sensitivity b, not the pool. Handing it the
      // pool made the books quote a different call than the floor did for the
      // same market, by exactly the ln 2 between them (2026-08-30).
      consensus: consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax) ?? null,
      currentValue: metric ? metric.value : null,
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      targetDate: m.targetDate,
      resolvesOn: resolutionInstant(m.targetDate),
      // The credit figure is the pool; b is derived from it and belongs to the
      // price maths, not to a books line that says "cr".
      pool: m.pool,
      tradedVolume: m.tradedVolume,
      history: logs.map(l => ({ at: l.at.toISOString(), value: l.value })),
    },
  };
}

/** Everything that has happened on the platform, counted. */
async function traction() {
  const [participants] = await db.select({ n: count() }).from(agents);
  const [accounts] = await db.select({ n: count() }).from(authUser);
  const [verified] = await db
    .select({ n: count() })
    .from(systemConfig)
    .where(like(systemConfig.key, 'manifold-claimed:agent:%'));
  const [tradeRow] = await db
    .select({
      n: count(),
      credits: sql<number>`coalesce(sum(abs(${trades.cost})), 0)::float`,
    })
    .from(trades);
  const [openMarkets] = await db
    .select({ n: count() })
    .from(markets)
    .where(and(eq(markets.resolved, false), eq(markets.active, true)));
  const [settled] = await db.select({ n: count() }).from(markets).where(eq(markets.resolved, true));
  const [floors] = await db.select({ n: count() }).from(workspaces).where(eq(workspaces.visibility, 'public'));

  const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  const signupsByDay = await db
    .select({
      day: sql<string>`to_char(${authUser.createdAt}, 'YYYY-MM-DD')`,
      signups: sql<number>`count(*)::int`,
    })
    .from(authUser)
    .where(gte(authUser.createdAt, twoMonthsAgo))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return {
    participants: Number(participants.n),
    accounts: Number(accounts.n),
    verifiedParticipants: Number(verified.n),
    trades: Number(tradeRow.n),
    creditsTraded: Math.round(Number(tradeRow.credits)),
    openMarkets: Number(openMarkets.n),
    settledMarkets: Number(settled.n),
    publicFloors: Number(floors.n),
    signupsByDay: signupsByDay.map(r => ({ day: r.day, signups: Number(r.signups) })),
  };
}

/** The jobs side of every public floor: what was proposed, what was decided,
 *  and what the approvals cost in real money. */
async function contracts() {
  const rows = await db
    .select({ status: proposals.status, n: count(), ask: sql<number>`coalesce(sum(${proposals.askUsd}), 0)::float` })
    .from(proposals)
    // 'removed' is the admin taking an entry off the board because it should
    // never have been on it (spam, duplicates, test rows). It is not a
    // decision and counting it would leave a published total that its own
    // rows do not add up to.
    .where(ne(proposals.status, 'removed'))
    .groupBy(proposals.status);
  const by = (s: string) => Number(rows.find(r => r.status === s)?.n ?? 0);
  const approvedAsk = Number(rows.find(r => r.status === 'approved')?.ask ?? 0);
  return {
    proposed: rows.reduce((a, r) => a + Number(r.n), 0),
    approved: by('approved'),
    declined: by('declined') + by('declined_spam'),
    pending: by('pending'),
    withdrawn: by('withdrawn'),
    /** USD the owner has committed by approving. The ask is what the proposer
     *  named, and approval is the promise to pay it. */
    approvedUsd: Math.round(approvedAsk),
  };
}

/** Visits and unique addresses per day, from the rollup, plus the last day and
 *  week off the live log so the newest bar is not a day behind. */
async function traffic() {
  await rollUpTraffic();

  const days = await db.select().from(trafficDaily).orderBy(asc(trafficDaily.day));
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const since = (from: Date) =>
    db
      .select({
        visits: sql<number>`count(*)::int`,
        uniques: sql<number>`count(distinct ${pageVisits.ip})::int`,
      })
      .from(pageVisits)
      .where(and(gte(pageVisits.ts, from), humanVisitFilter()));

  const [last24h] = await since(dayAgo);
  const [last7d] = await since(weekAgo);

  return {
    /** The whole kept history, oldest first. */
    byDay: days.map(d => ({ day: d.day, visits: d.visits, uniques: d.uniques })),
    /** The day the rollup started, so the page never implies it has more
     *  history than it does. */
    keptSince: days[0]?.day ?? null,
    visits24h: Number(last24h?.visits ?? 0),
    uniques24h: Number(last24h?.uniques ?? 0),
    visits7d: Number(last7d?.visits ?? 0),
    uniques7d: Number(last7d?.uniques ?? 0),
    totalVisits: days.reduce((a, d) => a + d.visits, 0),
  };
}

const feedCache = ttlCache({
  ttlMs: CACHE_MS,
  keyOf: () => 'feed',
  load: () => computeDataRoomFeed(),
});

/** Drop the cached feed. Tests call it; nothing in production does. */
export function clearDataRoomCache(): void {
  feedCache.clear();
}

/**
 * The whole feed, cached briefly.
 *
 * A data room is read by strangers arriving in bursts, and none of these
 * numbers move inside a minute, so one computation serves everybody who shows
 * up in that window. Otto reads the same cached object, which is also what
 * keeps his answers and the page from quoting different numbers.
 */
export function buildDataRoomFeed(): Promise<DataRoomFeed> {
  return feedCache.get();
}

async function computeDataRoomFeed(): Promise<DataRoomFeed> {
  const [stats, floor, tract, contractRows, traf] = await Promise.all([
    platformStats(),
    selfFloor(),
    traction(),
    contracts(),
    traffic(),
  ]);

  const body: DataRoomFeed = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    doc: { updatedAt: CONTENT_UPDATED_AT, sections: SECTIONS },
    evidence: {
      pulse: {
        weeklyActiveVerifiedTraders: stats.weeklyActiveVerifiedTraders,
        participants: stats.agentsActive,
        openMarkets: stats.marketsActive,
        tradesThisWeek: stats.tradesThisWeek,
        // The route the weekly pulse resolves against, published beside the
        // number so a reader can check it without trusting this page.
        source: '/api/marketplace/stats',
      },
      market: floor,
      traction: tract,
      contracts: contractRows,
      traffic: traf,
      shipping: {
        days: CHANGE_DAYS,
        changes: CHANGES,
        total: TOTAL_CHANGES,
        // The deploy that generated the log. Older than the feed's own
        // timestamp by design: git is read at build time, not at read time.
        builtAt: CHANGELOG_BUILT_AT,
      },
    },
  };

  return body;
}

export interface DataRoomFeed {
  schema: number;
  generatedAt: string;
  doc: { updatedAt: string; sections: DataRoomSection[] };
  evidence: Record<string, unknown> & {
    shipping: {
      changes: Array<{ date: string; subject: string }>;
      total: number;
      builtAt: string;
      days: Array<{ date: string; changes: number }>;
    };
  };
}

/**
 * How Otto reads this (owner direction 2026-08-20: "he should be able to
 * browse it itself, not force fed the context").
 *
 * The floor's brief is Otto's fixed context and stays that way: it is
 * identical for every visitor on a floor, so it is the prefix an upstream
 * cache hits, and stuffing the whole data room into it would cost every
 * visitor tokens for a document almost none of them ask about. Instead he
 * gets a door: an index first, then one section at a time, on his own
 * initiative. Same feed the page renders, same cache, so he cannot quote a
 * number the page does not show.
 */
function fmt(v: unknown): string {
  if (v === null || v === undefined) return 'not published';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : String(Math.round(v * 100) / 100);
  return String(v);
}

/** One evidence block as lines Otto can quote, rather than as raw JSON. */
function renderBlock(name: string, feed: DataRoomFeed): string {
  const e = feed.evidence as Record<string, any>;
  const v = e[name];
  if (!v) return `${name}: not published`;

  if (name === 'market') {
    const m = v.market;
    if (!m) return 'market: no open market on the Telarchy floor right now';
    return [
      `market: ${m.metricName}`,
      `  the market's call: ${fmt(m.consensus)}`,
      `  the metric now reads: ${fmt(m.currentValue)}`,
      `  band ${fmt(m.rangeMin)} to ${fmt(m.rangeMax)}, settles ${m.resolvesOn}`,
      `  pool ${fmt(m.pool)} cr, traded volume ${fmt(m.tradedVolume)} cr`,
      `  readings: ${
        (m.history || [])
          .slice(-12)
          .map((p: any) => `${String(p.at).slice(0, 10)}=${fmt(p.value)}`)
          .join(', ') || 'none'
      }`,
    ].join('\n');
  }

  if (name === 'shipping') {
    const recent = v.changes
      .slice(0, 15)
      .map((c: any) => `  ${c.date}: ${c.subject}`)
      .join('\n');
    return [
      `shipping: ${fmt(v.total)} changes over ${v.days.length} days, log generated ${v.builtAt}`,
      `  newest changes:`,
      recent,
    ].join('\n');
  }

  if (name === 'traffic') {
    const tail = v.byDay
      .slice(-14)
      .map((d: any) => `  ${d.day}: ${d.visits} visits, ${d.uniques} distinct`)
      .join('\n');
    return [
      `traffic: ${fmt(v.visits24h)} visits and ${fmt(v.uniques24h)} distinct visitors in 24h, ` +
        `${fmt(v.visits7d)} visits in 7 days, ${fmt(v.totalVisits)} since ${fmt(v.keptSince)}`,
      tail,
    ].join('\n');
  }

  const entries = Object.entries(v)
    .filter(([, val]) => typeof val !== 'object' || val === null)
    .map(([k, val]) => `  ${k}: ${fmt(val)}`);
  return [`${name}:`, ...entries].join('\n');
}

/** The table of contents: what is in the data room, so Otto can pick. */
export function renderDataRoomIndex(feed: DataRoomFeed): string {
  const lines = feed.doc.sections.map(
    s => `- ${s.id}${s.blocks.length ? ` (figures: ${s.blocks.join(', ')})` : ''}: ${s.title}`,
  );
  return [
    `Telarchy's data room, telarchy.com/data-room, figures generated ${feed.generatedAt}.`,
    'Sections, readable one at a time with read_data_room({ section }):',
    ...lines,
  ].join('\n');
}

/** One section: its prose exactly as published, then its figures. */
export function renderDataRoomSection(feed: DataRoomFeed, id: string): string {
  const section = feed.doc.sections.find(s => s.id === id.trim().toLowerCase());
  if (!section) {
    return `No section "${id}". Sections: ${feed.doc.sections.map(s => s.id).join(', ')}`;
  }
  const blocks = section.blocks.map(b => renderBlock(b, feed));
  return [`## ${section.title}`, section.markdown, ...blocks].join('\n\n');
}

/**
 * The tool Otto is handed on every floor. No arguments reads the index; a
 * section id reads that section. Two rounds get him from "what is Telarchy"
 * to the actual numbers, and a visitor who never asks pays nothing for it.
 */
export function dataRoomTool() {
  return {
    spec: {
      type: 'function' as const,
      function: {
        name: 'read_data_room',
        description:
          "Open Telarchy's own data room (telarchy.com/data-room): what Telarchy is for, the " +
          'market it runs on itself, its traction, its traffic, what has shipped, its plans and ' +
          'its risks. Call with no arguments for the list of sections, then again with a section ' +
          'id to read one. Use it whenever a visitor asks about Telarchy the platform rather than ' +
          'about the company whose floor you are standing on.',
        parameters: {
          type: 'object',
          properties: {
            section: {
              type: 'string',
              description: 'A section id from the index. Omit to get the index.',
            },
          },
        },
      },
    },
    async run(args: { section?: string }): Promise<string> {
      const feed = await buildDataRoomFeed();
      return args?.section ? renderDataRoomSection(feed, args.section) : renderDataRoomIndex(feed);
    },
  };
}
