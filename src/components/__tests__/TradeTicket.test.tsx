import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { SLIDER_STEPS } from '../../lib/bet-slider';
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

/**
 * The ticket opens on a side at 0 cr since 2026-09-09 (owner ask: "the bet
 * dialog should start like this"). These tests were written when a side had
 * to be picked and 25 cr was the default, so picking one now also stakes the
 * 25 they assume; what each test is actually about is unchanged.
 */
function pick(side: 'Higher' | 'Lower', amount = '25') {
  const sides = screen.getByRole('group', { name: 'Direction' });
  fireEvent.click(within(sides).getByRole('button', { name: new RegExp(side) }));
  const input = screen.queryByLabelText('Credits to spend');
  if (input) fireEvent.change(input, { target: { value: amount } });
}

describe('progressive disclosure', () => {
  test('an untouched ticket is already on a side, at nothing', () => {
    // Revised 2026-09-09: the ticket is the floor's rail and opens composed.
    // What it still does not do is offer Limit on a market that cannot take
    // orders.
    render(<TradeTicket {...base} />);
    expect(screen.getByText('Higher')).toBeTruthy();
    expect(screen.getByLabelText('Credits to spend')).toBeTruthy();
    expect(screen.queryByText('Limit')).toBeNull();
  });

  test('staking an amount reveals the order type and arms the confirm', () => {
    const { container } = render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    pick('Higher');
    expect(screen.getByLabelText('Credits to spend')).toBeTruthy();
    expect(screen.getByText('Quick')).toBeTruthy();
    expect(screen.getByText('Limit')).toBeTruthy();
    expect(screen.getByText('Bet 25 cr on Higher')).toBeTruthy();
    // The answer is the payoff line: what the bet is worth wherever the
    // number lands, and no rows saying the same thing in prose.
    expect(screen.getByLabelText('Bet the market to this value in $')).toBeTruthy();
    expect(container.querySelector('.scale')).toBeTruthy();
  });

  test('the Limit toggle stays hidden when the market cannot take orders', () => {
    render(<TradeTicket {...base} />);
    pick('Higher');
    expect(screen.queryByText('Limit')).toBeNull();
  });
});

describe('win facts', () => {
  test('a limit order breaks even exactly at its own price', () => {
    const { container } = render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });

    // Filled at $40,000 the average price is 40000/500000 = 0.08, so 25 cr
    // buys 312.5 shares: the whole stake gone at the bottom of the range
    // and 287.5 credits up at the top, breaking even at the limit itself.
    const cr = Array.from(container.querySelectorAll('.scale-cr > span')).map(e => e.textContent ?? '');
    expect(cr[0]).toBe('-25 cr');
    expect(cr[cr.length - 1]).toBe('+288 cr');
  });

  test('a lower bet is worth most at the bottom of the range', () => {
    const { container } = render(<TradeTicket {...base} />);
    pick('Lower');
    const cr = Array.from(container.querySelectorAll('.scale-cr > span')).map(e => e.textContent ?? '');
    expect(cr[0]?.startsWith('+')).toBe(true);
    expect(cr[cr.length - 1]).toBe('-25 cr');
  });
});

describe('dialog mode', () => {
  test('initialDir opens on the side the verb named', () => {
    render(<TradeTicket {...base} initialDir="lower" />);
    expect(screen.getByLabelText('Credits to spend')).toBeTruthy();
    expect(screen.getByText('Bet 0 cr on Lower')).toBeTruthy();
  });
});

describe('limit mode', () => {
  test('the confirm restates the whole instruction', () => {
    render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    const input = screen.getByLabelText('Limit price in $') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '40000' } });
    expect(screen.getByText('Buy Higher under $40,000')).toBeTruthy();
  });

  test('a limit the market already passed is sent, with a warning of what fills now', async () => {
    const onPlaceLimit = vi.fn(async () => {});
    render(<TradeTicket {...base} probability={0.1} onPlaceLimit={onPlaceLimit} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '60000' } });

    expect(screen.getByText(/The market is already under \$60,000: [\d.,]+ cr fills now/)).toBeTruthy();
    const confirm = screen.getByText('Buy Higher under $60,000').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(onPlaceLimit).toHaveBeenCalledWith('higher', 60000, 25));
  });

  test('a limit outside the market range is refused before it is sent', () => {
    const onPlaceLimit = vi.fn(async () => {});
    render(<TradeTicket {...base} probability={0.1} onPlaceLimit={onPlaceLimit} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '600000' } });

    expect(screen.getByText(/Between \$0(\.00)? and \$500,000/)).toBeTruthy();
    const confirm = screen.getByText(/Set a price for Higher/).closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onPlaceLimit).not.toHaveBeenCalled();
  });

  test('a limit the market already passed casts the ghost of the fill it makes now', () => {
    const onPreview = vi.fn();
    render(<TradeTicket {...base} probability={0.1} onPreview={onPreview} onPlaceLimit={async () => {}} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '60000' } });
    const last = onPreview.mock.calls.at(-1)?.[0];
    expect(last).toEqual(expect.objectContaining({ direction: 'higher' }));
    // It lands on the limit or short of it, never past: 60,000 of 500,000 is 0.12.
    expect(last.newProb).toBeGreaterThan(0.1);
    expect(last.newProb).toBeLessThanOrEqual(0.12 + 1e-9);
  });

  test('the buy limit confirm names the side and the price, not the stake', () => {
    render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });
    const confirm = screen.getByText(/^Buy Higher/).closest('button') as HTMLButtonElement;
    expect(confirm.textContent).toBe('Buy Higher under $40,000');
    expect(confirm.textContent).not.toMatch(/cr/);
  });

  test('a lower order wants a limit above the call', () => {
    render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    pick('Lower');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '70000' } });
    expect(screen.getByText('Buy Lower over $70,000')).toBeTruthy();
  });

  test('placing sends the limit, not a market trade', async () => {
    const onTrade = vi.fn(async () => {});
    const onPlaceLimit = vi.fn(async () => {});
    render(<TradeTicket {...base} onTrade={onTrade} onPlaceLimit={onPlaceLimit} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });
    fireEvent.click(screen.getByText('Buy Higher under $40,000'));

    await waitFor(() => expect(onPlaceLimit).toHaveBeenCalledWith('higher', 40000, 25));
    expect(onTrade).not.toHaveBeenCalled();
  });

  test('a resting order casts no ghost on the chart, since it moves no price', () => {
    const onPreview = vi.fn();
    render(<TradeTicket {...base} onPreview={onPreview} onPlaceLimit={async () => {}} />);
    pick('Higher');
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'higher' }));

    fireEvent.click(screen.getByText('Limit'));
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });
});

describe('resting orders', () => {
  const order = {
    id: 'ord-1',
    marketId: 'm1',
    agentId: 'a1',
    direction: 'higher' as const,
    limitValue: 40_000,
    budgetCredits: 50,
    filledCredits: 10,
    remainingCredits: 40,
    status: 'open' as const,
    expiresAt: null,
    createdAt: new Date().toISOString(),
  };

  test('a buy order names its verb, its limit and the credits left', () => {
    render(<TradeTicket {...base} orders={[order]} onPlaceLimit={async () => {}} onCancelLimit={async () => {}} />);
    expect(screen.getByText(/buy under \$40,000 · 40.0 cr/)).toBeTruthy();
    expect(screen.queryByText(/waiting/)).toBeNull();
  });

  test('a lower buy order reads "buy over"', () => {
    const lower = { ...order, id: 'ord-2', direction: 'lower' as const, limitValue: 80_000 };
    render(<TradeTicket {...base} orders={[lower]} onPlaceLimit={async () => {}} onCancelLimit={async () => {}} />);
    expect(screen.getByText(/buy over \$80,000 · 40.0 cr/)).toBeTruthy();
  });

  test('a sell order names its verb, its limit and the shares left', () => {
    const sell = {
      ...order,
      id: 'ord-3',
      side: 'sell' as const,
      limitValue: 80_000,
      budgetCredits: 0,
      filledCredits: 0,
      remainingCredits: 0,
      shares: 40.5,
      filledShares: 0,
      remainingShares: 40.5,
    };
    render(<TradeTicket {...base} orders={[sell]} onPlaceLimit={async () => {}} onCancelLimit={async () => {}} />);
    expect(screen.getByText(/sell at \$80,000 · 40.5 sh/)).toBeTruthy();
  });

  test('cancelling calls back with the order id', async () => {
    const onCancelLimit = vi.fn(async () => {});
    render(<TradeTicket {...base} orders={[order]} onPlaceLimit={async () => {}} onCancelLimit={onCancelLimit} />);
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(onCancelLimit).toHaveBeenCalledWith('ord-1'));
  });
});

describe('selling at a price', () => {
  const higher = { direction: 'higher' as const, shares: 40.5, totalCost: 18 };
  const lower = { direction: 'lower' as const, shares: 40.5, totalCost: 18 };
  const sellTab = () => fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
  const orderType = () => screen.queryByRole('group', { name: 'Order type' });

  test('the Sell tab offers Limit when there is a position to sell', () => {
    render(
      <TradeTicket {...base} positions={[higher]} onPlaceLimit={async () => {}} onPlaceSellLimit={async () => {}} />,
    );
    sellTab();
    expect(within(orderType() as HTMLElement).getByText('Limit')).toBeTruthy();
  });

  test('Quick and Limit do not disappear from Sell when there is nothing to sell', () => {
    render(<TradeTicket {...base} positions={[]} onPlaceLimit={async () => {}} onPlaceSellLimit={async () => {}} />);
    sellTab();
    expect(orderType()).toBeTruthy();
    fireEvent.click(screen.getByText('Limit'));
    expect(screen.getByText(/Unfilled buy orders are not holdings/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Sell .* at/ })).toBeNull();
  });

  test('a sell limit restates the whole instruction', () => {
    render(
      <TradeTicket {...base} positions={[higher]} onPlaceLimit={async () => {}} onPlaceSellLimit={async () => {}} />,
    );
    sellTab();
    fireEvent.click(within(orderType() as HTMLElement).getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '80000' } });
    expect(screen.getByText('Sell 40.5 at $80,000')).toBeTruthy();
    expect(screen.getByText('sell at this or higher')).toBeTruthy();
  });

  test('a sell limit states the least the shares bring at the limit', () => {
    render(
      <TradeTicket {...base} positions={[higher]} onPlaceLimit={async () => {}} onPlaceSellLimit={async () => {}} />,
    );
    sellTab();
    fireEvent.click(within(orderType() as HTMLElement).getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '80000' } });
    // 40.5 higher shares at $80,000 of a $0..$500,000 range: 40.5 x 0.16.
    expect(screen.getByText('6.5 cr or more')).toBeTruthy();
  });

  test('a sell limit the market already passed is sent, with a warning of what sells now', async () => {
    const onPlaceSellLimit = vi.fn(async () => {});
    render(
      <TradeTicket
        {...base}
        probability={0.1}
        positions={[higher]}
        onPlaceLimit={async () => {}}
        onPlaceSellLimit={onPlaceSellLimit}
      />,
    );
    sellTab();
    fireEvent.click(within(orderType() as HTMLElement).getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });

    expect(screen.getByText(/The market is already over \$40,000: [\d.,]+ of 40\.5 shares sell now/)).toBeTruthy();
    fireEvent.click(screen.getByText('Sell 40.5 at $40,000'));
    await waitFor(() => expect(onPlaceSellLimit).toHaveBeenCalledWith('higher', 40000, 40.5));
  });

  test('placing a sell limit sends the side held, the price and the shares, and trades nothing', async () => {
    const onSell = vi.fn(async () => {});
    const onPlaceSellLimit = vi.fn(async () => {});
    render(
      <TradeTicket
        {...base}
        positions={[higher]}
        onSell={onSell}
        onPlaceLimit={async () => {}}
        onPlaceSellLimit={onPlaceSellLimit}
      />,
    );
    sellTab();
    fireEvent.click(within(orderType() as HTMLElement).getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '80000' } });
    fireEvent.click(screen.getByText('Sell 40.5 at $80,000'));
    await waitFor(() => expect(onPlaceSellLimit).toHaveBeenCalledWith('higher', 80000, 40.5));
    expect(onSell).not.toHaveBeenCalled();
  });

  test('a sell limit can never be for more than the position', async () => {
    const onPlaceSellLimit = vi.fn(async () => {});
    render(
      <TradeTicket {...base} positions={[higher]} onPlaceLimit={async () => {}} onPlaceSellLimit={onPlaceSellLimit} />,
    );
    sellTab();
    fireEvent.click(within(orderType() as HTMLElement).getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '80000' } });
    fireEvent.change(screen.getByLabelText('Shares of higher to sell'), { target: { value: '1000' } });
    fireEvent.click(screen.getByText('Sell 40.5 at $80,000'));
    await waitFor(() => expect(onPlaceSellLimit).toHaveBeenCalledWith('higher', 80000, 40.5));
  });

  test('a lower position sells when the market falls to its price', () => {
    render(
      <TradeTicket {...base} positions={[lower]} onPlaceLimit={async () => {}} onPlaceSellLimit={async () => {}} />,
    );
    sellTab();
    fireEvent.click(within(orderType() as HTMLElement).getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '20000' } });
    expect(screen.getByText('sell at this or lower')).toBeTruthy();
    expect(screen.getByText('Sell 40.5 at $20,000')).toBeTruthy();
  });

  test('a sell limit opens on the position with no Sell or Cancel pill', () => {
    render(
      <TradeTicket {...base} positions={[higher]} onPlaceLimit={async () => {}} onPlaceSellLimit={async () => {}} />,
    );
    sellTab();
    fireEvent.click(within(orderType() as HTMLElement).getByText('Limit'));
    expect(screen.getByLabelText('Shares of higher to sell')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  test('quick selling is unchanged by the sell limit', () => {
    render(
      <TradeTicket {...base} positions={[higher]} onPlaceLimit={async () => {}} onPlaceSellLimit={async () => {}} />,
    );
    sellTab();
    fireEvent.click(screen.getAllByRole('button', { name: 'Sell' }).at(-1) as HTMLElement);
    expect(screen.getByText(/Sell all for/)).toBeTruthy();
  });
});

describe('what a composed limit order does not say', () => {
  test('no release time and no waiting line', () => {
    render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });
    expect(screen.queryByText(/Until filled/)).toBeNull();
    expect(screen.queryByText(/waits|cancel anytime|until \d/i)).toBeNull();
  });
});

describe('bet amount slider', () => {
  test('a thousands balance no longer crams every sensible bet into the left edge', () => {
    render(<TradeTicket {...base} balance={23_400} />);
    pick('Higher');
    const slider = screen.getByLabelText('Bet amount slider') as HTMLInputElement;
    const amount = screen.getByLabelText('Credits to spend') as HTMLInputElement;
    // Mid-track is the geometric mean of 1..23,400 (~153, snapped to two
    // significant digits), not the linear 11,700.
    fireEvent.change(slider, { target: { value: '500' } });
    expect(Number(amount.value)).toBe(150);
    // The far end is still all in, exactly.
    fireEvent.change(slider, { target: { value: '1000' } });
    expect(Number(amount.value)).toBe(23_400);
  });
});

describe('betting towards a value', () => {
  test('typing a target into New value sets the side, the cost, and a confirm that names the target', () => {
    render(<TradeTicket {...base} />);
    pick('Higher');
    const target = screen.getByLabelText('Bet the market to this value in $');
    // Ask for a value below the current call (base probability 0.5 maps
    // to 250k on this range): the ticket flips to Lower and prices it.
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '100000' } });
    const amountInput = screen.getByLabelText('Credits to spend') as HTMLInputElement;
    expect(Number(amountInput.value)).toBeGreaterThan(0);
    // The confirm states the landing value, because that is what the
    // placed trade (the server's targetValue mode) actually promises.
    expect(screen.getByText(/Bet to \$100,000, up to [\d.,]+ cr/)).toBeTruthy();
    expect(screen.getByText('Lower').closest('button')?.getAttribute('aria-pressed')).toBe('true');
    // And above: flips back to Higher.
    fireEvent.change(target, { target: { value: '400000' } });
    expect(screen.getByText(/Bet to \$400,000, up to [\d.,]+ cr/)).toBeTruthy();
    expect(screen.getByText('Higher').closest('button')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('an unreachable target caps the amount at the per-market maximum', () => {
    render(<TradeTicket {...base} />);
    pick('Higher');
    const target = screen.getByLabelText('Bet the market to this value in $');
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '499000' } });
    const amountInput = screen.getByLabelText('Credits to spend') as HTMLInputElement;
    expect(Number(amountInput.value)).toBe(250);
  });

  test('confirming a typed target places a targetValue trade, not a budget buy', async () => {
    const onTrade = vi.fn(async () => {});
    const onTradeTarget = vi.fn(async () => {});
    render(<TradeTicket {...base} onTrade={onTrade} onTradeTarget={onTradeTarget} />);
    pick('Higher');
    const target = screen.getByLabelText('Bet the market to this value in $');
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '300000' } });
    fireEvent.click(screen.getByText(/Bet to \$300,000/));
    await waitFor(() => expect(onTradeTarget).toHaveBeenCalledTimes(1));
    const [placedTarget, budget] = onTradeTarget.mock.calls[0] as unknown as [number, number];
    expect(placedTarget).toBe(300000);
    expect(budget).toBeGreaterThan(0);
    expect(onTrade).not.toHaveBeenCalled();
  });

  test('editing the amount by hand after typing a target goes back to a plain buy', async () => {
    const onTrade = vi.fn(async () => {});
    const onTradeTarget = vi.fn(async () => {});
    render(<TradeTicket {...base} onTrade={onTrade} onTradeTarget={onTradeTarget} />);
    pick('Higher');
    const target = screen.getByLabelText('Bet the market to this value in $');
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '300000' } });
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('Bet 40 cr on Higher'));
    await waitFor(() => expect(onTrade).toHaveBeenCalledWith('higher', 40, expect.any(Number)));
    expect(onTradeTarget).not.toHaveBeenCalled();
  });

  test('picking a side after typing a target clears the target instruction', () => {
    render(<TradeTicket {...base} />);
    pick('Higher');
    const target = screen.getByLabelText('Bet the market to this value in $');
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '100000' } });
    expect(screen.getByText(/Bet to \$100,000/)).toBeTruthy();
    // Re-picking Higher is a manual side choice: back to a budget buy.
    pick('Higher');
    expect(screen.queryByText(/Bet to \$/)).toBeNull();
  });
});

describe('the preview knows about redemption (2026-08-30)', () => {
  // The trader holds the market's only 50 higher shares on a thin book
  // (b=100, range 0..1000): the live probability that the ticket receives
  // already contains them. Buying lower does NOT close that position on
  // the server any more; it buys, then cashes the matched pairs at par,
  // which moves no price. So the shown New value is the plain landing.
  const b = 100;
  const prob = 1 / (1 + Math.exp(-50 / b)); // pHigher([0, 50], 100)
  const netted = {
    ...base,
    probability: prob,
    liquidity: b,
    consensus: 1000 * prob,
    rangeMin: 0,
    rangeMax: 1000,
    positions: [{ direction: 'higher' as const, shares: 50, totalCost: 30 }],
  };

  const landing = (container: HTMLElement) =>
    parseFloat((container.querySelector('.ticket-newvalue') as HTMLInputElement).value.replace(/,/g, ''));

  test('holding the opposite side does not change the landing', () => {
    // The whole point of redemption: the price a bet lands on is the bet's
    // own doing. The liquidation this replaced landed ~389 here, dragged
    // down by the forced sale of all 50 shares.
    const withPosition = render(<TradeTicket {...netted} />);
    pick('Lower');
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '25' } });
    const held = landing(withPosition.container);
    withPosition.unmount();

    const flat = render(<TradeTicket {...netted} positions={[]} />);
    pick('Lower');
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '25' } });
    expect(landing(flat.container)).toBeCloseTo(held, 1);
    expect(held).toBeGreaterThan(450);
  });

  test('the bet ceiling is the balance: redemption pays out after the buy', () => {
    // Balance 10 and a held position worth ~30. The liquidation this
    // replaced funded the bet from the forced close, so the ceiling was
    // balance + proceeds (~40) and the default 25 sat mid-track.
    // Redemption cannot fund the buy, because it happens after it, so 25
    // is now past the ceiling and the slider pins to its top.
    const poor = render(<TradeTicket {...netted} balance={10} />);
    pick('Lower');
    const pinned = poor.container.querySelector('input[aria-label="Bet amount slider"]') as HTMLInputElement;
    expect(pinned.value).toBe(String(SLIDER_STEPS));
    poor.unmount();

    // With the balance actually covering it, the same amount sits inside
    // the track: the ceiling moved with the balance, nothing else.
    const rich = render(<TradeTicket {...netted} balance={1000} />);
    pick('Lower');
    const inside = rich.container.querySelector('input[aria-label="Bet amount slider"]') as HTMLInputElement;
    expect(Number(inside.value)).toBeLessThan(SLIDER_STEPS);
  });
});

/**
 * The price at rest (docs/ui-conventions.md, "An untouched ticket still
 * quotes both sides"). The rule this enforces: a trader can read what a
 * share of each side costs BEFORE pressing anything, which is what every
 * other venue does and what the platform's most calibrated trader left for
 * want of (notes/quroe-churn-2026-08-27.md).
 */
describe('how much is on the table', () => {
  test('each side says the most that can be won on it, in credits', () => {
    render(<TradeTicket {...base} />);
    // b = 200 at even odds: 200 * ln 2 = 139 credits behind either side.
    expect(screen.getAllByText('up to 139 cr')).toHaveLength(2);
  });

  test('and says it INSTEAD of the price, which told a reader nothing about depth', () => {
    const { container } = render(<TradeTicket {...base} probability={0.2} />);
    expect(container.textContent).not.toContain('20c');
    expect(container.textContent).not.toContain('80c');
    expect(container.textContent).not.toMatch(/up to [\d.]+x/);
  });

  test('the cheap side has more on the table than the dear one', () => {
    render(<TradeTicket {...base} probability={0.14} />);
    expect(screen.getByText('up to 393 cr')).toBeTruthy();
    expect(screen.getByText('up to 30 cr')).toBeTruthy();
  });

  test('a thinner market says so, on the same prices', () => {
    // The number is the market's depth, which is the thing that decides
    // whether a market is worth a trader's time at all.
    render(<TradeTicket {...base} liquidity={12} />);
    expect(screen.getAllByText('up to 8.3 cr')).toHaveLength(2);
  });

  test('it is never quoted bare, because the ceiling is not the expectation', () => {
    const { container } = render(<TradeTicket {...base} probability={0.2} />);
    // 200 * ln(1/0.2) = 322 credits behind Higher.
    expect(container.textContent).toContain('up to 322 cr');
    expect(container.textContent).not.toMatch(/(?<!up to )322 cr/);
  });

  test('the ceilings go with the pills, so manage mode has none', () => {
    const { container } = render(<TradeTicket {...base} manageMode initialDir="higher" />);
    expect(container.textContent).not.toContain('up to');
  });
});

describe('the quote at rest', () => {
  test('both sides carry a quote before any click', () => {
    render(<TradeTicket {...base} />);
    expect(screen.getAllByText('up to 139 cr')).toHaveLength(2);
  });

  test('a side the market has all but settled has almost nothing to win', () => {
    // The Telarchy revenue market really does sit at p = 0.001.
    render(<TradeTicket {...base} probability={0.996} />);
    expect(screen.getByText('<1 cr', { exact: false })).toBeTruthy();
  });

  test('an unfunded market quotes nothing: there is no ceiling to state', () => {
    const { container } = render(<TradeTicket {...base} liquidity={0} />);
    expect(container.textContent).not.toContain('up to');
  });

  test('the quote is never a percent, which would read as a chance', () => {
    const { container } = render(<TradeTicket {...base} probability={0.14} />);
    expect(container.textContent).not.toContain('%');
  });

  test('and never the price in cents, which is the thing it replaced', () => {
    const { container } = render(<TradeTicket {...base} probability={0.14} />);
    expect(container.textContent).not.toContain('14c');
    expect(container.textContent).not.toContain('86c');
  });

  test('the payoff line replaces the payout sentence inside the ticket', () => {
    const { container } = render(<TradeTicket {...base} />);
    expect(container.textContent).not.toContain('A share pays');
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '25' } });
    expect(container.querySelector('.scale')?.textContent).toContain('$500.0k');
  });

  test('without a range there is no track, but the quotes stand', () => {
    const { container } = render(<TradeTicket {...base} rangeMin={undefined} rangeMax={undefined} />);
    expect(screen.getAllByText('up to 139 cr')).toHaveLength(2);
    expect(container.querySelector('.pay-track')).toBeNull();
  });

  test('the quotes stay on the pills once a side is picked', () => {
    render(<TradeTicket {...base} probability={0.14} />);
    pick('Higher');
    expect(screen.getByText('up to 393 cr')).toBeTruthy();
    expect(screen.getByText('up to 30 cr')).toBeTruthy();
  });

  test('manage mode quotes nothing: it has no side pills to quote', () => {
    const { container } = render(<TradeTicket {...base} manageMode initialDir="higher" />);
    expect(container.textContent).not.toContain('up to');
    expect(container.textContent).not.toContain('A share pays');
  });
});

describe('the payoff line', () => {
  /** p = 0.5 on a $0..$500k range really is $250,000; the shared fixture
      passes an unrelated consensus, and the untouched bar draws both. */
  const payBase = { ...base, consensus: 250_000 };

  /** The stops, in order: [value label, credits label, percentage]. */
  const stops = (container: HTMLElement) => {
    const vals = Array.from(container.querySelectorAll('.scale-val > span'));
    const crs = Array.from(container.querySelectorAll('.scale-cr > span'));
    return vals.map((v, i) => ({
      value: v.textContent ?? '',
      credits: crs[i]?.textContent ?? '',
      at: Number((v as HTMLElement).dataset.at),
    }));
  };

  test('an untouched ticket keeps the plain range bar: there is nothing to price', () => {
    // The two-tracks confusion of 2026-09-09 is answered by labelling the
    // stake slider's ends in credits, not by removing the picture (owner,
    // 2026-09-10).
    const { container } = render(<TradeTicket {...payBase} />);
    expect(container.querySelector('.pay-track')).toBeTruthy();
    expect(container.querySelector('.scale')).toBeNull();
  });

  test('the line carries two rows and nothing else: credits over it, values under', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    const scale = container.querySelector('.scale') as HTMLElement;
    expect(scale.querySelectorAll('.scale-cr')).toHaveLength(1);
    expect(scale.querySelectorAll('.scale-val')).toHaveLength(1);
    // No third row of labels, no captions floating over the rule.
    expect(scale.querySelectorAll('.scale-row')).toHaveLength(2);
  });

  test('BOTH ENDS OF THE RANGE ARE ALWAYS STOPS, so the best case is never hidden', () => {
    // The version this replaces dropped the top of the range whenever the
    // break-even came near it, and then every credit figure on the ticket
    // was a loss (owner report, 2026-09-01).
    const { container } = render(<TradeTicket {...payBase} probability={0.86} liquidity={800} />);
    pick('Higher');
    const s = stops(container);
    expect(s[0].at).toBe(0);
    expect(s[s.length - 1].at).toBe(100);
    expect(s[s.length - 1].credits.startsWith('+')).toBe(true);
    expect(s[0].credits.startsWith('-')).toBe(true);
  });

  test('the break-even is a stop, and it is the one that reads 0 cr', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    const zero = stops(container).filter(s => s.credits === '0 cr');
    expect(zero).toHaveLength(1);
    expect(zero[0].at).toBeCloseTo(52.94, 1);
  });

  test('no two stops crowd: every pair is at least a seventh of the range apart', () => {
    for (const p of [0.02, 0.2, 0.5, 0.7, 0.86, 0.97]) {
      const { container, unmount } = render(<TradeTicket {...payBase} probability={p} liquidity={800} />);
      pick('Higher');
      const at = stops(container).map(s => s.at);
      expect(at.length).toBeGreaterThanOrEqual(3);
      expect(at.length).toBeLessThanOrEqual(5);
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(13);
      unmount();
    }
  });

  test('a stop near an edge leans away from it rather than over its neighbour', () => {
    const { container } = render(<TradeTicket {...payBase} probability={0.86} liquidity={800} />);
    pick('Higher');
    const near = Array.from(container.querySelectorAll('.scale-val > span')).find(
      e => Number((e as HTMLElement).dataset.at) > 82 && Number((e as HTMLElement).dataset.at) < 100,
    ) as HTMLElement;
    expect(near.style.transform).toBe('translateX(-100%)');
  });

  test('the ends pin to the card, so no label hangs off it', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    const els = Array.from(container.querySelectorAll('.scale-val > span')) as HTMLElement[];
    expect(els[0].style.left).toBe('0px');
    expect(els[els.length - 1].style.right).toBe('0px');
  });

  /** Where a rule segment actually sits, as [left%, right%] of the rule. */
  const seg = (container: HTMLElement, cls: string) => {
    const el = container.querySelector(cls) as HTMLElement;
    return [parseFloat(el.style.left || '0'), 100 - parseFloat(el.style.right || '0')];
  };

  test('the rule turns colour where the bet starts paying', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    const [, loseEnds] = seg(container, '.rule-lose');
    const [winStarts] = seg(container, '.rule-win');
    expect(loseEnds).toBeCloseTo(52.94, 1);
    expect(winStarts).toBeCloseTo(52.94, 1);
  });

  test('THE GREEN SIDE IS THE SIDE THE BET WINS ON: a higher bet wins above the break-even', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    const [loseFrom, loseTo] = seg(container, '.rule-lose');
    const [winFrom, winTo] = seg(container, '.rule-win');
    expect(loseFrom).toBeCloseTo(0, 5);
    expect(winTo).toBeCloseTo(100, 5);
    expect(loseTo).toBeCloseTo(winFrom, 5);
  });

  test('THE GREEN SIDE IS THE SIDE THE BET WINS ON: a lower bet wins BELOW the break-even', () => {
    // Owner report, 2026-09-01: a Lower bet painted the low end (where it
    // pays) red and the high end (where the stake is gone) green, because
    // the segments were laid out in a fixed order and only their widths
    // knew about the direction.
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Lower');
    const [winFrom, winTo] = seg(container, '.rule-win');
    const [loseFrom, loseTo] = seg(container, '.rule-lose');
    expect(winFrom).toBeCloseTo(0, 5);
    expect(loseTo).toBeCloseTo(100, 5);
    expect(winTo).toBeCloseTo(loseFrom, 5);
  });

  test('THE GREEN SIDE IS THE SIDE THE BET WINS ON: colour agrees with the credits above it, both ways', () => {
    // The rule and the numbers over it are the same claim drawn twice, so
    // every stop under green must read +, and every stop under red -.
    for (const dir of ['Higher', 'Lower']) {
      const { container, unmount } = render(<TradeTicket {...payBase} />);
      pick(dir as 'Higher' | 'Lower');
      const [winFrom, winTo] = seg(container, '.rule-win');
      const [loseFrom, loseTo] = seg(container, '.rule-lose');
      for (const s of stops(container)) {
        if (s.credits === '0 cr') continue;
        const under = s.at > winFrom && s.at < winTo ? 'win' : s.at > loseFrom && s.at < loseTo ? 'lose' : null;
        if (under === null) continue;
        expect([dir, s.at, under, s.credits].join(' ')).toBe(
          [dir, s.at, under, s.credits.startsWith(under === 'win' ? '+' : '-') ? s.credits : 'MISMATCH'].join(' '),
        );
      }
      unmount();
    }
  });

  test('THE STAKE AND THE VALUE IT BUYS ARE ONE LINE, and both are typeable', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    const compose = container.querySelector('.compose') as HTMLElement;
    expect(compose.contains(screen.getByLabelText('Credits to spend'))).toBe(true);
    expect(compose.contains(screen.getByLabelText('Bet the market to this value in $'))).toBe(true);
  });

  test('typing into the value half composes a bet that lands there', () => {
    render(<TradeTicket {...payBase} />);
    pick('Higher');
    const target = screen.getByLabelText('Bet the market to this value in $');
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '400000' } });
    expect(screen.getByText(/Bet to \$400,000, up to [\d.,]+ cr/)).toBeTruthy();
  });

  test('typing into the stake half goes back to spending a budget', () => {
    render(<TradeTicket {...payBase} />);
    pick('Higher');
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '40' } });
    expect(screen.getByText('Bet 40 cr on Higher')).toBeTruthy();
  });

  test('a market with no range draws nothing, and still takes a bet', () => {
    const { container } = render(<TradeTicket {...payBase} rangeMin={undefined} rangeMax={undefined} />);
    pick('Higher');
    // Without a range there is no landing value, no break-even and no
    // payout to state, so the ticket falls back to a stake and a confirm
    // rather than inventing any of them.
    expect(container.querySelector('.scale')).toBeNull();
    expect(container.querySelector('.pay-track')).toBeNull();
    expect(container.querySelector('.compose-arrow')).toBeNull();
    expect(screen.getByLabelText('Credits to spend')).toBeTruthy();
    expect(screen.getByText('Bet 25 cr on Higher')).toBeTruthy();
  });

  test('a stake of nothing prices nothing', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '' } });
    expect(container.querySelector('.scale')).toBeNull();
  });

  test('EVERY VALUE ON THE LINE CARRIES THE SAME DECIMALS', () => {
    // A row reading "0, 33.3, 66.7, 84, 100" is ragged: the one that lands
    // on a whole number has to say 84.0 like the rest (owner, 2026-09-01).
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    const vals = stops(container).map(s => s.value);
    expect(vals).toEqual(['$0.0k', '$166.7k', '$264.7k', '$333.3k', '$500.0k']);
    const decimals = vals.map(v => (v.split('.')[1] ?? '').replace(/[^\d]/g, '').length);
    expect(new Set(decimals).size).toBe(1);
  });

  test('and drops them together when no value on the line needs one', () => {
    const { container } = render(<TradeTicket {...payBase} rangeMin={0} rangeMax={12} consensus={6} />);
    pick('Higher');
    const vals = stops(container).map(s => s.value);
    for (const v of vals) expect(v.includes('.')).toBe(vals[0].includes('.'));
  });

  test('THE INTERIOR STOPS NEVER MOVE, WHATEVER THE STAKE', () => {
    // They used to be spaced off the break-even, so every drag of the
    // slider slid every label sideways (owner, 2026-09-01: "the numbers are
    // kind of twitching when i move the slider"). They sit at fixed thirds
    // now: an interior stop is either at its third or not drawn, and the
    // only label that travels is the break-even, which really is moving.
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    for (const amount of ['5', '25', '60', '120', '200', '400', '1000']) {
      fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: amount } });
      const at = stops(container).map(s => s.at);
      expect(at[0]).toBe(0);
      expect(at[at.length - 1]).toBe(100);
      const zeroAt = stops(container).find(s => s.credits === '0 cr')?.at;
      for (const a of at.slice(1, -1)) {
        const isThird = Math.abs(a - 33.33) < 0.02 || Math.abs(a - 66.67) < 0.02;
        expect(isThird || a === zeroAt).toBe(true);
      }
    }
  });

  test('THE BREAK-EVEN STOP READS 0 CR, never -0 cr', () => {
    // Its worth is zero by construction, but the float lands a hair either
    // side of it, so the stop flickered between "0 cr" and "-0 cr" as the
    // stake moved (owner, 2026-09-01).
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    for (let amount = 1; amount <= 60; amount += 1) {
      fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: String(amount) } });
      // A stake small enough can be worth under a credit at several stops,
      // so several may legitimately read "0 cr"; none may read "-0 cr".
      const all = Array.from(container.querySelectorAll('.scale-cr > span')).map(e => e.textContent ?? '');
      expect(all.some(x => x.includes('-0 cr'))).toBe(false);
    }
  });

  const hover = (container: HTMLElement, x: number) => {
    const scale = container.querySelector('.scale') as HTMLElement;
    scale.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 40 }) as DOMRect;
    fireEvent.pointerMove(scale, { clientX: x });
    return {
      top: container.querySelector('.scale-cr .scale-cursor')?.textContent ?? '',
      bottom: container.querySelector('.scale-val .scale-cursor')?.textContent ?? '',
    };
  };

  test('HOVERING THE LINE SAYS WHAT THE NUMBERS MEAN, not just what they are', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    // A quarter along the range is $125,000; 25 cr bought 47.2 shares, so
    // that settles at 47.2266 * 0.25 - 25 = -13 credits.
    const { top, bottom } = hover(container, 100);
    expect(top).toBe('you lose 13 cr');
    expect(bottom).toBe('if it settles at $125.0k');
  });

  test('and says it as a gain where the bet gains', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    expect(hover(container, 380).top).toBe('you make +20 cr');
  });

  test('and names the break-even for what it is', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    // The break-even is at 52.94% of the range: 400px * 0.5294 = 212px.
    expect(hover(container, 211.7).top).toBe('you break even');
  });

  test('the readout follows the pointer and the static stops stand down', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    const scale = container.querySelector('.scale') as HTMLElement;
    scale.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 40 }) as DOMRect;
    expect(container.querySelector('.scale.is-reading')).toBeNull();
    fireEvent.pointerMove(scale, { clientX: 300 });
    expect(container.querySelector('.scale.is-reading')).toBeTruthy();
    expect(Number((container.querySelector('.scale-cr .scale-cursor') as HTMLElement).dataset.at)).toBeCloseTo(75, 5);
    expect(container.querySelector('.scale-cr .scale-cursor')?.textContent).toBe('you make +10 cr');
  });

  test('leaving the line puts the readout away', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    const scale = container.querySelector('.scale') as HTMLElement;
    scale.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 40 }) as DOMRect;
    fireEvent.pointerMove(scale, { clientX: 100 });
    fireEvent.pointerLeave(scale);
    expect(container.querySelector('.scale-cursor')).toBeNull();
  });

  test('a line with no width on screen reads out nothing rather than dividing by it', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    pick('Higher');
    fireEvent.pointerMove(container.querySelector('.scale') as HTMLElement, { clientX: 40 });
    expect(container.querySelector('.scale-cursor')).toBeNull();
  });

  test('A RESTING ORDER NAMES ITS LIMIT, never a landing it will not cause', () => {
    // A resting order moves nothing until it fills, so the value the ticket
    // shows beside the stake has to be the limit itself. It used to show
    // the landing of a market buy that was not being placed.
    const { container } = render(<TradeTicket {...payBase} onPlaceLimit={async () => {}} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    const compose = container.querySelector('.compose') as HTMLElement;
    expect(compose.contains(screen.getByLabelText('Limit price in $'))).toBe(true);
    expect(screen.queryByLabelText('Bet the market to this value in $')).toBeNull();
  });

  test('and the price lives in the composer, not in a second row of its own', () => {
    const { container } = render(<TradeTicket {...payBase} onPlaceLimit={async () => {}} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    expect(container.querySelectorAll('.compose')).toHaveLength(1);
    expect(container.querySelector('.ticket-amt--price')).toBeNull();
    expect(container.querySelectorAll('.compose input')).toHaveLength(2);
  });

  test('typing the limit into the composer composes the whole instruction', () => {
    render(<TradeTicket {...payBase} onPlaceLimit={async () => {}} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });
    expect(screen.getByText('Buy Higher under $40,000')).toBeTruthy();
  });

  test('the line prices the FILL, not a walk the order never takes', () => {
    const { container } = render(<TradeTicket {...payBase} onPlaceLimit={async () => {}} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '100000' } });
    // Filled at a fifth of the range, 25 cr buys 125 shares: the whole stake
    // gone at the floor, 100 credits up at the ceiling, even at the limit.
    const s = stops(container);
    expect(s[0].credits).toBe('-25 cr');
    expect(s[s.length - 1].credits).toBe('+100 cr');
    expect(s.find(x => x.credits === '0 cr')?.at).toBeCloseTo(20, 5);
  });

  test('a limit the market has already passed prices nothing at all', () => {
    const { container } = render(<TradeTicket {...payBase} onPlaceLimit={async () => {}} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    // Buying higher waits for a cheaper price, so a limit above the current
    // call fills at once, at prices between the call and the limit: the
    // ticket says what fills now and draws no payoff line.
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '400000' } });
    expect(container.querySelector('.scale')).toBeNull();
    expect(screen.getByText(/The market is already under \$400,000: [\d.,]+ cr fills now/)).toBeTruthy();
  });

  test('a held position is priced by the SALE, not by a settlement line', () => {
    // Revised 2026-09-09 (owner: "i dont understand the sell visualization
    // at all"): the Sell tab prices what selling does, in proceeds and
    // profit or loss, and draws no settlement line at all.
    const { container } = render(
      <TradeTicket {...payBase} manageMode positions={[{ direction: 'higher', shares: 100, totalCost: 20 }]} />,
    );
    expect(container.querySelector('.scale')).toBeNull();
    expect(container.querySelector('.pay')).toBeNull();
    fireEvent.click(
      within(container.querySelector('.ticket-pos-head') as HTMLElement).getByRole('button', { name: 'Sell' }),
    );
    expect(screen.getByText('You get')).toBeTruthy();
    expect(screen.getByText('Profit / loss')).toBeTruthy();
  });
});

/**
 * The stake is typed to a millionth of a credit (docs/ui-conventions.md,
 * "The stake is typed to a millionth of a credit"; Viktor 2026-09-11: "we
 * need to support betting decimal amounts of credits up to 1000000th of a
 * credit for now"). The server keeps nanocredits; the ticket was the only
 * thing rounding.
 */
describe('decimal stakes', () => {
  test('a typed decimal stake is kept, named on the confirm, and sent as typed', async () => {
    const onTrade = vi.fn(async () => {});
    render(<TradeTicket {...base} onTrade={onTrade} balance={100} />);
    pick('Higher', '0.25');
    const input = screen.getByLabelText('Credits to spend') as HTMLInputElement;
    expect(input.value).toBe('0.25');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    fireEvent.click(screen.getByText('Bet 0.25 cr on Higher'));
    await waitFor(() => expect(onTrade).toHaveBeenCalledWith('higher', 0.25, expect.any(Number)));
  });

  test('the decimal point survives typing: 12.5 stays 12.5, not 125', () => {
    render(<TradeTicket {...base} balance={100} />);
    pick('Higher', '12.5');
    expect((screen.getByLabelText('Credits to spend') as HTMLInputElement).value).toBe('12.5');
    expect(screen.getByText('Bet 12.5 cr on Higher')).toBeTruthy();
  });

  test('the field takes no seventh decimal; under a millionth is nothing to bet', async () => {
    const onTrade = vi.fn(async () => {});
    render(<TradeTicket {...base} onTrade={onTrade} balance={100} />);
    pick('Higher', '0.0000001');
    expect((screen.getByLabelText('Credits to spend') as HTMLInputElement).value).toBe('0.000000');
    const confirm = screen.getByText('Bet 0 cr on Higher').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '1.2345678' } });
    expect((screen.getByLabelText('Credits to spend') as HTMLInputElement).value).toBe('1.234567');
    fireEvent.click(screen.getByText('Bet 1.234567 cr on Higher'));
    await waitFor(() => expect(onTrade).toHaveBeenCalledWith('higher', 1.234567, expect.any(Number)));
  });

  test('a fractional balance can be bet in full: the ceiling is the balance, not the balance rounded down', async () => {
    const onTrade = vi.fn(async () => {});
    render(<TradeTicket {...base} onTrade={onTrade} balance={250.75} />);
    pick('Higher', '250.75');
    expect(screen.getByText(/250\.75 cr, all you have/)).toBeTruthy();
    const slider = screen.getByLabelText('Bet amount slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '1000' } });
    expect((screen.getByLabelText('Credits to spend') as HTMLInputElement).value).toBe('250.75');
    fireEvent.click(screen.getByText('Bet 250.75 cr on Higher'));
    await waitFor(() => expect(onTrade).toHaveBeenCalledWith('higher', 250.75, expect.any(Number)));
  });

  test('a balance under a credit is still a stake you can type', async () => {
    const onTrade = vi.fn(async () => {});
    render(<TradeTicket {...base} onTrade={onTrade} balance={0.4} />);
    pick('Higher', '0.4');
    fireEvent.click(screen.getByText('Bet 0.4 cr on Higher'));
    await waitFor(() => expect(onTrade).toHaveBeenCalledWith('higher', 0.4, expect.any(Number)));
  });

  test('a limit order budget keeps its decimals too', async () => {
    const onPlaceLimit = vi.fn(async () => {});
    render(<TradeTicket {...base} balance={100} onPlaceLimit={onPlaceLimit} />);
    pick('Higher', '2.5');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });
    fireEvent.click(screen.getByText('Buy Higher under $40,000'));
    await waitFor(() => expect(onPlaceLimit).toHaveBeenCalledWith('higher', 40000, 2.5));
  });
});

describe('the limit price is typed with decimals', () => {
  // Owner report 2026-09-17: "i should be able to enter decimal values here
  // (in the limit orders (bet below/above)". The field reformatted every
  // keystroke, so "1.0" snapped back to "1" and the next digit made "15".
  const small = { ...base, consensus: 50, rangeMin: 0, rangeMax: 100 };
  const field = () => screen.getByLabelText('Limit price in $') as HTMLInputElement;
  const type = (value: string) => fireEvent.change(field(), { target: { value } });
  const openLimit = (props: Record<string, unknown> = {}) => {
    const onPlaceLimit = vi.fn(async () => {});
    render(<TradeTicket {...small} balance={100} onPlaceLimit={onPlaceLimit} {...props} />);
    pick('Higher', '5');
    fireEvent.click(screen.getByText('Limit'));
    return onPlaceLimit;
  };

  test('I can enter a decimal limit price one key at a time', async () => {
    const onPlaceLimit = openLimit();
    for (const step of ['1', '1.', '1.0']) {
      type(step);
      expect(field().value).toBe(step);
    }
    type('1.05');
    expect(field().value).toBe('1.05');
    fireEvent.click(screen.getByText('Buy Higher under $1.05'));
    await waitFor(() => expect(onPlaceLimit).toHaveBeenCalledWith('higher', 1.05, 5));
  });

  test('a trailing zero stays in the field while I type', () => {
    openLimit();
    type('1.50');
    expect(field().value).toBe('1.50');
    type('0.0');
    expect(field().value).toBe('0.0');
  });

  test('a decimal comma is a decimal point', async () => {
    const onPlaceLimit = openLimit();
    type('1,');
    expect(field().value).toBe('1.');
    type('1.5');
    type('12,5');
    expect(field().value).toBe('12.5');
    fireEvent.click(screen.getByText('Buy Higher under $12.5'));
    await waitFor(() => expect(onPlaceLimit).toHaveBeenCalledWith('higher', 12.5, 5));
  });

  test('the whole part keeps its thousands separators and they are never read as a decimal', () => {
    openLimit({ consensus: 50_000, rangeMax: 500_000 });
    type('40000');
    expect(field().value).toBe('40,000');
    // The next key arrives with the separator the field itself put there.
    type('40,0001');
    expect(field().value).toBe('400,001');
    type('40,000.25');
    expect(field().value).toBe('40,000.25');
    expect(screen.getByText('Buy Higher under $40,000')).toBeTruthy();
  });

  test('a comma typed after a grouped number is the decimal point', () => {
    openLimit({ consensus: 50_000, rangeMax: 500_000 });
    type('40000');
    type('40,000,');
    expect(field().value).toBe('40,000.');
    type('40,000.5');
    expect(field().value).toBe('40,000.5');
  });

  test('one decimal point, six places, nothing but digits', () => {
    openLimit();
    type('1.2.3');
    expect(field().value).toBe('1.23');
    type('1.23456789');
    expect(field().value).toBe('1.234567');
    type('-4e2');
    expect(field().value).toBe('42');
    type('');
    expect(field().value).toBe('');
  });

  test('a price typed from the point down reads as a number', async () => {
    const onPlaceLimit = openLimit();
    type('.5');
    expect(field().value).toBe('.5');
    fireEvent.click(screen.getByText('Buy Higher under $0.50'));
    await waitFor(() => expect(onPlaceLimit).toHaveBeenCalledWith('higher', 0.5, 5));
  });

  test('a decimal limit outside the range is still refused', () => {
    openLimit();
    type('100.5');
    expect(screen.getByText('Between $0.00 and $100')).toBeTruthy();
  });

  test('the sell limit field takes decimals the same way', async () => {
    const onPlaceSellLimit = vi.fn(async () => {});
    render(
      <TradeTicket
        {...small}
        positions={[{ direction: 'higher' as const, shares: 40, totalCost: 18 }]}
        onPlaceSellLimit={onPlaceSellLimit}
      />,
    );
    fireEvent.click(screen.getByText('Sell'));
    fireEvent.click(screen.getByText('Limit'));
    type('60.');
    expect(field().value).toBe('60.');
    type('60.0');
    expect(field().value).toBe('60.0');
    type('60.05');
    expect(field().value).toBe('60.05');
    fireEvent.click(screen.getByText(/^Sell 40(\.0)? at \$60\.1$/));
    await waitFor(() => expect(onPlaceSellLimit).toHaveBeenCalledWith('higher', 60.05, 40));
  });
});

describe('the trade dialog keeps my selections after an action', () => {
  const position = { direction: 'higher' as const, shares: 40.5, totalCost: 18 };
  const order = {
    id: 'pending',
    marketId: 'm1',
    agentId: 'a1',
    side: 'buy' as const,
    direction: 'higher' as const,
    limitValue: 40000,
    budgetCredits: 50,
    filledCredits: 10,
    remainingCredits: 40,
    status: 'open' as const,
    expiresAt: null,
    createdAt: '2026-09-16T18:27:00Z',
  };
  const selected = (name: string) =>
    expect(
      within(screen.getByRole('group', { name: 'Buy or sell' }))
        .getByRole('button', { name, exact: true })
        .getAttribute('aria-pressed'),
    ).toBe('true');

  test('placing a buy limit does not reset the dialog to buying Quick', async () => {
    const submit = vi.fn(async () => {});
    render(<TradeTicket {...base} onPlaceLimit={submit} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });
    fireEvent.click(screen.getByText('Buy Higher under $40,000'));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    await waitFor(() => selected('Limit'));
    selected('Buy');
    expect((screen.getByLabelText('Limit price in $') as HTMLInputElement).value).toBe('40,000');
    expect(screen.getByText('✓ Order placed')).toBeTruthy();
  });

  test('placing a sell limit stays on Sell Limit after the held shares refresh to zero', async () => {
    const submit = vi.fn(async () => {});
    const props = { ...base, positions: [position], onPlaceLimit: async () => {}, onPlaceSellLimit: submit };
    const { rerender } = render(<TradeTicket {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sell', exact: true }));
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '80000' } });
    fireEvent.click(screen.getByText('Sell 40.5 at $80,000'));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    await waitFor(() => selected('Limit'));
    expect((screen.getByLabelText('Limit price in $') as HTMLInputElement).value).toBe('80,000');
    rerender(<TradeTicket {...props} positions={[]} />);
    selected('Sell');
    selected('Limit');
    expect(screen.queryByRole('button', { name: /^Sell .* at/ })).toBeNull();
  });

  test('a quick sale stays on Sell with the remaining shares ready to sell', async () => {
    const submit = vi.fn(async () => {});
    const props = { ...base, positions: [position], onSell: submit, onPlaceSellLimit: async () => {} };
    const { rerender } = render(<TradeTicket {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sell', exact: true }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Sell', exact: true })[1]);
    fireEvent.click(screen.getByRole('button', { name: /^Sell all for/ }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    rerender(<TradeTicket {...props} positions={[{ ...position, shares: 10 }]} />);
    selected('Sell');
    selected('Quick');
    expect(screen.getByRole('button', { name: /^Sell all for/ })).toBeTruthy();
  });

  test.each(['Buy', 'Sell'])('open orders stay visibly labelled inside %s in Quick and Limit', tab => {
    render(
      <TradeTicket
        {...base}
        positions={[position]}
        orders={[order]}
        onPlaceLimit={async () => {}}
        onPlaceSellLimit={async () => {}}
        onCancelLimit={async () => {}}
      />,
    );
    const header = screen.getByRole('group', { name: 'Buy or sell' });
    fireEvent.click(within(header).getByRole('button', { name: tab, exact: true }));
    for (const mode of ['Quick', 'Limit']) {
      fireEvent.click(within(header).getByRole('button', { name: mode, exact: true }));
      const region = screen.getByRole('region', { name: 'Open orders' });
      expect(within(region).getByText('Open orders')).toBeTruthy();
      expect(region.closest('.ticket')).toBeTruthy();
      expect(
        within(region)
          .getAllByRole('button')
          .map(button => button.textContent),
      ).toEqual(['Cancel']);
      expect(within(header).getByRole('button', { name: 'Buy', exact: true })).toBeTruthy();
      expect(within(header).getByRole('button', { name: 'Sell', exact: true })).toBeTruthy();
      selected(tab);
      selected(mode);
    }
  });

  test('pending orders offer only Cancel before the actually bought shares', async () => {
    const cancel = vi.fn(async () => {});
    const sell = vi.fn(async () => {});
    render(
      <TradeTicket
        {...base}
        positions={[position]}
        orders={[order]}
        onCancelLimit={cancel}
        onSell={sell}
        onPlaceSellLimit={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sell', exact: true }));
    fireEvent.click(screen.getByText('Limit'));
    const orders = screen.getByRole('region', { name: 'Open orders' });
    const shares = screen.getByRole('region', { name: 'Your shares' });
    expect(orders.compareDocumentPosition(shares) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      within(orders)
        .getAllByRole('button')
        .map(b => b.textContent),
    ).toEqual(['Cancel']);
    fireEvent.click(within(orders).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('pending'));
    expect(sell).not.toHaveBeenCalled();
    selected('Sell');
    selected('Limit');
    expect(screen.getByRole('region', { name: 'Your shares' })).toBeTruthy();
  });
});

/* Persona run 2026-09-17, the trader: "The confirmation is gone after about
   three seconds and never restates the cost." */
describe('a placed bet leaves a line saying what was bought', () => {
  test('after a bet the ticket says the side and the cost, and keeps saying it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<TradeTicket {...base} onTrade={async () => ({ spent: 25 })} />);
      pick('Higher');
      fireEvent.click(screen.getByText('Bet 25 cr on Higher'));
      expect((await screen.findByRole('status')).textContent).toBe('You bought Higher for 25 cr.');
      // The tick on the button goes; the line stays.
      await vi.advanceTimersByTimeAsync(5000);
      expect(screen.getByRole('status').textContent).toBe('You bought Higher for 25 cr.');
    } finally {
      vi.useRealTimers();
    }
  });
  test('it goes when the trader composes something else', async () => {
    render(<TradeTicket {...base} onTrade={async () => ({ spent: 25 })} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Bet 25 cr on Higher'));
    await screen.findByRole('status');
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '30' } });
    expect(screen.queryByRole('status')).toBeNull();
  });
  test('a partly filled bet keeps its own line, which already names what was spent', async () => {
    render(<TradeTicket {...base} onTrade={async () => ({ limited: true, spent: 10, unspent: 15 })} />);
    pick('Higher');
    fireEvent.click(screen.getByText('Bet 25 cr on Higher'));
    expect((await screen.findByRole('status')).textContent).toMatch(/^Filled 10 of 25 cr/);
  });
  test('a failed bet says nothing was bought', async () => {
    render(
      <TradeTicket
        {...base}
        onTrade={async () => {
          throw new Error('Insufficient balance');
        }}
      />,
    );
    pick('Higher');
    fireEvent.click(screen.getByText('Bet 25 cr on Higher'));
    expect(await screen.findByText('Insufficient balance')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the refund line (docs/ui-conventions.md, direction A, 2026-09-18)', () => {
  test('a subject that carries a refund line prints it once, above the confirm button', () => {
    const { container } = render(
      <TradeTicket
        {...base}
        subject={{
          context: '#7 · if approved',
          title: 'Rewrite the store page',
          refund: 'If this is declined, your bet is refunded.',
        }}
      />,
    );
    const lines = container.querySelectorAll('.ticket-refund');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe('If this is declined, your bet is refunded.');
    const go = container.querySelector('.ticket-go') as HTMLElement;
    expect(lines[0].compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('a plain market promises no refund', () => {
    const { container } = render(<TradeTicket {...base} subject={{ context: 'LookPilot', title: 'Net revenue' }} />);
    expect(container.querySelector('.ticket-refund')).toBeNull();
    expect(container.textContent).not.toMatch(/refunded/);
  });
});
