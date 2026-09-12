import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { currentStoreName, db } from '../db/client';
import { markets, proposals, workspaces } from '../db/schema';
import { consensus, pHigher } from '../lib/amm';
import { priceChannelLive } from '../lib/price-channel';
import { priceKey, priceVersion } from '../lib/price-version';
import { restrictedToMembers } from '../lib/public-read';
import { onClearAllCaches, ttlCache } from '../lib/ttl-cache';

/**
 * GET /api/marketplace/:workspaceId/prices: every open book's price, polled
 * once a second per viewer (docs/guides/agent-api.md, "Prices, once a
 * second"; the cost rules are docs/infra/deploy.md, "Prices, one channel
 * across instances").
 *
 *   request ─▶ access (cached 10 s) ─▶ version moved? ──no──▶ memory (200 or 304)
 *                                           │ yes
 *                                           ▼
 *                                ONE query, single-flight ─▶ cache at that version
 *
 * The cost is the requirement: an /admin tab polling a heavy read once took
 * the site down. While the floor's price version stands still this touches no
 * database at all; when it moves, one read serves every viewer who arrives.
 * Without the price channel an answer is trusted for at most a second.
 */

/** How long whether a stranger may read a floor is trusted. */
export const ACCESS_TTL_MS = 10_000;
/** How long an answer is trusted while this instance is not hearing the channel. */
export const UNLISTENED_TTL_MS = 1_000;

export interface FloorBook {
  marketId: string;
  /** The call on the book's own scale; null while it has no liquidity. */
  consensus: number | null;
  /** The call as a fraction of the range; null while it has no liquidity. */
  probability: number | null;
  /** Credits in the pool. */
  pool: number;
  /** Rows that moved the book, the same count as a dry run's basis.tradeCount. */
  tradeCount: number;
}

export type PricesAnswer =
  | { status: 200; etag: string; body: { asOf: string; version: string; books: FloorBook[] } }
  | { status: 304; etag: string }
  | { status: 403 | 404; error: string };

type Access = { ok: true; workspaceId: string } | { ok: false; status: 403 | 404; error: string };

/**
 * The ballot's disclosure rule in one query: an id, or a slug among public
 * and unlisted floors (ambiguous resolves to none), public, and a Public
 * group that reads.
 */
async function resolveAccess(idOrSlug: string): Promise<Access> {
  const rows = await db
    .select({
      id: workspaces.id,
      visibility: workspaces.visibility,
      // The outer columns are spelled out: inside a one-table select drizzle
      // renders a column unqualified, and the subquery would bind it to its own
      // table.
      publicCaps: sql<unknown>`(select pg.capabilities from permission_groups pg where pg.workspace_id = "workspaces"."id" and pg.type = 'public' limit 1)`,
    })
    .from(workspaces)
    .where(
      or(
        eq(workspaces.id, idOrSlug),
        and(
          sql`lower(${workspaces.slug}) = lower(${idOrSlug})`,
          inArray(workspaces.visibility, ['public', 'unlisted']),
        ),
      ),
    )
    .limit(3);
  const ws = rows.find(r => r.id === idOrSlug) ?? (rows.length === 1 ? rows[0] : undefined);
  if (!ws) return { ok: false, status: 404, error: 'Workspace not found' };
  if (restrictedToMembers(ws.visibility)) return { ok: false, status: 403, error: 'This workspace is private' };
  // jsonb through a raw subquery: some drivers hand back the parsed array,
  // others the JSON text.
  const raw: unknown = ws.publicCaps;
  let caps: unknown = raw;
  if (typeof raw === 'string') {
    try {
      caps = JSON.parse(raw);
    } catch {
      caps = [];
    }
  }
  if (!Array.isArray(caps)) caps = [];
  if (!(caps as unknown[]).includes('read')) return { ok: false, status: 403, error: 'Not public' };
  return { ok: true, workspaceId: ws.id };
}

const accessCache = ttlCache({
  ttlMs: ACCESS_TTL_MS,
  keyOf: (store: string, idOrSlug: string) => `${store}:${idOrSlug}`,
  load: (_store: string, idOrSlug: string) => resolveAccess(idOrSlug),
  maxEntries: 512,
});

/** The open books a viewer can trade: open baselines and pending proposals' books. */
async function readBooks(workspaceId: string): Promise<FloorBook[]> {
  const rows = await db
    .select({
      marketId: markets.id,
      shares: markets.shares,
      liquidity: markets.liquidity,
      rangeMin: markets.rangeMin,
      rangeMax: markets.rangeMax,
      pool: markets.pool,
      // Outer columns spelled out, for the same reason as the access query.
      tradeCount: sql<number>`(select count(*)::int from trades t where t.workspace_id = "markets"."workspace_id" and t.market_id = "markets"."id")`,
    })
    .from(markets)
    .leftJoin(proposals, and(eq(proposals.id, markets.proposalId), eq(proposals.workspaceId, markets.workspaceId)))
    .where(
      and(
        eq(markets.workspaceId, workspaceId),
        eq(markets.resolved, false),
        eq(markets.voided, false),
        eq(markets.active, true),
        or(isNull(markets.proposalId), and(eq(proposals.status, 'pending'), isNull(proposals.closedAt))),
      ),
    )
    .orderBy(asc(markets.id));
  return rows.map(r => {
    const shares = (r.shares as [number, number]) || [0, 0];
    const funded = r.liquidity > 0;
    return {
      marketId: r.marketId,
      consensus: consensus(shares, r.liquidity, r.rangeMin, r.rangeMax) ?? null,
      probability: funded ? Math.round(pHigher(shares, r.liquidity) * 10000) / 10000 : null,
      pool: r.pool ?? 0,
      tradeCount: Number(r.tradeCount) || 0,
    };
  });
}

interface Built {
  version: number;
  builtAt: number;
  etag: string;
  books: FloorBook[];
}

const built = new Map<string, Built>();
const inflight = new Map<string, { version: number; promise: Promise<Built> }>();
onClearAllCaches(() => {
  built.clear();
  inflight.clear();
});

function etagOf(books: FloorBook[]): string {
  return createHash('sha1').update(JSON.stringify(books)).digest('hex').slice(0, 16);
}

function current(entry: Built | undefined, version: number, now: number): entry is Built {
  if (!entry || entry.version !== version) return false;
  return priceChannelLive() || now - entry.builtAt < UNLISTENED_TTL_MS;
}

async function booksFor(key: string, workspaceId: string): Promise<Built> {
  const version = priceVersion(key);
  const have = built.get(key);
  if (current(have, version, Date.now())) return have;
  const running = inflight.get(key);
  if (running && running.version === version) return running.promise;

  const promise = readBooks(workspaceId)
    .then(books => {
      const next: Built = { version, builtAt: Date.now(), etag: etagOf(books), books };
      // A newer build may have landed while this one read; never overwrite it.
      const stored = built.get(key);
      if (!stored || stored.version <= version) built.set(key, next);
      return next;
    })
    .finally(() => {
      if (inflight.get(key)?.promise === promise) inflight.delete(key);
    });
  inflight.set(key, { version, promise });
  return promise;
}

function matches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').some(raw => {
    const tag = raw.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
    return tag === '*' || tag === etag;
  });
}

export async function answerFloorPrices(idOrSlug: string, ifNoneMatch?: string): Promise<PricesAnswer> {
  const store = currentStoreName();
  const access = await accessCache.get(store, idOrSlug);
  if (!access.ok) return { status: access.status, error: access.error };
  const entry = await booksFor(priceKey(store, access.workspaceId), access.workspaceId);
  if (matches(ifNoneMatch, entry.etag)) return { status: 304, etag: entry.etag };
  // While the channel is live an unmoved version IS current, so the answer is
  // as of now; without it, as of the read.
  const asOf = new Date(priceChannelLive() ? Date.now() : entry.builtAt).toISOString();
  return { status: 200, etag: entry.etag, body: { asOf, version: entry.etag, books: entry.books } };
}
