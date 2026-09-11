import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * "What is planned" in the data room (docs/data-room.md, "What is planned";
 * docs/ui-conventions.md, "The data room", the PlannedTimeline paragraph).
 * The geometry is the model's spec (timeline-model.test.ts); this pins what
 * a reader sees: the head's anatomy (label, the floor's name as meta), one
 * row per open entry with its due meta, the eight-row fold, "Nothing planned
 * yet." as a true sentence, and that there are NO controls on it for anyone:
 * entries are written in the cockpit, and the room draws them and cannot
 * change them.
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

const entry = (over: Record<string, unknown> & { id: string; title: string }) => ({
  description: null,
  start: null,
  due: null,
  done: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  editedAt: null,
  doneAt: null,
  ...over,
});

const ITEMS = [
  entry({ id: 'pl0', title: 'Ship the results post', start: at(-DAY), due: at(2 * DAY) }),
  entry({ id: 'pl1', title: 'Call with Seer', due: at(4 * DAY), description: 'Thursday' }),
  entry({ id: 'pl2', title: 'Write the September post' }),
  entry({ id: 'pl3', title: 'Already done', due: at(DAY), done: true, doneAt: at(-3600e3) }),
];

/** Twelve dated entries, one every ten hours, for the fold. */
const MANY = Array.from({ length: 12 }, (_, i) =>
  entry({ id: `m${i}`, title: `Plan number ${i}`, due: at((i + 1) * 0.4 * DAY) }),
);

const planned = (items: unknown[], workspace: typeof WS | null = WS) => ({
  workspace,
  now: NOW.toISOString(),
  items,
});

const renderIt = () =>
  render(
    <MemoryRouter>
      <PlannedTimeline initialNow={NOW} />
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
  test("fetches the room's own read once on mount and draws the head: label, the floor's name as meta", async () => {
    renderIt();
    await waitFor(() => expect(h.getDataRoomPlanned).toHaveBeenCalledTimes(1));
    await screen.findByText('Ship the results post');
    const sec = section()!;
    expect(sec).toBeTruthy();
    expect(sec.getAttribute('aria-label')).toBe('What is planned');
    expect(sec.querySelector('.dr-tl-label')?.textContent).toBe('What is planned');
    expect(sec.querySelector('.dr-tl-floor')?.textContent).toBe('Telarchy');
  });

  test('with nothing planned it says so in one line, and keeps the head', async () => {
    h.getDataRoomPlanned.mockResolvedValue(planned([]));
    renderIt();
    expect(await screen.findByText('Nothing planned yet.')).toBeTruthy();
    expect(section()).toBeTruthy();
    expect(screen.getByText('What is planned')).toBeTruthy();
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

  test('each open dated entry is one row, soonest due on top; a done entry has left the axis', async () => {
    renderIt();
    await screen.findByText('Ship the results post');
    const titles = Array.from(document.querySelectorAll('.dr-tl-row .dr-tl-title')).map(e => e.textContent);
    expect(titles).toEqual(['Ship the results post', 'Call with Seer']);
    expect(screen.queryByText('Already done')).toBeNull();
  });

  test('the title line is one line, and the bar carries no words', async () => {
    renderIt();
    const title = await screen.findByText('Ship the results post');
    expect(title.className).toContain('dr-tl-title');
    const row = title.closest('.dr-tl-row')!;
    const bar = row.querySelector('.dr-tl-bar')!;
    expect(bar.textContent).toBe('');
  });

  test('the meta at the end of the title line is the due point: "due <day>", "due today", "due tomorrow"', async () => {
    h.getDataRoomPlanned.mockResolvedValue(
      planned([
        entry({ id: 'a', title: 'Later this week', due: at(4 * DAY) }),
        entry({ id: 'b', title: 'Today thing', due: at(3 * 36e5) }),
        entry({ id: 'c', title: 'Tomorrow thing', due: at(DAY) }),
      ]),
    );
    renderIt();
    await screen.findByText('Later this week');
    expect(screen.getByText(`due ${dayMonth(4 * DAY)}`)).toBeTruthy();
    expect(screen.getByText('due today')).toBeTruthy();
    expect(screen.getByText('due tomorrow')).toBeTruthy();
    const metas = Array.from(document.querySelectorAll('.dr-tl-row .dr-tl-meta')).map(e => e.textContent);
    expect(metas).toEqual(['due today', 'due tomorrow', `due ${dayMonth(4 * DAY)}`]);
  });

  test("a row is a button that toggles the entry's own words under it", async () => {
    renderIt();
    const row = (await screen.findByText('Call with Seer')).closest('button');
    expect(row).toBeTruthy();
    expect(row!.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(row!);
    expect(row!.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Thursday')).toBeTruthy();
    expect(document.querySelector('.dr-tl-words')).toBeTruthy();
    fireEvent.click(row!);
    expect(screen.queryByText('Thursday')).toBeNull();
  });

  test('an entry with no words says so when opened', async () => {
    renderIt();
    fireEvent.click((await screen.findByText('Ship the results post')).closest('button')!);
    expect(screen.getByText('No notes.')).toBeTruthy();
  });

  test('undated open entries are listed under "No date" with no meta; a done undated entry is not', async () => {
    h.getDataRoomPlanned.mockResolvedValue(
      planned([
        entry({ id: 'u1', title: 'Write the September post' }),
        entry({ id: 'u2', title: 'Finished, undated', done: true, doneAt: at(-DAY) }),
      ]),
    );
    renderIt();
    expect(await screen.findByText('No date')).toBeTruthy();
    const row = screen.getByText('Write the September post').closest('.dr-tl-undated-row')!;
    expect(row.querySelector('.dr-tl-meta')).toBeNull();
    expect(screen.queryByText('Finished, undated')).toBeNull();
  });

  test('THERE ARE NO CONTROLS ON IT FOR ANYONE: no "+ plan", no done tick, no dialog, nothing written', async () => {
    renderIt();
    await screen.findByText('Call with Seer');
    expect(screen.queryByRole('button', { name: '+ plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: /mark done/i })).toBeNull();
    expect(document.querySelector('.dr-tl-done')).toBeNull();
    expect(screen.queryByLabelText('Title')).toBeNull();
    const buttons = Array.from(section()!.querySelectorAll('button')).map(b => b.className);
    // The only buttons: the range control and the rows that open their words.
    for (const cls of buttons) expect(cls).toMatch(/pubws-seg-btn|dr-tl-rowlink|dr-tl-undated-title|dr-tl-act/);
    expect(h.createPlan).not.toHaveBeenCalled();
    expect(h.updatePlan).not.toHaveBeenCalled();
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
      planned([entry({ id: 'far', title: 'Far away', start: at(10 * DAY), due: at(11 * DAY) })]),
    );
    renderIt();
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
    fireEvent.click(screen.getByRole('button', { name: 'All 12' }));
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

  test("no class on the section carries the floor's prefix: the room draws it in its own language", async () => {
    renderIt();
    await screen.findByText('Call with Seer');
    const stray = Array.from(section()!.querySelectorAll('[class*="pubws-tl"]'));
    expect(stray).toEqual([]);
  });
});
