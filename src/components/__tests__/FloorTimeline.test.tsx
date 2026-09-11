import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * "What is planned" on the floor (docs/owner-on-the-floor.md, "What is
 * planned"; docs/ui-conventions.md, the FloorTimeline paragraph). The
 * geometry is the model's spec (timeline-model.test.ts); this pins what a
 * visitor and a manager see, and what the two owner controls call.
 */

const h = vi.hoisted(() => ({
  getWorkspaceTimeline: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: {
    getWorkspaceTimeline: h.getWorkspaceTimeline,
    createPlan: h.createPlan,
    updatePlan: h.updatePlan,
  },
}));

import { FloorTimeline } from '../FloorTimeline';

const NOW = new Date(2026, 8, 11, 10, 0, 0, 0);
const DAY = 864e5;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const ITEMS = [
  {
    kind: 'proposal',
    id: 'p1',
    title: 'Ship the results post',
    start: at(-DAY),
    end: at(2 * DAY),
    href: '/telarchy?proposal=1',
  },
  {
    kind: 'decision',
    id: 'd1',
    title: 'Daily update for a week',
    start: at(-2 * DAY),
    end: at(DAY),
    href: '/telarchy?proposal=36',
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

const renderIt = (props: Partial<Parameters<typeof FloorTimeline>[0]> = {}) =>
  render(
    <MemoryRouter>
      <FloorTimeline idOrSlug="telarchy" workspaceId="ws-1" canManage={false} initialNow={NOW} {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  h.getWorkspaceTimeline.mockReset();
  h.createPlan.mockReset();
  h.updatePlan.mockReset();
  h.getWorkspaceTimeline.mockResolvedValue({ now: NOW.toISOString(), items: ITEMS });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('what is planned, on the floor', () => {
  test('a visitor with nothing planned sees no section at all', async () => {
    h.getWorkspaceTimeline.mockResolvedValue({ now: NOW.toISOString(), items: [] });
    const { container } = renderIt();
    await waitFor(() => expect(h.getWorkspaceTimeline).toHaveBeenCalledWith('telarchy'));
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });

  test('a manager with nothing planned sees the head, the empty line and "+ plan"', async () => {
    h.getWorkspaceTimeline.mockResolvedValue({ now: NOW.toISOString(), items: [] });
    renderIt({ canManage: true });
    expect(await screen.findByText('Nothing planned yet.')).toBeTruthy();
    expect(screen.getByText('What is planned')).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ plan' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Range' })).toBeTruthy();
  });

  test('a 403 from the API renders nothing', async () => {
    h.getWorkspaceTimeline.mockRejectedValue(new Error('403'));
    const { container } = renderIt({ canManage: false });
    await waitFor(() => expect(h.getWorkspaceTimeline).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });

  test('items render as bars that link to the thing they are', async () => {
    renderIt();
    const bar = (await screen.findByText('Ship the results post')).closest('a');
    expect(bar?.getAttribute('href')).toBe('/telarchy?proposal=1');
    expect(screen.getByText('Active forecasters, this week').closest('a')?.getAttribute('href')).toBe(
      '/telarchy#market=b1',
    );
    // Each bar names its kind in one word for a reader who cannot tell a book from a proposal by colour.
    expect(screen.getByText('decides')).toBeTruthy();
  });

  test('a plan bar has no address: it is a button that opens its own words', async () => {
    renderIt();
    const bar = (await screen.findByText('Call with Seer')).closest('button');
    expect(bar).toBeTruthy();
    fireEvent.click(bar!);
    expect(screen.getByText('Thursday')).toBeTruthy();
  });

  test('undated items are listed under "No date"', async () => {
    renderIt();
    expect(await screen.findByText('No date')).toBeTruthy();
    expect(screen.getByText('Write the September post')).toBeTruthy();
  });

  test('a manager gets a done tick on each plan bar; a visitor gets none', async () => {
    const { unmount } = renderIt();
    await screen.findByText('Call with Seer');
    expect(screen.queryByRole('button', { name: 'Mark done: Call with Seer' })).toBeNull();
    unmount();
    renderIt({ canManage: true });
    expect(await screen.findByRole('button', { name: 'Mark done: Call with Seer' })).toBeTruthy();
    // Undated plans are open too, and can be done from the list.
    expect(screen.getByRole('button', { name: 'Mark done: Write the September post' })).toBeTruthy();
    // A proposal is not a plan: no tick.
    expect(screen.queryByRole('button', { name: 'Mark done: Ship the results post' })).toBeNull();
  });

  test('the done tick marks the plan done and refetches', async () => {
    h.updatePlan.mockResolvedValue({ id: 'pl1', doneAt: NOW.toISOString() });
    renderIt({ canManage: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Mark done: Call with Seer' }));
    await waitFor(() => expect(h.updatePlan).toHaveBeenCalledWith('ws-1', 'pl1', { done: true }));
    await waitFor(() => expect(h.getWorkspaceTimeline).toHaveBeenCalledTimes(2));
  });

  test('the range control switches the meta and marks the chosen range', async () => {
    renderIt();
    await screen.findByText('Call with Seer');
    const meta = document.querySelector('.pubws-lb-meta')!;
    const before = meta.textContent;
    const month = screen.getByRole('button', { name: 'Month' });
    fireEvent.click(month);
    expect(meta.textContent).not.toBe(before);
    expect(month.className).toContain('is-active');
    expect(screen.getByRole('button', { name: 'Week' }).className).not.toContain('is-active');
  });

  test('today shows only what reaches today, the rest waits for the wider range', async () => {
    h.getWorkspaceTimeline.mockResolvedValue({
      now: NOW.toISOString(),
      items: [
        { kind: 'plan', id: 'far', title: 'Far away', start: at(10 * DAY), end: at(11 * DAY), href: null, done: false },
      ],
    });
    renderIt({ canManage: true });
    await waitFor(() => expect(h.getWorkspaceTimeline).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.queryByText('Far away')).toBeNull();
    expect(screen.getByText('Nothing in this range.')).toBeTruthy();
  });

  test('"+ plan" opens the form and posting it creates the plan and refetches', async () => {
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
    await waitFor(() => expect(h.getWorkspaceTimeline).toHaveBeenCalledTimes(2));
  });

  test('the form refuses an empty title', async () => {
    renderIt({ canManage: true });
    fireEvent.click(await screen.findByRole('button', { name: '+ plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to the plan' }));
    expect(h.createPlan).not.toHaveBeenCalled();
  });
});
