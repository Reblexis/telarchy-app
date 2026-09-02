import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatesDialog } from '../DatesDialog';

/**
 * THE RULE: adding one date never removes another.
 *
 * The dialog writes `customHorizons` as a WHOLE array, built from `entries`,
 * which starts null and is filled by a GET. "Open the market" was enabled the
 * whole time (`disabled={busy}` only), so pressing it before the GET landed -
 * on a phone, or after the GET failed - sent an array containing only the new
 * date. The route accepts whatever array arrives with no "you are dropping N
 * dates" guard, and the reconcile reads the absent entries as stopped: their
 * next markets never open and their current untraded ones are deactivated.
 * The owner asked to add one date and stopped three (bug hunt 2026-08-31).
 */

const getMetric = vi.fn();
const patchMetric = vi.fn(async () => ({ ok: true }));
const deleteMetric = vi.fn(async () => ({}));
vi.mock('../../lib/api', () => ({
  api: {
    getMetric: (...a: unknown[]) => getMetric(...(a as [])),
    patchMetric: (...a: unknown[]) => patchMetric(...(a as [])),
    deleteMetric: (...a: unknown[]) => deleteMetric(...(a as [])),
  },
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
  getMetric.mockReset();
  patchMetric.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The submit button, by class, or null: while the dates are unread the
 *  dialog shows no add form at all, and a button that does exist must be
 *  dead. Either satisfies the rule; a live button breaks it. */
const goButton = () => document.querySelector('.ticket-go') as HTMLButtonElement | null;
const noLiveButton = () => {
  const go = goButton();
  if (go) {
    expect(go.disabled).toBe(true);
    fireEvent.click(go);
  }
};

const open = () =>
  render(
    <DatesDialog
      metricId="m1"
      metricName="Revenue"
      workspaceId="ws1"
      markets={[]}
      defaultCredits={1000}
      spendable={100000}
      onClose={() => {}}
      onDone={() => {}}
    />,
  );

describe('the dialog cannot write dates it has not read', () => {
  test('the open button is not live while the stored dates are still loading', async () => {
    // A GET that never settles: the state a phone on a slow connection is in.
    getMetric.mockImplementation(() => new Promise(() => {}));
    open();

    noLiveButton();
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('a failed read never turns into a write that drops every other date', async () => {
    getMetric.mockRejectedValue(new Error('500'));
    open();

    await waitFor(() => expect(getMetric).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('500')).toBeTruthy());
    noLiveButton();

    await waitFor(() => expect(patchMetric).not.toHaveBeenCalled());
  });

  test('once the dates are loaded, adding one keeps the others', async () => {
    getMetric.mockResolvedValue({
      id: 'm1',
      timePreference: { enabled: false, halfLife: 1, customHorizons: ['+0m', '+0d', '2026-12-31'] },
    });
    open();

    await screen.findByText('Every month');
    fireEvent.click(screen.getByRole('button', { name: /Add a date/ }));
    const go = await screen.findByRole('button', { name: /Open the market/ });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(go);

    await waitFor(() => expect(patchMetric).toHaveBeenCalled());
    const sent = patchMetric.mock.calls[0] as unknown[];
    const body = sent.find(a => a && typeof a === 'object' && 'timePreference' in (a as object)) as {
      timePreference: { customHorizons: string[] };
    };
    for (const kept of ['+0m', '+0d', '2026-12-31']) {
      expect(body.timePreference.customHorizons).toContain(kept);
    }
  });
});
