import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { previewTrade } from '../../lib/amm';
import { TradeTicket } from '../TradeTicket';

/**
 * The ticket guards the price by default (docs/ui-conventions.md, "The ticket
 * guards the price by default"). Owner ask, 2026-09-12: "the guard as well..
 * dont block the actual trade". Every buy the ticket places carries a limit
 * two percent of the range past its own quote; a partial fill says so in one
 * line; a price_moved refusal names the call now and is never retried by the
 * ticket, because a retry would spend at a price nobody saw.
 */

const base = {
  probability: 0.5,
  liquidity: 200,
  positions: [],
  onSell: async () => {},
  unit: '$',
  consensus: 50_000,
  rangeMin: 0,
  rangeMax: 500_000,
};
const SPAN = 500_000;

function stake(side: 'Higher' | 'Lower', amount = '25') {
  const sides = screen.getByRole('group', { name: 'Direction' });
  fireEvent.click(within(sides).getByRole('button', { name: new RegExp(side) }));
  fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: amount } });
}

describe('every buy carries a limit', () => {
  test('a buy of higher: its quoted landing plus 2% of the range', async () => {
    const onTrade = vi.fn(async () => ({ limited: false }));
    render(<TradeTicket {...base} onTrade={onTrade} />);
    stake('Higher');
    await act(async () => {
      fireEvent.click(screen.getByText('Bet 25 cr on Higher'));
    });
    expect(onTrade).toHaveBeenCalledTimes(1);
    const [direction, amount, limit] = onTrade.mock.calls[0] as unknown as [string, number, number];
    expect(direction).toBe('higher');
    expect(amount).toBe(25);
    const landing = previewTrade(0.5, 200, 'higher', 25, null).newProb * SPAN;
    expect(limit).toBeCloseTo(landing + 0.02 * SPAN, 3);
  });

  test('a buy of lower: its quoted landing minus 2% of the range', async () => {
    const onTrade = vi.fn(async () => ({ limited: false }));
    render(<TradeTicket {...base} onTrade={onTrade} />);
    stake('Lower');
    await act(async () => {
      fireEvent.click(screen.getByText('Bet 25 cr on Lower'));
    });
    const [, , limit] = onTrade.mock.calls[0] as unknown as [string, number, number];
    const landing = previewTrade(0.5, 200, 'lower', 25, null).newProb * SPAN;
    expect(limit).toBeCloseTo(landing - 0.02 * SPAN, 3);
  });

  test('a resting limit order is not guarded: its price is the order', async () => {
    const onPlaceLimit = vi.fn(async () => {});
    render(<TradeTicket {...base} onTrade={async () => {}} onPlaceLimit={onPlaceLimit} />);
    stake('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });
    const confirm = screen.getByRole('button', { name: /Buy Higher with 25 cr under/ });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(onPlaceLimit).toHaveBeenCalledWith('higher', 40000, 25);
  });
});

describe('what the ticket says after a guarded trade', () => {
  test('A PARTIAL FILL SAYS HOW MUCH FILLED AND THAT THE PRICE MOVED', async () => {
    const onTrade = vi.fn(async () => ({ limited: true, spent: 12.5, unspent: 12.5 }));
    render(<TradeTicket {...base} onTrade={onTrade} />);
    stake('Higher');
    await act(async () => {
      fireEvent.click(screen.getByText('Bet 25 cr on Higher'));
    });
    expect(screen.getByText('Filled 12.5 of 25 cr. The price moved.')).toBeTruthy();
  });

  test('a full fill says nothing extra', async () => {
    const onTrade = vi.fn(async () => ({ limited: false, spent: 25, unspent: 0 }));
    render(<TradeTicket {...base} onTrade={onTrade} />);
    stake('Higher');
    await act(async () => {
      fireEvent.click(screen.getByText('Bet 25 cr on Higher'));
    });
    expect(screen.queryByText(/The price moved/)).toBeNull();
  });

  test('NOTHING FILLED: THE LINE NAMES THE CALL NOW, AND THE TICKET NEVER RETRIES', async () => {
    const refusal = Object.assign(new Error('The price moved'), {
      code: 'price_moved',
      body: { code: 'price_moved', consensus: 64_000, limit: 62_000 },
    });
    const onTrade = vi.fn(async () => {
      throw refusal;
    });
    render(<TradeTicket {...base} onTrade={onTrade} />);
    stake('Higher');
    await act(async () => {
      fireEvent.click(screen.getByText('Bet 25 cr on Higher'));
    });
    expect(screen.getByText('The price moved to $64,000. Nothing was spent.')).toBeTruthy();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(onTrade).toHaveBeenCalledTimes(1);
  });

  test('the line clears on the next edit', async () => {
    const onTrade = vi.fn(async () => ({ limited: true, spent: 12.5, unspent: 12.5 }));
    render(<TradeTicket {...base} onTrade={onTrade} />);
    stake('Higher');
    await act(async () => {
      fireEvent.click(screen.getByText('Bet 25 cr on Higher'));
    });
    expect(screen.getByText(/The price moved/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '30' } });
    expect(screen.queryByText(/The price moved/)).toBeNull();
  });

  test('any other failure still reads as the error it is', async () => {
    const onTrade = vi.fn(async () => {
      throw new Error('Insufficient balance');
    });
    render(<TradeTicket {...base} onTrade={onTrade} />);
    stake('Higher');
    await act(async () => {
      fireEvent.click(screen.getByText('Bet 25 cr on Higher'));
    });
    expect(screen.getByText('Insufficient balance')).toBeTruthy();
  });
});
