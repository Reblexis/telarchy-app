import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { getActions: vi.fn() },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
// The top bar drags in the whole floor page; the log is what this spec is about.
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { DataRoomPage } from '../DataRoomPage';

/**
 * What a visitor sees on telarchy.com/data-room (docs/data-room.md, "The
 * page"): the public actions log, grouped by day, filtered through the URL,
 * paged at the bottom, and topped up on its own. The rules pinned here are
 * the ones a page would otherwise drift on: every filter is a query
 * parameter, the JSON link carries the same filters, an empty log and a
 * failed read are different sentences, and a page never invents a row.
 */

const KINDS = [
  { id: 'trade', label: 'Trades', description: 'A participant bought or sold shares on a book.' },
  { id: 'decision', label: 'Decisions', description: 'An owner decided.' },
  { id: 'join', label: 'Joins', description: 'A participant account was created.' },
];
const FLOORS = [
  { slug: 'telarchy', name: 'Telarchy' },
  { slug: 'lookpilot', name: 'LookPilot' },
];

function row(over: Partial<ReturnType<typeof baseRow>> = {}) {
  return { ...baseRow(), ...over };
}
function baseRow() {
  return {
    id: 'trade:t1',
    at: '2026-09-10T09:05:00.000Z',
    kind: 'trade',
    workspace: { slug: 'telarchy', name: 'Telarchy' },
    actor: { id: 'a1', handle: 'vire' },
    text: 'bought 10 higher shares on Active traders (2026-09) for 40 cr, call 4 to 5.2',
    detail: {},
    href: '/telarchy#market=mkt1&trade=t1',
  };
}

const page = (rows: ReturnType<typeof row>[], next: string | null = null) => ({
  generatedAt: '2026-09-10T12:00:00.000Z',
  kinds: KINDS,
  workspaces: FLOORS,
  rows,
  next,
});

const getActions = api.getActions as unknown as ReturnType<typeof vi.fn>;

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.search}</output>;
}

function mount(initial = '/data-room') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="/data-room"
          element={
            <>
              <DataRoomPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getActions.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the log', () => {
  test('renders rows under their UTC day, each with its time, kind, actor, sentence and floor', async () => {
    getActions.mockResolvedValue(
      page([
        row(),
        row({ id: 'join:a2', at: '2026-09-09T22:30:00.000Z', kind: 'join', workspace: null, actor: { id: 'a2', handle: 'quroe' }, text: 'joined as a person', href: '/participants/quroe' }),
      ]),
    );
    mount();
    expect(await screen.findByText('bought 10 higher shares on Active traders (2026-09) for 40 cr, call 4 to 5.2')).toBeInTheDocument();
    // Two days, in order, newest first.
    const days = screen.getAllByRole('heading', { level: 2 });
    expect(days.map(d => d.textContent)).toEqual(['Thursday, 10 September 2026', 'Wednesday, 9 September 2026']);
    const first = screen.getByText('bought 10 higher shares on Active traders (2026-09) for 40 cr, call 4 to 5.2').closest('li')!;
    expect(within(first).getByText('09:05')).toBeInTheDocument();
    expect(within(first).getByText('Trades')).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'vire' })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Telarchy' })).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: /bought 10 higher/ })).toHaveAttribute('href', '/telarchy#market=mkt1&trade=t1');
    // A platform-wide row has no floor.
    const second = screen.getByText('joined as a person').closest('li')!;
    expect(within(second).queryByRole('button', { name: /Telarchy|LookPilot/ })).toBeNull();
    // The desk fixes its palette.
    expect(document.querySelector('.dr-desk')).toHaveAttribute('data-theme', 'dark');
  });

  test('the filters in the URL are the filters it reads with, and the JSON link carries them', async () => {
    getActions.mockResolvedValue(page([row()]));
    mount('/data-room?kinds=trade,decision&workspace=telarchy');
    await screen.findByText(/bought 10 higher/);
    expect(getActions).toHaveBeenCalledWith(expect.objectContaining({ kinds: 'trade,decision', workspace: 'telarchy' }));
    expect(screen.getByRole('button', { name: 'Trades' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Decisions' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Joins' })).toHaveAttribute('aria-pressed', 'false');
    const json = screen.getByRole('link', { name: /the same log as JSON/ });
    expect(json.getAttribute('href')).toBe('/api/data-room/actions?kinds=trade%2Cdecision&workspace=telarchy');
  });

  test('a kind chip toggles the kind in the URL and refetches; every chip off means every kind', async () => {
    getActions.mockResolvedValue(page([row()]));
    mount();
    await screen.findByText(/bought 10 higher/);
    expect(getActions).toHaveBeenLastCalledWith(expect.not.objectContaining({ kinds: expect.anything() }));
    fireEvent.click(screen.getByRole('button', { name: 'Trades' }));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('?kinds=trade'));
    await waitFor(() => expect(getActions).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: 'trade' })));
    fireEvent.click(screen.getByRole('button', { name: 'Joins' }));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('?kinds=trade%2Cjoin'));
    fireEvent.click(screen.getByRole('button', { name: 'Trades' }));
    fireEvent.click(screen.getByRole('button', { name: 'Joins' }));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe(''));
  });

  test('clicking an actor filters to them, shown as a chip with a clear; clicking a floor filters to it', async () => {
    getActions.mockResolvedValue(page([row()]));
    mount();
    await screen.findByText(/bought 10 higher/);
    fireEvent.click(screen.getByRole('button', { name: 'vire' }));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('?participant=vire'));
    await waitFor(() => expect(getActions).toHaveBeenLastCalledWith(expect.objectContaining({ participant: 'vire' })));
    const chip = screen.getByRole('button', { name: /vire/, pressed: true });
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe(''));
    fireEvent.click(within(screen.getByText(/bought 10 higher/).closest('li')!).getByRole('button', { name: 'Telarchy' }));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('?workspace=telarchy'));
    expect((screen.getByLabelText('Floor') as HTMLSelectElement).value).toBe('telarchy');
  });

  test('the floor select narrows to one public floor and clears back to every floor', async () => {
    getActions.mockResolvedValue(page([row()]));
    mount();
    await screen.findByText(/bought 10 higher/);
    const select = screen.getByLabelText('Floor') as HTMLSelectElement;
    expect([...select.options].map(o => o.textContent)).toEqual(['Every floor', 'Telarchy', 'LookPilot']);
    fireEvent.change(select, { target: { value: 'lookpilot' } });
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('?workspace=lookpilot'));
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe(''));
  });

  test('more rows append through the cursor and the end of the log is said', async () => {
    getActions.mockResolvedValueOnce(page([row()], 'CURSOR1'));
    getActions.mockResolvedValueOnce(
      page([row({ id: 'trade:t0', at: '2026-09-08T09:00:00.000Z', text: 'sold 4 higher shares on Active traders (2026-09) for 15 cr' })], null),
    );
    mount();
    await screen.findByText(/bought 10 higher/);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await screen.findByText(/sold 4 higher/);
    expect(getActions).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'CURSOR1' }));
    // The first row is still first: rows already on the page never move.
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/bought 10 higher/);
    expect(items[1]).toHaveTextContent(/sold 4 higher/);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.getByText('End of the log.')).toBeInTheDocument();
  });

  test('an empty log and a failed read are different sentences', async () => {
    getActions.mockResolvedValueOnce(page([]));
    const { unmount } = mount('/data-room?kinds=decision');
    expect(await screen.findByText('No actions match.')).toBeInTheDocument();
    // The filters stay up so the reader can change them.
    expect(screen.getByRole('button', { name: 'Decisions' })).toHaveAttribute('aria-pressed', 'true');
    unmount();
    getActions.mockRejectedValueOnce(new Error('boom'));
    mount();
    expect(await screen.findByText('The log would not open.')).toBeInTheDocument();
    expect(screen.queryByText('No actions match.')).toBeNull();
  });

  test('new rows arrive on their own each minute, with the same filters, and are marked new', async () => {
    vi.useFakeTimers();
    getActions.mockResolvedValueOnce(page([row()]));
    mount('/data-room?kinds=trade');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/bought 10 higher/)).toBeInTheDocument();
    getActions.mockResolvedValueOnce(
      page([row({ id: 'trade:t2', at: '2026-09-10T10:00:00.000Z', text: 'sold 2 lower shares on Active traders (2026-09) for 3 cr' })]),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getActions).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: 'trade', after: '2026-09-10T09:05:00.000Z' }));
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/sold 2 lower/);
    expect(items[0].className).toMatch(/is-new/);
    expect(items[1]).toHaveTextContent(/bought 10 higher/);
    expect(items[1].className).not.toMatch(/is-new/);
  });
});
