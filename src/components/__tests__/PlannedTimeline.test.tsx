import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * "What is planned" in the data room (docs/data-room.md, "What is planned";
 * docs/ui-conventions.md, "The data room", the PlannedTimeline paragraph).
 * The geometry is the model's spec (timeline-model.test.ts); this pins what a
 * visitor and a manager see, that the section never disappears, the head's
 * anatomy (label, the floor's name as meta), the eight-row fold, and what the
 * two owner controls call.
 */

const h = vi.hoisted(() => ({
  getDataRoomPlanned: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: {
    getDataRoomPlanned: h.getDataRoomPlanned,
    createPlan: h.createPlan,
    updatePlan: h.updatePlan,
  },
}));

import { PlannedTimeline } from '../PlannedTimeline';

const NOW = new Date(2026, 8, 11, 10, 0, 0, 0);
const DAY = 864e5;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const dayMonth = (ms: number) =>
  new Date(NOW.getTime() + ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const WS = { id: 'ws-1', slug: 'telarchy', name: 'Telarchy' };

const ITEMS = [
  {
    kind: 'decision',
    id: 'd1',
    title: 'Daily update for a week',
    start: at(-2 * DAY),
    end: at(DAY),
    href: '/telarchy/p/36',
  },
  {
    kind: 'proposal',
    id: 'p1',
    title: 'Ship the results post',
    start: at(-DAY),
    end: at(2 * DAY),
    href: '/telarchy/p/1',
  },
  {
    kind: 'book',
    id: 'b1',
    title: 'Active forecasters, this week',
    start: at(-3 * DAY),
    end: at(3 * DAY),
    href: '/telarchy#market=b1',
  },
  {
    kind: 'plan',
    id: 'pl1',
    title: 'Call with Seer',
    start: null,
    end: at(4 * DAY),
    href: null,
    done: false,
    description: 'Thursday',
  },
  {
    kind: 'plan',
    id: 'pl2',
    title: 'Write the September post',
    start: null,
    end: null,
    href: null,
    done: false,
    description: null,
  },
];

/** Twelve dated plans, one a day, for the fold. */
const MANY = Array.from({ length: 12 }, (_, i) => ({
  kind: 'plan',
  id: `m${i}`,
  title: `Plan number ${i}`,
  start: null,
  end: at((i + 1) * 0.4 * DAY),
  href: null,
  done: false,
}));

const planned = (items: unknown[], workspace: typeof WS | null = WS) => ({
  workspace,
  now: NOW.toISOString(),
  items,
});

const renderIt = (props: Partial<Parameters<typeof PlannedTimeline>[0]> = {}) =>
  render(
    <MemoryRouter>
      <PlannedTimeline workspaceId="ws-1" canManage={false} initialNow={NOW} {...props} />
    </MemoryRouter>,
  );

const section = () => document.querySelector('section.dr-planned');

beforeEach(() => {
  h.getDataRoomPlanned.mockReset();
  h.createPlan.mockReset();
  h.updatePlan.mockReset();
  h.getDataRoomPlanned.mockResolvedValue(planned(ITEMS));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('what is planned, in the data room', () => {
  test("fetches the room's own read on mount and draws the head: label, the floor's name as meta", async () => {
    renderIt();
    await waitFor(() => expect(h.getDataRoomPlanned).toHaveBeenCalledTimes(1));
    await screen.findByText('Ship the results post');
    const sec = section()!;
    expect(sec).toBeTruthy();
    expect(sec.getAttribute('aria-label')).toBe('What is planned');
    expect(sec.querySelector('.dr-tl-label')?.textContent).toBe('What is planned');
    expect(sec.querySelector('.dr-tl-floor')?.textContent).toBe('Telarchy');
  });

  test('tells the page which floor answered, so it can ask who may manage it', async () => {
    const onWorkspace = vi.fn();
    renderIt({ onWorkspace });
    await waitFor(() => expect(onWorkspace).toHaveBeenCalledWith(WS));
  });

  test('a visitor with nothing planned still sees the head and one line, and no "+ plan"', async () => {
    h.getDataRoomPlanned.mockResolvedValue(planned([]));
    renderIt();
    expect(await screen.findByText('Nothing planned yet.')).toBeTruthy();
    expect(section()).toBeTruthy();
    expect(screen.getByText('What is planned')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ plan' })).toBeNull();
  });

  test('a manager with nothing planned sees the head, the empty line and "+ plan"', async () => {
    h.getDataRoomPlanned.mockResolvedValue(planned([]));
    renderIt({ canManage: true });
    expect(await screen.findByText('Nothing planned yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ plan' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Range' })).toBeTruthy();
  });

  test('a fresh instance with no platform floor says nothing is planned and names no floor', async () => {
    h.getDataRoomPlanned.mockResolvedValue(planned([], null));
    renderIt();
    expect(await screen.findByText('Nothing planned yet.')).toBeTruthy();
    expect(section()!.querySelector('.dr-tl-floor')).toBeNull();
  });

  test('a failed read is a different sentence from nothing planned, and the section stays', async () => {
    h.getDataRoomPlanned.mockRejectedValue(new Error('boom'));
    renderIt();
    expect(await screen.findByText('The calendar would not open.')).toBeTruthy();
    expect(screen.queryByText('Nothing planned yet.')).toBeNull();
    expect(section()).toBeTruthy();
  });

  test('each item is one row, in end order, and the row is the link to the thing it is', async () => {
    renderIt();
    await screen.findByText('Ship the results post');
    const titles = Array.from(document.querySelectorAll('.dr-tl-row .dr-tl-title')).map(e => e.textContent);
    expect(titles).toEqual([
      'Daily update for a week',
      'Ship the results post',
      'Active forecasters, this week',
      'Call with Seer',
    ]);
    expect(screen.getByText('Ship the results post').closest('a')?.getAttribute('href')).toBe('/telarchy/p/1');
    expect(screen.getByText('Active forecasters, this week').closest('a')?.getAttribute('href')).toBe(
      '/telarchy#market=b1',
    );
  });

  test('the title line is one line cut with an ellipsis, and the bar carries no words', async () => {
    renderIt();
    const title = await screen.findByText('Ship the results post');
    expect(title.className).toContain('dr-tl-title');
    const row = title.closest('.dr-tl-row')!;
    const bar = row.querySelector('.dr-tl-bar')!;
    expect(bar.textContent).toBe('');
    expect(bar.className).toContain('dr-tl-bar--proposal');
    // The book began three days ago, before the week window opens: its bar is open on the left.
    const book = screen.getByText('Active forecasters, this week').closest('.dr-tl-row')!.querySelector('.dr-tl-bar')!;
    expect(book.className).toContain('dr-tl-bar--book');
    expect(book.className).toContain('dr-tl-bar--open-left');
  });

  test('the meta at the end of the title line names the end per kind', async () => {
    renderIt();
    await screen.findByText('Ship the results post');
    expect(screen.getByText('decides tomorrow')).toBeTruthy();
    expect(screen.getByText(`by ${dayMonth(2 * DAY)}`)).toBeTruthy();
    expect(screen.getByText(`settles ${dayMonth(3 * DAY)}`)).toBeTruthy();
    expect(screen.getByText(`due ${dayMonth(4 * DAY)}`)).toBeTruthy();
  });

  test('a plan row has no address: it is a button that opens its own words', async () => {
    renderIt();
    const row = (await screen.findByText('Call with Seer')).closest('button');
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(screen.getByText('Thursday')).toBeTruthy();
    expect(document.querySelector('.dr-tl-words')).toBeTruthy();
  });

  test('undated items are listed under "No date" with no meta', async () => {
    renderIt();
    expect(await screen.findByText('No date')).toBeTruthy();
    const row = screen.getByText('Write the September post').closest('.dr-tl-undated-row')!;
    expect(row.querySelector('.dr-tl-meta')).toBeNull();
  });

  test('a manager gets a done tick on each plan row; a visitor gets none', async () => {
    const { unmount } = renderIt();
    await screen.findByText('Call with Seer');
    expect(screen.queryByRole('button', { name: 'Mark done: Call with Seer' })).toBeNull();
    unmount();
    renderIt({ canManage: true });
    expect(await screen.findByRole('button', { name: 'Mark done: Call with Seer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark done: Write the September post' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark done: Ship the results post' })).toBeNull();
  });

  test('the done tick marks the plan done on that floor and refetches', async () => {
    h.updatePlan.mockResolvedValue({ id: 'pl1', doneAt: NOW.toISOString() });
    renderIt({ canManage: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Mark done: Call with Seer' }));
    await waitFor(() => expect(h.updatePlan).toHaveBeenCalledWith('ws-1', 'pl1', { done: true }));
    await waitFor(() => expect(h.getDataRoomPlanned).toHaveBeenCalledTimes(2));
  });

  test('a manager with no floor id yet gets no done tick and no "+ plan": nothing to write to', async () => {
    renderIt({ canManage: true, workspaceId: null });
    await screen.findByText('Call with Seer');
    expect(screen.queryByRole('button', { name: 'Mark done: Call with Seer' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ plan' })).toBeNull();
  });

  test('the range control switches the meta and marks the chosen range', async () => {
    renderIt();
    await screen.findByText('Call with Seer');
    const meta = document.querySelector('.dr-tl-range')!;
    const before = meta.textContent;
    const month = screen.getByRole('button', { name: 'Month' });
    fireEvent.click(month);
    expect(meta.textContent).not.toBe(before);
    expect(month.className).toContain('is-active');
    expect(screen.getByRole('button', { name: 'Week' }).className).not.toContain('is-active');
  });

  test('ticks follow the range: a week has seven day ticks, today has four six-hour ticks', async () => {
    renderIt();
    await screen.findByText('Call with Seer');
    expect(document.querySelectorAll('.dr-tl-tick').length).toBe(7);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    const labels = Array.from(document.querySelectorAll('.dr-tl-tick')).map(e => e.textContent);
    expect(labels).toEqual(['00:00', '06:00', '12:00', '18:00', '00:00']);
  });

  test('today shows only what reaches today, the rest waits for the wider range', async () => {
    h.getDataRoomPlanned.mockResolvedValue(
      planned([
        { kind: 'plan', id: 'far', title: 'Far away', start: at(10 * DAY), end: at(11 * DAY), href: null, done: false },
      ]),
    );
    renderIt({ canManage: true });
    await waitFor(() => expect(h.getDataRoomPlanned).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.queryByText('Far away')).toBeNull();
    expect(screen.getByText('Nothing in this range.')).toBeTruthy();
  });

  test('eight rows show; "All N" in the corner unfolds the rest and "Fewer" folds them', async () => {
    h.getDataRoomPlanned.mockResolvedValue(planned(MANY));
    renderIt();
    await screen.findByText('Plan number 0');
    expect(document.querySelectorAll('.dr-tl-row').length).toBe(8);
    expect(screen.queryByText('Plan number 8')).toBeNull();
    const all = screen.getByRole('button', { name: 'All 12' });
    fireEvent.click(all);
    expect(document.querySelectorAll('.dr-tl-row').length).toBe(12);
    expect(screen.getByText('Plan number 11')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fewer' }));
    expect(document.querySelectorAll('.dr-tl-row').length).toBe(8);
  });

  test('eight or fewer rows: no "All N" control', async () => {
    renderIt();
    await screen.findByText('Call with Seer');
    expect(screen.queryByRole('button', { name: /^All \d+$/ })).toBeNull();
  });

  test('a manager with many rows has both "+ plan" and "All N" in the corner', async () => {
    h.getDataRoomPlanned.mockResolvedValue(planned(MANY));
    renderIt({ canManage: true });
    await screen.findByText('Plan number 0');
    expect(screen.getByRole('button', { name: '+ plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All 12' })).toBeTruthy();
  });

  test('"+ plan" opens the form and posting it creates the plan on that floor and refetches', async () => {
    h.createPlan.mockResolvedValue({ id: 'pl9' });
    renderIt({ canManage: true });
    fireEvent.click(await screen.findByRole('button', { name: '+ plan' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Results post' } });
    fireEvent.change(screen.getByLabelText('What it is'), { target: { value: 'September numbers' } });
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-09-14T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to the plan' }));
    await waitFor(() => expect(h.createPlan).toHaveBeenCalledTimes(1));
    const [wsId, body] = h.createPlan.mock.calls[0];
    expect(wsId).toBe('ws-1');
    expect(body.title).toBe('Results post');
    expect(body.description).toBe('September numbers');
    expect(body.start).toBeUndefined();
    // datetime-local is wall-clock in the browser's zone; the API gets an instant.
    expect(body.due).toBe(new Date(2026, 8, 14, 18, 0).toISOString());
    await waitFor(() => expect(h.getDataRoomPlanned).toHaveBeenCalledTimes(2));
  });

  test('the form refuses an empty title', async () => {
    renderIt({ canManage: true });
    fireEvent.click(await screen.findByRole('button', { name: '+ plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to the plan' }));
    expect(h.createPlan).not.toHaveBeenCalled();
  });

  test("no class on the section carries the floor's prefix: the room draws it in its own language", async () => {
    renderIt({ canManage: true });
    await screen.findByText('Call with Seer');
    const stray = Array.from(section()!.querySelectorAll('[class*="pubws-tl"]'));
    expect(stray).toEqual([]);
  });
});
