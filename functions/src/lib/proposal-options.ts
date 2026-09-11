/**
 * Proposals with options (docs/guides/proposals.md, "More than two options").
 *
 * A proposal may carry two to six options in place of the approve/decline
 * pair. This file is the shape of that list and the one arithmetic every
 * reader of an option proposal shares: an option's delta is its consensus
 * minus the best of the OTHER options, so the leader's number is its lead
 * and every other option's is how far it trails. The proposal detail, the
 * floor payload, the brief and the contractor rail all call this rather than
 * each keeping a copy, which is how the two-branch delta came to be quoted
 * two different ways once (notes/otto-brief-misread-2026-08-31.md).
 */

import type { ProposalOption } from '../db/schema';

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;
export const MAX_OPTION_LABEL = 40;
/** A short handle: 1 to 24 of a-z 0-9 -, never the two branch names. */
export const OPTION_ID_RE = /^[a-z0-9-]{1,24}$/;
const RESERVED_IDS = new Set(['approved', 'declined']);

export type ParsedOptions = { ok: true; options: ProposalOption[] | null } | { ok: false; error: string };

/**
 * The option list as posted. Absent or null means the ordinary two-branch
 * proposal; anything else must be a list of two to six { id, label } with
 * unique well-formed ids and labels of 1 to 40 characters, or the whole
 * request is refused with the sentence returned here.
 */
export function parseProposalOptions(raw: unknown): ParsedOptions {
  if (raw === undefined || raw === null) return { ok: true, options: null };
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'options must be a list of { id, label } entries, two to six of them' };
  }
  if (raw.length < MIN_OPTIONS) {
    return { ok: false, error: `options needs at least two entries; one option is a proposal without options` };
  }
  if (raw.length > MAX_OPTIONS) {
    return { ok: false, error: `options may hold at most six entries; this one has ${raw.length}` };
  }
  const seen = new Set<string>();
  const options: ProposalOption[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as { id?: unknown; label?: unknown } | null;
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: `options[${i}] must be an object { id, label }` };
    }
    const id = entry.id;
    if (typeof id !== 'string' || !OPTION_ID_RE.test(id)) {
      return {
        ok: false,
        error: `options[${i}].id must be 1 to 24 characters of a-z, 0-9 and hyphen (got ${JSON.stringify(id)})`,
      };
    }
    if (RESERVED_IDS.has(id)) {
      return { ok: false, error: `options[${i}].id may not be "${id}": that name belongs to the two-branch proposal` };
    }
    if (seen.has(id)) {
      return { ok: false, error: `options ids must be unique within the proposal; "${id}" appears twice` };
    }
    seen.add(id);
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) {
      return { ok: false, error: `options[${i}].label is required: the words a reader chooses between` };
    }
    if (label.length > MAX_OPTION_LABEL) {
      return { ok: false, error: `options[${i}].label must be at most ${MAX_OPTION_LABEL} characters` };
    }
    options.push({ id, label });
  }
  return { ok: true, options };
}

/** How close two consensus values must be to count as the same price, so
 *  float noise never names a leader. */
export const TIE_EPSILON = 1e-9;

export interface OptionDeltas {
  /** The unique priced option with the strictly highest consensus; null with
   *  fewer than two priced, and null on a tie at the top. */
  leaderId: string | null;
  /** Per option id: its consensus minus the best of the other options; null where it, or every other, is unpriced. */
  deltas: Map<string, number | null>;
  /** The leader's lead, what the row and the floor's strips carry: 0 on a
   *  tie at the top, null with fewer than two priced. */
  rowDelta: number | null;
}

/**
 * The one arithmetic. An option with no price has no delta; a row where
 * fewer than two options are priced has no leader and no delta at all,
 * because a lead over nobody is not a number. A tie at the top (two or more
 * priced options within TIE_EPSILON of the highest) has no leader either:
 * the row's delta is 0 and every option's delta is its gap to that shared
 * top (docs/guides/proposals.md, "The number you are reading").
 */
export function optionDeltas(entries: Array<{ id: string; consensus: number | null }>): OptionDeltas {
  const priced = entries.filter(e => e.consensus !== null && Number.isFinite(e.consensus));
  const deltas = new Map<string, number | null>();
  if (priced.length < 2) {
    for (const e of entries) deltas.set(e.id, null);
    return { leaderId: null, deltas, rowDelta: null };
  }
  let leader = priced[0];
  for (const e of priced) if ((e.consensus as number) > (leader.consensus as number)) leader = e;
  for (const e of entries) {
    if (e.consensus === null || !Number.isFinite(e.consensus)) {
      deltas.set(e.id, null);
      continue;
    }
    let bestOther: number | null = null;
    for (const o of priced) {
      if (o.id === e.id) continue;
      if (bestOther === null || (o.consensus as number) > bestOther) bestOther = o.consensus as number;
    }
    const d = bestOther === null ? null : e.consensus - bestOther;
    deltas.set(e.id, d !== null && Math.abs(d) <= TIE_EPSILON ? 0 : d);
  }
  const rowDelta = deltas.get(leader.id) ?? null;
  return { leaderId: rowDelta === 0 ? null : leader.id, deltas, rowDelta };
}

/** The label an option id was posted with, or the id itself for a row whose list no longer names it. */
export function optionLabel(options: ProposalOption[] | null | undefined, id: string): string {
  return options?.find(o => o.id === id)?.label ?? id;
}

/** True where a market's branch is an option rather than one of the two worlds. */
export function isOptionBranch(branch: string | null | undefined): boolean {
  return !!branch && !RESERVED_IDS.has(branch);
}
