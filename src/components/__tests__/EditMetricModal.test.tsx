import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditMetricModal, customHorizonError } from '../EditMetricModal';
import type { Metric, TimePreference } from '../../types';

function makeMetric(overrides: Partial<Metric> = {}): Metric {
  return {
    id: 'm1',
    name: 'Test Metric',
    description: '',
    value: 10,
    total: 10,
    formula: '0',
    order: 0,
    depth: 0,
    ...overrides,
  };
}

describe('customHorizonError', () => {
  test('accepts relative offsets and future absolute dates', () => {
    expect(customHorizonError('+3m')).toBeNull();
    expect(customHorizonError('+1d')).toBeNull();
    expect(customHorizonError('2099-12')).toBeNull();
    expect(customHorizonError('2099-12-31')).toBeNull();
    expect(customHorizonError('2099-W40')).toBeNull();
    expect(customHorizonError('2099')).toBeNull();
  });
  test('rejects bad formats, zero offsets, impossible and past dates', () => {
    expect(customHorizonError('garbage')).not.toBeNull();
    expect(customHorizonError('+0d')).not.toBeNull();
    expect(customHorizonError('2099-13')).not.toBeNull();
    expect(customHorizonError('2099-02-31')).not.toBeNull();
    expect(customHorizonError('2099-W60')).not.toBeNull();
    expect(customHorizonError('2020-01-01')).not.toBeNull();
    expect(customHorizonError('2020')).not.toBeNull();
  });
});

describe('EditMetricModal custom market dates', () => {
  test('adds and removes custom date chips', async () => {
    const user = userEvent.setup();
    render(<EditMetricModal metric={makeMetric()} onClose={vi.fn()} onSave={vi.fn()} />);

    const input = screen.getByPlaceholderText('+3m or 2026-09-15');
    await user.type(input, '+3m');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('button', { name: 'Remove +3m' })).toBeTruthy();

    await user.type(input, '2099-12-31');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('button', { name: 'Remove 2099-12-31' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Remove +3m' }));
    expect(screen.queryByRole('button', { name: 'Remove +3m' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove 2099-12-31' })).toBeTruthy();
  });

  test('rejects invalid input with an inline error and adds no chip', async () => {
    const user = userEvent.setup();
    render(<EditMetricModal metric={makeMetric()} onClose={vi.fn()} onSave={vi.fn()} />);

    const input = screen.getByPlaceholderText('+3m or 2026-09-15');
    await user.type(input, 'garbage{Enter}');
    expect(screen.getByText(/Use \+3m/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  test('submits customHorizons in the timePreference payload, curve off', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditMetricModal metric={makeMetric()} onClose={vi.fn()} onSave={onSave} />);

    const input = screen.getByPlaceholderText('+3m or 2026-09-15');
    await user.type(input, '+3m{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const tp = onSave.mock.calls[0][7] as TimePreference | null;
    expect(tp).not.toBeNull();
    expect(tp!.enabled).toBe(false);
    expect(tp!.customHorizons).toEqual(['+3m']);
  });

  test('clearing the last custom date with the curve off submits null timePreference', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const tp: TimePreference = { enabled: false, halfLife: 1, customHorizons: ['+3m'] };
    render(<EditMetricModal metric={makeMetric({ timePreference: tp })} onClose={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Remove +3m' }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][7]).toBeNull();
  });
});
