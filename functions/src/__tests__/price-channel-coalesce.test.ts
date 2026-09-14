/**
 * A FLOOR SENDS AT MOST ONE PRICE MESSAGE A SECOND (docs/infra/deploy.md,
 * "Prices, one channel across instances").
 *
 * A machine-run floor changes prices several times a second (a proposal a
 * second, its funding, bots trading it, its close), and every change used to
 * cost a pg_notify. The first change of a quiet second still goes at once, so
 * another instance hears of a lone trade immediately; the rest of that second
 * rides one message when it ends, so nobody is more than a second behind.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { emitPricesChanged } from '../lib/market-events';
import { resetPriceAnnouncements, setPriceTransport } from '../lib/price-channel';
import { ensureMigrations } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

const tick = () => new Promise(resolve => setImmediate(resolve));

function recorder() {
  const sent: Array<Record<string, unknown>> = [];
  setPriceTransport({
    isLive: () => true,
    send: (payload: string) => {
      sent.push(JSON.parse(payload));
    },
  });
  return sent;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  setPriceTransport(null);
  resetPriceAnnouncements();
});
afterEach(() => {
  resetPriceAnnouncements();
  setPriceTransport(null);
  jest.useRealTimers();
});

describe('A FLOOR SENDS AT MOST ONE PRICE MESSAGE A SECOND', () => {
  test('the first change goes at once; the rest of its second ride one message when the second ends', async () => {
    const sent = recorder();
    emitPricesChanged('ws-busy', 'm-1');
    await tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ w: 'ws-busy', m: 'm-1' });

    jest.advanceTimersByTime(100);
    emitPricesChanged('ws-busy', 'm-2');
    await tick();
    jest.advanceTimersByTime(300);
    emitPricesChanged('ws-busy', 'm-3');
    await tick();
    expect(sent).toHaveLength(1);

    jest.advanceTimersByTime(599);
    await tick();
    expect(sent).toHaveLength(1);
    jest.advanceTimersByTime(1);
    await tick();
    expect(sent).toHaveLength(2);
    // Two markets changed: the message names the floor as a whole.
    expect(sent[1].w).toBe('ws-busy');
    expect(sent[1].m).toBeUndefined();
  });

  test('a floor changing every 100 ms for five seconds sends about one message a second, never more', async () => {
    const sent = recorder();
    for (let i = 0; i < 50; i++) {
      emitPricesChanged('ws-hot', `m-${i}`);
      await tick();
      jest.advanceTimersByTime(100);
    }
    jest.advanceTimersByTime(1000);
    await tick();
    expect(sent.length).toBeGreaterThanOrEqual(5);
    expect(sent.length).toBeLessThanOrEqual(6);
  });

  test('another floor is never held back by a busy one', async () => {
    const sent = recorder();
    emitPricesChanged('ws-busy', 'm-1');
    await tick();
    emitPricesChanged('ws-busy', 'm-2');
    emitPricesChanged('ws-quiet', 'm-9');
    await tick();
    expect(sent.map(m => m.w)).toEqual(['ws-busy', 'ws-quiet']);
  });

  test('a floor quiet for a second sends its next change at once again', async () => {
    const sent = recorder();
    emitPricesChanged('ws-a', 'm-1');
    await tick();
    jest.advanceTimersByTime(1001);
    await tick();
    expect(sent).toHaveLength(1);
    emitPricesChanged('ws-a', 'm-2');
    await tick();
    expect(sent).toHaveLength(2);
  });

  test('A MESSAGE SAYS WHEN NO MONEY MOVED, and one where any change in it moved money does not', async () => {
    const sent = recorder();
    emitPricesChanged('ws-spawn', 'm-1', { moneyMoved: false });
    emitPricesChanged('ws-trade', 'm-2');
    await tick();
    expect(sent.find(m => m.w === 'ws-spawn')?.k).toBe(0);
    expect(sent.find(m => m.w === 'ws-trade')).not.toHaveProperty('k');

    jest.advanceTimersByTime(100);
    emitPricesChanged('ws-spawn', 'm-3', { moneyMoved: false });
    emitPricesChanged('ws-spawn', 'm-4');
    await tick();
    jest.advanceTimersByTime(1000);
    await tick();
    const second = sent.filter(m => m.w === 'ws-spawn')[1];
    expect(second).toBeDefined();
    expect(second).not.toHaveProperty('k');
  });
});
