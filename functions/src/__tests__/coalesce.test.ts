/**
 * CONCURRENT LOOKUPS OF ONE KIND RUN AS ONE (docs/infra/deploy.md, "A burst
 * of per-book reads costs a fixed number of statements").
 *
 * A floor opening a proposal with 218 options fires 218 reads at once, and
 * the beta store has one connection. `coalesce` turns the calls waiting at the
 * same moment into one load, keyed so that nothing crosses a workspace or a
 * store, and caches nothing past the load that answered.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { coalesce } from '../lib/coalesce';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Key = { group: string; id: string };

function recorder(answer: (k: Key) => string | undefined = k => `v:${k.group}:${k.id}`) {
  const flights: Key[][] = [];
  const loadMany = async (keys: Key[]) => {
    flights.push(keys);
    const out = new Map<string, string>();
    for (const k of keys) {
      const v = answer(k);
      if (v !== undefined) out.set(k.id, v);
    }
    return out;
  };
  return { flights, loadMany };
}

test('calls made at the same moment run as one load with every key', async () => {
  const r = recorder();
  const load = coalesce<Key, string>({ groupOf: k => k.group, keyOf: k => k.id, loadMany: r.loadMany });
  const answers = await Promise.all(['a', 'b', 'c'].map(id => load({ group: 'ws', id })));
  expect(answers).toEqual(['v:ws:a', 'v:ws:b', 'v:ws:c']);
  expect(r.flights).toHaveLength(1);
  expect(r.flights[0].map(k => k.id).sort()).toEqual(['a', 'b', 'c']);
});

test('the same key asked twice in a burst is loaded once and answers both callers', async () => {
  const r = recorder();
  const load = coalesce<Key, string>({ groupOf: k => k.group, keyOf: k => k.id, loadMany: r.loadMany });
  const answers = await Promise.all([load({ group: 'ws', id: 'a' }), load({ group: 'ws', id: 'a' })]);
  expect(answers).toEqual(['v:ws:a', 'v:ws:a']);
  expect(r.flights).toEqual([[{ group: 'ws', id: 'a' }]]);
});

test('a key the load does not answer resolves undefined, and its neighbours still answer', async () => {
  const r = recorder(k => (k.id === 'gone' ? undefined : `v:${k.id}`));
  const load = coalesce<Key, string>({ groupOf: k => k.group, keyOf: k => k.id, loadMany: r.loadMany });
  const answers = await Promise.all([load({ group: 'ws', id: 'gone' }), load({ group: 'ws', id: 'here' })]);
  expect(answers).toEqual([undefined, 'v:here']);
});

test('calls arriving while a load runs wait and then run together as ONE next load', async () => {
  const first = deferred<Map<string, string>>();
  const flights: string[][] = [];
  let n = 0;
  const load = coalesce<Key, string>({
    groupOf: k => k.group,
    keyOf: k => k.id,
    loadMany: async keys => {
      flights.push(keys.map(k => k.id));
      if (n++ === 0) return first.promise;
      return new Map(keys.map(k => [k.id, `late:${k.id}`]));
    },
  });
  const a = load({ group: 'ws', id: 'a' });
  await tick();
  expect(flights).toEqual([['a']]);
  const later = ['b', 'c', 'd'].map(id => load({ group: 'ws', id }));
  await tick();
  await tick();
  // Still one flight: the newcomers wait for the running one.
  expect(flights).toEqual([['a']]);
  first.resolve(new Map([['a', 'early:a']]));
  expect(await a).toBe('early:a');
  expect(await Promise.all(later)).toEqual(['late:b', 'late:c', 'late:d']);
  expect(flights).toEqual([['a'], ['b', 'c', 'd']]);
});

test('different groups never share a load', async () => {
  const r = recorder();
  const load = coalesce<Key, string>({ groupOf: k => k.group, keyOf: k => k.id, loadMany: r.loadMany });
  const answers = await Promise.all([load({ group: 'ws-1', id: 'a' }), load({ group: 'ws-2', id: 'a' })]);
  expect(answers).toEqual(['v:ws-1:a', 'v:ws-2:a']);
  expect(r.flights).toHaveLength(2);
  for (const f of r.flights) expect(new Set(f.map(k => k.group)).size).toBe(1);
});

test('a beta read and a production read never share a load, even for the same key', async () => {
  let store = 'production';
  const flights: Array<{ store: string; ids: string[] }> = [];
  const load = coalesce<Key, string>({
    groupOf: k => k.group,
    keyOf: k => k.id,
    storeOf: () => store,
    loadMany: async keys => {
      flights.push({ store, ids: keys.map(k => k.id) });
      return new Map(keys.map(k => [k.id, `${store}:${k.id}`]));
    },
  });
  const prod = load({ group: 'ws', id: 'a' });
  store = 'beta';
  const beta = load({ group: 'ws', id: 'a' });
  await Promise.all([prod, beta]);
  expect(flights).toHaveLength(2);
  expect(flights.map(f => f.ids)).toEqual([['a'], ['a']]);
});

test('a failing load rejects exactly its own callers, and the next load runs normally', async () => {
  let fail = true;
  const load = coalesce<Key, string>({
    groupOf: k => k.group,
    keyOf: k => k.id,
    loadMany: async keys => {
      if (fail) throw new Error('db down');
      return new Map(keys.map(k => [k.id, `ok:${k.id}`]));
    },
  });
  const failed = await Promise.allSettled([load({ group: 'ws', id: 'a' }), load({ group: 'ws', id: 'b' })]);
  expect(failed.map(f => f.status)).toEqual(['rejected', 'rejected']);
  fail = false;
  expect(await load({ group: 'ws', id: 'a' })).toBe('ok:a');
});

test('a burst larger than maxBatch runs in loads of at most maxBatch keys, and every caller answers', async () => {
  const r = recorder();
  const load = coalesce<Key, string>({
    groupOf: k => k.group,
    keyOf: k => k.id,
    loadMany: r.loadMany,
    maxBatch: 2,
  });
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const answers = await Promise.all(ids.map(id => load({ group: 'ws', id })));
  expect(answers).toEqual(ids.map(id => `v:ws:${id}`));
  for (const f of r.flights) expect(f.length).toBeLessThanOrEqual(2);
  expect(
    r.flights
      .flat()
      .map(k => k.id)
      .sort(),
  ).toEqual(ids);
});

test('nothing is cached: a call after a load has answered reads again and sees the new value', async () => {
  let version = 1;
  const r = recorder(k => `${k.id}@${version}`);
  const load = coalesce<Key, string>({ groupOf: k => k.group, keyOf: k => k.id, loadMany: r.loadMany });
  expect(await load({ group: 'ws', id: 'a' })).toBe('a@1');
  version = 2;
  expect(await load({ group: 'ws', id: 'a' })).toBe('a@2');
  expect(r.flights).toHaveLength(2);
});
