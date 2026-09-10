/**
 * Map over `items` with at most `limit` calls of `fn` in flight, results in
 * input order. The bound is the point (docs/infra/deploy.md, "Reads are
 * bounded in the size of a workspace"): a `Promise.all` over every open
 * market is N concurrent acquires against a pool of four, and past the pool's
 * 5 s connection timeout that reads as a database outage. Rejections
 * propagate; work already in flight finishes on its own.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}
