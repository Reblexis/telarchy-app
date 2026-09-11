import { describe, expect, test } from 'vitest';
import { optionIdsOf, optionLead, pairPool, worldOf } from '../proposal-options';

/**
 * The arithmetic of a proposal with options (docs/ui-conventions.md, "A
 * proposal with options shows one world per option"; docs/guides/
 * proposals.md, "More than two options"): which market a world key names,
 * who leads and by how much, what the ids of typed labels are, and what is
 * behind a row.
 */
const opt = (id: string, label: string, consensus: number | null, over: Record<string, unknown> = {}) => ({
  id,
  label,
  marketId: `m-${id}`,
  consensus,
  probability: consensus === null ? null : 0.4,
  liquidity: consensus === null ? 0 : 200,
  pool: consensus === null ? 0 : 300,
  traders: consensus === null ? 0 : 2,
  volume: consensus === null ? 0 : 40,
  delta: null,
  ...over,
});
const pairRow = {
  approvedConsensus: 7,
  declinedConsensus: 6,
  approvedMarketId: 'm-a',
  declinedMarketId: 'm-d',
  approvedProbability: 0.6,
  declinedProbability: 0.5,
  approvedLiquidity: 100,
  declinedLiquidity: 90,
  approvedPool: 150,
  declinedPool: 120,
  approvedTraders: 3,
  declinedTraders: 1,
  approvedVolume: 30,
  declinedVolume: 10,
  options: null,
};
const optionRow = {
  ...pairRow,
  approvedConsensus: null,
  declinedConsensus: null,
  approvedMarketId: null,
  declinedMarketId: null,
  approvedProbability: null,
  declinedProbability: null,
  approvedLiquidity: null,
  declinedLiquidity: null,
  approvedPool: null,
  declinedPool: null,
  approvedTraders: null,
  declinedTraders: null,
  approvedVolume: null,
  declinedVolume: null,
  options: [opt('forward', 'Continue', 7.2), opt('left', 'Turn left', 8.9), opt('right', 'Turn right', null)],
};

describe('worldOf: the world key names one market of the row', () => {
  test('approved and declined name the pair branches, worded "if approved" / "if declined"', () => {
    expect(worldOf(pairRow as never, 'approved')).toMatchObject({
      marketId: 'm-a',
      consensus: 7,
      probability: 0.6,
      liquidity: 100,
      pool: 150,
      traders: 3,
      volume: 30,
      label: 'if approved',
    });
    expect(worldOf(pairRow as never, 'declined')).toMatchObject({ marketId: 'm-d', label: 'if declined' });
  });

  test("an option id names that option's market, worded by its own label", () => {
    expect(worldOf(optionRow as never, 'left')).toMatchObject({
      marketId: 'm-left',
      consensus: 8.9,
      liquidity: 200,
      pool: 300,
      label: 'Turn left',
    });
  });

  test('a key the row does not carry is no world: a branch word on an option row, an option id on a pair, an unknown id, no row', () => {
    expect(worldOf(optionRow as never, 'approved')).toBeNull();
    expect(worldOf(pairRow as never, 'left')).toBeNull();
    expect(worldOf(optionRow as never, 'up')).toBeNull();
    expect(worldOf(null, 'approved')).toBeNull();
  });
});

describe("optionLead: the leader's consensus minus the best other PRICED option", () => {
  test('the leader and its lead over the next best', () => {
    const lead = optionLead(optionRow.options as never);
    expect(lead?.leader?.id).toBe('left');
    expect(lead?.tied).toBe(false);
    expect(lead?.lead).toBeCloseTo(1.7, 9);
  });

  test('an option with no liquidity has no price and never leads or trails', () => {
    const lead = optionLead([opt('a', 'A', null), opt('b', 'B', 3), opt('c', 'C', 2)] as never);
    expect(lead?.leader?.id).toBe('b');
    expect(lead?.lead).toBeCloseTo(1, 9);
    // Priced at a number but nothing staked: still unpriced.
    expect(
      optionLead([opt('a', 'A', 9, { liquidity: 0 }), opt('b', 'B', 3), opt('c', 'C', 2)] as never)?.leader?.id,
    ).toBe('b');
  });

  test('fewer than two priced options: no leader', () => {
    expect(optionLead([opt('a', 'A', 5), opt('b', 'B', null)] as never)).toBeNull();
    expect(optionLead([] as never)).toBeNull();
    expect(optionLead(null)).toBeNull();
  });

  test('a tie at the top has no leader: a lead of zero, nobody named, even through float noise', () => {
    const lead = optionLead([opt('a', 'A', 2), opt('b', 'B', 5), opt('c', 'C', 5)] as never);
    expect(lead?.leader).toBeNull();
    expect(lead?.tied).toBe(true);
    expect(lead?.lead).toBe(0);
    const noisy = optionLead([opt('a', 'A', 5 + 1e-12), opt('b', 'B', 5), opt('c', 'C', 2)] as never);
    expect(noisy?.leader).toBeNull();
    expect(noisy?.lead).toBe(0);
  });
});

describe('optionIdsOf: ids are the labels lowercased and hyphenated, deduplicated with a number', () => {
  test('the ordinary case', () => {
    expect(optionIdsOf(['Turn left', 'Turn right'])).toEqual(['turn-left', 'turn-right']);
    expect(optionIdsOf(['Headline B!', '  Headline  C  '])).toEqual(['headline-b', 'headline-c']);
  });
  test('duplicates take a number from 2', () => {
    expect(optionIdsOf(['Go', 'go', 'GO'])).toEqual(['go', 'go-2', 'go-3']);
  });
  test('never the reserved branch names, never empty, never over 24 characters', () => {
    expect(optionIdsOf(['approved', 'declined', '!!!'])).toEqual(['approved-2', 'declined-2', 'option-3']);
    const long = optionIdsOf(['a'.repeat(40), 'a'.repeat(40)]);
    for (const id of long) {
      expect(id.length).toBeLessThanOrEqual(24);
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
    expect(long[0]).not.toBe(long[1]);
  });
});

describe('pairPool: what is behind a row is every one of its books', () => {
  test('a pair counts both branches, an option row counts every option, a missing book counts nothing', () => {
    expect(pairPool(pairRow as never)).toBe(270);
    expect(pairPool(optionRow as never)).toBe(600);
    expect(pairPool({ approvedPool: null, declinedPool: null, options: [{ pool: null }] } as never)).toBe(0);
  });
});
