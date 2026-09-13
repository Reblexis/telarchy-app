import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionRow } from '../../lib/api';
import { clockOf } from '../../lib/viewer-time';
import { LiveLogBlock, LiveLogStrip } from '../FloorLiveLog';

/**
 * The floor's Live column and its folded strip (docs/ui-conventions.md,
 * "The live log"; Viktor 2026-09-12: "show somewhere a realtime log of what
 * happened for a given workspace"; design direction A).
 */

const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const r = (over: Partial<ActionRow> & Pick<ActionRow, 'id' | 'at' | 'kind' | 'text'>): ActionRow => ({
  workspace: { slug: 'snake', name: 'Snake' },
  actor: { id: 'snake', handle: 'snake' },
  detail: {},
  href: '/snake',
  ...over,
});

const SNAKE: ActionRow[] = [
  r({
    id: 'trade:t95',
    at: '2026-09-12T20:21:06Z',
    kind: 'trade',
    actor: { id: 'v', handle: 'vi0' },
    text: 'bought 306.34 higher shares on Reached length for 151.18 cr, call 16.71 to 18.82',
    detail: { side: 'buy', direction: 'higher', cost: 151.18, callBefore: 16.71, callAfter: 18.82 },
    href: '/snake#market=m&trade=t95',
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
    text: 'proposed "Game 2, attempt 223, move 95"',
    detail: { event: 'posted', number: 95, title: 'Game 2, attempt 223, move 95' },
    href: '/snake/p/95',
  }),
  r({
    id: 'dec:94',
    at: '2026-09-12T20:20:58Z',
    kind: 'decision',
    text: 'approved "Game 2, attempt 223, move 94", choosing "Turn left"',
    detail: { number: 94, status: 'approved', option: { id: 'left', label: 'Turn left' } },
    href: '/snake/p/94',
  }),
  r({
    id: 'prop:94',
    at: '2026-09-12T20:20:00Z',
    kind: 'proposal',
    text: 'proposed "Game 2, attempt 223, move 94"',
    detail: { event: 'posted', number: 94, title: 'Game 2, attempt 223, move 94' },
    href: '/snake/p/94',
  }),
];

const TELARCHY: ActionRow[] = [
  r({
    id: 'reading:1',
    at: '2026-09-12T18:40:06Z',
    kind: 'reading',
    actor: null,
    text: 'Profitable forecasters read 9, was 8',
    workspace: { slug: 'telarchy', name: 'Telarchy' },
    href: '/telarchy',
  }),
  r({
    id: 'trade:2',
    at: '2026-09-12T16:26:13Z',
    kind: 'trade',
    actor: { id: 'w', handle: 'Wobert' },
    text: 'bought 35.58 lower shares on Telarchy revenue (USD) (2026-09) for 34 cr, call 44.67 to 44.35',
    workspace: { slug: 'telarchy', name: 'Telarchy' },
    href: '/telarchy#market=x&trade=2',
  }),
];

/** A fast floor: `groups` proposals a minute apart, each funded with 3,000 cr
 *  and traded `trades` times, served newest first like the log. */
function fastFloor(groups: number, trades: number): ActionRow[] {
  const out: ActionRow[] = [];
  for (let n = 1; n <= groups; n++) {
    const base = Date.parse('2026-09-13T13:00:00Z') + n * 60_000;
    const iso = (s: number) => new Date(base + s * 1000).toISOString();
    const title = `Game 3, attempt 1, move ${n}`;
    out.push(
      r({
        id: `prop:${n}`,
        at: iso(0),
        kind: 'proposal',
        text: `proposed "${title}"`,
        detail: { number: n, title },
        href: `/snake/p/${n}`,
      }),
      r({
        id: `liq:${n}`,
        at: iso(0.5),
        kind: 'liquidity',
        text: 'funded',
        detail: { amount: 3000, number: n, title },
        href: `/snake/p/${n}`,
      }),
    );
    for (let t = 1; t <= trades; t++) {
      out.push(
        r({
          id: `trade:${n}.${t}`,
          at: iso(t * 5),
          kind: 'trade',
          actor: { id: 'v', handle: 'vi0' },
          text: 'bought',
          detail: { side: 'buy', direction: 'higher', cost: 14, callBefore: 18.3, callAfter: 19.1 },
          href: `/snake#market=m&trade=${n}.${t}`,
        }),
      );
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** A slow floor with `count` readings a minute apart, newest first. */
function slowFloor(count: number): ActionRow[] {
  return Array.from({ length: count }, (_, i) =>
    r({
      id: `reading:${i}`,
      at: new Date(Date.parse('2026-09-13T12:00:00Z') - i * 60_000).toISOString(),
      kind: 'reading',
      actor: null,
      text: `Profitable forecasters read ${i}`,
      workspace: { slug: 'telarchy', name: 'Telarchy' },
      href: '/telarchy',
    }),
  );
}

function block(props: Partial<Parameters<typeof LiveLogBlock>[0]> = {}) {
  return render(
    <MemoryRouter>
      <LiveLogBlock slug="telarchy" rows={TELARCHY} fast={false} newIds={new Set()} onSeen={() => {}} {...props} />
    </MemoryRouter>,
  );
}

describe('the Live block', () => {
  test('a head with the live dot and "Live", and "All activity" linking to the workspace log', () => {
    const { container } = block({ slug: 'snake' });
    const head = container.querySelector('.pubws-live-head') as HTMLElement;
    expect(within(head).getByText('Live')).toBeTruthy();
    expect(head.querySelector('.pubws-live-dot')).toBeTruthy();
    expect(within(head).getByRole('link', { name: 'All activity' }).getAttribute('href')).toBe('/snake/log');
  });

  test('a slow workspace: one row per action, time in the viewer zone, the actor in bold, the whole row a link', () => {
    const { container } = block();
    const rows = [...container.querySelectorAll('.pubws-live-row')] as HTMLAnchorElement[];
    expect(rows).toHaveLength(2);
    expect(rows[1].getAttribute('href')).toBe('/telarchy#market=x&trade=2');
    expect(rows[1].querySelector('.pubws-live-time')?.textContent).toBe(clockOf('2026-09-12T16:26:13Z'));
    expect(rows[1].querySelector('.pubws-live-who')?.textContent).toBe('Wobert');
    expect(rows[1].textContent).toContain('bought 35.58 lower shares on Telarchy revenue');
    // A row with no actor prints no empty name.
    expect(rows[0].querySelector('.pubws-live-who')).toBeNull();
    // Its kind's name sits over the sentence.
    expect(rows[1].querySelector('.pubws-live-kind')?.textContent?.toLowerCase()).toBe('trade');
  });

  test('A FAST WORKSPACE IS GROUPED BY PROPOSAL: the title, where it stands, what it opened with, and short trades', () => {
    const { container } = block({ slug: 'snake', rows: SNAKE, fast: true });
    // Compact first: the older group is behind "Show 1 more".
    fireEvent.click(container.querySelector('.pubws-live-more') as HTMLButtonElement);
    const groups = [...container.querySelectorAll('.pubws-live-group')] as HTMLElement[];
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelector('.pubws-live-group-title')?.textContent).toBe('Game 2, attempt 223, move 95');
    expect(groups[0].querySelector('.pubws-live-status')?.textContent).toBe('open');
    expect(groups[0].textContent).toContain('opened with 3,000 cr');
    expect(groups[0].textContent).toContain('vi0');
    expect(groups[0].textContent).toContain('bought higher, 151 cr, 16.7 → 18.8');
    expect(groups[1].querySelector('.pubws-live-status')?.textContent).toBe('chose Turn left');
    expect((groups[0].querySelector('a.pubws-live-group-title') as HTMLAnchorElement).getAttribute('href')).toBe(
      '/snake/p/95',
    );
  });

  test('a row that arrived since the block first drew is tinted, and the tint clears when the pointer moves over the block', () => {
    const onSeen = vi.fn();
    const { container } = block({ newIds: new Set(['reading:1']), onSeen });
    const rows = [...container.querySelectorAll('.pubws-live-row')];
    expect(rows[0].classList.contains('is-new')).toBe(true);
    expect(rows[1].classList.contains('is-new')).toBe(false);
    fireEvent.mouseMove(container.querySelector('.pubws-live') as Element);
    expect(onSeen).toHaveBeenCalled();
  });

  test('a workspace with no rows says so in one line', () => {
    block({ rows: [] });
    expect(screen.getByText('Nothing has happened here yet.')).toBeTruthy();
  });
});

beforeEach(() => {
  localStorage.clear();
});

const more = (c: HTMLElement) => c.querySelector('.pubws-live-more') as HTMLButtonElement | null;
const drawnRows = (c: HTMLElement) => c.querySelectorAll('.pubws-live-row').length;

describe('the compact Live block', () => {
  test('THE LIVE BLOCK OPENS ON THE NEWEST PROPOSAL ONLY', () => {
    const { container } = block({ slug: 'snake', rows: fastFloor(3, 4), fast: true });
    const groups = [...container.querySelectorAll('.pubws-live-group')];
    expect(groups).toHaveLength(1);
    expect(groups[0].querySelector('.pubws-live-group-title')?.textContent).toBe('Game 3, attempt 1, move 3');
    // Its four trades and its "opened with" line, nothing of the two older proposals.
    expect(drawnRows(container)).toBe(5);
    expect(container.textContent).not.toContain('move 2');
  });

  test('a row standing alone that is newer than the newest proposal stays drawn above it', () => {
    const rows = [
      r({ id: 'comment:1', at: '2026-09-13T14:00:00Z', kind: 'comment', text: 'said hello', href: '/snake' }),
      ...fastFloor(2, 1),
    ];
    const { container } = block({ slug: 'snake', rows, fast: true });
    const list = container.querySelector('.pubws-live-list') as HTMLElement;
    expect(list.children).toHaveLength(2);
    expect(list.children[0].textContent).toContain('said hello');
    expect(list.children[1].querySelector('.pubws-live-group-title')?.textContent).toBe('Game 3, attempt 1, move 2');
  });

  test('a fast floor whose window holds no proposal opens on its newest 5 entries', () => {
    const rows = slowFloor(8);
    const { container } = block({ slug: 'snake', rows, fast: true });
    expect(drawnRows(container)).toBe(5);
    expect(more(container)?.textContent).toBe('Show 3 more');
  });

  test("A SLOW FLOOR'S LIVE BLOCK OPENS ON ITS NEWEST 5 ROWS", () => {
    const rows = slowFloor(12);
    const { container } = block({ rows });
    const drawn = [...container.querySelectorAll('.pubws-live-row')];
    expect(drawn).toHaveLength(5);
    expect(drawn[0].textContent).toContain('Profitable forecasters read 0');
    expect(drawn[4].textContent).toContain('Profitable forecasters read 4');
    expect(more(container)?.textContent).toBe('Show 7 more');
  });

  test('SHOW MORE OPENS THE REST IN PLACE AND SHOW FEWER FOLDS IT BACK', () => {
    const { container } = block({ slug: 'snake', rows: fastFloor(3, 4), fast: true });
    const button = more(container) as HTMLButtonElement;
    // N counts rows, not groups: two hidden groups of four trades and an "opened with" line.
    expect(button.textContent).toBe('Show 10 more');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.querySelector('svg')).toBeTruthy();
    // It is the last thing in the block, under the list.
    expect(follows(container.querySelector('.pubws-live-list') as Element, button)).toBe(true);
    fireEvent.click(button);
    expect(container.querySelectorAll('.pubws-live-group')).toHaveLength(3);
    expect(drawnRows(container)).toBe(15);
    expect(more(container)?.textContent).toBe('Show fewer');
    expect(more(container)?.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(more(container) as HTMLButtonElement);
    expect(container.querySelectorAll('.pubws-live-group')).toHaveLength(1);
    expect(more(container)?.textContent).toBe('Show 10 more');
  });

  test("SHOW MORE OPENS NO FURTHER THAN THE BLOCK'S 30-ROW READ", () => {
    const { container } = block({ rows: slowFloor(40) });
    expect(more(container)?.textContent).toBe('Show 25 more');
    fireEvent.click(more(container) as HTMLButtonElement);
    expect(drawnRows(container)).toBe(30);
  });

  test('NOTHING HIDDEN MEANS NO SHOW MORE ROW', () => {
    const slow = block({ rows: slowFloor(5) });
    expect(drawnRows(slow.container)).toBe(5);
    expect(more(slow.container)).toBeNull();
    slow.unmount();
    const fast = block({ slug: 'snake', rows: fastFloor(1, 3), fast: true });
    expect(more(fast.container)).toBeNull();
    fast.unmount();
    const empty = block({ rows: [] });
    expect(more(empty.container)).toBeNull();
  });

  test('SHOW MORE IS NOT REMEMBERED: the next visit opens compact', () => {
    const first = block({ rows: slowFloor(12) });
    fireEvent.click(more(first.container) as HTMLButtonElement);
    expect(drawnRows(first.container)).toBe(12);
    first.unmount();
    const again = block({ rows: slowFloor(12) });
    expect(drawnRows(again.container)).toBe(5);
  });
});

describe('the fold in the head', () => {
  const head = (c: HTMLElement) => c.querySelector('.pubws-live-head') as HTMLElement;

  test('THE HEAD FOLDS THE LIVE LOG TO ITS HEAD WITH THE NEWEST TIME', () => {
    const rows = fastFloor(3, 4);
    const { container } = block({ slug: 'snake', rows, fast: true });
    const fold = within(head(container)).getByRole('button', { name: 'Fold the live log' });
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    // At the right of the head, after "All activity".
    expect(follows(within(head(container)).getByRole('link', { name: 'All activity' }), fold)).toBe(true);
    expect(fold.parentElement?.lastElementChild).toBe(fold);
    fireEvent.click(fold);
    expect(container.querySelector('.pubws-live-list')).toBeNull();
    expect(container.querySelector('.pubws-live-more')).toBeNull();
    expect(container.querySelector('.pubws-live-group, .pubws-live-row')).toBeNull();
    const h = head(container);
    expect(within(h).getByText('Live')).toBeTruthy();
    expect(h.querySelector('.pubws-live-time')?.textContent).toBe(clockOf(rows[0].at));
    const open = within(h).getByRole('button', { name: 'Open the live log' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(open.querySelector('svg')).toBeTruthy();
    // Unfolding returns to compact, not to wherever Show more was.
    fireEvent.click(open);
    expect(container.querySelectorAll('.pubws-live-group')).toHaveLength(1);
    expect(within(head(container)).getByRole('button', { name: 'Fold the live log' })).toBeTruthy();
    expect(head(container).querySelector('.pubws-live-time')).toBeNull();
  });

  test('A FOLDED LIVE LOG STILL LEADS TO ALL ACTIVITY', () => {
    const { container } = block({ slug: 'snake', rows: SNAKE, fast: true });
    fireEvent.click(within(head(container)).getByRole('button', { name: 'Fold the live log' }));
    const h = head(container);
    expect(within(h).getByRole('link', { name: 'All activity' }).getAttribute('href')).toBe('/snake/log');
    // Right side, in order: the newest time, All activity, the chevron.
    const acts = h.querySelector('.pubws-live-acts') as HTMLElement;
    expect([...acts.children].map(c => c.className)).toEqual(['pubws-live-time', 'pubws-live-all', 'pubws-live-fold']);
  });

  test('A FOLDED LIVE LOG STAYS FOLDED ON THE NEXT VISIT, per floor', () => {
    const first = block({ slug: 'snake', rows: SNAKE, fast: true });
    fireEvent.click(within(head(first.container)).getByRole('button', { name: 'Fold the live log' }));
    expect(localStorage.getItem('telarchy.liveLog.folded.snake')).toBe('1');
    first.unmount();
    const again = block({ slug: 'snake', rows: SNAKE, fast: true });
    expect(again.container.querySelector('.pubws-live-list')).toBeNull();
    expect(within(head(again.container)).getByRole('button', { name: 'Open the live log' })).toBeTruthy();
    again.unmount();
    // Another floor is not folded by it.
    const other = block({ slug: 'telarchy' });
    expect(other.container.querySelector('.pubws-live-list')).toBeTruthy();
    other.unmount();
    // Unfolding is remembered too.
    const snake = block({ slug: 'snake', rows: SNAKE, fast: true });
    fireEvent.click(within(head(snake.container)).getByRole('button', { name: 'Open the live log' }));
    expect(localStorage.getItem('telarchy.liveLog.folded.snake')).toBeNull();
    snake.unmount();
    expect(block({ slug: 'snake', rows: SNAKE, fast: true }).container.querySelector('.pubws-live-list')).toBeTruthy();
  });

  describe('with storage the browser refuses', () => {
    let saved: PropertyDescriptor | undefined;
    beforeEach(() => {
      localStorage.setItem('telarchy.liveLog.folded.snake', '1');
      saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    afterEach(() => {
      if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    });

    test('A BLOCKED STORAGE NEVER BREAKS THE LIVE LOG: not folded, and the fold still works for the visit', () => {
      const { container } = block({ slug: 'snake', rows: SNAKE, fast: true });
      expect(container.querySelector('.pubws-live-list')).toBeTruthy();
      fireEvent.click(within(head(container)).getByRole('button', { name: 'Fold the live log' }));
      expect(container.querySelector('.pubws-live-list')).toBeNull();
      fireEvent.click(within(head(container)).getByRole('button', { name: 'Open the live log' }));
      expect(container.querySelector('.pubws-live-list')).toBeTruthy();
    });
  });

  test("A NEW ROW WHILE FOLDED UPDATES THE HEAD'S TIME", () => {
    const rows = fastFloor(2, 2);
    const props = { slug: 'snake', fast: true, newIds: new Set<string>(), onSeen: () => {} };
    const { container, rerender } = render(
      <MemoryRouter>
        <LiveLogBlock {...props} rows={rows} />
      </MemoryRouter>,
    );
    fireEvent.click(within(head(container)).getByRole('button', { name: 'Fold the live log' }));
    expect(head(container).querySelector('.pubws-live-time')?.textContent).toBe(clockOf(rows[0].at));
    const fresh = r({
      id: 'trade:new',
      at: '2026-09-13T15:47:00Z',
      kind: 'trade',
      actor: { id: 'v', handle: 'vi0' },
      text: 'bought',
      href: '/snake',
    });
    rerender(
      <MemoryRouter>
        <LiveLogBlock {...props} rows={[fresh, ...rows]} newIds={new Set(['trade:new'])} />
      </MemoryRouter>,
    );
    expect(head(container).querySelector('.pubws-live-time')?.textContent).toBe(clockOf('2026-09-13T15:47:00Z'));
    expect(container.querySelector('.pubws-live-list')).toBeNull();
  });
});

describe('the folded strip under the verbs', () => {
  function strip(rows: ActionRow[] = TELARCHY) {
    return render(
      <MemoryRouter>
        <LiveLogStrip slug="telarchy" rows={rows} fast={false} newIds={new Set()} onSeen={() => {}} />
      </MemoryRouter>,
    );
  }

  test('THE LIVE LINE STARTS WITH THE LIVE LABEL: the dot and "Live" in the block head\'s anatomy, then the newest row, its time, the chevron', () => {
    const { container } = strip();
    const line = container.querySelector('.pubws-live-strip-line') as HTMLButtonElement;
    expect(line.getAttribute('aria-expanded')).toBe('false');
    const first = line.firstElementChild as HTMLElement;
    expect(first.classList.contains('pubws-live-title')).toBe(true);
    expect(first.querySelector('.pubws-live-dot')).toBeTruthy();
    expect(first.textContent).toBe('Live');
    const parts = [...line.children].map(c => c.className);
    expect(parts).toEqual(['pubws-live-title', 'pubws-live-strip-text', 'pubws-live-time', 'pubws-live-chev']);
    expect(line.querySelector('.pubws-live-strip-text')?.textContent).toBe('Profitable forecasters read 9, was 8');
    expect(line.querySelector('.pubws-live-time')?.textContent).toBe(clockOf('2026-09-12T18:40:06Z'));
    expect(container.querySelector('.pubws-live')).toBeNull();
  });

  test('PRESSING THE LINE OPENS THE BLOCK AND PRESSING AGAIN FOLDS IT, the open block linking All activity to the workspace log', () => {
    const { container } = strip();
    const line = container.querySelector('.pubws-live-strip-line') as HTMLButtonElement;
    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    const opened = container.querySelector('.pubws-live-strip .pubws-live') as HTMLElement;
    expect(opened).toBeTruthy();
    expect(within(opened).getByRole('link', { name: 'All activity' }).getAttribute('href')).toBe('/telarchy/log');
    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.pubws-live')).toBeNull();
  });

  test('THE STRIP OPENS THE SAME COMPACT BLOCK, with Show more and the fold, even on a floor folded before', () => {
    localStorage.setItem('telarchy.liveLog.folded.snake', '1');
    const { container } = render(
      <MemoryRouter>
        <LiveLogStrip slug="snake" rows={fastFloor(3, 4)} fast newIds={new Set()} onSeen={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(container.querySelector('.pubws-live-strip-line') as HTMLButtonElement);
    const opened = container.querySelector('.pubws-live-strip .pubws-live') as HTMLElement;
    expect(opened.querySelectorAll('.pubws-live-group')).toHaveLength(1);
    expect(opened.querySelector('.pubws-live-more')?.textContent).toBe('Show 10 more');
    const fold = within(opened).getByRole('button', { name: 'Fold the live log' });
    fireEvent.click(opened.querySelector('.pubws-live-more') as HTMLButtonElement);
    expect(opened.querySelectorAll('.pubws-live-group')).toHaveLength(3);
    fireEvent.click(fold);
    expect(opened.querySelector('.pubws-live-list')).toBeNull();
    expect(localStorage.getItem('telarchy.liveLog.folded.snake')).toBe('1');
  });

  test('with no rows the strip is not drawn at all', () => {
    const { container } = strip([]);
    expect(container.querySelector('.pubws-live-strip')).toBeNull();
  });
});
