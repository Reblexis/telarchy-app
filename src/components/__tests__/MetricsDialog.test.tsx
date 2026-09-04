import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MetricsDialog } from '../MetricsDialog';

/**
 * The metrics a floor prices, and one metric's sheet
 * (docs/owner-on-the-floor.md, dialogs 1 and 2).
 *
 * The list comes first and every line says what the metric IS (its range,
 * its dates, whether anyone is in it), because a control that vanished
 * without a trace read as a control that never existed (owner report
 * 2026-09-03). The sheet under a line carries the range with the rule
 * printed under it (docs/market-integrity.md, "The range applies from now
 * on") and, since 2026-09-04, the dates as rows of its own: each row says
 * what it IS, what is open on it, and two numbers in credits, "Book opens
 * with" and "Proposal opens with", both stored on the entry as
 * `timePreference.horizonCredits[entry]`. The proposal number defaults to
 * 0, which means the proposer funds their own.
 */

/** The fixtures name real dates and the rows resolve their entries against
 *  today, so the clock is pinned to the day these expectations describe. */
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const METRICS = [
  {
    id: 'm-val',
    name: 'Implied valuation (USD)',
    description: 'The post-money valuation implied by the latest priced investment.',
    value: 0,
    marketRangeMax: 20_000_000,
    settlementLagMinutes: 0,
    liquidityCredits: 250,
  },
  {
    id: 'm-rev',
    name: 'Telarchy revenue (USD)',
    description: 'Net revenue received in the trailing 30 days.',
    value: 5,
    marketRangeMax: 1000,
    settlementLagMinutes: 3 * 24 * 60,
    liquidityCredits: null,
  },
];

/** What GET /api/metrics/:id says about each: the stored entries and, for
 *  the valuation's monthly one, both numbers already chosen. */
const STORED: Record<string, unknown> = {
  'm-val': {
    id: 'm-val',
    name: 'Implied valuation (USD)',
    liquidityCredits: 250,
    settlementLagMinutes: 0,
    timePreference: {
      enabled: false,
      halfLife: 1,
      customHorizons: ['+0m', '2026'],
      horizonCredits: { '+0m': { book: 500, proposal: 250 } },
    },
  },
  'm-rev': {
    id: 'm-rev',
    name: 'Telarchy revenue (USD)',
    liquidityCredits: null,
    settlementLagMinutes: 3 * 24 * 60,
    timePreference: { enabled: false, halfLife: 1, customHorizons: ['+0d', '+0w', '+0m'] },
  },
};

const getMetricsIn = vi.fn(async () => METRICS);
const getMetric = vi.fn(async (_ws: string, id: string) => STORED[id]);
const patchMetric = vi.fn(async () => ({ ok: true }));
const deleteMetric = vi.fn(async () => ({}));
vi.mock('../../lib/api', () => ({
  api: {
    getMetricsIn: (...a: unknown[]) => getMetricsIn(...(a as [])),
    getMetric: (...a: unknown[]) => getMetric(...(a as [string, string])),
    patchMetric: (...a: unknown[]) => patchMetric(...(a as [])),
    deleteMetric: (...a: unknown[]) => deleteMetric(...(a as [])),
  },
}));

const MARKETS = [
  { metricId: 'm-val', targetDate: '2026-09', label: 'September', pool: 360, traders: 5, tradedVolume: 902 },
  { metricId: 'm-val', targetDate: '2026', label: '2026', pool: 1447, traders: 0, tradedVolume: 0 },
  { metricId: 'm-rev', targetDate: '2026-09-03', label: 'today', pool: 250, traders: 0, tradedVolume: 0 },
  { metricId: 'm-rev', targetDate: '2026-W36', label: 'this week', pool: 250, traders: 0, tradedVolume: 0 },
  { metricId: 'm-rev', targetDate: '2026-09', label: 'September', pool: 250, traders: 0, tradedVolume: 0 },
];

const onAdd = vi.fn();
const onDone = vi.fn();

const open = (markets = MARKETS, extra: { initialMetricId?: string } = {}) =>
  render(
    <MetricsDialog
      workspaceId="ws"
      markets={markets}
      defaultCredits={250}
      spendable={12_400}
      onAdd={onAdd}
      onClose={() => {}}
      onDone={onDone}
      {...extra}
    />,
  );

beforeEach(() => {
  getMetricsIn.mockClear();
  getMetricsIn.mockResolvedValue(METRICS as never);
  getMetric.mockClear();
  getMetric.mockImplementation(async (_ws: string, id: string) => STORED[id]);
  patchMetric.mockClear();
  deleteMetric.mockClear();
  onAdd.mockClear();
  onDone.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The sheet's rows table, once the metric has been read. */
const rowsTable = async () => {
  await waitFor(() => expect(document.querySelector('.metrics-dates-table')).toBeTruthy());
  return document.querySelector('.metrics-dates-table') as HTMLTableElement;
};
/** The row whose "Priced" label is exactly this: "2026" must not match the
 *  monthly row's open market, "2026-09". */
const rowOf = (table: HTMLTableElement, label: string) =>
  (Array.from(table.querySelectorAll('tbody tr')).find(r => r.querySelector('.dates-what')?.textContent === label) ??
    null) as HTMLTableRowElement | null;

describe('the list', () => {
  test('renders every metric with its range, its dates and whether anyone is in it', async () => {
    open();
    expect(await screen.findByText('Implied valuation (USD)')).toBeTruthy();
    expect(screen.getByText('Telarchy revenue (USD)')).toBeTruthy();
    expect(screen.getByText('0 - 20,000,000 · 2 dates · 902 cr traded')).toBeTruthy();
    expect(screen.getByText('0 - 1,000 · 3 dates · nobody in it yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2);
  });

  test('adding is folded behind one chip while the floor has metrics', async () => {
    open();
    await screen.findByText('Implied valuation (USD)');
    fireEvent.click(screen.getByRole('button', { name: /Add a metric/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  test('an empty floor opens on the add form, with no chip', async () => {
    getMetricsIn.mockResolvedValue([] as never);
    open([]);
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /Add a metric/ })).toBeNull();
  });

  test("the floor's dates chip opens straight onto that metric's sheet", async () => {
    open(MARKETS, { initialMetricId: 'm-rev' });
    await waitFor(() => expect(text(document.querySelector('.ticket-label'))).toBe('Metrics · Telarchy revenue (USD)'));
    expect(screen.queryByText('0 - 1,000 · 3 dates · nobody in it yet')).toBeNull();
    // The head link still leads back to the list.
    fireEvent.click(screen.getByRole('button', { name: 'Metrics' }));
    expect(await screen.findByText('0 - 1,000 · 3 dates · nobody in it yet')).toBeTruthy();
  });
});

describe('the sheet', () => {
  const openSheet = async (name = 'Implied valuation (USD)') => {
    open();
    await screen.findByText(name);
    const line = screen.getByText(name).closest('.ticket-fact') as HTMLElement;
    fireEvent.click(line.querySelector('button')!);
  };

  test('Open goes to the sheet, and the head names the metric', async () => {
    await openSheet();
    expect(text(document.querySelector('.ticket-label'))).toBe('Metrics · Implied valuation (USD)');
    expect((screen.getByLabelText('Metric name') as HTMLInputElement).value).toBe('Implied valuation (USD)');
    expect((screen.getByLabelText('What the metric is') as HTMLTextAreaElement).value).toContain('post-money');
  });

  test('the head link returns to the list', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Metrics' }));
    expect(await screen.findByText('0 - 20,000,000 · 2 dates · 902 cr traded')).toBeTruthy();
  });

  test('the range prints the traded rule when a book on it is traded', async () => {
    await openSheet();
    expect(text(document.querySelector('.metrics-range-rule'))).toBe(
      '1 book is traded and keeps 0 to 20,000,000 to settlement. The new range applies to every book that opens after this, and re-opens the untraded ones at it, pools refunded.',
    );
  });

  test('and the untraded rule when nobody has traded', async () => {
    await openSheet('Telarchy revenue (USD)');
    expect(text(document.querySelector('.metrics-range-rule'))).toBe(
      'Nobody has traded, so this re-opens every book at the new range. Pools come back to whoever funded them.',
    );
  });

  test('a range under the reading is refused, not sent', async () => {
    await openSheet('Telarchy revenue (USD)');
    fireEvent.click(screen.getByRole('button', { name: 'change' }));
    const field = screen.getByLabelText('Range top') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the range' }));
    expect(screen.getByText('The range has to reach the number.')).toBeTruthy();
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('saving the range sends marketRangeMax and nothing else', async () => {
    await openSheet('Telarchy revenue (USD)');
    fireEvent.click(screen.getByRole('button', { name: 'change' }));
    fireEvent.change(screen.getByLabelText('Range top'), { target: { value: '20,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the range' }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledWith('ws', 'm-rev', { marketRangeMax: 20_000 }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  test('the words save on blur, one field at a time', async () => {
    await openSheet();
    const name = screen.getByLabelText('Metric name');
    fireEvent.change(name, { target: { value: 'Implied valuation (USD), post-money' } });
    fireEvent.blur(name);
    await waitFor(() =>
      expect(patchMetric).toHaveBeenCalledWith('ws', 'm-val', { name: 'Implied valuation (USD), post-money' }),
    );
    const what = screen.getByLabelText('What the metric is');
    fireEvent.change(what, { target: { value: 'New words.' } });
    fireEvent.blur(what);
    await waitFor(() => expect(patchMetric).toHaveBeenCalledWith('ws', 'm-val', { description: 'New words.' }));
    // Unchanged words write nothing.
    fireEvent.blur(what);
    expect(patchMetric).toHaveBeenCalledTimes(2);
  });

  test('final-after reads from the metric, and change writes one field', async () => {
    await openSheet('Telarchy revenue (USD)');
    expect(screen.getByText('3 days · markets already open keep their instant')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change the lag' }));
    fireEvent.change(screen.getByLabelText('Days after the period'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the lag' }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledWith('ws', 'm-rev', { settlementLagMinutes: 24 * 60 }));
  });

  test('the dates are rows on the sheet: no "Open" line and no standing number line', async () => {
    await openSheet();
    await rowsTable();
    expect(screen.queryByRole('button', { name: /Open ›/ })).toBeNull();
    expect(screen.queryByText('A new book opens with')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change the credits' })).toBeNull();
  });

  test('Remove opens the confirmation, which names what is in the way', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the metric' }));
    expect(text(document.querySelector('.ticket-label'))).toBe('Remove Implied valuation (USD)');
    expect(screen.getByText('in the way')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Remove the metric/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('an untraded metric removes, and its pools come back', async () => {
    await openSheet('Telarchy revenue (USD)');
    fireEvent.click(screen.getByRole('button', { name: 'Remove the metric' }));
    const go = screen.getByRole('button', { name: /Remove the metric/ }) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(deleteMetric).toHaveBeenCalledWith('m-rev'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe('the date rows', () => {
  const openSheet = async (name = 'Implied valuation (USD)') => {
    open();
    await screen.findByText(name);
    const line = screen.getByText(name).closest('.ticket-fact') as HTMLElement;
    fireEvent.click(line.querySelector('button')!);
    return rowsTable();
  };

  test('one row per stored entry, saying what it IS and what is open on it', async () => {
    const table = await openSheet();
    const monthly = rowOf(table, 'Every month')!;
    expect(monthly).toBeTruthy();
    expect(text(monthly.querySelector('.metrics-dates-what'))).toBe('Every month from this month');
    expect(text(monthly.querySelector('.metrics-dates-open'))).toBe('2026-09 · 360 cr · 5 traders');
    const once = rowOf(table, '2026')!;
    expect(text(once.querySelector('.metrics-dates-what'))).toBe('2026 once');
    expect(text(once.querySelector('.metrics-dates-open'))).toBe('2026 · 1,447 cr · nobody yet');
  });

  test('a row with no market open on it says so, and a once entry names its hour', async () => {
    getMetric.mockResolvedValueOnce({
      ...(STORED['m-val'] as object),
      timePreference: { enabled: false, halfLife: 1, customHorizons: ['+1d', '2026-12-31T14'] },
    });
    const table = await openSheet();
    const daily = rowOf(table, 'Every day')!;
    expect(text(daily.querySelector('.metrics-dates-what'))).toBe('Every day from tomorrow');
    expect(text(daily.querySelector('.metrics-dates-open'))).toBe('no market open on it');
    const once = rowOf(table, '31 December 2026')!;
    expect(text(once.querySelector('.metrics-dates-what'))).toBe('31 December 2026 once, 14:00 UTC');
  });

  test('both numbers are on the row: the stored ones where chosen', async () => {
    await openSheet();
    expect((screen.getByLabelText('Book opens with, Every month') as HTMLInputElement).value).toBe('500');
    expect((screen.getByLabelText('Proposal opens with, Every month') as HTMLInputElement).value).toBe('250');
  });

  test("a row with no book number of its own shows the metric's standing number, as the placeholder too", async () => {
    await openSheet();
    const book = screen.getByLabelText('Book opens with, 2026') as HTMLInputElement;
    expect(book.value).toBe('250');
    expect(book.placeholder).toBe('250');
    // The proposal number defaults to 0: the proposer funds their own.
    expect((screen.getByLabelText('Proposal opens with, 2026') as HTMLInputElement).value).toBe('0');
  });

  test('a metric with no standing number falls back to the workspace default', async () => {
    await openSheet('Telarchy revenue (USD)');
    const book = screen.getByLabelText('Book opens with, Every day') as HTMLInputElement;
    expect(book.value).toBe('250');
    expect(book.placeholder).toBe('250');
  });

  test('the note says whose credits these are and what 0 means', async () => {
    await openSheet();
    expect(
      screen.getByText(
        'Both numbers come out of your wallet as each market opens, every time the date comes round. The book is yours to fund. A proposal at 0 is funded by whoever proposes it, which is the usual case; put a number there when you want its price before they pay for one.',
      ),
    ).toBeTruthy();
  });

  test('there is no Save until a number changes, and it writes nothing when nothing did', async () => {
    await openSheet();
    expect(screen.queryByRole('button', { name: /^Save ·/ })).toBeNull();
    const book = screen.getByLabelText('Book opens with, Every month');
    fireEvent.change(book, { target: { value: '600' } });
    expect(screen.getByRole('button', { name: /^Save ·/ })).toBeTruthy();
    fireEvent.change(book, { target: { value: '500' } });
    expect(screen.queryByRole('button', { name: /^Save ·/ })).toBeNull();
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('Save names the one change: a proposal number', async () => {
    await openSheet();
    fireEvent.change(screen.getByLabelText('Proposal opens with, 2026'), { target: { value: '100' } });
    expect(screen.getByRole('button', { name: /^Save ·/ }).textContent).toMatch(
      /^Save · 100 cr behind each proposal on 2026/,
    );
    fireEvent.change(screen.getByLabelText('Proposal opens with, 2026'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Proposal opens with, Every month'), { target: { value: '300' } });
    expect(screen.getByRole('button', { name: /^Save ·/ }).textContent).toMatch(
      /^Save · 300 cr behind each monthly proposal/,
    );
  });

  test('Save names the one change: a book number', async () => {
    await openSheet('Telarchy revenue (USD)');
    fireEvent.change(screen.getByLabelText('Book opens with, Every day'), { target: { value: '500' } });
    expect(screen.getByRole('button', { name: /^Save ·/ }).textContent).toMatch(/^Save · 500 cr behind the daily book/);
  });

  test('and counts them when more than one changed', async () => {
    await openSheet('Telarchy revenue (USD)');
    fireEvent.change(screen.getByLabelText('Book opens with, Every day'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Proposal opens with, Every week'), { target: { value: '250' } });
    expect(screen.getByRole('button', { name: /^Save ·/ }).textContent).toMatch(/^Save · 2 changes/);
  });

  test('Save is ONE write of the whole timePreference, keyed by the entry, every other entry preserved', async () => {
    await openSheet();
    fireEvent.change(screen.getByLabelText('Proposal opens with, 2026'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save ·/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(patchMetric).toHaveBeenCalledWith('ws', 'm-val', {
      timePreference: {
        enabled: false,
        halfLife: 1,
        customHorizons: ['+0m', '2026'],
        horizonCredits: {
          '+0m': { book: 500, proposal: 250 },
          // The book was never chosen for this entry and stays unchosen: the
          // fallback is the metric's, not frozen into the row.
          '2026': { proposal: 100 },
        },
      },
    });
    // Saved, the button goes, and nothing else was touched.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Save ·/ })).toBeNull());
    expect(patchMetric.mock.calls[0][2]).not.toHaveProperty('liquidityCredits');
  });

  test('a cleared book number is written as null: back to the standing number', async () => {
    await openSheet();
    fireEvent.change(screen.getByLabelText('Book opens with, Every month'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save ·/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(patchMetric.mock.calls[0][2]).toMatchObject({
      timePreference: { horizonCredits: { '+0m': { book: null, proposal: 250 } } },
    });
  });

  test('zero is a valid book number, and a non-number is refused before the write', async () => {
    await openSheet();
    fireEvent.change(screen.getByLabelText('Book opens with, Every month'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save ·/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(patchMetric.mock.calls[0][2]).toMatchObject({
      timePreference: { horizonCredits: { '+0m': { book: 0, proposal: 250 } } },
    });
    patchMetric.mockClear();
    fireEvent.change(screen.getByLabelText('Proposal opens with, Every month'), { target: { value: 'lots' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save ·/ }));
    await waitFor(() => expect(screen.getByText('A number of credits.')).toBeTruthy());
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('a refused write is shown, and the numbers stay as typed', async () => {
    patchMetric.mockRejectedValueOnce(new Error('Forbidden') as never);
    await openSheet();
    fireEvent.change(screen.getByLabelText('Proposal opens with, 2026'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save ·/ }));
    expect(await screen.findByText('Forbidden')).toBeTruthy();
    expect((screen.getByLabelText('Proposal opens with, 2026') as HTMLInputElement).value).toBe('100');
  });
});

describe('stopping a date says which of two things it will do, before the press', () => {
  const openSheet = async (name = 'Implied valuation (USD)', markets = MARKETS) => {
    open(markets);
    await screen.findByText(name);
    const line = screen.getByText(name).closest('.ticket-fact') as HTMLElement;
    fireEvent.click(line.querySelector('button')!);
    return rowsTable();
  };

  test('a traded date: the open market keeps running, and only the next one never opens', async () => {
    const table = await openSheet();
    fireEvent.click(within(rowOf(table, 'Every month')!).getByText('Stop'));
    expect(screen.getByText('The open one, 2026-09')).toBeTruthy();
    expect(screen.getByText('keeps running')).toBeTruthy();
    expect(screen.getByText('5 traders, 360 cr in the pool')).toBeTruthy();
    expect(screen.getByText('untouched')).toBeTruthy();
    expect(screen.getByText('never opens')).toBeTruthy();
    expect(screen.getByText('Stop repeating')).toBeTruthy();
  });

  test('an untraded date: the market goes and the pool comes back', async () => {
    const table = await openSheet();
    fireEvent.click(within(rowOf(table, '2026')!).getByText('Stop'));
    expect(screen.getByText('Nobody has traded it')).toBeTruthy();
    expect(screen.getByText('1,447 cr in its pool')).toBeTruthy();
    expect(screen.getByText('back to your wallet')).toBeTruthy();
    expect(screen.getByText('Stop and take the pool back')).toBeTruthy();
    // A once entry has no next one.
    expect(screen.queryByText('never opens')).toBeNull();
  });

  test('confirming sends the shorter list, its numbers dropped, and no liquidity at all', async () => {
    const table = await openSheet();
    fireEvent.click(within(rowOf(table, 'Every month')!).getByText('Stop'));
    fireEvent.click(screen.getByRole('button', { name: /Stop repeating/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(patchMetric.mock.calls[0][2]).toEqual({
      timePreference: { enabled: false, halfLife: 1, customHorizons: ['2026'], horizonCredits: {} },
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  test('the close on the confirmation goes back to the sheet, stopping nothing', async () => {
    const table = await openSheet();
    fireEvent.click(within(rowOf(table, 'Every month')!).getByText('Stop'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByLabelText('Book opens with, Every month')).toBeTruthy();
    expect(patchMetric).not.toHaveBeenCalled();
  });
});

describe('adding a date', () => {
  const openSheet = async (name = 'Implied valuation (USD)') => {
    open();
    await screen.findByText(name);
    const line = screen.getByText(name).closest('.ticket-fact') as HTMLElement;
    fireEvent.click(line.querySelector('button')!);
    return rowsTable();
  };
  const sentence = (cls: string) => (document.querySelector(`.${cls}`)?.textContent ?? '').replace(/\s+/g, ' ');

  test('is folded behind one chip while the metric has dates, and "Not now" folds it back', async () => {
    await openSheet();
    expect(screen.queryByRole('group', { name: 'How often' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Add a date/ }));
    expect(screen.getByRole('group', { name: 'How often' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add a date/ })).toBeNull();
    fireEvent.click(screen.getByText('Not now'));
    expect(screen.queryByRole('group', { name: 'How often' })).toBeNull();
    expect(screen.getByRole('button', { name: /Add a date/ })).toBeTruthy();
  });

  test('with no dates, the form is open, there is no chip, and no "Not now"', async () => {
    getMetric.mockResolvedValueOnce({
      ...(STORED['m-rev'] as object),
      timePreference: { enabled: false, halfLife: 1, customHorizons: [] },
    });
    open([]);
    await screen.findByText('Telarchy revenue (USD)');
    const line = screen.getByText('Telarchy revenue (USD)').closest('.ticket-fact') as HTMLElement;
    fireEvent.click(line.querySelector('button')!);
    expect(await screen.findByRole('group', { name: 'How often' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add a date/ })).toBeNull();
    expect(screen.queryByText('Not now')).toBeNull();
    expect(document.querySelector('.metrics-dates-table')).toBeNull();
  });

  test('offers the six the API has always had, and a repeat says which period it starts with', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /Add a date/ }));
    const row = screen.getByRole('group', { name: 'How often' });
    expect(Array.from(row.querySelectorAll('button')).map(b => b.textContent)).toEqual([
      'hourly',
      'daily',
      'weekly',
      'monthly',
      'yearly',
      'once',
    ]);
    fireEvent.click(screen.getByText('daily'));
    expect(sentence('dates-start')).toMatch(/^Starts with today, 2026-09-03\. /);
    fireEvent.click(screen.getByText('Start with tomorrow instead'));
    expect(sentence('dates-start')).toMatch(/^Starts with tomorrow, 2026-09-04\. /);
  });

  test('carries both numbers: the book from the standing number, the proposal at 0, and says whose they are', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /Add a date/ }));
    expect(screen.getByText('The book opens with · of your 12,400 cr')).toBeTruthy();
    expect((screen.getByLabelText('Credits behind the book') as HTMLInputElement).value).toBe('250');
    expect(screen.getByText('A proposal on it opens with')).toBeTruthy();
    expect((screen.getByLabelText('Credits behind each proposal') as HTMLInputElement).value).toBe('0');
    expect(
      screen.getByText(
        'Every week, from your wallet as the market opens. Leave the proposal at 0 and whoever proposes pays for their own price.',
      ),
    ).toBeTruthy();
  });

  test('one write: the new entry joins the stored ones, and its two numbers ride in horizonCredits', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /Add a date/ }));
    fireEvent.click(screen.getByText('daily'));
    fireEvent.change(screen.getByLabelText('Credits behind the book'), { target: { value: '1,000' } });
    fireEvent.change(screen.getByLabelText('Credits behind each proposal'), { target: { value: '250' } });
    const go = screen.getByRole('button', { name: /Open the daily book · 1,000 cr/ });
    fireEvent.click(go);
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(patchMetric).toHaveBeenCalledWith('ws', 'm-val', {
      settlementLagMinutes: 0,
      timePreference: {
        enabled: false,
        halfLife: 1,
        customHorizons: ['+0m', '2026', '+0d'],
        horizonCredits: { '+0m': { book: 500, proposal: 250 }, '+0d': { book: 1000, proposal: 250 } },
      },
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  test('once asks for a day, and the entry carries its UTC hour', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /Add a date/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'How often' })).getByText('once'));
    expect(screen.queryByText(/Starts with/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open the book/ }));
    await waitFor(() => expect(screen.getByText('Pick a date.')).toBeTruthy());
    expect(patchMetric).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText('Pick an hour, UTC'), { target: { value: '14:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Open the book/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(patchMetric.mock.calls[0][2]).toMatchObject({
      timePreference: {
        customHorizons: ['+0m', '2026', '2026-12-31T14'],
        horizonCredits: { '2026-12-31T14': { book: 250, proposal: 0 } },
      },
    });
  });

  test('a non-number in either field reaches no API', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /Add a date/ }));
    fireEvent.change(screen.getByLabelText('Credits behind each proposal'), { target: { value: 'lots' } });
    fireEvent.click(screen.getByRole('button', { name: /Open the weekly book/ }));
    await waitFor(() => expect(screen.getByText('A number of credits.')).toBeTruthy());
    expect(patchMetric).not.toHaveBeenCalled();
  });

  // THE RULE: adding one date never removes another. The write sends
  // customHorizons as a WHOLE array, so it must not run before the stored
  // dates have been read (bug hunt 2026-08-31).
  test('the form is not live while the stored dates are still being read', async () => {
    getMetric.mockImplementation(() => new Promise(() => {}));
    open();
    await screen.findByText('Telarchy revenue (USD)');
    const line = screen.getByText('Telarchy revenue (USD)').closest('.ticket-fact') as HTMLElement;
    fireEvent.click(line.querySelector('button')!);
    expect(screen.getByText(/Reading the dates/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'How often' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a date/ })).toBeNull();
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('a failed read is shown and never turns into a write', async () => {
    getMetric.mockRejectedValue(new Error('500') as never);
    open();
    await screen.findByText('Telarchy revenue (USD)');
    const line = screen.getByText('Telarchy revenue (USD)').closest('.ticket-fact') as HTMLElement;
    fireEvent.click(line.querySelector('button')!);
    expect(await screen.findByText('500')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'How often' })).toBeNull();
    expect(patchMetric).not.toHaveBeenCalled();
  });
});
