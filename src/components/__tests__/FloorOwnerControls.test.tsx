import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The owner's controls on the floor (docs/owner-on-the-floor.md).
 *
 * The rule they exist to keep: an owner changes their workspace while looking
 * at what a visitor sees. So these controls are additions to the floor, inert
 * for anyone without the capability, and they never invent a second way to say
 * something the API already says.
 */

const injectLiquidity = vi.fn(async () => ({}));
vi.mock('../../lib/api', () => ({ api: { injectLiquidity: (...a: unknown[]) => injectLiquidity(...(a as [])) } }));

import { openableDates } from '../../lib/floor-horizons';
import { MarketFacts } from '../MarketFacts';

beforeEach(() => {
  injectLiquidity.mockClear();
});

describe('the pool is a control for the owner and a fact for everyone else', () => {
  test('a visitor sees the numbers and no way to change them', () => {
    render(<MarketFacts traders={3} pool={1200} volume={800} />);
    expect(screen.getByText('1,200')).toBeTruthy();
    expect(screen.queryByText('Deepen')).toBeNull();
  });

  test('the owner deepens the market beside the pool it changes', async () => {
    render(<MarketFacts traders={3} pool={1200} volume={800} canManage marketId="mkt" workspaceId="ws" />);
    fireEvent.click(screen.getByText('Deepen'));
    const input = screen.getByLabelText('Credits to add to the pool');
    fireEvent.change(input, { target: { value: '2500' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(injectLiquidity).toHaveBeenCalledWith('mkt', 2500, 'ws'));
  });

  test('a number that is not a number never reaches the API', async () => {
    render(<MarketFacts traders={3} pool={1200} volume={800} canManage marketId="mkt" workspaceId="ws" />);
    fireEvent.click(screen.getByText('Deepen'));
    fireEvent.change(screen.getByLabelText('Credits to add to the pool'), { target: { value: 'lots' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(screen.getByText('A number of credits.')).toBeTruthy());
    expect(injectLiquidity).not.toHaveBeenCalled();
  });
});

describe('the dates an owner can open a market on', () => {
  test('are the four a company plans against, in the formats the API takes', () => {
    const now = new Date(Date.UTC(2026, 7, 27)); // Thursday 27 Aug 2026
    const dates = openableDates(now);
    expect(dates.map(d => d.targetDate)).toEqual(['2026-W35', '2026-08', '2026-09', '2026']);
    expect(dates.map(d => d.label)).toEqual(['this week', 'this month', 'next month', 'end of 2026']);
  });

  test('roll over the year end without inventing a thirteenth month', () => {
    const dates = openableDates(new Date(Date.UTC(2026, 11, 15)));
    expect(dates[2].targetDate).toBe('2027-01');
    expect(dates[3].targetDate).toBe('2026');
  });
});
