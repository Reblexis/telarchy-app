import { and, asc, count, eq, gte, ne, sql } from 'drizzle-orm';
import { CHANGE_DAYS, CHANGELOG_BUILT_AT, CHANGES, TOTAL_CHANGES } from '../content/changelog';
import { type BlockName, CONTENT_UPDATED_AT, DATA_ROOM_MARKDOWN, KNOWN_BLOCKS, KNOWN_PARTS } from '../content/data-room';
import { db } from '../db/client';
import { agents, authUser, markets, pageVisits, proposals, trades, trafficDaily, workspaces } from '../db/schema';
import { ttlCache } from '../lib/ttl-cache';
import { humanVisitFilter } from '../lib/visit-log';
import { buildBaseRates } from './base-rates';
import { buildCalendar } from './calendar';
import { buildFloorEvents } from './floor-events';
import { paidManifoldLinkCount, platformStats } from './platform-stats';
import { buildTraderWindow } from './trader-window';
import { buildTradingByDay } from './trading-by-day';

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

/** How long one computed feed is served to everybody. A data room is read by
 *  strangers arriving in bursts, and none of these numbers move in a minute. */
const CACHE_MS = 60_000;

export interface DataRoomSection {
  id: string;
  title: string;
  /** Which part of the page it belongs to (docs/data-room.md, "One page,
   *  three parts"), or null on a section that names none. */
  part: string | null;
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
  const chunks = markdown.split(/^## /m).filter(c => c.trim());
  const sections = chunks.map(chunk => {
    const nl = chunk.indexOf('\n');
    const title = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    const body = nl < 0 ? '' : chunk.slice(nl + 1);
    // Which part of the page this section is in. Same shape as `block:`, and
    // the same rule: an unknown name is a mistake that must be loud rather
    // than a section that quietly falls out of the index.
    let part: string | null = null;
    for (const m of body.matchAll(/^part:([a-z-]+)$/gm)) {
      if (!(KNOWN_PARTS as readonly { id: string }[]).some(p => p.id === m[1])) {
        throw new Error(
          `data room: section "${title}" names unknown part "${m[1]}". ` +
            `Known parts: ${KNOWN_PARTS.map(p => p.id).join(', ')}`,
        );
      }
      part = m[1];
    }
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
      part,
      markdown: body
        .replace(/^(?:block|part):[a-z-]+$/gm, '')
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

/**
 * The chain that ends in the floor's metric: a page load, an account, a
 * Manifold profile claimed, a hundred credits traded in seven days.
 *
 * This replaces `selfFloor`, which published the floor's own call, the reading
 * it settles against and its settle date. That block was the page's stated
 * rule ("nothing restates what the market currently forecasts") being broken
 * inside the document the rule governs, and a reader arriving from the floor
 * already had every number in it. See docs/data-room.md.
 *
 * Every count is one the feed already carries, passed in rather than queried
 * again: a funnel that computes its own totals is a second pipeline, and a
 * second pipeline is a thing that can disagree with the page beside it.
 *
 * `shareOfAbove` is of the step above, so the first step has none. A step
 * whose predecessor is zero refuses rather than dividing, because 0/0 on a
 * public page is worse than an absent figure.
 */
function funnel(counts: { loads: number; accounts: number; verified: number; weeklyActive: number }) {
  const steps: Array<{ id: string; n: number; shareOfAbove: number | null }> = [
    { id: 'loads', n: counts.loads, shareOfAbove: null },
    { id: 'accounts', n: counts.accounts, shareOfAbove: null },
    { id: 'verified', n: counts.verified, shareOfAbove: null },
    { id: 'weeklyActive', n: counts.weeklyActive, shareOfAbove: null },
  ];
  for (let i = 1; i < steps.length; i++) {
    const above = steps[i - 1].n;
    steps[i].shareOfAbove = above > 0 ? steps[i].n / above : null;
  }
  return {
    steps,
    /** Loads count what the visit rollup holds, and accounts predate it, so
     *  the first conversion is not a cohort. The page says so where it shows. */
    loadsSince: null as string | null,
  };
}

/** Everything that has happened on the platform, counted. */
async function traction() {
  const [participants] = await db.select({ n: count() }).from(agents);
  const [accounts] = await db.select({ n: count() }).from(authUser);
  // The verified set has one definition, in platform-stats.ts: participants
  // whose Manifold record was PAID for. A free badge is not evidence.
  const verifiedCount = await paidManifoldLinkCount();
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
    verifiedParticipants: verifiedCount,
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
  const [stats, tract, contractRows, traf, windowRows, rates, calendar, events, trading] = await Promise.all([
    platformStats(),
    traction(),
    contracts(),
    traffic(),
    buildTraderWindow(),
    buildBaseRates(),
    buildCalendar(),
    process.env.SELF_SYNC_WORKSPACE_ID ? buildFloorEvents(process.env.SELF_SYNC_WORKSPACE_ID) : Promise.resolve([]),
    buildTradingByDay(),
  ]);
  const chain = funnel({
    loads: traf.totalVisits,
    accounts: tract.accounts,
    verified: tract.verifiedParticipants,
    weeklyActive: stats.weeklyActiveVerifiedTraders,
  });
  chain.loadsSince = traf.keptSince ?? null;

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
      funnel: chain,
      // The rows behind the next reading, not a count of them
      // (docs/data-room.md, "The window is the rows behind the next reading").
      window: windowRows,
      // Every weekly reading, so "how far does it normally move" is a number
      // rather than a shape (docs/data-room.md, "The base rates").
      rates,
      // The dates already committed, so a forecaster can see the owner's
      // calendar (docs/data-room.md, "What is scheduled").
      calendar,
      events,
      // How busy the place is, day by day: the shape under the trader count
      // (docs/data-room.md, "How the page draws things").
      trading,
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

  if (name === 'funnel') {
    const label: Record<string, string> = {
      loads: 'page loads',
      accounts: 'accounts',
      verified: 'verified on Manifold',
      weeklyActive: 'traded 100+ credits in the last 7 days',
    };
    return [
      `funnel${v.loadsSince ? ` (loads counted from ${v.loadsSince})` : ''}:`,
      ...v.steps.map(
        (st: any) =>
          `  ${label[st.id] ?? st.id}: ${fmt(st.n)}` +
          (st.shareOfAbove === null ? '' : ` (${(st.shareOfAbove * 100).toFixed(1)}% of the step above)`),
      ),
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

  if (name === 'window') {
    const overTraders = v.traders.spend.filter((x: number) => x >= v.traders.threshold).length;
    const near = v.traders.spend.filter((x: number) => x > 0 && x < v.traders.threshold);
    const overProfit = v.forecasters.profit.filter((x: number) => x >= v.forecasters.threshold).length;
    return [
      'window (the rows that already determine part of the next reading):',
      `  traded this week, per verified participant, high to low: ${v.traders.spend.map(fmt).join(', ') || 'none'}`,
      `  at or above ${fmt(v.traders.threshold)} credits, so counted today: ${fmt(overTraders)}`,
      `  under it but not at zero: ${near.length ? near.map(fmt).join(', ') : 'none'}`,
      `  the day each counted trader falls out of their week: ${v.traders.lapses.join(', ') || 'none'}`,
      `  marked profit, per participant, high to low: ${v.forecasters.profit.map(fmt).join(', ') || 'none'}`,
      `  at or above ${fmt(v.forecasters.threshold)} credits: ${fmt(overProfit)}`,
      '  undecided proposals on outside floors:',
      ...(v.owners.pending.length
        ? v.owners.pending.map(
            (r: any) => `    ${r.slug}: ${r.title}${r.decideBy ? ` (decides by ${r.decideBy})` : ''}`,
          )
        : ['    none']),
      '  payments on the revenue rail in the last 30 days:',
      ...(v.revenue.payments.length
        ? v.revenue.payments.map((p: any) => `    ${p.at}: $${fmt(p.usd)}, ${p.status}`)
        : ['    none']),
    ].join('\n');
  }

  if (name === 'rates') {
    if (!v.metrics.length) return 'rates: nothing recorded yet';
    return [
      `rates (the reading at the end of each of the last eight weeks, oldest first, weeks ending ${v.weeks[0]} to ${v.weeks[v.weeks.length - 1]}):`,
      ...v.metrics.map(
        (m: any) =>
          `  ${m.name}: ${m.readings.map((r: number | null) => (r === null ? 'not read' : fmt(r))).join(', ')}`,
      ),
    ].join('\n');
  }

  if (name === 'events') {
    return v.length
      ? [
          'What moved it (dated context, not proof of causation):',
          ...[...v]
            .sort((a: any, b: any) => a.at.localeCompare(b.at))
            .map((e: any) => `  ${e.at.slice(0, 10)}: ${e.label} (${e.kind})`),
        ].join('\n')
      : 'No events recorded yet.';
  }

  if (name === 'calendar') {
    const stageCounts = new Map<string, number>();
    for (const st of v.outreach.stages) stageCounts.set(st, (stageCounts.get(st) ?? 0) + 1);
    return [
      'calendar (what is already committed, soonest first):',
      ...(v.dates.length
        ? v.dates.map((d: any) => `  ${d.at.slice(0, 10)}: ${d.label} (${d.kind})`)
        : ['  nothing scheduled']),
      `  outreach list, by stage: ${
        stageCounts.size ? [...stageCounts.entries()].map(([st, n]) => `${st} ${n}`).join(', ') : 'nobody on it'
      }`,
    ].join('\n');
  }

  if (name === 'trading') {
    if (!v.byDay.length) return 'trading: nothing traded yet';
    const tail = v.byDay
      .slice(-14)
      .map((d: any) => `  ${d.day}: ${fmt(d.trades)} trades, ${fmt(d.credits)} credits, ${fmt(d.traders)} people`)
      .join('\n');
    return [`trading, day by day (last 14 of ${v.byDay.length} days with any):`, tail].join('\n');
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

/**
 * The whole document as one text: every section's prose followed by its
 * figures.
 *
 * This is what an outside agent gets handed in the brief for Telarchy's own
 * floor (`GET /api/marketplace/:id/context`). Otto is deliberately NOT given
 * it that way: his brief is the fixed prefix of every question on every
 * floor, so it stays a tool he opens on his own initiative. An agent reading
 * the brief makes one request and then has to price the number, which is the
 * opposite trade-off.
 */
export function renderDataRoomDocument(feed: DataRoomFeed): string {
  return [
    `Telarchy's data room, telarchy.com/data-room. Words updated ${feed.doc.updatedAt}; figures generated ${feed.generatedAt}.`,
    ...feed.doc.sections.map(s => renderDataRoomSection(feed, s.id)),
  ].join('\n\n');
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
