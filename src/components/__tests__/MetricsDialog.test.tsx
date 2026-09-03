import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MetricsDialog } from '../MetricsDialog';

/**
 * The metrics a floor prices (docs/owner-on-the-floor.md, dialog 1).
 *
 * The list comes first and every line says what the metric IS (its range,
 * its dates, whether anyone is in it), because a control that vanished
 * without a trace read as a control that never existed (owner report
 * 2026-09-03). The sheet under a line carries the range with the rule
 * printed under it in the words that apply right now
 * (docs/market-integrity.md, "The range applies from now on").
 */

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

const getMetricsIn = vi.fn(async () => METRICS);
const patchMetric = vi.fn(async () => ({ ok: true }));
const deleteMetric = vi.fn(async () => ({}));
vi.mock('../../lib/api', () => ({
  api: {
    getMetricsIn: (...a: unknown[]) => getMetricsIn(...(a as [])),
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

const onOpenDates = vi.fn();
const onAdd = vi.fn();
const onDone = vi.fn();

const open = (markets = MARKETS) =>
  render(
    <MetricsDialog
      workspaceId="ws"
      markets={markets}
      defaultCredits={250}
      onOpenDates={onOpenDates}
      onAdd={onAdd}
      onClose={() => {}}
      onDone={onDone}
    />,
  );

beforeEach(() => {
  getMetricsIn.mockClear();
  getMetricsIn.mockResolvedValue(METRICS as never);
  patchMetric.mockClear();
  deleteMetric.mockClear();
  onOpenDates.mockClear();
  onAdd.mockClear();
  onDone.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

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

  test('the dates line says what is open on it and opens the dates dialog', async () => {
    await openSheet();
    expect(screen.getByText('September (5 traders) · 2026 (nobody yet)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open ›/ }));
    expect(onOpenDates).toHaveBeenCalledWith('m-val', 'Implied valuation (USD)');
  });

  test('final-after and opens-with read from the metric, and change writes one field', async () => {
    await openSheet('Telarchy revenue (USD)');
    expect(screen.getByText('3 days · markets already open keep their instant')).toBeTruthy();
    expect(screen.getByText("250 cr · the workspace's default")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change the credits' }));
    fireEvent.change(screen.getByLabelText('Credits a new book opens with'), { target: { value: '400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the credits' }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledWith('ws', 'm-rev', { liquidityCredits: 400 }));
    fireEvent.click(screen.getByRole('button', { name: 'Change the lag' }));
    fireEvent.change(screen.getByLabelText('Days after the period'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the lag' }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledWith('ws', 'm-rev', { settlementLagMinutes: 24 * 60 }));
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
