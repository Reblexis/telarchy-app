import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatesDialog } from '../DatesDialog';

/**
 * The dates a metric is priced on (docs/owner-on-the-floor.md).
 *
 * What is pinned here is the honesty: a repeating date says it repeats, and
 * stopping one says which of the two things it will do BEFORE the press,
 * because the two are genuinely different (docs/market-integrity.md,
 * "Stopping a date is not destroying a market").
 */

/** The fixtures name real dates ('2026-08' as the open market) and the
 *  dialog renders them relative to today, so the clock is pinned to the day
 *  these expectations describe. Without it the suite goes red on a month
 *  boundary with nothing changed. */
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const getMetric = vi.fn(async () => ({
  id: 'm1',
  timePreference: { enabled: false, halfLife: 1, customHorizons: ['+0m', '+0d', '2026-12-31'] },
}));
const patchMetric = vi.fn(async () => ({ ok: true }));
const deleteMetric = vi.fn(async () => ({}));
vi.mock('../../lib/api', () => ({
  api: {
    getMetric: (...a: unknown[]) => getMetric(...(a as [])),
    patchMetric: (...a: unknown[]) => patchMetric(...(a as [])),
    deleteMetric: (...a: unknown[]) => deleteMetric(...(a as [])),
  },
}));

const MARKETS = [
  { targetDate: '2026-08', pool: 150, traders: 4, traded: true },
  { targetDate: '2026-12-31', pool: 200, traders: 2, traded: true },
];

const open = (markets = MARKETS) =>
  render(
    <DatesDialog
      workspaceId="ws"
      metricId="m1"
      metricName="Monthly bags roasted"
      markets={markets}
      defaultCredits={1000}
      spendable={128400}
      onClose={() => {}}
      onDone={() => {}}
    />,
  );

beforeEach(() => {
  patchMetric.mockClear();
  deleteMetric.mockClear();
  deleteMetric.mockResolvedValue({} as never);
});

describe('the list', () => {
  test('says which dates come back and which happen once', async () => {
    open();
    expect(await screen.findByText('Every month')).toBeTruthy();
    expect(screen.getByText('Every day')).toBeTruthy();
    expect(screen.getByText('31 December 2026, once')).toBeTruthy();
  });

  test('and what each one currently holds', async () => {
    open();
    expect(await screen.findByText(/^2026-08 · 150 cr · 4 traders$/)).toBeTruthy();
    // The daily entry has no market open on it in this fixture, and says so
    // rather than showing another market's numbers.
    expect(screen.getByText('no market open on it')).toBeTruthy();
  });
});

/** A sentence with the date set in its own mono span reads as one string
 *  here, the way the owner reads it. */
const sentence = (cls: string) => (document.querySelector(`.${cls}`)?.textContent ?? '').replace(/\s+/g, ' ');

/** The add form is folded behind one chip while the metric has dates
 *  (docs/owner-on-the-floor.md, dialog 2), so every add starts by opening it. */
const openAdd = async () => {
  await screen.findByText('Every month');
  fireEvent.click(screen.getByRole('button', { name: /Add a date/ }));
};

describe('the list comes first, and adding is folded away', () => {
  test('with dates, the form is behind one chip and opens on it', async () => {
    open();
    await screen.findByText('Every month');
    expect(screen.queryByText('How often')).toBeNull();
    expect(screen.queryByRole('button', { name: /Open the market/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Add a date/ }));
    expect(screen.getByText('How often')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open the market/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add a date/ })).toBeNull();
  });

  test('"Not now" folds it away again', async () => {
    open();
    await openAdd();
    fireEvent.click(screen.getByText('Not now'));
    expect(screen.queryByText('How often')).toBeNull();
    expect(screen.getByRole('button', { name: /Add a date/ })).toBeTruthy();
  });

  test('with no dates, the form is open and there is no chip', async () => {
    getMetric.mockResolvedValueOnce({ id: 'm1', timePreference: { enabled: false, halfLife: 1, customHorizons: [] } });
    open([]);
    expect(await screen.findByText('How often')).toBeTruthy();
    expect(screen.getByText(/No dates yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add a date/ })).toBeNull();
    expect(screen.queryByText('Not now')).toBeNull();
  });
});

describe('adding one', () => {
  test('offers the six the API has always had, on one row', async () => {
    open();
    await openAdd();
    const row = screen.getByRole('group', { name: 'How often' });
    const labels = Array.from(row.querySelectorAll('button')).map(b => b.textContent);
    expect(labels).toEqual(['hourly', 'daily', 'weekly', 'monthly', 'yearly', 'once']);
  });

  test('a repeat starts with the current period, and one line says so with the date', async () => {
    open();
    await openAdd();
    fireEvent.click(screen.getByText('daily'));
    expect(sentence('dates-start')).toMatch(/^Starts with today, 2026-08-31\. /);
    // No "which one" control: the alternative is the link in that line.
    expect(screen.queryByRole('group', { name: 'Which one' })).toBeNull();
    fireEvent.click(screen.getByText(/Open the market/));
    await waitFor(() =>
      expect(patchMetric.mock.calls[0][2]).toMatchObject({
        timePreference: { customHorizons: ['+0m', '+0d', '2026-12-31'] },
      }),
    );
  });

  test('the link flips it to the next period, which is the +1 entry', async () => {
    open();
    await openAdd();
    fireEvent.click(screen.getByText('daily'));
    fireEvent.click(screen.getByText('Start with tomorrow instead'));
    expect(sentence('dates-start')).toMatch(/^Starts with tomorrow, 2026-09-01\. /);
    expect(screen.getByText('Start with today instead')).toBeTruthy();
    fireEvent.click(screen.getByText(/Open the market/));
    await waitFor(() =>
      expect(patchMetric.mock.calls[0][2]).toMatchObject({
        timePreference: { customHorizons: ['+0m', '+0d', '2026-12-31', '+1d'] },
      }),
    );
  });

  test('once asks for a day instead of a period, and refuses without it', async () => {
    open();
    await openAdd();
    fireEvent.click(screen.getByText('once'));
    expect(screen.queryByText(/Starts with/)).toBeNull();
    fireEvent.click(screen.getByText(/Open the market/));
    await waitFor(() => expect(screen.getByText('Pick a date.')).toBeTruthy());
    expect(patchMetric).not.toHaveBeenCalled();
  });
});

describe('stopping one', () => {
  test('a traded date says the open market keeps running, and only the next one stops', async () => {
    open();
    await screen.findByText('Every month');
    fireEvent.click(screen.getAllByText('Stop')[0]);
    expect(screen.getByText('The open one, 2026-08')).toBeTruthy();
    expect(screen.getByText('keeps running')).toBeTruthy();
    expect(screen.getByText('4 traders, 150 cr in the pool')).toBeTruthy();
    expect(screen.getByText('untouched')).toBeTruthy();
    expect(screen.getByText('never opens')).toBeTruthy();
    expect(screen.getByText('Stop repeating')).toBeTruthy();
  });

  test('an untraded date says the market goes and the pool comes back', async () => {
    open([{ targetDate: '2026-08', pool: 40, traders: 0, traded: false }]);
    await screen.findByText('Every month');
    fireEvent.click(screen.getAllByText('Stop')[0]);
    expect(screen.getByText('Nobody has traded it')).toBeTruthy();
    expect(screen.getByText('40 cr in its pool')).toBeTruthy();
    expect(screen.getByText('back to your wallet')).toBeTruthy();
    expect(screen.getByText('Stop and take the pool back')).toBeTruthy();
  });

  // The press that stops a market must not be refused for one it is not
  // opening: sending liquidity with it was (preview, 2026-08-31).
  test('confirming sends the shorter list and no liquidity at all', async () => {
    open();
    await screen.findByText('Every month');
    fireEvent.click(screen.getAllByText('Stop')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Stop and take the pool back|Stop repeating/ }));
    await waitFor(() =>
      expect(patchMetric.mock.calls[0][2]).toMatchObject({
        timePreference: { customHorizons: ['+0m', '2026-12-31'] },
      }),
    );
    expect(patchMetric.mock.calls[0][2]).not.toHaveProperty('liquidityCredits');
  });
});

describe('how long after a period the number is final', () => {
  test('is a footer sentence with the number in it, not a field', async () => {
    open();
    await screen.findByText('Every month');
    expect(sentence('dates-final')).toMatch(/^Final 0 days after each period/);
    expect(screen.queryByLabelText('Days after the period')).toBeNull();
  });

  test('reads the stored lag back', async () => {
    getMetric.mockResolvedValueOnce({
      id: 'm1',
      settlementLagMinutes: 3 * 24 * 60,
      timePreference: { enabled: false, halfLife: 1, customHorizons: ['+0m'] },
    });
    open();
    await screen.findByText('Every month');
    expect(sentence('dates-final')).toMatch(/^Final 3 days after each period/);
  });

  test('"change" opens the field, and the write carries it', async () => {
    open();
    await screen.findByText('Every month');
    fireEvent.click(screen.getByText('change'));
    const field = screen.getByLabelText('Days after the period');
    fireEvent.change(field, { target: { value: '3' } });
    await openAdd();
    fireEvent.click(screen.getByText(/Open the market/));
    await waitFor(() => expect(patchMetric.mock.calls[0][2]).toMatchObject({ settlementLagMinutes: 3 * 24 * 60 }));
  });
});

describe('removing the metric', () => {
  test('is a link in the footer with no sentence around it', async () => {
    open();
    await screen.findByText('Every month');
    expect(screen.getByText('Remove metric')).toBeTruthy();
    expect(screen.queryByText(/everything above/)).toBeNull();
  });

  test('names what is in the way and refuses before the press, not after', async () => {
    open();
    await screen.findByText('Every month');
    fireEvent.click(screen.getByText('Remove metric'));
    expect(screen.getAllByText('in the way').length).toBe(2);
    expect(screen.getByText(/cannot be removed while anyone has money on it/)).toBeTruthy();
    const go = screen.getByRole('button', { name: /Remove the metric/ }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(go);
    expect(deleteMetric).not.toHaveBeenCalled();
  });

  test('goes through when nobody is in any of them', async () => {
    open([{ targetDate: '2026-08', pool: 40, traders: 0, traded: false }]);
    await screen.findByText('Every month');
    fireEvent.click(screen.getByText('Remove metric'));
    expect(screen.getByText('would go, pool back')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove the metric/ }));
    await waitFor(() => expect(deleteMetric).toHaveBeenCalledWith('m1'));
  });

  test('a server refusal is shown rather than swallowed', async () => {
    deleteMetric.mockRejectedValueOnce(new Error('4 participants hold positions') as never);
    open([{ targetDate: '2026-08', pool: 40, traders: 0, traded: false }]);
    await screen.findByText('Every month');
    fireEvent.click(screen.getByText('Remove metric'));
    fireEvent.click(screen.getByRole('button', { name: /Remove the metric/ }));
    expect(await screen.findByText(/4 participants hold positions/)).toBeTruthy();
  });
});
