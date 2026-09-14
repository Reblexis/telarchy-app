import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { previewSellPrice, previewTrade } from '../../lib/amm';
import type { RestingOrder } from '../../lib/limit-fills';
import { TradeTicket } from '../TradeTicket';

/**
 * The ticket's landing is where the price comes to rest (docs/limit-orders.md,
 * "A quote lands where the price comes to rest"; docs/ui-conventions.md, "The
 * price and the chart"). Asked (Viktor, 2026-09-14): "make sure that when
 * placing a  trade in the ui and whatnot it properly shows the actual final
 * impact on the price considering also the limit orders in place".
 *
 * Resting orders the trade crosses fill in the same transaction and pull the
 * price back, so the ghost and the landing value show where it ends after
 * them; the guard still bounds the trade's own fill.
 */

const base = {
  probability: 0.5,
  liquidity: 200,
  positions: [],
  onTrade: async () => {},
  onSell: async () => {},
  balance: 1000,
  unit: '$',
  consensus: 50,
  rangeMin: 0,
  rangeMax: 100,
};

function resting(over: Partial<RestingOrder>): RestingOrder {
  return {
    id: 'o-1',
    side: 'buy',
    direction: 'lower',
    limitValue: 52,
    left: 1000,
    holder: 0,
    held: { higher: 0, lower: 0 },
    ...over,
  };
}

function stake(side: 'Higher' | 'Lower', amount = '25') {
  const sides = screen.getByRole('group', { name: 'Direction' });
  fireEvent.click(within(sides).getByRole('button', { name: new RegExp(side) }));
  fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: amount } });
}

const lastGhost = (onPreview: ReturnType<typeof vi.fn>) => onPreview.mock.calls.at(-1)?.[0];
const landingShown = () =>
  parseFloat((screen.getByLabelText('Bet the market to this value in $') as HTMLInputElement).value.replace(/,/g, ''));

describe('a buy', () => {
  test('THE LANDING IS WHERE THE PRICE COMES TO REST: a buy through a resting order ghosts the price after it fills', () => {
    const onPreview = vi.fn();
    render(<TradeTicket {...base} onPreview={onPreview} restingOrders={[resting({})]} />);
    stake('Higher');
    // On its own the buy lands well above 52; the lower buy waiting at 52
    // buys it straight back down to 52.
    expect(previewTrade(0.5, 200, 'higher', 25, null).newProb).toBeGreaterThan(0.55);
    expect(lastGhost(onPreview)).toEqual(expect.objectContaining({ direction: 'higher' }));
    expect(lastGhost(onPreview).newProb).toBeCloseTo(0.52, 3);
    expect(landingShown()).toBeCloseTo(52, 1);
  });

  test('with no resting orders the ghost is the trade’s own landing', () => {
    const onPreview = vi.fn();
    render(<TradeTicket {...base} onPreview={onPreview} restingOrders={[]} />);
    stake('Higher');
    expect(lastGhost(onPreview).newProb).toBeCloseTo(previewTrade(0.5, 200, 'higher', 25, null).newProb, 9);
  });

  test('THE GUARD BOUNDS THE TRADE’S OWN FILL, NOT THE PRICE AT REST', async () => {
    const onTrade = vi.fn(async () => ({ limited: false }));
    render(<TradeTicket {...base} onTrade={onTrade} restingOrders={[resting({})]} />);
    stake('Higher');
    await act(async () => {
      fireEvent.click(screen.getByText('Bet 25 cr on Higher'));
    });
    const [, , limit] = onTrade.mock.calls[0] as unknown as [string, number, number];
    const own = previewTrade(0.5, 200, 'higher', 25, null).newProb * 100;
    expect(limit).toBeCloseTo(own + 2, 3);
  });

  test("THE TRADER'S OWN RESTING SELL SELLS WHAT THE BUY ADDS", () => {
    const onPreview = vi.fn();
    const mine = resting({ id: 'mine', side: 'sell', direction: 'higher', limitValue: 53, holder: 4 });
    const { rerender } = render(<TradeTicket {...base} onPreview={onPreview} restingOrders={[mine]} />);
    stake('Higher');
    // Not known to be the trader's: its holder holds nothing, so it sells nothing.
    expect(lastGhost(onPreview).newProb).toBeCloseTo(previewTrade(0.5, 200, 'higher', 25, null).newProb, 9);
    rerender(<TradeTicket {...base} onPreview={onPreview} restingOrders={[mine]} ownOrderIds={['mine']} />);
    expect(lastGhost(onPreview).newProb).toBeCloseTo(0.53, 3);
  });

  test('the ghost follows the list: an order that arrives on the next prices read moves it', () => {
    const onPreview = vi.fn();
    const { rerender } = render(<TradeTicket {...base} onPreview={onPreview} restingOrders={[]} />);
    stake('Higher');
    expect(lastGhost(onPreview).newProb).toBeGreaterThan(0.55);
    rerender(<TradeTicket {...base} onPreview={onPreview} restingOrders={[resting({})]} />);
    expect(lastGhost(onPreview).newProb).toBeCloseTo(0.52, 3);
  });
});

describe('a sale', () => {
  const held = { direction: 'higher' as const, shares: 40, totalCost: 25 };
  const openSell = (c: HTMLElement) =>
    fireEvent.click(within(c.querySelector('.ticket-pos-head') as HTMLElement).getByRole('button', { name: 'Sell' }));

  test('a sale through a resting buy ghosts the price at rest', () => {
    const onPreview = vi.fn();
    const { container } = render(
      <TradeTicket
        {...base}
        positions={[held]}
        manageMode
        onPreview={onPreview}
        restingOrders={[resting({ direction: 'higher', limitValue: 48 })]}
      />,
    );
    openSell(container);
    expect(previewSellPrice(0.5, 200, 'higher', 40)).toBeLessThan(0.46);
    expect(lastGhost(onPreview).newProb).toBeCloseTo(0.48, 3);
  });
});

describe('an order placed past the market', () => {
  test('ghosts the price at rest after its own fill sets off the others', () => {
    const onPreview = vi.fn();
    render(
      <TradeTicket
        {...base}
        probability={0.1}
        consensus={10}
        onPreview={onPreview}
        onPlaceLimit={async () => {}}
        restingOrders={[resting({ limitValue: 11 })]}
      />,
    );
    stake('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '12' } });
    // Its own fill takes the call to 12; the lower buy at 11 brings it back.
    expect(lastGhost(onPreview).newProb).toBeCloseTo(0.11, 3);
  });

  test('a resting order that crosses nothing still casts no ghost', () => {
    const onPreview = vi.fn();
    render(<TradeTicket {...base} onPreview={onPreview} onPlaceLimit={async () => {}} restingOrders={[resting({})]} />);
    stake('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40' } });
    expect(lastGhost(onPreview)).toBeNull();
  });
});
