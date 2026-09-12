import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import type { ActionRow } from '../../lib/api';
import { clockOf } from '../../lib/viewer-time';
import { LiveLogBlock, LiveLogStrip } from '../FloorLiveLog';

/**
 * The floor's Live column and its folded strip (docs/ui-conventions.md,
 * "The live log"; Viktor 2026-09-12: "show somewhere a realtime log of what
 * happened for a given workspace"; design direction A).
 */

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

describe('the folded strip under the verbs', () => {
  function strip(rows: ActionRow[] = TELARCHY) {
    return render(
      <MemoryRouter>
        <LiveLogStrip slug="telarchy" rows={rows} fast={false} newIds={new Set()} onSeen={() => {}} />
      </MemoryRouter>,
    );
  }

  test('folded, it is one line: the live dot, the newest row, its time', () => {
    const { container } = strip();
    const line = container.querySelector('.pubws-live-strip-line') as HTMLButtonElement;
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(line.querySelector('.pubws-live-dot')).toBeTruthy();
    expect(line.textContent).toContain('Profitable forecasters read 9, was 8');
    expect(line.textContent).toContain(clockOf('2026-09-12T18:40:06Z'));
    expect(container.querySelector('.pubws-live')).toBeNull();
  });

  test('pressing the line opens the block in place, and pressing again folds it', () => {
    const { container } = strip();
    const line = container.querySelector('.pubws-live-strip-line') as HTMLButtonElement;
    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.pubws-live')).toBeTruthy();
    fireEvent.click(line);
    expect(container.querySelector('.pubws-live')).toBeNull();
  });

  test('with no rows the strip is not drawn at all', () => {
    const { container } = strip([]);
    expect(container.querySelector('.pubws-live-strip')).toBeNull();
  });
});
