import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DatesDialog } from '../DatesDialog';

/**
 * The dates a metric is priced on (docs/owner-on-the-floor.md).
 *
 * What is pinned here is the honesty: a repeating date says it repeats, and
 * stopping one says which of the two things it will do BEFORE the press,
 * because the two are genuinely different (docs/market-integrity.md,
 * "Stopping a date is not destroying a market").
 */

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
    expect(screen.getByText('2026-12-31, once')).toBeTruthy();
  });

  test('and what each one currently holds', async () => {
    open();
    expect(await screen.findByText(/next one 2026-08 · 150 cr · 4 traders/)).toBeTruthy();
    // The daily entry has no market open on it in this fixture, and says so
    // rather than showing another market's numbers.
    expect(screen.getByText('no market open on it')).toBeTruthy();
  });
});

describe('adding one', () => {
  test('offers the repeats the API has always had, daily included', async () => {
    open();
    await screen.findByText('Every month');
    for (const label of ['every hour', 'every day', 'every week', 'every month', 'every year', 'once']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  test('a repeat stores the rolling entry, and keeps the ones already there', async () => {
    open();
    await screen.findByText('Every month');
    fireEvent.click(screen.getByText('every day'));
    fireEvent.click(screen.getByText('tomorrow'));
    fireEvent.click(screen.getByText(/Open the market/));
    await waitFor(() =>
      expect(patchMetric.mock.calls[0][2]).toMatchObject({
        timePreference: { customHorizons: ['+0m', '+0d', '2026-12-31', '+1d'] },
      }),
    );
  });

  test('once asks for a day instead of which one, and refuses without it', async () => {
    open();
    await screen.findByText('Every month');
    fireEvent.click(screen.getByText('once'));
    expect(screen.queryByText('tomorrow')).toBeNull();
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

describe('removing the metric', () => {
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
