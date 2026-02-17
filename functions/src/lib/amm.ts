/**
 * LMSR (Logarithmic Market Scoring Rule) for bucketed numeric markets.
 * Each market has N buckets spanning a value range.
 * Agents buy/sell shares in buckets; prices adjust automatically.
 */

/** Total cost function C(q) = b * ln(sum(exp(q_i / b))) */
export function lmsrCost(bucketShares: number[], b: number): number {
  const maxQ = Math.max(...bucketShares);
  const sumExp = bucketShares.reduce((sum, q) => sum + Math.exp((q - maxQ) / b), 0);
  return b * (maxQ / b + Math.log(sumExp));
}

/** Cost to buy (positive) or sell (negative) `amount` shares of bucket `bucketIndex`. */
export function tradeCost(bucketShares: number[], bucketIndex: number, amount: number, b: number): number {
  const after = [...bucketShares];
  after[bucketIndex] += amount;
  return Math.round((lmsrCost(after, b) - lmsrCost(bucketShares, b)) * 100) / 100;
}

/** Probability distribution across buckets. */
export function bucketProbabilities(bucketShares: number[], b: number): number[] {
  const maxQ = Math.max(...bucketShares);
  const exps = bucketShares.map(q => Math.exp((q - maxQ) / b));
  const total = exps.reduce((a, v) => a + v, 0);
  return exps.map(e => e / total);
}

/** Expected value (consensus) from the probability distribution. */
export function ammConsensus(bucketShares: number[], b: number, rangeMin: number, rangeMax: number): number {
  const probs = bucketProbabilities(bucketShares, b);
  const step = (rangeMax - rangeMin) / probs.length;
  return Math.round(probs.reduce((sum, p, i) => sum + p * (rangeMin + (i + 0.5) * step), 0) * 100) / 100;
}

/** Get the bucket index that contains a given value. */
export function valueToBucket(value: number, rangeMin: number, rangeMax: number, numBuckets: number): number {
  if (value <= rangeMin) return 0;
  if (value >= rangeMax) return numBuckets - 1;
  const step = (rangeMax - rangeMin) / numBuckets;
  return Math.min(Math.floor((value - rangeMin) / step), numBuckets - 1);
}

/** Get the value range [min, max) for a bucket index. */
export function bucketRange(bucketIndex: number, rangeMin: number, rangeMax: number, numBuckets: number): [number, number] {
  const step = (rangeMax - rangeMin) / numBuckets;
  return [rangeMin + bucketIndex * step, rangeMin + (bucketIndex + 1) * step];
}

/** Default AMM parameters for new markets. */
export const AMM_DEFAULTS = {
  rangeMin: 0,
  rangeMax: 1000,
  numBuckets: 10,
  liquidity: 100,
};
