import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { currentStoreName } from '../db/client';
import { afterCommit } from './after-commit';
import { emitRemotePricesChanged, onPricesChanged } from './market-events';
import { bumpEveryPriceVersion, bumpPriceVersion, priceKey } from './price-version';

/**
 * How every instance learns that a floor's prices moved (docs/infra/deploy.md,
 * "Prices, one channel across instances").
 *
 *   write commits ─▶ bump this instance's version ─▶ announce (next tick)
 *                                                        │ pg_notify
 *                     other instance ◀── LISTEN ─────────┘
 *                     bump its version, drop its replay and board caches
 *
 * NOTHING HERE MAY SIT IN A TRADE'S REQUEST PATH (owner ask 2026-09-12: "dont
 * block the actual trade"). The bump is a map write; the announcement is
 * queued with setImmediate, sent without being awaited, and every failure is
 * logged and swallowed.
 *
 * The connection is behind `PriceChannelTransport` so the logic can be tested
 * without a Postgres wire connection (the pglite harness has none).
 */

export const PRICE_CHANNEL = 'telarchy_prices';

/** Names this process on the channel, so it can ignore its own messages. */
export const INSTANCE_ID = randomUUID();

export interface PriceChannelTransport {
  isLive(): boolean;
  send(payload: string): unknown;
}

let transport: PriceChannelTransport | null = null;

export function setPriceTransport(next: PriceChannelTransport | null): void {
  transport = next;
}

/** True while this instance is hearing the other instances. */
export function priceChannelLive(): boolean {
  try {
    return !!transport?.isLive();
  } catch {
    return false;
  }
}

interface Pending {
  store: string;
  workspaceId: string;
  markets: Set<string>;
  whole: boolean;
}

const pending = new Map<string, Pending>();
let scheduled = false;

/** Queue one message for the floor; several changes in one tick send once. */
export function announcePriceChange(store: string, workspaceId: string, marketId?: string): void {
  const key = priceKey(store, workspaceId);
  const entry = pending.get(key) ?? { store, workspaceId, markets: new Set<string>(), whole: false };
  if (marketId) entry.markets.add(marketId);
  else entry.whole = true;
  pending.set(key, entry);
  if (!scheduled) {
    scheduled = true;
    setImmediate(flushAnnouncements);
  }
}

function flushAnnouncements(): void {
  scheduled = false;
  const batch = [...pending.values()];
  pending.clear();
  const out = transport;
  if (!out) return;
  for (const entry of batch) {
    const market = !entry.whole && entry.markets.size === 1 ? [...entry.markets][0] : undefined;
    const payload = JSON.stringify({
      i: INSTANCE_ID,
      s: entry.store,
      w: entry.workspaceId,
      ...(market ? { m: market } : {}),
    });
    try {
      const sent = out.send(payload);
      if (sent && typeof (sent as Promise<unknown>).catch === 'function') {
        (sent as Promise<unknown>).catch(e => console.error('price channel send failed:', e));
      }
    } catch (e) {
      console.error('price channel send failed:', e);
    }
  }
}

// A local write: move this instance's version once it commits, then tell the
// others. A remote change is already everyone's news, so it is not re-sent.
onPricesChanged((workspaceId, marketId, origin) => {
  if (origin === 'remote') return;
  const store = currentStoreName();
  afterCommit(() => {
    bumpPriceVersion(priceKey(store, workspaceId));
    announcePriceChange(store, workspaceId, marketId);
  });
});

/** A message from the channel. Its own and malformed messages are ignored. */
export function receivePriceMessage(payload: string): void {
  let msg: { i?: unknown; s?: unknown; w?: unknown; m?: unknown };
  try {
    msg = JSON.parse(payload);
  } catch {
    return;
  }
  if (!msg || typeof msg.w !== 'string' || typeof msg.s !== 'string') return;
  if (msg.i === INSTANCE_ID) return;
  bumpPriceVersion(priceKey(msg.s, msg.w));
  emitRemotePricesChanged(msg.w, typeof msg.m === 'string' ? msg.m : undefined);
}

/** 1, 2, 4 ... seconds between reconnects, capped at 30. */
export function reconnectBackoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

/** The slice of pg.Client the channel uses. */
export interface ListenClient {
  connect(): Promise<unknown>;
  query(text: string, params?: unknown[]): Promise<unknown>;
  end(): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeAllListeners?(event?: string): unknown;
}

/**
 * Open the one dedicated listening connection for this instance and keep it
 * open: reconnect on error or end with backoff, and move every version on
 * each (re)connect, since messages may have been missed while it was down.
 * While connected, announcements go over it; while not, over `fallbackSend`
 * (the pool), so the other instances still hear this one.
 */
export function startPriceChannel(opts: {
  connectionString: string;
  createClient?: (connectionString: string) => ListenClient;
  fallbackSend?: (payload: string) => Promise<unknown>;
}): { stop(): Promise<void> } {
  const create = opts.createClient ?? ((cs: string) => new Client({ connectionString: cs }) as unknown as ListenClient);
  let client: ListenClient | null = null;
  let live = false;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer || stopped) return;
    const delay = reconnectBackoffMs(attempt);
    attempt += 1;
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
  };

  const drop = (c: ListenClient, why: unknown) => {
    if (client !== c) return;
    client = null;
    live = false;
    c.removeAllListeners?.();
    c.on('error', () => {});
    c.end().catch(() => {});
    if (!stopped) {
      console.error('price channel dropped, reconnecting:', why);
      schedule();
    }
  };

  const connect = async () => {
    if (stopped) return;
    const c = create(opts.connectionString);
    c.on('error', (e: unknown) => drop(c, e));
    c.on('end', () => drop(c, 'connection ended'));
    c.on('notification', (msg: { channel?: string; payload?: string }) => {
      if (msg?.channel === PRICE_CHANNEL && typeof msg.payload === 'string') receivePriceMessage(msg.payload);
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${PRICE_CHANNEL}`);
    } catch (e) {
      c.removeAllListeners?.();
      c.on('error', () => {});
      c.end().catch(() => {});
      console.error('price channel connect failed:', e);
      schedule();
      return;
    }
    if (stopped) {
      c.end().catch(() => {});
      return;
    }
    client = c;
    live = true;
    attempt = 0;
    bumpEveryPriceVersion();
  };

  setPriceTransport({
    isLive: () => live,
    send: (payload: string) => {
      if (live && client) return client.query('SELECT pg_notify($1, $2)', [PRICE_CHANNEL, payload]);
      return opts.fallbackSend?.(payload);
    },
  });
  void connect();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const c = client;
      client = null;
      live = false;
      if (c) await c.end().catch(() => {});
    },
  };
}
