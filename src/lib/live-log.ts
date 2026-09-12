import type { ActionRow } from './api';

/**
 * The floor's Live column, as data (docs/ui-conventions.md, "The live log").
 * The rows are the public actions log for one workspace, newest first. A
 * slow workspace shows them one by one; a fast one (a decision window of five
 * minutes or less) groups them into one block per proposal, because a floor
 * that decides every minute otherwise prints four near-identical lines a
 * minute.
 */

/** A workspace whose proposals decide this fast is grouped by proposal. */
export const FAST_DECISION_MINUTES = 5;

export function isFastWorkspace(decisionMinutes: number | null | undefined): boolean {
  return typeof decisionMinutes === 'number' && decisionMinutes > 0 && decisionMinutes <= FAST_DECISION_MINUTES;
}

/** Where a grouped proposal stands. */
export type LiveStatus =
  | { kind: 'open' }
  | { kind: 'chosen'; label: string }
  | { kind: 'approved' }
  | { kind: 'declined' }
  | { kind: 'lapsed' };

export type LiveGroup = {
  type: 'group';
  /** The proposal's number on its floor. */
  number: number;
  title: string;
  href: string;
  status: LiveStatus;
  /** What the proposal's books were funded with, in credits, or null. */
  openedWith: number | null;
  openedAt: string;
  /** Its own trades and orders, newest first. */
  rows: ActionRow[];
};

export type LiveEntry = { type: 'row'; row: ActionRow } | LiveGroup;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The entries the column draws, newest first. On a slow workspace, one per
 * row in the order served. On a fast one: a proposal row opens a group; a
 * funding or decision row naming that proposal's number sets what it opened
 * with and where it stands; a trade or order names no proposal, so it belongs
 * to the newest proposal posted at or before it; anything else, and a trade
 * older than every proposal in the window, stands alone. Entries are ordered
 * by their newest instant.
 */
export function liveEntries(rows: ActionRow[], fast: boolean): LiveEntry[] {
  if (!fast) return rows.map(row => ({ type: 'row', row }));

  const t = (at: string) => {
    const ms = Date.parse(at);
    return Number.isFinite(ms) ? ms : 0;
  };
  // Two passes, so a funding row stamped a hair before its proposal row still
  // finds its group: every proposal first, then everything that refers to one.
  const groups = new Map<number, LiveGroup & { newest: number }>();
  for (const row of rows) {
    const n = num(row.detail?.number);
    if (row.kind !== 'proposal' || n === null || groups.has(n)) continue;
    groups.set(n, {
      type: 'group',
      number: n,
      title: typeof row.detail.title === 'string' ? row.detail.title : '',
      href: row.href,
      status: { kind: 'open' },
      openedWith: null,
      openedAt: row.at,
      rows: [],
      newest: t(row.at),
    });
  }
  // Proposals by posting instant, for "the newest posted at or before".
  const posted = [...groups.values()].sort((a, b) => t(a.openedAt) - t(b.openedAt));
  const loose: ActionRow[] = [];

  for (const row of rows) {
    if (row.kind === 'proposal' && num(row.detail?.number) !== null) continue;
    const n = num(row.detail?.number);
    const own = n !== null ? groups.get(n) : undefined;
    if (own && row.kind === 'liquidity') {
      const amount = num(row.detail.amount);
      if (amount !== null) own.openedWith = (own.openedWith ?? 0) + amount;
      own.newest = Math.max(own.newest, t(row.at));
      continue;
    }
    if (own && row.kind === 'decision') {
      const option = row.detail.option as { label?: unknown } | undefined;
      const status = row.detail.status;
      own.status =
        option && typeof option.label === 'string'
          ? { kind: 'chosen', label: option.label }
          : status === 'declined' || status === 'lapsed'
            ? { kind: status }
            : { kind: 'approved' };
      own.newest = Math.max(own.newest, t(row.at));
      continue;
    }
    if (row.kind === 'trade' || row.kind === 'order') {
      const at = t(row.at);
      let home: (LiveGroup & { newest: number }) | undefined;
      for (const g of posted) if (t(g.openedAt) <= at) home = g;
      if (home) {
        home.rows.push(row);
        home.newest = Math.max(home.newest, at);
        continue;
      }
    }
    loose.push(row);
  }

  const dated: Array<{ at: number; entry: LiveEntry }> = [
    ...[...groups.values()].map(({ newest, ...g }) => ({
      at: newest,
      entry: { ...g, rows: [...g.rows].sort((a, b) => t(b.at) - t(a.at)) } as LiveEntry,
    })),
    ...loose.map(row => ({ at: t(row.at), entry: { type: 'row', row } as LiveEntry })),
  ];
  dated.sort((a, b) => b.at - a.at);
  return dated.map(d => d.entry);
}

/** A trade in a group, short: "bought higher, 151 cr, 16.7 → 18.8". Anything
 *  without those numbers keeps its own sentence. */
export function shortTradeText(row: ActionRow): string {
  const d = row.detail ?? {};
  const cost = num(d.cost);
  const before = num(d.callBefore);
  const after = num(d.callAfter);
  if (row.kind !== 'trade' || cost === null || before === null || after === null || typeof d.direction !== 'string') {
    return row.text;
  }
  const verb = d.side === 'sell' ? 'sold' : 'bought';
  return `${verb} ${d.direction}, ${Math.round(cost)} cr, ${before.toFixed(1)} → ${after.toFixed(1)}`;
}
