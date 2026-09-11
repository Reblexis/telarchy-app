import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The cockpit's Plans card (docs/data-room.md, "What is planned": entries
 * are written from /admin, "Plans" card, shaped like vcihal.com/tasks). The
 * room is read-only for everyone, so this card is the only place an entry is
 * added, edited, ticked done or reopened. What is pinned: the composer (a
 * title row with Add, the details folded under it, datetime-local turned
 * into an ISO instant in the browser's zone, absent optionals sent as
 * undefined), one open list soonest due first with the undated last, the due
 * meta and "overdue", edit in place sending only what changed, the done tick,
 * "Done N" newest first with an undo, and that the card reads once on mount
 * and after each write and never on a timer (an /admin tab polling took the
 * site down on 2026-09-09).
 */

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../lib/api', () => ({
  api: {
    getProfile: vi.fn(),
    getFloorStats: vi.fn(),
    getFeedback: vi.fn(),
    getFloorQuestions: vi.fn(),
    getJourneys: vi.fn(),
    getAdminEarnTable: vi.fn(),
    getDataRoomPlanned: vi.fn(),
    listPlans: vi.fn(),
    createPlan: vi.fn(),
    updatePlan: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));
vi.mock('../../components/XWorkbench', () => ({ XWorkbench: () => null }));
vi.mock('../../components/OutreachWorkbench', () => ({ OutreachWorkbench: () => <div>outreach workbench</div> }));
vi.mock('../../components/ManifoldUpdate', () => ({ ManifoldUpdate: () => null }));
vi.mock('../../components/EarnTableEditor', () => ({ EarnTableEditor: () => null }));

import { api } from '../../lib/api';
import { AdminPage } from '../AdminPage';

const m = (f: unknown) => f as ReturnType<typeof vi.fn>;

/** Thursday 11 September 2026, 10:00 local. Built by parts so the tests hold in any zone. */
const NOW = new Date(2026, 8, 11, 10, 0, 0, 0);
const DAY = 864e5;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const dayMonth = (ms: number) =>
  new Date(NOW.getTime() + ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const WS = { id: 'ws-telarchy', slug: 'telarchy', name: 'Telarchy' };

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

/** Deliberately out of order: the card sorts, whatever the server sent. */
const ITEMS = [
  entry({ id: 'undated', title: 'Someday' }),
  entry({ id: 'later', title: 'Results post', due: at(3 * DAY), description: 'The September numbers' }),
  entry({ id: 'late', title: 'Missed call', due: at(-DAY) }),
  entry({ id: 'soon', title: 'Call with Seer', start: at(-2 * DAY), due: at(DAY) }),
  entry({ id: 'done-old', title: 'Finished first', done: true, doneAt: at(-3 * DAY) }),
  entry({ id: 'done-new', title: 'Finished second', done: true, doneAt: at(-DAY) }),
];

const listed = (items: unknown[]) => ({ workspace: WS, now: NOW.toISOString(), items });

function renderPlans() {
  window.location.hash = '#plans';
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
}

const card = () => screen.getByRole('region', { name: 'Plans' });
const openTitles = () => Array.from(card().querySelectorAll('.adm-plan-open .adm-plan-title')).map(e => e.textContent);
const rowOf = (title: string) => screen.getByText(title).closest('.adm-plan-row') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  m(api.getProfile).mockResolvedValue({ platformAdmin: true });
  m(api.getDataRoomPlanned).mockResolvedValue({ workspace: WS, now: NOW.toISOString(), items: [] });
  m(api.listPlans).mockResolvedValue(listed(ITEMS));
  m(api.createPlan).mockResolvedValue({});
  m(api.updatePlan).mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

describe('the Plans card on /admin', () => {
  test('lives on its own tab, so opening another tab never reads the plans', async () => {
    window.location.hash = '';
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('outreach workbench')).toBeInTheDocument();
    expect(api.getDataRoomPlanned).not.toHaveBeenCalled();
    expect(api.listPlans).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^plans$/i }));
    await waitFor(() => expect(api.listPlans).toHaveBeenCalledWith(WS.id));
  });

  test("targets the room's floor: the workspace id comes from the planned read, the list from the managers' read", async () => {
    renderPlans();
    await screen.findByText('Call with Seer');
    expect(api.getDataRoomPlanned).toHaveBeenCalledTimes(1);
    expect(api.listPlans).toHaveBeenCalledTimes(1);
    expect(api.listPlans).toHaveBeenCalledWith(WS.id);
  });

  test('every open entry in one list, soonest due first, the undated last', async () => {
    renderPlans();
    await screen.findByText('Call with Seer');
    expect(openTitles()).toEqual(['Missed call', 'Call with Seer', 'Results post', 'Someday']);
  });

  test('each open row carries its due meta, "overdue" once its due point has passed, and nothing when undated', async () => {
    renderPlans();
    await screen.findByText('Call with Seer');
    expect(within(rowOf('Call with Seer')).getByText('due tomorrow')).toBeInTheDocument();
    expect(within(rowOf('Results post')).getByText(`due ${dayMonth(3 * DAY)}`)).toBeInTheDocument();
    expect(within(rowOf('Missed call')).getByText('overdue')).toBeInTheDocument();
    expect(rowOf('Someday').querySelector('.adm-plan-meta')).toBeNull();
  });

  test('the composer: a title and Add is enough, and the optionals go as undefined', async () => {
    renderPlans();
    await screen.findByText('Call with Seer');
    fireEvent.change(screen.getByPlaceholderText('What needs doing?'), { target: { value: '  Ship the tabs  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.createPlan).toHaveBeenCalledTimes(1));
    expect(api.createPlan).toHaveBeenCalledWith(WS.id, {
      title: 'Ship the tabs',
      description: undefined,
      start: undefined,
      due: undefined,
    });
    // One read after the write, and the title row is cleared for the next.
    await waitFor(() => expect(api.listPlans).toHaveBeenCalledTimes(2));
    expect((screen.getByPlaceholderText('What needs doing?') as HTMLInputElement).value).toBe('');
  });

  test("the details fold under the title row; start and due are converted to ISO in the browser's zone", async () => {
    renderPlans();
    await screen.findByText('Call with Seer');
    const composer = card().querySelector('.adm-plan-composer') as HTMLElement;
    const details = composer.querySelector('details') as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    fireEvent.change(screen.getByPlaceholderText('What needs doing?'), { target: { value: 'Results post' } });
    fireEvent.change(within(composer).getByLabelText('What it is'), { target: { value: 'The numbers' } });
    fireEvent.change(within(composer).getByLabelText('Start'), { target: { value: '2026-09-12T09:00' } });
    fireEvent.change(within(composer).getByLabelText('Due'), { target: { value: '2026-09-14T18:30' } });
    fireEvent.click(within(composer).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.createPlan).toHaveBeenCalledTimes(1));
    expect(api.createPlan).toHaveBeenCalledWith(WS.id, {
      title: 'Results post',
      description: 'The numbers',
      start: new Date(2026, 8, 12, 9, 0).toISOString(),
      due: new Date(2026, 8, 14, 18, 30).toISOString(),
    });
  });

  test('an empty title adds nothing', async () => {
    renderPlans();
    await screen.findByText('Call with Seer');
    fireEvent.change(screen.getByPlaceholderText('What needs doing?'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(api.createPlan).not.toHaveBeenCalled();
  });

  test('a failed add says why and keeps what was typed', async () => {
    m(api.createPlan).mockRejectedValue(new Error('due is before start'));
    renderPlans();
    await screen.findByText('Call with Seer');
    fireEvent.change(screen.getByPlaceholderText('What needs doing?'), { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('due is before start')).toBeInTheDocument();
    expect((screen.getByPlaceholderText('What needs doing?') as HTMLInputElement).value).toBe('Keep me');
  });

  test('edit opens the same fields in place, filled in, and saves only the fields that changed', async () => {
    renderPlans();
    await screen.findByText('Results post');
    fireEvent.click(within(rowOf('Results post')).getByRole('button', { name: 'Edit' }));
    const form = card().querySelector('.adm-plan-edit') as HTMLElement;
    expect(form).toBeTruthy();
    const title = within(form).getByLabelText('Title') as HTMLInputElement;
    expect(title.value).toBe('Results post');
    expect((within(form).getByLabelText('What it is') as HTMLTextAreaElement).value).toBe('The September numbers');
    expect((within(form).getByLabelText('Due') as HTMLInputElement).value).not.toBe('');
    fireEvent.change(title, { target: { value: 'The results post' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updatePlan).toHaveBeenCalledTimes(1));
    expect(api.updatePlan).toHaveBeenCalledWith(WS.id, 'later', { title: 'The results post' });
    await waitFor(() => expect(api.listPlans).toHaveBeenCalledTimes(2));
  });

  test('clearing a date in the edit sends null for it, and a new due as an ISO instant', async () => {
    renderPlans();
    await screen.findByText('Call with Seer');
    fireEvent.click(within(rowOf('Call with Seer')).getByRole('button', { name: 'Edit' }));
    const form = card().querySelector('.adm-plan-edit') as HTMLElement;
    fireEvent.change(within(form).getByLabelText('Start'), { target: { value: '' } });
    fireEvent.change(within(form).getByLabelText('Due'), { target: { value: '2026-09-20T12:00' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updatePlan).toHaveBeenCalledTimes(1));
    expect(api.updatePlan).toHaveBeenCalledWith(WS.id, 'soon', {
      start: null,
      due: new Date(2026, 8, 20, 12, 0).toISOString(),
    });
  });

  test('an edit that changes nothing writes nothing, and cancel closes the fields', async () => {
    renderPlans();
    await screen.findByText('Results post');
    fireEvent.click(within(rowOf('Results post')).getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.updatePlan).not.toHaveBeenCalled();
    expect(card().querySelector('.adm-plan-edit')).toBeNull();
    fireEvent.click(within(rowOf('Results post')).getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(card().querySelector('.adm-plan-edit')).toBeNull();
    expect(api.updatePlan).not.toHaveBeenCalled();
  });

  test('the done tick sends done: true and reads the list again', async () => {
    renderPlans();
    await screen.findByText('Call with Seer');
    fireEvent.click(screen.getByRole('button', { name: 'Mark done: Call with Seer' }));
    await waitFor(() => expect(api.updatePlan).toHaveBeenCalledWith(WS.id, 'soon', { done: true }));
    await waitFor(() => expect(api.listPlans).toHaveBeenCalledTimes(2));
  });

  test('done entries fold under "Done N", newest first, each with an undo that reopens it', async () => {
    renderPlans();
    await screen.findByText('Call with Seer');
    const fold = card().querySelector('details.adm-plan-done') as HTMLDetailsElement;
    expect(fold).toBeTruthy();
    expect(fold.querySelector('summary')?.textContent).toBe('Done 2');
    const done = Array.from(fold.querySelectorAll('.adm-plan-title')).map(e => e.textContent);
    expect(done).toEqual(['Finished second', 'Finished first']);
    // Done entries are not in the open list.
    expect(openTitles()).not.toContain('Finished first');
    fireEvent.click(within(rowOf('Finished first')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.updatePlan).toHaveBeenCalledWith(WS.id, 'done-old', { done: false }));
  });

  test('with nothing done there is no "Done" fold, and with nothing open the list says so', async () => {
    m(api.listPlans).mockResolvedValue(listed([]));
    renderPlans();
    expect(await screen.findByText('Nothing planned yet.')).toBeInTheDocument();
    expect(card().querySelector('details.adm-plan-done')).toBeNull();
  });

  test('IT NEVER POLLS: five minutes after the first read, nothing has been read again', async () => {
    vi.useFakeTimers();
    renderPlans();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Call with Seer')).toBeInTheDocument();
    expect(api.listPlans).toHaveBeenCalledTimes(1);
    expect(api.getDataRoomPlanned).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(api.listPlans).toHaveBeenCalledTimes(1);
    expect(api.getDataRoomPlanned).toHaveBeenCalledTimes(1);
  });

  test('when the platform floor is not public the card says so in one line and lists nothing', async () => {
    m(api.getDataRoomPlanned).mockResolvedValue({ workspace: null, now: NOW.toISOString(), items: [] });
    renderPlans();
    expect(
      await screen.findByText('The platform floor is not public, so its plans cannot be shown here.'),
    ).toBeInTheDocument();
    expect(api.listPlans).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('What needs doing?')).toBeNull();
  });

  test('a failed read says the plans would not open, never an empty list', async () => {
    m(api.listPlans).mockRejectedValue(new Error('boom'));
    renderPlans();
    expect(await screen.findByText('The plans would not open.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing planned yet.')).toBeNull();
  });
});
