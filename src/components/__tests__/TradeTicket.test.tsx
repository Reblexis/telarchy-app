import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('progressive disclosure', () => {
  test('an untouched ticket asks only for a side', () => {
    render(<TradeTicket {...base} />);
    expect(screen.getByText('Higher')).toBeTruthy();
    expect(screen.queryByLabelText('Credits to spend')).toBeNull();
    expect(screen.queryByText('Limit')).toBeNull();
  });

  test('picking a side reveals the amount, the order type, and the confirm', () => {
    render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(screen.getByLabelText('Credits to spend')).toBeTruthy();
    expect(screen.getByText('Quick')).toBeTruthy();
    expect(screen.getByText('Limit')).toBeTruthy();
    expect(screen.getByText('Bet 25 cr on Higher')).toBeTruthy();
    // The answer rows: where the market would land, where the bet starts
    // winning, and what each further step pays. Payout is linear in the
    // settled value, so breakeven + slope IS the whole payout, stated
    // without the misleading at-the-range-edge maximum.
    expect(screen.getByText('New value')).toBeTruthy();
    expect(screen.getByText('Wins above')).toBeTruthy();
    expect(screen.getByText('Each $10k beyond')).toBeTruthy();
  });

  test('the Limit toggle stays hidden when the market cannot take orders', () => {
    render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(screen.queryByText('Limit')).toBeNull();
  });
});

describe('win facts', () => {
  test('a limit order breaks even exactly at its own price', () => {
    render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });

    // Filled at $40,000 the average price is 40000/500000 = 0.08, so 25 cr
    // buys 312.5 shares: breakeven at the limit, +6.25 cr per further $10k.
    expect(screen.getByText('Once filled, wins above')).toBeTruthy();
    expect(screen.getByText('$40,000')).toBeTruthy();
    expect(screen.getByText('+6.3 cr')).toBeTruthy();
  });

  test('a lower bet wins below its breakeven', () => {
    render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByText('Lower'));
    expect(screen.getByText('Wins below')).toBeTruthy();
  });
});

describe('dialog mode', () => {
  test('initialDir opens with the side chosen and the amount visible', () => {
    render(<TradeTicket {...base} initialDir="higher" />);
    expect(screen.getByLabelText('Credits to spend')).toBeTruthy();
    expect(screen.getByText('Bet 25 cr on Higher')).toBeTruthy();
  });

  test('the X calls onClose instead of collapsing', () => {
    const onClose = vi.fn();
    render(<TradeTicket {...base} initialDir="lower" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
    // Still expanded: closing is the dialog's job, not the card's.
    expect(screen.getByLabelText('Credits to spend')).toBeTruthy();
  });
});

describe('limit mode', () => {
  test('the confirm restates the whole instruction', () => {
    render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('Limit'));
    const input = screen.getByLabelText('Limit price in $') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '40000' } });
    expect(screen.getByText('Buy Higher with 25 cr under $40,000')).toBeTruthy();
  });

  test('a limit on the wrong side of the call is refused before it is sent', () => {
    const onPlaceLimit = vi.fn(async () => {});
    render(<TradeTicket {...base} onPlaceLimit={onPlaceLimit} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('Limit'));
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
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '70000' } });
    expect(screen.getByText('Buy Lower with 25 cr over $70,000')).toBeTruthy();
  });

  test('placing sends the limit, not a market trade', async () => {
    const onTrade = vi.fn(async () => {});
    const onPlaceLimit = vi.fn(async () => {});
    render(<TradeTicket {...base} onTrade={onTrade} onPlaceLimit={onPlaceLimit} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('Limit'));
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

describe('bet amount slider', () => {
  test('a thousands balance no longer crams every sensible bet into the left edge', () => {
    render(<TradeTicket {...base} balance={23_400} />);
    fireEvent.click(screen.getByText('Higher'));
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
    fireEvent.click(screen.getByText('Higher'));
    const target = screen.getByLabelText('Bet the market to this value in $');
    // Ask for a value below the current call (base probability 0.5 maps
    // to 250k on this range): the ticket flips to Lower and prices it.
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '100000' } });
    const amountInput = screen.getByLabelText('Credits to spend') as HTMLInputElement;
    expect(Number(amountInput.value)).toBeGreaterThan(0);
    // The confirm states the landing value, because that is what the
    // placed trade (the server's targetValue mode) actually promises.
    expect(screen.getByText(/Bet to \$100,000, up to \d+ cr/)).toBeTruthy();
    expect(screen.getByText('Lower').closest('button')?.getAttribute('aria-pressed')).toBe('true');
    // And above: flips back to Higher.
    fireEvent.change(target, { target: { value: '400000' } });
    expect(screen.getByText(/Bet to \$400,000, up to \d+ cr/)).toBeTruthy();
    expect(screen.getByText('Higher').closest('button')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('an unreachable target caps the amount at the per-market maximum', () => {
    render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByText('Higher'));
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
    fireEvent.click(screen.getByText('Higher'));
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
    fireEvent.click(screen.getByText('Higher'));
    const target = screen.getByLabelText('Bet the market to this value in $');
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '300000' } });
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('Bet 40 cr on Higher'));
    await waitFor(() => expect(onTrade).toHaveBeenCalledWith('higher', 40));
    expect(onTradeTarget).not.toHaveBeenCalled();
  });

  test('picking a side after typing a target clears the target instruction', () => {
    render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByText('Higher'));
    const target = screen.getByLabelText('Bet the market to this value in $');
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '100000' } });
    expect(screen.getByText(/Bet to \$100,000/)).toBeTruthy();
    // Re-picking Higher is a manual side choice: back to a budget buy.
    fireEvent.click(screen.getByText('Higher'));
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
    fireEvent.click(screen.getByText('Lower'));
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '25' } });
    const held = landing(withPosition.container);
    withPosition.unmount();

    const flat = render(<TradeTicket {...netted} positions={[]} />);
    fireEvent.click(screen.getByText('Lower'));
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
    fireEvent.click(screen.getByText('Lower'));
    const pinned = poor.container.querySelector('input[aria-label="Bet amount slider"]') as HTMLInputElement;
    expect(pinned.value).toBe(String(SLIDER_STEPS));
    poor.unmount();

    // With the balance actually covering it, the same amount sits inside
    // the track: the ceiling moved with the balance, nothing else.
    const rich = render(<TradeTicket {...netted} balance={1000} />);
    fireEvent.click(screen.getByText('Lower'));
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
describe('the price at rest', () => {
  test('both sides carry a price before any click', () => {
    render(<TradeTicket {...base} />);
    // p = 0.5: a share of either side costs half a credit.
    expect(screen.getAllByText('50c')).toHaveLength(2);
  });

  test("the price is the market's own number, and the two sides complement", () => {
    render(<TradeTicket {...base} probability={0.14} />);
    expect(screen.getByText('14c')).toBeTruthy();
    expect(screen.getByText('86c')).toBeTruthy();
  });

  test('a price that rounds to nothing reads <1c, never 0c', () => {
    // The Telarchy revenue market really does sit at p = 0.001. "0c" would
    // say a share is free; "100c" would say the other side cannot lose.
    render(<TradeTicket {...base} probability={0.001} />);
    expect(screen.getByText('<1c')).toBeTruthy();
    expect(screen.getByText('>99c')).toBeTruthy();
    expect(screen.queryByText('0c')).toBeNull();
    expect(screen.queryByText('100c')).toBeNull();
  });

  test('the same holds at the other end of the range', () => {
    render(<TradeTicket {...base} probability={0.996} />);
    expect(screen.getByText('>99c')).toBeTruthy();
    expect(screen.getByText('<1c')).toBeTruthy();
    expect(screen.queryByText('100c')).toBeNull();
  });

  test('the price is quoted in cents, never as a percent', () => {
    // A percent would read as the chance of an event. Our payout is linear,
    // so there is no such chance to state.
    const { container } = render(<TradeTicket {...base} probability={0.14} />);
    expect(container.textContent).not.toContain('%');
  });

  test('one line says what a share pays, naming both ends of the range', () => {
    const { container } = render(<TradeTicket {...base} />);
    expect(container.textContent).toContain('$500,000');
    expect(container.textContent).toContain('$0,');
  });

  test('without a range there is no payout line, but the prices stand', () => {
    const { container } = render(<TradeTicket {...base} rangeMin={undefined} rangeMax={undefined} />);
    expect(screen.getAllByText('50c')).toHaveLength(2);
    expect(container.textContent).not.toContain('A share pays');
  });

  test('the payout line goes once a side is picked', () => {
    const { container } = render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(container.textContent).not.toContain('A share pays');
  });

  test('the prices stay on the pills once a side is picked', () => {
    render(<TradeTicket {...base} probability={0.14} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(screen.getByText('14c')).toBeTruthy();
    expect(screen.getByText('86c')).toBeTruthy();
  });

  test('manage mode quotes nothing: it has no side pills to quote', () => {
    const { container } = render(<TradeTicket {...base} manageMode initialDir="higher" />);
    expect(screen.queryByText('50c')).toBeNull();
    expect(container.textContent).not.toContain('A share pays');
  });
});
