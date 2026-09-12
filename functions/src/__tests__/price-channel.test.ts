/**
 * The price channel: how every instance learns that a floor's prices moved
 * (docs/infra/deploy.md, "Prices, one channel across instances").
 *
 * Production carries it over Postgres LISTEN/NOTIFY on one dedicated
 * pg.Client per instance. The pglite harness is an in-process database with
 * no wire protocol to open a pg.Client against, so the connection sits behind
 * a small interface and these tests drive it with a fake client: what is
 * pinned is the logic (after commit, never awaited, coalesced, own messages
 * ignored, reconnect with backoff, versions moved on reconnect), not
 * Postgres's delivery.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { EventEmitter } from 'node:events';
import { emitPricesChanged, onPricesChanged } from '../lib/market-events';
import {
  INSTANCE_ID,
  PRICE_CHANNEL,
  priceChannelLive,
  receivePriceMessage,
  reconnectBackoffMs,
  setPriceTransport,
  startPriceChannel,
} from '../lib/price-channel';
import { priceKey, priceVersion } from '../lib/price-version';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const tick = () => new Promise(resolve => setImmediate(resolve));

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  // Let an announcement the previous test queued flush into no transport,
  // so it cannot land in this test's recorder.
  setPriceTransport(null);
  await tick();
  await truncateAll();
});
afterAll(() => {
  setPriceTransport(null);
});

function recordingTransport(live = true) {
  const sent: string[] = [];
  return {
    sent,
    transport: {
      isLive: () => live,
      send: (payload: string) => {
        sent.push(payload);
      },
    },
  };
}

describe('a committed price change', () => {
  test('moves the floor version on this instance when the transaction commits, not before', async () => {
    const key = priceKey('production', 'ws-a');
    const before = priceVersion(key);
    await db.transaction(async () => {
      emitPricesChanged('ws-a', 'm-1');
      expect(priceVersion(key)).toBe(before);
    });
    expect(priceVersion(key)).toBeGreaterThan(before);
  });

  test('a rolled-back change moves nothing and tells nobody', async () => {
    const { sent, transport } = recordingTransport();
    setPriceTransport(transport);
    const key = priceKey('production', 'ws-a');
    const before = priceVersion(key);
    await expect(
      db.transaction(async () => {
        emitPricesChanged('ws-a', 'm-1');
        throw new Error('dry run');
      }),
    ).rejects.toThrow();
    await tick();
    expect(priceVersion(key)).toBe(before);
    expect(sent).toEqual([]);
  });

  test('tells the other instances once per floor per tick, naming this instance', async () => {
    const { sent, transport } = recordingTransport();
    setPriceTransport(transport);
    emitPricesChanged('ws-a', 'm-1');
    emitPricesChanged('ws-a', 'm-2');
    emitPricesChanged('ws-b', 'm-9');
    expect(sent).toEqual([]); // never inline
    await tick();
    const messages = sent.map(s => JSON.parse(s));
    expect(messages).toHaveLength(2);
    expect(messages.map(m => m.w).sort()).toEqual(['ws-a', 'ws-b']);
    for (const m of messages) {
      expect(m.i).toBe(INSTANCE_ID);
      expect(m.s).toBe('production');
    }
    // One market named, it rides along; two, the floor as a whole.
    expect(messages.find(m => m.w === 'ws-b').m).toBe('m-9');
    expect(messages.find(m => m.w === 'ws-a').m).toBeUndefined();
  });

  test('a transport that throws or never answers is swallowed', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setPriceTransport({
      isLive: () => true,
      send: () => {
        throw new Error('socket gone');
      },
    });
    emitPricesChanged('ws-a');
    await tick();
    setPriceTransport({ isLive: () => true, send: () => Promise.reject(new Error('rejected')) });
    emitPricesChanged('ws-a');
    await tick();
    await tick();
    setPriceTransport({ isLive: () => true, send: () => new Promise(() => {}) });
    emitPricesChanged('ws-a');
    await tick();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('a message from another instance', () => {
  test('moves that floor version and fans out as a remote change', () => {
    const seen: Array<[string, string | undefined, string]> = [];
    onPricesChanged((ws, m, origin) => seen.push([ws, m, origin ?? 'local']));
    const key = priceKey('production', 'ws-remote');
    const before = priceVersion(key);
    receivePriceMessage(JSON.stringify({ i: 'another-instance', s: 'production', w: 'ws-remote', m: 'm-7' }));
    expect(priceVersion(key)).toBeGreaterThan(before);
    expect(seen).toContainEqual(['ws-remote', 'm-7', 'remote']);
  });

  test('a remote change is not sent back out (no echo between instances)', async () => {
    const { sent, transport } = recordingTransport();
    setPriceTransport(transport);
    receivePriceMessage(JSON.stringify({ i: 'another-instance', s: 'production', w: 'ws-echo' }));
    await tick();
    expect(sent).toEqual([]);
  });

  test('this instance ignores its own message: it moved its version at commit already', () => {
    const key = priceKey('production', 'ws-own');
    const before = priceVersion(key);
    receivePriceMessage(JSON.stringify({ i: INSTANCE_ID, s: 'production', w: 'ws-own' }));
    expect(priceVersion(key)).toBe(before);
  });

  test('garbage on the channel is ignored', () => {
    expect(() => receivePriceMessage('not json')).not.toThrow();
    expect(() => receivePriceMessage(JSON.stringify({ i: 'x' }))).not.toThrow();
  });

  test('a remote change drops the leaderboard cache on this instance too', () => {
    // The listener calls the module's own function, which a spy cannot see
    // from outside; the wiring is pinned at the source.
    const { readFileSync } = require('fs') as typeof import('fs');
    const src = readFileSync(require.resolve('../routes/leaderboard'), 'utf8');
    expect(src).toMatch(/onPricesChanged\([^)]*origin[\s\S]*?remote[\s\S]*?clearBoardCache\(\)/);
  });
});

class FakeClient extends EventEmitter {
  queries: string[] = [];
  connected = false;
  failConnect = false;
  ended = false;
  async connect() {
    if (this.failConnect) throw new Error('refused');
    this.connected = true;
  }
  async query(text: string, _params?: unknown[]) {
    this.queries.push(text);
    return { rows: [] };
  }
  async end() {
    this.ended = true;
  }
}

describe('the listening connection', () => {
  test('backs off 1, 2, 4 ... seconds, capped at 30', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(reconnectBackoffMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });

  test('connects one dedicated client, LISTENs, and is live', async () => {
    const clients: FakeClient[] = [];
    const ch = startPriceChannel({
      connectionString: 'postgres://fake',
      createClient: () => {
        const c = new FakeClient();
        clients.push(c);
        return c;
      },
    });
    await tick();
    await tick();
    expect(clients).toHaveLength(1);
    expect(clients[0].queries).toContain(`LISTEN ${PRICE_CHANNEL}`);
    expect(priceChannelLive()).toBe(true);
    await ch.stop();
    expect(priceChannelLive()).toBe(false);
  });

  test('a notification on the channel reaches the version', async () => {
    const clients: FakeClient[] = [];
    const ch = startPriceChannel({
      connectionString: 'postgres://fake',
      createClient: () => {
        const c = new FakeClient();
        clients.push(c);
        return c;
      },
    });
    await tick();
    await tick();
    const key = priceKey('production', 'ws-n');
    const before = priceVersion(key);
    clients[0].emit('notification', {
      channel: PRICE_CHANNEL,
      payload: JSON.stringify({ i: 'other', s: 'production', w: 'ws-n' }),
    });
    expect(priceVersion(key)).toBeGreaterThan(before);
    await ch.stop();
  });

  test('sends over the dedicated client while connected, over the fallback when not', async () => {
    const clients: FakeClient[] = [];
    const fallback: string[] = [];
    const ch = startPriceChannel({
      connectionString: 'postgres://fake',
      createClient: () => {
        const c = new FakeClient();
        clients.push(c);
        return c;
      },
      fallbackSend: async payload => {
        fallback.push(payload);
      },
    });
    await tick();
    await tick();
    emitPricesChanged('ws-send');
    await tick();
    expect(clients[0].queries.some(q => /pg_notify/.test(q))).toBe(true);
    expect(fallback).toEqual([]);

    // The connection drops: not live, and a change still reaches the others.
    jest.useFakeTimers();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    clients[0].emit('error', new Error('connection reset'));
    expect(priceChannelLive()).toBe(false);
    jest.useRealTimers();
    emitPricesChanged('ws-send');
    await tick();
    expect(fallback).toHaveLength(1);
    spy.mockRestore();
    await ch.stop();
  });

  test('reconnects after a drop with backoff, and moves every version it holds on the way back', async () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const clients: FakeClient[] = [];
    let refuse = 0;
    const ch = startPriceChannel({
      connectionString: 'postgres://fake',
      createClient: () => {
        const c = new FakeClient();
        if (clients.length > 0 && refuse > 0) {
          c.failConnect = true;
          refuse--;
        }
        clients.push(c);
        return c;
      },
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(priceChannelLive()).toBe(true);

    const key = priceKey('production', 'ws-missed');
    receivePriceMessage(JSON.stringify({ i: 'other', s: 'production', w: 'ws-missed' }));
    const held = priceVersion(key);

    refuse = 1;
    clients[0].emit('end');
    expect(priceChannelLive()).toBe(false);
    expect(clients[0].ended).toBe(true);

    // First retry after 1 s is refused; the next waits 2 s.
    await jest.advanceTimersByTimeAsync(999);
    expect(clients).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(clients).toHaveLength(2);
    expect(priceChannelLive()).toBe(false);
    await jest.advanceTimersByTimeAsync(1999);
    expect(clients).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(clients).toHaveLength(3);
    expect(priceChannelLive()).toBe(true);
    // Messages may have been missed while it was down.
    expect(priceVersion(key)).toBeGreaterThan(held);

    await ch.stop();
    spy.mockRestore();
    jest.useRealTimers();
  });
});
