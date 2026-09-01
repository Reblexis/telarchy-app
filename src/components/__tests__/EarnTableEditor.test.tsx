import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: { getAdminEarnTable: vi.fn(), setEarnRule: vi.fn() },
}));

import { api } from '../../lib/api';
import { EarnTableEditor } from '../EarnTableEditor';

const rules = [
  {
    key: 'signup_user',
    label: 'Sign up',
    credits: 10000,
    liquidityCredits: 300,
    kind: 'flat' as const,
    enabled: true,
    note: 'A person arriving.',
  },
  {
    key: 'signup_agent',
    label: 'API registration',
    credits: 0,
    liquidityCredits: 0,
    kind: 'flat' as const,
    enabled: true,
    note: '',
  },
];

beforeEach(() => {
  vi.mocked(api.getAdminEarnTable).mockResolvedValue({ rules } as never);
  vi.mocked(api.setEarnRule).mockResolvedValue({ rule: rules[0] } as never);
});

describe('the earn table editor', () => {
  test('lists every rule with its price and note', async () => {
    render(<EarnTableEditor />);
    expect(await screen.findByText('Sign up')).toBeInTheDocument();
    expect(screen.getByText('A person arriving.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10000')).toBeInTheDocument();
  });

  test('re-pricing a task sends the new number, and Save is inert until it changes', async () => {
    render(<EarnTableEditor />);
    const input = await screen.findByLabelText('Credits for Sign up');
    // The reported bug shape this guards: a Save that fires on an unchanged
    // row writes a history entry for an edit nobody made.
    const saves = screen.getAllByRole('button', { name: 'Save' });
    expect(saves[0]).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, '1000');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await waitFor(() =>
      expect(vi.mocked(api.setEarnRule)).toHaveBeenCalledWith('signup_user', {
        credits: 1000,
        liquidityCredits: 300,
      }),
    );
  });

  // The two purses are priced side by side and saved together, because they
  // are one rule (owner decision 2026-09-01).
  test('the matched liquidity is its own field, and re-pricing it saves both', async () => {
    render(<EarnTableEditor />);
    const liq = await screen.findByLabelText('Liquidity for Sign up');
    expect(liq).toHaveValue('300');
    await userEvent.clear(liq);
    await userEvent.type(liq, '500');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await waitFor(() =>
      expect(vi.mocked(api.setEarnRule)).toHaveBeenCalledWith('signup_user', {
        credits: 10000,
        liquidityCredits: 500,
      }),
    );
  });

  test('disabling a rule sends enabled false, never a price of zero', async () => {
    render(<EarnTableEditor />);
    await screen.findByText('Sign up');
    await userEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0]);
    await waitFor(() => expect(vi.mocked(api.setEarnRule)).toHaveBeenCalledWith('signup_user', { enabled: false }));
  });
});
