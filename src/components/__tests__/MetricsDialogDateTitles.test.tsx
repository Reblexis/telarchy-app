import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MetricsDialog } from '../MetricsDialog';

/**
 * A title on every date row, and a date that settles when the owner settles
 * it (docs/owner-on-the-floor.md, dialog 2, "Every row carries a title" and
 * "Above how often sits Settles"; docs/guides/time-preference.md).
 *
 * THE RULE the sheet has to keep: every write of the dates is the WHOLE
 * timePreference, so no write, of a number, a title, a stop or a new date,
 * may drop a title another entry carries.
 */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const METRICS = [
  {
    id: 'm-len',
    name: 'Reached length',
    description: 'The length the current attempt has reached.',
    value: 2,
    marketRangeMax: 64,
    settlementLagMinutes: 0,
    liquidityCredits: 3000,
  },
  {
    id: 'm-plain',
    name: 'Plain',
    description: 'A metric with one weekly date.',
    value: 5,
    marketRangeMax: 1000,
    settlementLagMinutes: 0,
    liquidityCredits: 250,
  },
];

const STORED: Record<string, unknown> = {
  'm-len': {
    id: 'm-len',
    name: 'Reached length',
    liquidityCredits: 3000,
    settlementLagMinutes: 0,
    timePreference: {
      enabled: false,
      halfLife: 1,
      customHorizons: ['until-settled', '+0w'],
      horizonCredits: { 'until-settled': { book: 3000, proposal: 1000 } },
      horizonTitles: { 'until-settled': 'this attempt' },
    },
  },
  'm-plain': {
    id: 'm-plain',
    name: 'Plain',
    liquidityCredits: 250,
    settlementLagMinutes: 0,
    timePreference: { enabled: false, halfLife: 1, customHorizons: ['+0w'] },
  },
};

const getMetricsIn = vi.fn(async () => METRICS);
const getMetric = vi.fn(async (_ws: string, id: string) => STORED[id]);
const patchMetric = vi.fn(async () => ({ ok: true }));
vi.mock('../../lib/api', () => ({
  api: {
    getMetricsIn: (...a: unknown[]) => getMetricsIn(...(a as [])),
    getMetric: (...a: unknown[]) => getMetric(...(a as [string, string])),
    patchMetric: (...a: unknown[]) => patchMetric(...(a as [])),
    deleteMetric: vi.fn(async () => ({})),
  },
}));

const MARKETS = [
  { metricId: 'm-len', targetDate: 'until-settled', label: 'this attempt', pool: 3000, traders: 4, tradedVolume: 412 },
  { metricId: 'm-len', targetDate: '2026-W36', label: 'this week', pool: 250, traders: 0, tradedVolume: 0 },
  { metricId: 'm-plain', targetDate: '2026-W36', label: 'this week', pool: 250, traders: 0, tradedVolume: 0 },
];

const onDone = vi.fn();
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const openSheet = async (name: string) => {
  render(
    <MetricsDialog
      workspaceId="ws"
      markets={MARKETS}
      defaultCredits={250}
      spendable={12_400}
      onAdd={() => {}}
      onClose={() => {}}
      onDone={onDone}
    />,
  );
  await screen.findByText(name);
  const line = screen.getByText(name).closest('.ticket-fact') as HTMLElement;
  fireEvent.click(line.querySelector('button')!);
  await waitFor(() => expect(document.querySelector('.metrics-dates-table')).toBeTruthy());
  return document.querySelector('.metrics-dates-table') as HTMLTableElement;
};
const rowOf = (table: HTMLTableElement, label: string) =>
  Array.from(table.querySelectorAll('tbody tr')).find(r => r.querySelector('.dates-what')?.textContent === label) as
    | HTMLTableRowElement
    | undefined;
const sentTp = () => (patchMetric.mock.calls[0] as unknown[])[2] as { timePreference: Record<string, unknown> };

beforeEach(() => {
  getMetricsIn.mockClear();
  getMetric.mockClear();
  getMetric.mockImplementation(async (_ws: string, id: string) => STORED[id]);
  patchMetric.mockClear();
  onDone.mockClear();
});

describe('the until-settled row', () => {
  test('says what it is and who settles it, and names no date for its open book', async () => {
    const table = await openSheet('Reached length');
    const row = rowOf(table, 'Until you settle it');
    expect(row).toBeTruthy();
    expect(text(row!)).toContain('settles when you settle it');
    expect(text(row!)).toContain('3,000 cr · 4 traders');
    expect(text(row!)).not.toContain('until-settled');
  });
});

describe('every row carries a title', () => {
  test("the stored title is in the row's field, and an untitled row's field is empty", async () => {
    await openSheet('Reached length');
    expect((screen.getByLabelText('Title, Until you settle it') as HTMLInputElement).value).toBe('this attempt');
    expect((screen.getByLabelText('Title, Every week') as HTMLInputElement).value).toBe('');
  });

  test('a changed title is a Save that names it, and ONE whole write keeps every credit and title', async () => {
    await openSheet('Reached length');
    fireEvent.change(screen.getByLabelText('Title, Every week'), { target: { value: 'this week of the sprint' } });
    fireEvent.click(screen.getByRole('button', { name: /Save · the title of every week/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(sentTp().timePreference).toEqual({
      enabled: false,
      halfLife: 1,
      customHorizons: ['until-settled', '+0w'],
      horizonCredits: { 'until-settled': { book: 3000, proposal: 1000 } },
      horizonTitles: { 'until-settled': 'this attempt', '+0w': 'this week of the sprint' },
    });
  });

  test('clearing a title removes it from the write', async () => {
    await openSheet('Reached length');
    fireEvent.change(screen.getByLabelText('Title, Until you settle it'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    const titles = (sentTp().timePreference.horizonTitles ?? {}) as Record<string, string>;
    expect(titles['until-settled']).toBeUndefined();
  });

  test('THE RULE: saving a number never drops a title', async () => {
    const table = await openSheet('Reached length');
    const week = rowOf(table, 'Every week')!;
    fireEvent.change(within(week).getByLabelText('Proposal opens with, Every week'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(sentTp().timePreference.horizonTitles).toEqual({ 'until-settled': 'this attempt' });
  });

  test('THE RULE: stopping one date keeps the other titles and drops only its own', async () => {
    const table = await openSheet('Reached length');
    fireEvent.click(within(rowOf(table, 'Every week')!).getByText('Stop'));
    fireEvent.click(await screen.findByRole('button', { name: /Stop and take the pool back/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(sentTp().timePreference.customHorizons).toEqual(['until-settled']);
    expect(sentTp().timePreference.horizonTitles).toEqual({ 'until-settled': 'this attempt' });
  });

  test('stopping a traded until-settled date says it settles when you settle it, not on a date', async () => {
    const table = await openSheet('Reached length');
    fireEvent.click(within(rowOf(table, 'Until you settle it')!).getByText('Stop'));
    const go = await screen.findByRole('button', { name: /Stop repeating/ });
    expect(text(go)).toContain('It settles when you settle the metric, and the one after it is never opened.');
  });
});

describe('adding a date: Settles', () => {
  const openForm = async (name: string) => {
    await openSheet(name);
    fireEvent.click(screen.getByRole('button', { name: /Add a date/ }));
  };

  test('offers On a date and When I settle it, On a date first and chosen', async () => {
    await openForm('Plain');
    const group = screen.getByRole('group', { name: 'Settles' });
    const buttons = Array.from(group.querySelectorAll('button'));
    expect(buttons.map(b => b.textContent)).toEqual(['On a date', 'When I settle it']);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('group', { name: 'How often' })).toBeTruthy();
  });

  test('When I settle it takes how often away and needs the title before any write', async () => {
    await openForm('Plain');
    fireEvent.click(within(screen.getByRole('group', { name: 'Settles' })).getByText('When I settle it'));
    expect(screen.queryByRole('group', { name: 'How often' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open the book/ }));
    await waitFor(() => expect(screen.getByText('Write the title: it is the only thing that says when.')).toBeTruthy());
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('with a title it is ONE write: until-settled joins the list with its numbers and its title', async () => {
    await openForm('Plain');
    fireEvent.click(within(screen.getByRole('group', { name: 'Settles' })).getByText('When I settle it'));
    fireEvent.change(screen.getByLabelText('Title of the date'), { target: { value: 'this attempt' } });
    const go = screen.getByRole('button', { name: /Open the book · 250 cr/ });
    expect(text(go)).toContain('It settles when you settle it, and the next one opens after.');
    fireEvent.click(go);
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(sentTp().timePreference).toEqual({
      enabled: false,
      halfLife: 1,
      customHorizons: ['+0w', 'until-settled'],
      horizonCredits: { 'until-settled': { book: 250, proposal: 0 } },
      horizonTitles: { 'until-settled': 'this attempt' },
    });
  });

  test('a metric that already has one says so in place of the button', async () => {
    await openForm('Reached length');
    fireEvent.click(within(screen.getByRole('group', { name: 'Settles' })).getByText('When I settle it'));
    expect(screen.getByText('This metric already has a date you settle.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open the book/ })).toBeNull();
  });

  test('On a date takes an optional title, stored under the new entry, and keeps the stored titles', async () => {
    await openForm('Reached length');
    fireEvent.click(within(screen.getByRole('group', { name: 'How often' })).getByText('daily'));
    fireEvent.change(screen.getByLabelText('Title of the date'), { target: { value: 'today on the board' } });
    fireEvent.click(screen.getByRole('button', { name: /Open the daily book/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(sentTp().timePreference.horizonTitles).toEqual({
      'until-settled': 'this attempt',
      '+0d': 'today on the board',
    });
  });
});
