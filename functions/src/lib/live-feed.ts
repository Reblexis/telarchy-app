/**
 * The owner's live feed, proxied for the floor (docs/ui-conventions.md, "The
 * live view is a segment of the chart slot"). Two jobs: validate the
 * `liveFeed` setting, and fetch the feed's three endpoints with the stated
 * caches so the floor's 2-second poll costs the owner's host one read per
 * window however many browsers watch.
 *
 * The browser never reads the owner's host: the app is the one reader, and
 * a failure upstream is a 502 here rather than a broken page there.
 */

/** The feed shapes the floor can draw. A new kind is a new component under
 *  src/components/live and a new entry here, nothing else. */
export const LIVE_FEED_KINDS: ReadonlySet<string> = new Set(['snake']);

export interface LiveFeed {
  kind: string;
  url: string;
}

const URL_MAX = 500;

/**
 * `{ kind, url }` from the allow-list with an https url, trimmed and without
 * a trailing slash, or a string naming why it is refused. Extra fields are
 * dropped: the stored value is exactly the two the floor reads.
 */
export function parseLiveFeed(value: unknown): { ok: true; feed: LiveFeed } | { ok: false; error: string } {
  const bad = (why: string) => ({ ok: false as const, error: `liveFeed ${why}` });
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return bad('must be { kind, url } or null');
  }
  const { kind, url } = value as Record<string, unknown>;
  if (typeof kind !== 'string' || !LIVE_FEED_KINDS.has(kind)) {
    return bad(`kind must be one of: ${[...LIVE_FEED_KINDS].join(', ')}`);
  }
  if (typeof url !== 'string') return bad('url must be an https URL');
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed.length > URL_MAX) return bad(`url must be at most ${URL_MAX} characters`);
  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== 'https:' || !parsed.hostname) return bad('url must be an https URL');
  return { ok: true, feed: { kind, url: trimmed } };
}

/** The three endpoints, their upstream path and how long an answer is held. */
export const LIVE_ENDPOINTS = {
  state: { path: '/state', ttlMs: 2_000 },
  games: { path: '/games', ttlMs: 30_000 },
  history: { path: '/history', ttlMs: 30_000 },
} as const;
export type LiveEndpoint = keyof typeof LIVE_ENDPOINTS;

export const HISTORY_LIMIT_MAX = 2000;
const UPSTREAM_TIMEOUT_MS = 5_000;

/** The history query, forwarded as given when it is well-formed and dropped
 *  otherwise: `game` any short token, `from` a non-negative integer, `limit`
 *  a positive integer capped at 2000. */
export function historyQuery(q: Record<string, unknown>): URLSearchParams {
  const out = new URLSearchParams();
  const game = typeof q.game === 'string' ? q.game.trim() : '';
  if (game && /^[A-Za-z0-9_-]{1,40}$/.test(game)) out.set('game', game);
  const from = typeof q.from === 'string' ? Number(q.from) : Number.NaN;
  if (Number.isInteger(from) && from >= 0) out.set('from', String(from));
  const limit = typeof q.limit === 'string' ? Number(q.limit) : Number.NaN;
  if (Number.isInteger(limit) && limit > 0) out.set('limit', String(Math.min(limit, HISTORY_LIMIT_MAX)));
  return out;
}

export class LiveFeedError extends Error {}

interface Entry {
  at: number;
  body: unknown;
}
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export function resetLiveFeedCache(): void {
  cache.clear();
  inflight.clear();
}

/**
 * One endpoint of one workspace's feed: the cached body while it is fresh,
 * else one upstream fetch shared by every caller that arrives while it is in
 * flight. A failure throws LiveFeedError and caches nothing, so the next
 * read tries again.
 */
export async function readLiveFeed(
  workspaceId: string,
  feed: LiveFeed,
  endpoint: LiveEndpoint,
  query?: URLSearchParams,
): Promise<unknown> {
  const { path, ttlMs } = LIVE_ENDPOINTS[endpoint];
  const qs = query && [...query.keys()].length > 0 ? `?${query.toString()}` : '';
  const key = `${workspaceId} ${endpoint}${qs}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.body;
  const pending = inflight.get(key);
  if (pending) return pending;
  const run = (async () => {
    try {
      const body = await fetchJson(`${feed.url}${path}${qs}`);
      cache.set(key, { at: Date.now(), body });
      return body;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    } catch (e) {
      throw new LiveFeedError(`The live feed did not answer (${e instanceof Error ? e.message : 'fetch failed'})`);
    }
    if (!res.ok) throw new LiveFeedError(`The live feed answered ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new LiveFeedError('The live feed did not answer JSON');
    }
  } finally {
    clearTimeout(timer);
  }
}
