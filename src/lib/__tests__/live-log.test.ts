import { describe, expect, test } from 'vitest';
import type { ActionRow } from '../api';
import { isFastWorkspace, liveEntries, shortTradeText } from '../live-log';

/**
 * The floor's Live column (docs/ui-conventions.md, "The live log"): a fast
 * workspace is grouped by proposal, a slow one is one row per action, and a
 * trade in a group reads short. Rows arrive newest first, as the actions log
 * serves them.
 */

const r = (over: Partial<ActionRow> & Pick<ActionRow, 'id' | 'at' | 'kind' | 'text'>): ActionRow => ({
  workspace: { slug: 'snake', name: 'Snake' },
  actor: { id: 'snake', handle: 'snake' },
  detail: {},
  href: '/snake',
  ...over,
});

// Newest first, the shape of GET /api/data-room/actions?workspace=snake.
const SNAKE: ActionRow[] = [
  r({
    id: 'trade:t95',
    at: '2026-09-12T20:21:06Z',
    kind: 'trade',
    actor: { id: 'v', handle: 'vi0' },
    text: 'bought 306.34 higher shares on Reached length (2026-09-12T20:48) for 151.18 cr, call 16.71 to 18.82',
    detail: { side: 'buy', direction: 'higher', cost: 151.18, callBefore: 16.71, callAfter: 18.82 },
  }),
  r({
    id: 'liq:95',
    at: '2026-09-12T20:21:00.5Z',
    kind: 'liquidity',
    text: 'funded "Game 2, attempt 223, move 95" with 3000 cr of liquidity',
    detail: { event: 'subsidy', amount: 3000, number: 95, title: 'Game 2, attempt 223, move 95' },
    href: '/snake/p/95',
  }),
  r({
    id: 'prop:95',
    at: '2026-09-12T20:21:00Z',
    kind: 'proposal',
    text: 'proposed "Game 2, attempt 223, move 95", choosing between "Continue forward", "Turn left", "Turn right"',
    detail: { event: 'posted', number: 95, title: 'Game 2, attempt 223, move 95' },
    href: '/snake/p/95',
  }),
  r({
    id: 'dec:94',
    at: '2026-09-12T20:20:58Z',
    kind: 'decision',
    text: 'approved "Game 2, attempt 223, move 94", choosing "Turn left"',
    detail: {
      number: 94,
      title: 'Game 2, attempt 223, move 94',
      status: 'approved',
      option: { id: 'left', label: 'Turn left' },
    },
    href: '/snake/p/94',
  }),
  r({
    id: 'trade:t94',
    at: '2026-09-12T20:20:06Z',
    kind: 'trade',
    actor: { id: 'v', handle: 'vi0' },
    text: 'bought 364.07 higher shares ...',
    detail: { side: 'buy', direction: 'higher', cost: 181.68, callBefore: 16.71, callAfter: 19.22 },
  }),
  r({
    id: 'liq:94',
    at: '2026-09-12T20:20:00.5Z',
    kind: 'liquidity',
    text: 'funded "Game 2, attempt 223, move 94" with 3000 cr of liquidity',
    detail: { event: 'subsidy', amount: 3000, number: 94, title: 'Game 2, attempt 223, move 94' },
    href: '/snake/p/94',
  }),
  r({
    id: 'prop:94',
    at: '2026-09-12T20:20:00Z',
    kind: 'proposal',
    text: 'proposed "Game 2, attempt 223, move 94", ...',
    detail: { event: 'posted', number: 94, title: 'Game 2, attempt 223, move 94' },
    href: '/snake/p/94',
  }),
  // Older than every proposal in the window: nothing to group it under.
  r({
    id: 'trade:early',
    at: '2026-09-12T20:19:30Z',
    kind: 'trade',
    actor: { id: 'w', handle: 'Wobert' },
    text: 'bought 10 lower shares ...',
    detail: { side: 'buy', direction: 'lower', cost: 5, callBefore: 17, callAfter: 16.9 },
  }),
];

describe('a slow workspace: every action stands alone', () => {
  test('rows come back one entry each, in the order served', () => {
    const out = liveEntries(SNAKE, false);
    expect(out.map(e => (e.type === 'row' ? e.row.id : 'group'))).toEqual(SNAKE.map(x => x.id));
  });
});

describe('A FAST WORKSPACE IS GROUPED BY PROPOSAL', () => {
  const out = liveEntries(SNAKE, true);
  const groups = out.filter(e => e.type === 'group');

  test('one group per proposal in the window, newest proposal first', () => {
    expect(groups.map(g => (g.type === 'group' ? g.number : 0))).toEqual([95, 94]);
  });

  test('an undecided proposal is open, and its funding is said as what it opened with, not as a row', () => {
    const g = groups[0];
    if (g.type !== 'group') throw new Error('group');
    expect(g.status).toEqual({ kind: 'open' });
    expect(g.openedWith).toBe(3000);
    expect(g.title).toBe('Game 2, attempt 223, move 95');
    expect(g.href).toBe('/snake/p/95');
    expect(g.rows.map(x => x.id)).toEqual(['trade:t95']);
  });

  test('a decided proposal names the option chosen, and holds the trade made while it was open', () => {
    const g = groups[1];
    if (g.type !== 'group') throw new Error('group');
    expect(g.status).toEqual({ kind: 'chosen', label: 'Turn left' });
    expect(g.rows.map(x => x.id)).toEqual(['trade:t94']);
  });

  test('a trade older than every proposal in the window stands alone, last', () => {
    const last = out[out.length - 1];
    expect(last.type).toBe('row');
    if (last.type === 'row') expect(last.row.id).toBe('trade:early');
  });

  test('a decision without an option says approved, declined or lapsed', () => {
    const rows: ActionRow[] = [
      r({
        id: 'dec:7',
        at: '2026-09-12T10:05:00Z',
        kind: 'decision',
        text: 'declined "x"',
        detail: { number: 7, status: 'declined' },
      }),
      r({
        id: 'prop:7',
        at: '2026-09-12T10:00:00Z',
        kind: 'proposal',
        text: 'proposed "x"',
        detail: { event: 'posted', number: 7, title: 'x' },
      }),
      r({
        id: 'dec:6',
        at: '2026-09-12T09:05:00Z',
        kind: 'decision',
        text: '"y" lapsed undecided',
        detail: { number: 6, status: 'lapsed' },
      }),
      r({
        id: 'prop:6',
        at: '2026-09-12T09:00:00Z',
        kind: 'proposal',
        text: 'proposed "y"',
        detail: { event: 'posted', number: 6, title: 'y' },
      }),
    ];
    const gs = liveEntries(rows, true).filter(e => e.type === 'group');
    expect(gs.map(g => (g.type === 'group' ? g.status : null))).toEqual([{ kind: 'declined' }, { kind: 'lapsed' }]);
  });

  test('a comment or a reading on a fast workspace stands alone, placed by its time', () => {
    const rows: ActionRow[] = [
      SNAKE[0],
      r({ id: 'comment:c', at: '2026-09-12T20:21:03Z', kind: 'comment', text: 'on Reached length: nice' }),
      ...SNAKE.slice(1, 3),
    ];
    const kinds = liveEntries(rows, true).map(e => (e.type === 'row' ? e.row.id : `group:${e.number}`));
    expect(kinds).toEqual(['group:95', 'comment:c']);
  });
});

describe('a trade in a group reads short', () => {
  test('the side, the credits rounded, and the call before and after to one decimal', () => {
    expect(shortTradeText(SNAKE[0])).toBe('bought higher, 151 cr, 16.7 → 18.8');
  });
  test('a sale says sold', () => {
    expect(
      shortTradeText(
        r({
          id: 's',
          at: '2026-09-12T20:00:00Z',
          kind: 'trade',
          text: 'sold ...',
          detail: { side: 'sell', direction: 'lower', cost: 12.4, callBefore: 9, callAfter: 9.4 },
        }),
      ),
    ).toBe('sold lower, 12 cr, 9.0 → 9.4');
  });
  test('a row without the numbers keeps its own sentence', () => {
    expect(
      shortTradeText(
        r({
          id: 'o',
          at: '2026-09-12T20:00:00Z',
          kind: 'order',
          text: 'placed a limit order: up to 230 cr on higher at 18',
        }),
      ),
    ).toBe('placed a limit order: up to 230 cr on higher at 18');
  });
});

describe('what counts as a fast workspace', () => {
  test('a decision window of five minutes or less', () => {
    expect(isFastWorkspace(1)).toBe(true);
    expect(isFastWorkspace(5)).toBe(true);
    expect(isFastWorkspace(6)).toBe(false);
    expect(isFastWorkspace(1440)).toBe(false);
    expect(isFastWorkspace(undefined)).toBe(false);
  });
});
