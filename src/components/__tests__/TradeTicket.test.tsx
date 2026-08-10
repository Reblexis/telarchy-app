import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TradeTicket } from '../TradeTicket';

/**
 * The ticket's disclosure order and the price question.
 *
 * What matters here is what a trader can see and read back: nothing but the
 * side until a side is picked, and, once "at my price" is on, a confirm that
 * states the whole instruction rather than the word "place".
 */

const base = {
  probability: 0.5,
  liquidity: 200,
  positions: [],
  onTrade: async () => {},
  onSell: async () => {},
  unit: '$',
  consensus: 50_000,
  rangeMin: 0,
  rangeMax: 500_000,
};

describe('progressive disclosure', () => {
  test('an untouched ticket asks only for a side', () => {
    render(<TradeTicket {...base} />);
    expect(screen.getByText('Higher')).toBeTruthy();
    expect(screen.queryByLabelText('Credits to spend')).toBeNull();
    expect(screen.queryByText('at my price')).toBeNull();
  });

  test('picking a side reveals the amount, the price mode, and the confirm', () => {
    render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(screen.getByLabelText('Credits to spend')).toBeTruthy();
    expect(screen.getByText('at any price')).toBeTruthy();
    expect(screen.getByText('Place 25 cr on Higher')).toBeTruthy();
  });

  test('the price mode stays hidden when the market cannot take orders', () => {
    render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(screen.queryByText('at my price')).toBeNull();
  });
});

describe('at my price', () => {
  test('the confirm restates the whole instruction', () => {
    render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('at my price'));
    const input = screen.getByLabelText('Limit price in $') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '40000' } });
    expect(screen.getByText('Buy Higher with 25 cr under $40,000')).toBeTruthy();
  });

  test('a limit on the wrong side of the call is refused before it is sent', () => {
    const onPlaceLimit = vi.fn(async () => {});
    render(<TradeTicket {...base} onPlaceLimit={onPlaceLimit} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('at my price'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '60000' } });

    expect(screen.getByText(/fills right now/)).toBeTruthy();
    const confirm = screen.getByText(/Set a price for Higher/).closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onPlaceLimit).not.toHaveBeenCalled();
  });

  test('a lower order wants a limit above the call', () => {
    render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Lower'));
    fireEvent.click(screen.getByText('at my price'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '70000' } });
    expect(screen.getByText('Buy Lower with 25 cr over $70,000')).toBeTruthy();
  });

  test('placing sends the limit, not a market trade', async () => {
    const onTrade = vi.fn(async () => {});
    const onPlaceLimit = vi.fn(async () => {});
    render(<TradeTicket {...base} onTrade={onTrade} onPlaceLimit={onPlaceLimit} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('at my price'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });
    fireEvent.click(screen.getByText('Buy Higher with 25 cr under $40,000'));

    await waitFor(() => expect(onPlaceLimit).toHaveBeenCalledWith('higher', 40000, 25));
    expect(onTrade).not.toHaveBeenCalled();
  });

  test('a resting order casts no ghost on the chart, since it moves no price', () => {
    const onPreview = vi.fn();
    render(<TradeTicket {...base} onPreview={onPreview} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'higher' }));

    fireEvent.click(screen.getByText('at my price'));
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });
});

describe('resting orders', () => {
  const order = {
    id: 'ord-1', marketId: 'm1', agentId: 'a1',
    direction: 'higher' as const, limitValue: 40_000,
    budgetCredits: 50, filledCredits: 10, remainingCredits: 40,
    status: 'open' as const, expiresAt: null, createdAt: new Date().toISOString(),
  };

  test('each order states its limit and what is still waiting', () => {
    render(<TradeTicket {...base} orders={[order]} onPlaceLimit={async () => {}} onCancelLimit={async () => {}} />);
    expect(screen.getByText(/under \$40,000 · 40.0 cr waiting/)).toBeTruthy();
  });

  test('cancelling calls back with the order id', async () => {
    const onCancelLimit = vi.fn(async () => {});
    render(<TradeTicket {...base} orders={[order]} onPlaceLimit={async () => {}} onCancelLimit={onCancelLimit} />);
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(onCancelLimit).toHaveBeenCalledWith('ord-1'));
  });
});
