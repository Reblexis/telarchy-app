import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { getFloorHistory: vi.fn() },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
// The top bar drags in the whole floor page; the tree is what this spec is about.
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { FloorHistoryPage } from '../FloorHistoryPage';

/**
 * telarchy.com/<slug>/history: a floor's history as the tree of worlds it is
 * (docs/ui-conventions.md, "A floor's history"). The page draws what
 * GET /api/marketplace/:idOrSlug/history hands it and computes nothing
 * itself; what is pinned here is that it draws it faithfully: what happened
 * right of the trunk, what did not left of it, the call against the value on
 * a settled book, nothing invented where a number is missing, and replay
 * showing the floor as it stood.
 */

const getFloorHistory = api.getFloorHistory as unknown as ReturnType<typeof vi.fn>;

type Fork = Record<string, unknown>;
const fork = (over: Fork = {}): Fork => ({
  kind: 'fork',
  at: '2026-09-10T12:31:00.000Z',
  verdict: 'approved',
  title: 'Referral rule',
  proposals: [
    {
      id: 'p1',
      number: 31,
      title: 'Referral rule',
      askUsd: 50,
      proposedBy: 'vire',
      status: 'approved',
      declineReason: null,
      deliveredAt: null,
      decideBy: null,
      href: '/telarchy/p/31',
    },
  ],
  metric: { id: 'm-traders', name: 'Active traders', targetDate: '2026-09' },
  options: [
    { label: 'if approved', proposalId: 'p1', taken: true, price: 18 },
    { label: 'if declined', proposalId: 'p1', taken: false, price: 14 },
  ],
  ...over,
});

const settle = {
  kind: 'settle',
  at: '2026-09-11T00:00:00.000Z',
  books: [
    {
      marketId: 'b1',
      metricId: 'm-traders',
      metricName: 'Active traders',
      targetDate: '2026-09-10',
      voided: false,
      value: 7,
      call: 6.35,
    },
    {
      marketId: 'b2',
      metricId: 'm-val',
      metricName: 'Implied valuation',
      targetDate: '2026',
      voided: true,
      value: null,
      call: 820,
    },
  ],
};

const history = (over: Record<string, unknown> = {}) => ({
  workspace: { slug: 'telarchy', name: 'Telarchy' },
  now: '2026-09-11T17:40:00.000Z',
  counts: { decided: 36, settled: 57, voided: 3 },
  since: '2026-08-01T23:55:00.000Z',
  open: [],
  events: [settle, fork()],
  next: null,
  ...over,
});

function renderPage(path = '/telarchy/history') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:slug/history" element={<FloorHistoryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const rows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.hist-row'));

beforeEach(() => {
  getFloorHistory.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the head', () => {
  test('the floor name is the headline under a History label, and what the tree holds is counted under it', async () => {
    getFloorHistory.mockResolvedValue(history());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Telarchy' })).toBeTruthy();
    expect(screen.getByText('History')).toBeTruthy();
    expect(screen.getByText(/36 decided · 57 books settled · 3 voided · since/)).toBeTruthy();
    expect(getFloorHistory).toHaveBeenCalledWith('telarchy', {});
  });
});

describe('NEWEST FIRST: the tree is drawn in the order the endpoint hands it', () => {
  test('rows follow the events, the tip above them', async () => {
    getFloorHistory.mockResolvedValue(history({ open: [fork({ verdict: 'open', at: '2026-09-12T11:02:00.000Z' })] }));
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Telarchy' });
    expect(rows(container).map(r => r.dataset.kind)).toEqual(['open', 'settle', 'fork']);
  });
});

describe('A DECISION IS A FORK: what happened right of the trunk, what did not left of it', () => {
  test('the title links to the proposal, the verdict sits over the price of the world taken, the world not taken is priced on the left', async () => {
    getFloorHistory.mockResolvedValue(history({ events: [fork()] }));
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Telarchy' });
    const [row] = rows(container);
    const link = row.querySelector('.hist-body a') as HTMLAnchorElement;
    expect(link.textContent).toBe('Referral rule');
    expect(link.getAttribute('href')).toBe('/telarchy/p/31');
    expect(row.querySelector('.hist-body')?.textContent).toContain('#31');
    const verdict = row.querySelector('.hist-verdict')?.textContent ?? '';
    expect(verdict).toMatch(/approved/i);
    expect(verdict).toContain('18');
    const ghosts = row.querySelector('.hist-ghosts')?.textContent ?? '';
    expect(ghosts).toContain('if declined');
    expect(ghosts).toContain('14');
    expect(ghosts).not.toContain('if approved');
  });

  test('a decline prints the reason the owner published', async () => {
    getFloorHistory.mockResolvedValue(
      history({
        events: [
          fork({
            verdict: 'declined',
            proposals: [
              { ...(fork().proposals as Fork[])[0], status: 'declined', declineReason: 'There is already a prize' },
            ],
            options: [
              { label: 'if approved', proposalId: 'p1', taken: false, price: 20 },
              { label: 'if declined', proposalId: 'p1', taken: true, price: 18.6 },
            ],
          }),
        ],
      }),
    );
    const { container } = renderPage();
    await screen.findByText('There is already a prize');
    expect(rows(container)[0].querySelector('.hist-ghosts')?.textContent).toContain('if approved');
  });

  test('PROPOSALS POSTED TOGETHER draw one branch per answer not taken', async () => {
    getFloorHistory.mockResolvedValue(
      history({
        events: [
          fork({
            verdict: 'chosen',
            title: 'Game 1, attempt 88, move 6',
            // A group carries every proposal in it (the /api/help contract).
            proposals: (['m1', 'm2', 'm3'] as const).map((id, i) => ({
              ...(fork().proposals as Fork[])[0],
              id,
              number: 4019 + i,
              proposedBy: 'snake',
              askUsd: null,
              status: id === 'm2' ? 'approved' : 'declined',
              href: `/snake/p/${4019 + i}`,
            })),
            options: [
              { label: 'Continue forward', proposalId: 'm2', taken: true, price: 2.6 },
              { label: 'Turn left', proposalId: 'm1', taken: false, price: 2.1 },
              { label: 'Turn right', proposalId: 'm3', taken: false, price: 1.9 },
            ],
          }),
        ],
      }),
    );
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Telarchy' });
    const [row] = rows(container);
    expect(row.querySelectorAll('.hist-ghost')).toHaveLength(2);
    const ghosts = row.querySelector('.hist-ghosts')?.textContent ?? '';
    expect(ghosts).toContain('Turn left');
    expect(ghosts).toContain('2.1');
    expect(ghosts).toContain('Turn right');
    expect(row.querySelector('.hist-verdict')?.textContent).toMatch(/chosen/i);
    expect(row.querySelector('.hist-verdict')?.textContent).toContain('2.6');
    expect(row.querySelector('.hist-body')?.textContent).toContain('Continue forward');
  });

  test('NOTHING RECORDED: the fork keeps its words and invents no number', async () => {
    getFloorHistory.mockResolvedValue(
      history({
        events: [
          fork({
            metric: null,
            options: [
              { label: 'if approved', proposalId: 'p1', taken: true, price: null },
              { label: 'if declined', proposalId: 'p1', taken: false, price: null },
            ],
          }),
        ],
      }),
    );
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Telarchy' });
    const [row] = rows(container);
    expect(row.textContent).toContain('if declined');
    expect(row.textContent).not.toMatch(/null|NaN|undefined/);
    expect(row.querySelector('.hist-price')).toBeNull();
  });
});

describe('A PRICE FITS ITS COLUMN', () => {
  test('from ten thousand up a price is printed compact, so it fits the left column on a phone', async () => {
    getFloorHistory.mockResolvedValue(
      history({
        events: [
          fork({
            metric: { id: 'm-val', name: 'Implied valuation (USD)', targetDate: '2026' },
            options: [
              { label: 'if approved', proposalId: 'p1', taken: true, price: 744_286 },
              { label: 'if declined', proposalId: 'p1', taken: false, price: 10_000_000 },
            ],
          }),
        ],
      }),
    );
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Telarchy' });
    const [row] = rows(container);
    expect(row.querySelector('.hist-verdict')?.textContent).toContain('$744k');
    expect(row.querySelector('.hist-ghosts')?.textContent).toContain('$10.0M');
  });
});

describe('A BOOK THAT SETTLED IS A SQUARE ON THE TRUNK', () => {
  test('the call against the value, and a voided book says so', async () => {
    getFloorHistory.mockResolvedValue(history({ events: [settle] }));
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Telarchy' });
    const [row] = rows(container);
    expect(row.querySelectorAll('.hist-book')).toHaveLength(2);
    const [a, b] = Array.from(row.querySelectorAll('.hist-book'));
    expect(a.textContent).toContain('Active traders');
    expect(a.textContent).toContain('called 6.35');
    expect(a.textContent).toContain('settled 7');
    expect(b.textContent).toContain('voided · refunded');
    expect(b.textContent).not.toContain('settled');
  });
});

describe('THE TIP IS WHAT IS BEING DECIDED NOW', () => {
  test('an open proposal is being priced, its worlds at their live prices', async () => {
    getFloorHistory.mockResolvedValue(
      history({
        events: [],
        open: [
          fork({
            verdict: 'open',
            at: '2026-09-12T11:02:00.000Z',
            options: [
              { label: 'if approved', proposalId: 'p9', taken: false, price: 18.8 },
              { label: 'if declined', proposalId: 'p9', taken: false, price: 18.2 },
            ],
          }),
        ],
      }),
    );
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Telarchy' });
    const [row] = rows(container);
    expect(row.dataset.kind).toBe('open');
    expect(row.querySelector('.hist-verdict')?.textContent).toMatch(/being priced/i);
    const ghosts = row.querySelector('.hist-ghosts')?.textContent ?? '';
    expect(ghosts).toContain('18.8');
    expect(ghosts).toContain('18.2');
  });
});

describe('ONE PAGE AT A TIME', () => {
  test('"older" asks for the next page with the cursor and adds it under the tree', async () => {
    getFloorHistory
      .mockResolvedValueOnce(history({ events: [fork()], next: '2026-09-10T12:31:00.000Z' }))
      .mockResolvedValueOnce(
        history({ events: [fork({ title: 'Older one', at: '2026-09-01T10:00:00.000Z' })], next: null }),
      );
    const { container } = renderPage();
    const older = await screen.findByRole('button', { name: 'older' });
    fireEvent.click(older);
    await screen.findByText('Older one');
    expect(getFloorHistory).toHaveBeenLastCalledWith('telarchy', { before: '2026-09-10T12:31:00.000Z' });
    expect(rows(container)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'older' })).toBeNull();
  });

  test('an empty floor says so in words', async () => {
    getFloorHistory.mockResolvedValue(history({ events: [], open: [], since: null }));
    renderPage();
    expect(await screen.findByText('Nothing has been decided or settled here yet.')).toBeTruthy();
  });

  test('a failed read says so and can be tried again', async () => {
    getFloorHistory.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(history());
    renderPage();
    const again = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    fireEvent.click(again);
    expect(await screen.findByRole('heading', { name: 'Telarchy' })).toBeTruthy();
  });
});

describe('REPLAY GROWS THE TREE', () => {
  test('an instant on the scrubber hides every event newer than it, and the tip reads that instant', async () => {
    getFloorHistory.mockResolvedValue(history({ open: [fork({ verdict: 'open', at: '2026-09-12T11:02:00.000Z' })] }));
    const { container } = renderPage();
    const scrubber = (await screen.findByRole('slider', { name: 'Replay' })) as HTMLInputElement;
    expect(rows(container)).toHaveLength(3);
    act(() => {
      fireEvent.change(scrubber, { target: { value: String(Date.parse('2026-09-10T20:00:00.000Z')) } });
    });
    await waitFor(() => expect(rows(container).map(r => r.dataset.kind)).toEqual(['fork']));
    expect(container.querySelector('.hist-now')?.textContent).not.toMatch(/^now$/i);
  });

  test('the page opens at now and never plays by itself', async () => {
    getFloorHistory.mockResolvedValue(history());
    const { container } = renderPage();
    const scrubber = (await screen.findByRole('slider', { name: 'Replay' })) as HTMLInputElement;
    expect(Number(scrubber.value)).toBe(Number(scrubber.max));
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(rows(container)).toHaveLength(2);
  });
});
