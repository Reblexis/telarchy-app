import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({
  // Who is signed in: null for a visitor, swapped per test for a manager.
  auth: { user: null as null | { id: string }, loading: false },
}));

vi.mock('../../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    getActions: vi.fn(),
    getDataRoomPlanned: vi.fn(),
    getDataRoomVision: vi.fn(),
    getGuides: vi.fn(),
    getGuideCategories: vi.fn(),
    getGuide: vi.fn(),
    getProfile: vi.fn(),
    createPlan: vi.fn(),
    updatePlan: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => h.auth }));
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
const getDataRoomPlanned = api.getDataRoomPlanned as unknown as ReturnType<typeof vi.fn>;
const getDataRoomVision = api.getDataRoomVision as unknown as ReturnType<typeof vi.fn>;
const getGuides = api.getGuides as unknown as ReturnType<typeof vi.fn>;
const getGuideCategories = api.getGuideCategories as unknown as ReturnType<typeof vi.fn>;
const getGuide = api.getGuide as unknown as ReturnType<typeof vi.fn>;
const getProfile = api.getProfile as unknown as ReturnType<typeof vi.fn>;

const PLANNED_WS = { id: 'ws-telarchy', slug: 'telarchy', name: 'Telarchy' };
const plannedPage = (items: unknown[] = []) => ({
  workspace: PLANNED_WS,
  now: '2026-09-10T12:00:00.000Z',
  items,
});

function LocationProbe() {
  const loc = useLocation();
  return (
    <>
      <output data-testid="loc">{loc.search}</output>
      <output data-testid="path">{loc.pathname}</output>
    </>
  );
}

/** The same five addresses App.tsx registers (docs/data-room.md: "The tabs are addresses"). */
const ADDRESSES = [
  '/data-room',
  '/data-room/planned',
  '/data-room/docs',
  '/data-room/docs/:section',
  '/data-room/vision',
];

function mount(initial = '/data-room') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        {ADDRESSES.map(path => (
          <Route
            key={path}
            path={path}
            element={
              <>
                <DataRoomPage />
                <LocationProbe />
              </>
            }
          />
        ))}
      </Routes>
    </MemoryRouter>,
  );
}

const GUIDES = [
  { id: 'start-here', title: 'Start here', description: 'The first read.', category: 'basics', order: 1 },
  { id: 'get-paid', title: 'Get paid for work', description: 'How a proposal pays.', category: 'forecast', order: 50 },
];

beforeEach(() => {
  getActions.mockReset();
  getDataRoomPlanned.mockReset();
  getDataRoomVision.mockReset();
  getGuides.mockReset();
  getGuideCategories.mockReset();
  getGuide.mockReset();
  getProfile.mockReset();
  getDataRoomPlanned.mockResolvedValue(plannedPage());
  getDataRoomVision.mockResolvedValue({
    title: 'Vision',
    updatedAt: '2026-09-11',
    markdown: '## Where this goes\n\nBy the end of 2026 the floor prices **four** numbers.',
  });
  getGuides.mockResolvedValue(GUIDES);
  getGuideCategories.mockResolvedValue([
    { id: 'basics', title: 'Basics', description: '' },
    { id: 'forecast', title: 'Forecasting', description: '' },
  ]);
  getGuide.mockImplementation(async (id: string) => `# Guide ${id}\n\nSee [the index](./start-here.md).`);
  h.auth.user = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the log', () => {
  test('renders rows under their UTC day, each with its time, kind, actor, sentence and floor', async () => {
    getActions.mockResolvedValue(
      page([
        row(),
        row({
          id: 'join:a2',
          at: '2026-09-09T22:30:00.000Z',
          kind: 'join',
          workspace: null,
          actor: { id: 'a2', handle: 'quroe' },
          text: 'joined as a person',
          href: '/participants/quroe',
        }),
      ]),
    );
    mount();
    expect(
      await screen.findByText('bought 10 higher shares on Active traders (2026-09) for 40 cr, call 4 to 5.2'),
    ).toBeInTheDocument();
    // Two days, in order, newest first (the log's own headings; "What is
    // planned" above it has one too).
    const days = within(document.querySelector('.dr-log') as HTMLElement).getAllByRole('heading', { level: 2 });
    expect(days.map(d => d.textContent)).toEqual(['Thursday, 10 September 2026', 'Wednesday, 9 September 2026']);
    const first = screen
      .getByText('bought 10 higher shares on Active traders (2026-09) for 40 cr, call 4 to 5.2')
      .closest('li')!;
    expect(within(first).getByText('09:05')).toBeInTheDocument();
    expect(within(first).getByText('Trades')).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'vire' })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Telarchy' })).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: /bought 10 higher/ })).toHaveAttribute(
      'href',
      '/telarchy#market=mkt1&trade=t1',
    );
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
    expect(getActions).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: 'trade,decision', workspace: 'telarchy' }),
    );
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
    fireEvent.click(
      within(screen.getByText(/bought 10 higher/).closest('li')!).getByRole('button', { name: 'Telarchy' }),
    );
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
      page(
        [
          row({
            id: 'trade:t0',
            at: '2026-09-08T09:00:00.000Z',
            text: 'sold 4 higher shares on Active traders (2026-09) for 15 cr',
          }),
        ],
        null,
      ),
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
      page([
        row({
          id: 'trade:t2',
          at: '2026-09-10T10:00:00.000Z',
          text: 'sold 2 lower shares on Active traders (2026-09) for 3 cr',
        }),
      ]),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getActions).toHaveBeenLastCalledWith(
      expect.objectContaining({ kinds: 'trade', after: '2026-09-10T09:05:00.000Z' }),
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/sold 2 lower/);
    expect(items[0].className).toMatch(/is-new/);
    expect(items[1]).toHaveTextContent(/bought 10 higher/);
    expect(items[1].className).not.toMatch(/is-new/);
  });
});

/**
 * "What is planned" sits in the room between the stamp and the filter bar
 * (docs/data-room.md, "What is planned"; docs/ui-conventions.md, "The data
 * room"). The page draws the room's own read of the platform floor's
 * calendar; a visitor gets the section without the owner's controls, and a
 * signed-in reader who manages that floor gets "+ plan".
 */
describe('the tabs', () => {
  const tabLinks = () =>
    Array.from(document.querySelectorAll('.dr-tabs a')).map(a => [a.textContent, a.getAttribute('href')]);

  test('one tab row under the masthead: Log, What is planned, Documentation, Vision, each a link to its address', async () => {
    getActions.mockResolvedValue(page([row()]));
    mount();
    await screen.findByText(/bought 10 higher/);
    expect(tabLinks()).toEqual([
      ['Log', '/data-room'],
      ['What is planned', '/data-room/planned'],
      ['Documentation', '/data-room/docs'],
      ['Vision', '/data-room/vision'],
    ]);
    const head = document.querySelector('.dr-head')!;
    const tabs = document.querySelector('.dr-tabs')!;
    expect(head.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('the current tab is marked, and only it', async () => {
    getActions.mockResolvedValue(page([row()]));
    mount('/data-room/planned');
    await screen.findByRole('region', { name: 'What is planned' });
    const current = Array.from(document.querySelectorAll('.dr-tabs a[aria-current="page"]')).map(a => a.textContent);
    expect(current).toEqual(['What is planned']);
  });

  test('the log tab carries the stamp, the filter row and the log, and none of the other tabs', async () => {
    getActions.mockResolvedValue(page([row()]));
    mount('/data-room');
    await screen.findByText(/bought 10 higher/);
    expect(document.querySelector('.dr-stamp')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Filter the log' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'What is planned' })).toBeNull();
    expect(getDataRoomPlanned).not.toHaveBeenCalled();
    expect(getGuides).not.toHaveBeenCalled();
    expect(getDataRoomVision).not.toHaveBeenCalled();
  });

  test('a tab link walks to that tab without a reload, and back to the log', async () => {
    getActions.mockResolvedValue(page([row()]));
    mount('/data-room');
    await screen.findByText(/bought 10 higher/);
    fireEvent.click(screen.getByRole('link', { name: 'Vision' }));
    expect(screen.getByTestId('path').textContent).toBe('/data-room/vision');
    expect(await screen.findByText('Where this goes')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filter the log' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Log' }));
    expect(screen.getByTestId('path').textContent).toBe('/data-room');
    expect(await screen.findByText(/bought 10 higher/)).toBeInTheDocument();
  });
});

describe('what is planned', () => {
  test("the planned tab draws the timeline with the floor's name as its meta, and nothing of the log", async () => {
    getActions.mockResolvedValue(page([row()]));
    getDataRoomPlanned.mockResolvedValue(
      plannedPage([
        {
          id: 'pl1',
          title: 'Write the September results post',
          description: null,
          start: null,
          due: '2026-09-14T18:00:00.000Z',
          done: false,
          createdAt: '2026-09-01T00:00:00.000Z',
          editedAt: null,
          doneAt: null,
        },
      ]),
    );
    mount('/data-room/planned');
    const planned = await screen.findByRole('region', { name: 'What is planned' });
    expect(planned.className).toContain('dr-planned');
    expect(planned.querySelector('.dr-tl-floor')?.textContent).toBe('Telarchy');
    expect(await screen.findByText('Write the September results post')).toBeInTheDocument();
    expect(document.querySelector('.dr-stamp')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filter the log' })).toBeNull();
    expect(screen.queryByText(/bought 10 higher/)).toBeNull();
    expect(getActions).not.toHaveBeenCalled();
  });

  test('THE ROOM IS READ-ONLY FOR EVERYONE: a signed-in reader gets no controls and is asked nothing', async () => {
    h.auth.user = { id: 'u1' };
    getProfile.mockResolvedValue({ capabilities: ['read', 'trade', 'manage'] });
    mount('/data-room/planned');
    expect(await screen.findByText('Nothing planned yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: /mark done/i })).toBeNull();
    expect(getProfile).not.toHaveBeenCalled();
  });

  test('with no platform floor the tab still opens and says nothing is planned', async () => {
    getDataRoomPlanned.mockResolvedValue({ workspace: null, now: '2026-09-10T12:00:00.000Z', items: [] });
    mount('/data-room/planned');
    expect(await screen.findByText('Nothing planned yet.')).toBeInTheDocument();
  });
});

describe('documentation', () => {
  test('/data-room/docs is the guide index, grouped as the guides page groups it, linking inside the room', async () => {
    mount('/data-room/docs');
    const link = await screen.findByRole('link', { name: 'Start here' });
    expect(link.getAttribute('href')).toBe('/data-room/docs/start-here');
    expect(screen.getByRole('link', { name: 'Get paid for work' }).getAttribute('href')).toBe(
      '/data-room/docs/get-paid',
    );
    expect(screen.getByText('Basics')).toBeInTheDocument();
    expect(screen.getByText('Forecasting')).toBeInTheDocument();
    expect(document.querySelector('.dr-tabs')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Filter the log' })).toBeNull();
    expect(getActions).not.toHaveBeenCalled();
  });

  test('/data-room/docs/<section> is one guide, with its links kept inside /data-room/docs', async () => {
    mount('/data-room/docs/get-paid');
    expect(await screen.findByText('Guide get-paid')).toBeInTheDocument();
    expect(getGuide).toHaveBeenCalledWith('get-paid');
    expect(screen.getByRole('link', { name: 'the index' }).getAttribute('href')).toBe('/data-room/docs/start-here');
    expect(screen.getByRole('link', { name: 'All guides' }).getAttribute('href')).toBe('/data-room/docs');
    expect(document.querySelector('.dr-tabs a[aria-current="page"]')?.textContent).toBe('Documentation');
  });

  test('a guide that does not exist says so, inside the room', async () => {
    getGuide.mockRejectedValue(new Error('404'));
    mount('/data-room/docs/no-such');
    expect(await screen.findByText('That guide is not here')).toBeInTheDocument();
    expect(document.querySelector('.dr-tabs')).toBeTruthy();
  });
});

describe('vision', () => {
  test('/data-room/vision renders the one document as markdown, with its updated date in mono', async () => {
    mount('/data-room/vision');
    expect(await screen.findByText('Where this goes')).toBeInTheDocument();
    expect(screen.getByText('four').tagName).toBe('STRONG');
    const updated = document.querySelector('.dr-vision-updated')!;
    expect(updated.textContent).toContain('2026-09-11');
    expect(getDataRoomVision).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'Filter the log' })).toBeNull();
    expect(getActions).not.toHaveBeenCalled();
  });

  test('a failed read says the vision would not open, never an empty page', async () => {
    getDataRoomVision.mockRejectedValue(new Error('boom'));
    mount('/data-room/vision');
    expect(await screen.findByText('The vision would not open.')).toBeInTheDocument();
  });
});
