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
    const { container } = render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(screen.getByLabelText('Credits to spend')).toBeTruthy();
    expect(screen.getByText('Quick')).toBeTruthy();
    expect(screen.getByText('Limit')).toBeTruthy();
    expect(screen.getByText('Bet 25 cr on Higher')).toBeTruthy();
    // The answer is the payoff line: what the bet is worth wherever the
    // number lands, and no rows saying the same thing in prose.
    expect(screen.getByLabelText('Bet the market to this value in $')).toBeTruthy();
    expect(container.querySelector('.pay-curve')).toBeTruthy();
  });

  test('the Limit toggle stays hidden when the market cannot take orders', () => {
    render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(screen.queryByText('Limit')).toBeNull();
  });
});

describe('win facts', () => {
  test('a limit order breaks even exactly at its own price', () => {
    const { container } = render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });

    // Filled at $40,000 the average price is 40000/500000 = 0.08, so 25 cr
    // buys 312.5 shares. The line prices the fill, not the walk: the whole
    // stake gone at the bottom of the range, 287.5 credits up at the top,
    // and the crossing exactly at the limit, which is the appeal of naming
    // your own price.
    const curve = container.querySelector('.pay-curve') as HTMLElement;
    expect(Number(curve.dataset.from)).toBeCloseTo(-25, 5);
    expect(Number(curve.dataset.to)).toBeCloseTo(287.5, 3);
    expect(Number((container.querySelector('.pay-be') as HTMLElement).dataset.at)).toBeCloseTo(8, 5);
  });

  test('a lower bet is worth most at the bottom of the range', () => {
    const { container } = render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByText('Lower'));
    const curve = container.querySelector('.pay-curve') as HTMLElement;
    expect(Number(curve.dataset.from)).toBeGreaterThan(0);
    expect(Number(curve.dataset.to)).toBeCloseTo(-25, 5);
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

  test('the track replaces the payout sentence inside the ticket', () => {
    const { container } = render(<TradeTicket {...base} />);
    expect(container.textContent).not.toContain('A share pays');
    expect(container.querySelector('.pay-ends')?.textContent).toContain('$500,000');
  });

  test('without a range there is no track, but the quotes stand', () => {
    const { container } = render(<TradeTicket {...base} rangeMin={undefined} rangeMax={undefined} />);
    expect(screen.getAllByText('up to 139 cr')).toHaveLength(2);
    expect(container.querySelector('.pay-track')).toBeNull();
  });

  test('the quotes stay on the pills once a side is picked', () => {
    render(<TradeTicket {...base} probability={0.14} />);
    fireEvent.click(screen.getByText('Higher'));
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
      passes an unrelated consensus, and this line draws both. */
  const payBase = { ...base, consensus: 250_000 };

  const num = (el: Element | null, attr: string): number => Number((el as HTMLElement)?.dataset?.[attr]);
  /** Where a guide sits along the range, as a percentage. */
  const guide = (container: HTMLElement, which: string): number =>
    num(container.querySelector(`.pay-guide--${which}`), 'at');
  /** Give the plot a width, since jsdom measures everything as zero. */
  const plotOf = (container: HTMLElement): HTMLElement => {
    const plot = container.querySelector('.pay-plot') as HTMLElement;
    plot.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 84 }) as DOMRect;
    return plot;
  };
  const hoverAt = (container: HTMLElement, x: number) =>
    fireEvent.pointerMove(plotOf(container), { clientX: x, clientY: 40 });

  test('an untouched ticket keeps the plain range bar: there is no payoff to draw', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    expect(container.querySelector('.pay-track')).toBeTruthy();
    expect(container.querySelector('.pay-plot')).toBeNull();
    expect(container.querySelector('.pay-ends')?.textContent).toContain('$500,000');
  });

  test('a composed bet is DRAWN, because a linear payout is a straight line', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const curve = container.querySelector('.pay-curve') as HTMLElement;
    // 25 cr at p = 0.5, b = 200: worthless at the bottom of the range (the
    // whole stake gone) and 47.2 shares at the top.
    expect(num(curve, 'from')).toBeCloseTo(-25, 5);
    expect(num(curve, 'to')).toBeCloseTo(22.22, 2);
  });

  test('THE RULE: the break-even sits between the market and where the bet leaves it', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(guide(container, 'now')).toBeLessThan(num(container.querySelector('.pay-be'), 'at'));
    expect(num(container.querySelector('.pay-be'), 'at')).toBeLessThan(guide(container, 'new'));
  });

  test('THE RULE, mirrored on a lower bet', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Lower'));
    expect(guide(container, 'now')).toBeGreaterThan(num(container.querySelector('.pay-be'), 'at'));
    expect(num(container.querySelector('.pay-be'), 'at')).toBeGreaterThan(guide(container, 'new'));
  });

  test('the line crosses zero exactly at the break-even, which is what makes it readable', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const be = container.querySelector('.pay-be') as HTMLElement;
    // 264,680 of a 500,000 range.
    expect(num(be, 'at')).toBeCloseTo(52.936, 2);
    expect(num(be, 'worth')).toBe(0);
  });

  test('HOVERING THE PLOT SAYS WHAT THE BET IS WORTH THERE', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    hoverAt(container, 100); // a quarter along a 400px plot: $125,000
    const read = container.querySelector('.pay-read') as HTMLElement;
    expect(read.textContent).toContain('$125,000');
    // 47.2266 shares * 0.25 - 25 spent = -13.2 credits.
    expect(read.textContent).toContain('-13 cr');
  });

  test('the readout follows the pointer', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    hoverAt(container, 100);
    expect(num(container.querySelector('.pay-read'), 'at')).toBeCloseTo(25, 5);
    hoverAt(container, 300);
    expect(num(container.querySelector('.pay-read'), 'at')).toBeCloseTo(75, 5);
    expect(container.querySelector('.pay-read')?.textContent).toContain('+10 cr');
  });

  test('the readout sits on the far side of zero, so it never covers the line', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    hoverAt(container, 380); // deep in profit: the readout drops below zero
    expect((container.querySelector('.pay-read') as HTMLElement).dataset.side).toBe('under');
    hoverAt(container, 20); // deep in loss: it rises above
    expect((container.querySelector('.pay-read') as HTMLElement).dataset.side).toBe('over');
  });

  test('the standing labels stand down while the pointer is reading', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(container.querySelector('.pay-plot.is-reading')).toBeNull();
    hoverAt(container, 100);
    expect(container.querySelector('.pay-plot.is-reading')).toBeTruthy();
  });

  test('leaving the plot puts the readout away', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    hoverAt(container, 100);
    fireEvent.pointerLeave(container.querySelector('.pay-plot') as HTMLElement);
    expect(container.querySelector('.pay-read')).toBeNull();
  });

  test('a plot with no width on screen reads out nothing rather than dividing by it', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    // jsdom's own zero-width rect, unstubbed.
    fireEvent.pointerMove(container.querySelector('.pay-plot') as HTMLElement, { clientX: 40 });
    expect(container.querySelector('.pay-read')).toBeNull();
  });

  test('the two ends of the line are labelled with what they pay', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(container.querySelector('.pay-y--lo')?.textContent).toBe('-25 cr');
    expect(container.querySelector('.pay-y--hi')?.textContent).toBe('+22 cr');
  });

  test('the axis names both ends of the range and the break-even between them', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const axis = Array.from(container.querySelectorAll('.pay-axis span')).map(e => e.textContent);
    expect(axis).toEqual(['$0', '$265k', '$500k']);
  });

  test('the current value is annotated on its own guide', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const now = container.querySelector('.pay-now') as HTMLElement;
    expect(now.textContent).toBe('now $250,000');
    expect(num(now, 'at')).toBeCloseTo(guide(container, 'now'), 5);
  });

  test('the value the bet lands on is still typeable, on its own guide', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const target = screen.getByLabelText('Bet the market to this value in $');
    expect((container.querySelector('.pay-new') as HTMLElement).contains(target)).toBe(true);
    expect(container.querySelector('.pay-new-k')?.textContent).toBe('new value');
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '400000' } });
    expect(screen.getByText(/Bet to \$400,000, up to \d+ cr/)).toBeTruthy();
  });

  test('a resting order draws its payoff too, and has no new value to guide', () => {
    const { container } = render(<TradeTicket {...payBase} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });
    expect(container.querySelector('.pay-curve')).toBeTruthy();
    expect(container.querySelector('.pay-guide--new')).toBeNull();
    expect(num(container.querySelector('.pay-be'), 'at')).toBeCloseTo(8, 5);
  });

  test('a market with no range keeps the old fact rows instead', () => {
    const { container } = render(<TradeTicket {...payBase} rangeMin={undefined} rangeMax={undefined} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(container.querySelector('.pay-plot')).toBeNull();
    expect(container.querySelector('.pay-track')).toBeNull();
  });

  test('a stake of nothing draws nothing', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '' } });
    expect(container.querySelector('.pay-plot')).toBeNull();
    expect(container.querySelector('.pay-track')).toBeTruthy();
  });

  test('a held position is drawn at what it paid, with no new value to guide', () => {
    const { container } = render(
      <TradeTicket
        {...payBase}
        manageMode
        initialDir="higher"
        positions={[{ direction: 'higher', shares: 100, totalCost: 20 }]}
      />,
    );
    // 100 shares for 20 cr: worthless at the bottom, 80 up at the top.
    expect(num(container.querySelector('.pay-curve'), 'from')).toBeCloseTo(-20, 5);
    expect(num(container.querySelector('.pay-curve'), 'to')).toBeCloseTo(80, 5);
    expect(num(container.querySelector('.pay-be'), 'at')).toBeCloseTo(20, 5);
    expect(container.querySelector('.pay-guide--new')).toBeNull();
  });
});
