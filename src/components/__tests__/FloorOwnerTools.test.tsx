import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The owner's two controls on their own floor (docs/operator-setup.md).
 *
 * What is worth pinning here is not that the buttons render. It is the two
 * ways this becomes a lie:
 *
 *  - A number added without a horizon opens NO market, so the owner is handed
 *    a settings page while the screen says the market is open.
 *  - Funding that follows anything other than the clock on screen deepens a
 *    different question than the one the owner is looking at.
 */

const createMetric = vi.fn(async () => ({ id: 'metric-1' }));
const injectLiquidity = vi.fn(async () => ({ liquidity: 900 }));
const getParticipant = vi.fn(async () => ({ balance: 1234.5 }));

vi.mock('../../lib/api', () => ({
  api: {
    createMetric: (body: unknown) => createMetric(body as never),
    injectLiquidity: (id: string, amount: number) => injectLiquidity(id as never, amount as never),
    getParticipant: () => getParticipant(),
  },
}));

import { FloorOwnerTools } from '../FloorOwnerTools';

const MARKET = { marketId: 'mkt-september', label: 'DISPUTES SEPT 2026', liquidity: 721.35 };

const onChanged = vi.fn();
beforeEach(() => {
  createMetric.mockClear(); injectLiquidity.mockClear(); getParticipant.mockClear(); onChanged.mockClear();
});

describe('adding a number', () => {
  test('opens a market on the month given, not a metric with no horizon', async () => {
    const user = userEvent.setup();
    render(<FloorOwnerTools market={MARKET} onChanged={onChanged} />);

    await user.click(screen.getByRole('button', { name: /add a number/i }));
    await user.type(screen.getByLabelText(/^the number$/i), 'Monthly disputes arbitrated');
    await user.type(screen.getByLabelText(/where its value comes from/i), 'On-chain, first of the month.');
    await user.type(screen.getByLabelText(/highest it could plausibly reach/i), '5000');
    await user.click(screen.getByRole('button', { name: /open the market/i }));

    await waitFor(() => expect(createMetric).toHaveBeenCalled());
    const body = createMetric.mock.calls[0][0] as {
      name: string; description: string; marketRangeMax: number;
      timePreference: { customHorizons: string[] };
    };
    expect(body.name).toBe('Monthly disputes arbitrated');
    expect(body.description).toBe('On-chain, first of the month.');
    expect(body.marketRangeMax).toBe(5000);
    // Without this the metric exists and no market does.
    expect(body.timePreference.customHorizons[0]).toMatch(/^\d{4}-\d{2}$/);
    expect(onChanged).toHaveBeenCalled();
  });

  test('a missing ceiling stops before anything is created', async () => {
    const user = userEvent.setup();
    render(<FloorOwnerTools market={MARKET} onChanged={onChanged} />);

    await user.click(screen.getByRole('button', { name: /add a number/i }));
    await user.type(screen.getByLabelText(/^the number$/i), 'Disputes');
    await user.click(screen.getByRole('button', { name: /open the market/i }));

    expect(await screen.findByText(/number above zero/i)).toBeTruthy();
    expect(createMetric).not.toHaveBeenCalled();
  });
});

describe('deepening the market', () => {
  test('funds the clock on screen', async () => {
    const user = userEvent.setup();
    render(<FloorOwnerTools market={MARKET} onChanged={onChanged} />);

    await user.click(screen.getByRole('button', { name: /deepen this market/i }));
    await user.type(screen.getByLabelText(/credits to add/i), '500');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(injectLiquidity).toHaveBeenCalledWith('mkt-september', 500));
    expect(onChanged).toHaveBeenCalled();
  });

  test('shows the subsidy in credits, not the LMSR b', async () => {
    render(<FloorOwnerTools market={MARKET} onChanged={onChanged} />);
    // pool = b * ln 2, the exact relation the market row stores. 721.35 b is
    // 500 credits of pool; showing "721" would be a number with no meaning to
    // the person paying it.
    expect(screen.getByText(/500 credits/i)).toBeTruthy();
  });

  test('a floor with no market offers only the number', async () => {
    render(<FloorOwnerTools market={null} onChanged={onChanged} />);
    expect(screen.getByRole('button', { name: /add a number/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /deepen/i })).toBeNull();
    expect(screen.getByText(/no open market yet/i)).toBeTruthy();
  });

  test('a refusal from the server is shown, not swallowed', async () => {
    injectLiquidity.mockRejectedValueOnce(new Error('Insufficient balance'));
    const user = userEvent.setup();
    render(<FloorOwnerTools market={MARKET} onChanged={onChanged} />);

    await user.click(screen.getByRole('button', { name: /deepen this market/i }));
    await user.type(screen.getByLabelText(/credits to add/i), '999999');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText(/insufficient balance/i)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
