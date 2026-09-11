import type { PublicProposalMarketPair, PublicProposalOptionQuote } from './api';

/**
 * The arithmetic of a proposal with options (docs/ui-conventions.md, "A
 * proposal with options shows one world per option"; the API shape is
 * docs/guides/proposals.md, "More than two options"). One home, so the
 * page, the board and the strips cannot disagree about which market a world
 * key names or who leads.
 */

/** The two words an option id may never be: they name the pair's worlds. */
export const RESERVED_OPTION_IDS = ['approved', 'declined'] as const;
/** How many options a proposal may carry, and the longest id and label. */
export const MAX_OPTIONS = 6;
export const MAX_OPTION_ID = 24;
export const MAX_OPTION_LABEL = 40;

/** Whether an option has a price: a consensus, and something staked on it.
 *  An option with no liquidity has no price and no delta. */
export function isPricedOption(o: Pick<PublicProposalOptionQuote, 'consensus' | 'liquidity'>): boolean {
  return typeof o.consensus === 'number' && Number.isFinite(o.consensus) && (o.liquidity === null || o.liquidity > 0);
}

/** Whether a row is an option row (it carries options in place of the pair). */
export function isOptionRow(m: Pick<PublicProposalMarketPair, 'options'> | null | undefined): boolean {
  return !!m?.options && m.options.length > 0;
}

/**
 * Who leads a row and by how much: the leader's consensus minus the best of
 * the other PRICED options. Fewer than two priced options is no leader. A
 * tie at the top is a lead of zero, the first in the proposer's order named.
 */
export function optionLead(
  options: PublicProposalOptionQuote[] | null | undefined,
): { leader: PublicProposalOptionQuote; runnerUp: PublicProposalOptionQuote; lead: number } | null {
  const priced = (options ?? []).filter(isPricedOption);
  if (priced.length < 2) return null;
  let leader = priced[0];
  for (const o of priced) if ((o.consensus as number) > (leader.consensus as number)) leader = o;
  const rest = priced.filter(o => o !== leader);
  let runnerUp = rest[0];
  for (const o of rest) if ((o.consensus as number) > (runnerUp.consensus as number)) runnerUp = o;
  return { leader, runnerUp, lead: (leader.consensus as number) - (runnerUp.consensus as number) };
}

/** One world of a row, in the shape the page trades and draws. */
export interface World {
  key: string;
  marketId: string;
  consensus: number | null;
  probability: number | null;
  liquidity: number | null;
  pool: number | null;
  traders: number | null;
  volume: number | null;
  /** How the world is said beside a verb: "if approved", or the option's own label. */
  label: string;
}

/**
 * The market a world key names on a row: 'approved' / 'declined' on a pair,
 * an option id on an option row. A key the row does not carry, or a world
 * whose market was never spawned, is no world.
 */
export function worldOf(pair: PublicProposalMarketPair | null | undefined, key: string): World | null {
  if (!pair) return null;
  if (isOptionRow(pair)) {
    const o = pair.options?.find(x => x.id === key);
    if (!o?.marketId) return null;
    return {
      key,
      marketId: o.marketId,
      consensus: o.consensus,
      probability: o.probability,
      liquidity: o.liquidity,
      pool: o.pool,
      traders: o.traders,
      volume: o.volume,
      label: o.label,
    };
  }
  if (key !== 'approved' && key !== 'declined') return null;
  const a = key === 'approved';
  const marketId = a ? pair.approvedMarketId : pair.declinedMarketId;
  if (!marketId) return null;
  return {
    key,
    marketId,
    consensus: a ? pair.approvedConsensus : pair.declinedConsensus,
    probability: a ? pair.approvedProbability : pair.declinedProbability,
    liquidity: a ? pair.approvedLiquidity : pair.declinedLiquidity,
    pool: a ? pair.approvedPool : pair.declinedPool,
    traders: a ? pair.approvedTraders : pair.declinedTraders,
    volume: a ? pair.approvedVolume : pair.declinedVolume,
    label: `if ${key}`,
  };
}

/** What is behind a row: every one of its books, a missing one counting nothing. */
export function pairPool(
  m: Pick<PublicProposalMarketPair, 'approvedPool' | 'declinedPool'> & {
    options?: Array<{ pool?: number | null }> | null;
  },
): number {
  const options = (m.options ?? []).reduce((s, o) => s + (o.pool ?? 0), 0);
  return (m.approvedPool ?? 0) + (m.declinedPool ?? 0) + options;
}

/**
 * The ids of typed labels: lowercased and hyphenated, at most 24 characters,
 * deduplicated with a number from 2, never a reserved branch word, and never
 * empty (a label with no letters or digits becomes option-<n>).
 */
export function optionIdsOf(labels: string[]): string[] {
  const taken = new Set<string>(RESERVED_OPTION_IDS);
  const trimEnd = (s: string) => s.replace(/-+$/, '');
  return labels.map((label, i) => {
    let base = trimEnd(
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+/, '')
        .slice(0, MAX_OPTION_ID),
    );
    if (!base) base = `option-${i + 1}`;
    let id = base;
    for (let n = 2; taken.has(id); n++) {
      const suffix = `-${n}`;
      id = trimEnd(base.slice(0, MAX_OPTION_ID - suffix.length)) + suffix;
    }
    taken.add(id);
    return id;
  });
}

/** What the form posts from its label fields: the filled labels with their
 *  ids, or nothing when fewer than two are filled (a two-branch proposal). */
export function optionsFromLabels(labels: string[]): Array<{ id: string; label: string }> | undefined {
  const filled = labels.map(l => l.trim()).filter(Boolean);
  if (filled.length < 2) return undefined;
  const ids = optionIdsOf(filled);
  return filled.map((label, i) => ({ id: ids[i], label }));
}
