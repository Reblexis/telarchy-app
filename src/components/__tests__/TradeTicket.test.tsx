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
    // The answer is the payoff line: what the bet is worth wherever the
    // number lands, and no rows saying the same thing in prose.
    expect(screen.getByLabelText('Bet the market to this value in $')).toBeTruthy();
    expect(screen.getByLabelText('What this bet is worth at settlement')).toBeTruthy();
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
    // buys 312.5 shares. The scale prices the fill, not the walk: nothing
    // at the bottom of the range, 312.5 credits at the top.
    // The limit breaks even at 8% of the range, close enough to the floor
    // that the floor stop gives way to it.
    const worth = Array.from(container.querySelectorAll('.pay-stop b')).map(e => e.textContent ?? '');
    expect(worth[0]).toBe('0 cr');
    expect(worth[worth.length - 1]).toBe('+288 cr');
  });

  test('a lower bet is worth most at the bottom of the range', () => {
    const { container } = render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByText('Lower'));
    const worth = Array.from(container.querySelectorAll('.pay-stop b')).map(e => e.textContent ?? '');
    expect(worth[0]?.startsWith('+')).toBe(true);
    expect(worth[worth.length - 1]).toBe('-25 cr');
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

  /** Where a mark sits on the track, as a percentage of the range. */
  const at = (container: HTMLElement, cls: string): number => {
    const el = container.querySelector(`.pay-mark--${cls}`) as HTMLElement | null;
    return el === null ? Number.NaN : parseFloat(el.style.left);
  };
  /** The settlement values the scale prices, and what the bet is worth at each. */
  const scale = (container: HTMLElement): Array<[string, number]> =>
    Array.from(container.querySelectorAll('.pay-stop')).map(d => [
      d.querySelector('u')?.textContent ?? '',
      Number((d.querySelector('b')?.textContent ?? '').replace(/[+,]|\s*cr$/g, '')),
    ]);
  /** Where each stop sits along the range, as a percentage. */
  const stopsAt = (container: HTMLElement): number[] =>
    Array.from(container.querySelectorAll('.pay-stop')).map(d => Number((d as HTMLElement).dataset.at));

  test('an untouched ticket draws the range and marks only the market', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    expect(container.querySelector('.pay-ends')?.textContent).toContain('$500,000');
    expect(container.querySelectorAll('.pay-mark')).toHaveLength(1);
    expect(at(container, 'now')).toBeCloseTo(50, 5);
    expect(container.querySelector('.pay-stop')).toBeNull();
  });

  test('the track replaces the payout sentence inside the ticket', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    expect(container.querySelector('.pay-track')).toBeTruthy();
    expect(container.textContent).not.toContain('A share pays');
  });

  test('THE RULE: a bet breaks even SHORT of the value it pushes the market to', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(at(container, 'now')).toBeLessThan(at(container, 'be-higher'));
    expect(at(container, 'be-higher')).toBeLessThan(at(container, 'push'));
  });

  test('THE RULE, mirrored: a lower bet breaks even ABOVE where it pushes the market', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Lower'));
    expect(at(container, 'now')).toBeGreaterThan(at(container, 'be-lower'));
    expect(at(container, 'be-lower')).toBeGreaterThan(at(container, 'push'));
  });

  test('the scale prices the bet at the ends, the quarters, and the break-even', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    // Break-even lands at 52.9%, so the halfway quarter gives way to it.
    expect(scale(container).map(c => c[0])).toEqual(['$0', '$125k', '$265k', '$375k', '$500k']);
  });

  test('at the bottom of the range a higher bet loses exactly what it spent', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(scale(container)[0][1]).toBe(-25);
  });

  test('at the top of the range a share pays a credit, and the scale says so', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    // 25 cr at p = 0.5 with b = 200 buys 47.2 shares, worth 47.2 at the top.
    expect(scale(container)[4][1]).toBeCloseTo(22.2, 0);
  });

  test('THE RULE again, in money: everything left of the break-even loses', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const rows = scale(container);
    const ats = stopsAt(container);
    const zero = rows.findIndex(r => r[1] === 0);
    expect(zero).toBeGreaterThan(0);
    for (let i = 0; i < rows.length; i++) {
      if (i < zero) expect(rows[i][1]).toBeLessThan(0);
      if (i > zero) expect(rows[i][1]).toBeGreaterThan(0);
    }
    expect(ats[zero]).toBeCloseTo(at(container, 'be-higher'), 5);
  });

  test('every number on the scale says cr, so it reads as money and not as a value', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const worth = Array.from(container.querySelectorAll('.pay-stop b')).map(e => e.textContent ?? '');
    expect(worth.length).toBeGreaterThanOrEqual(4);
    for (const w of worth) expect(w.endsWith(' cr')).toBe(true);
  });

  test('the break-even is a STOP like any other, not a note beside them', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const zero = scale(container).filter(s => s[1] === 0);
    expect(zero).toHaveLength(1);
    // And it sits exactly on the break-even mark, like every other stop sits
    // on its own value.
    const i = scale(container).findIndex(s => s[1] === 0);
    expect(stopsAt(container)[i]).toBeCloseTo(at(container, 'be-higher'), 5);
  });

  test('every stop is marked on the track at the value it names', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const ticks = Array.from(container.querySelectorAll('.pay-tick')).map(e =>
      parseFloat((e as HTMLElement).style.left),
    );
    expect(ticks).toEqual(stopsAt(container));
  });

  test('a stop label sits over its own tick, not centred in a column of its own', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const els = Array.from(container.querySelectorAll('.pay-stop')) as HTMLElement[];
    const middle = els.filter(e => Number(e.dataset.at) > 25 && Number(e.dataset.at) < 75);
    expect(middle.length).toBeGreaterThan(0);
    for (const e of middle) {
      expect(parseFloat(e.style.left)).toBeCloseTo(Number(e.dataset.at), 5);
      expect(e.style.transform).toBe('translateX(-50%)');
    }
  });

  test('the stops at the ends pin inside the card instead of hanging off it', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const els = Array.from(container.querySelectorAll('.pay-stop')) as HTMLElement[];
    expect(els[0].style.left).toBe('0px');
    expect(els[els.length - 1].style.right).toBe('0px');
  });

  test('no two stops crowd each other, whatever the break-even is', () => {
    for (const p of [0.02, 0.2, 0.37, 0.5, 0.63, 0.9, 0.98]) {
      const { container, unmount } = render(<TradeTicket {...payBase} probability={p} liquidity={100_000} />);
      fireEvent.click(screen.getByText('Higher'));
      const ats = stopsAt(container);
      for (let i = 1; i < ats.length; i++) expect(ats[i] - ats[i - 1]).toBeGreaterThanOrEqual(13);
      expect(ats.length).toBeGreaterThanOrEqual(3);
      expect(ats.length).toBeLessThanOrEqual(5);
      unmount();
    }
  });

  test('an untouched ticket has no stops to price', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    expect(container.querySelector('.pay-stop')).toBeNull();
  });

  test('the winning stretch runs from the break-even to the side own end of the range', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const win = container.querySelector('.pay-win') as HTMLElement;
    expect(win.style.right).toBe('0%');
    expect(parseFloat(win.style.left)).toBeCloseTo(at(container, 'be-higher'), 5);
  });

  test('the four rows the picture replaced are gone', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    for (const gone of ['New value', 'Wins above', 'Wins below', 'Up to', 'beyond']) {
      expect(container.textContent).not.toContain(gone);
    }
  });

  test('the value the bet lands on is still typeable, now on the picture', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const target = screen.getByLabelText('Bet the market to this value in $');
    expect(container.querySelector('.pay-new')?.contains(target)).toBe(true);
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '400000' } });
    expect(screen.getByText(/Bet to \$400,000, up to \d+ cr/)).toBeTruthy();
  });

  test('the caption names the value rather than a verb nobody has met', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(container.querySelector('.pay-new-k')?.textContent).toBe('new value');
    expect(container.textContent).not.toContain('push');
  });

  test('the unit sits against its number, with no gap to read as a space', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    // The number is an input, so the unit is the only text beside it: any
    // stray whitespace node here renders as "$  279,376".
    const v = container.querySelector('.pay-new-v') as HTMLElement;
    expect(v.textContent).toBe('$');
    // 25 cr at p = 0.5 with b = 200 leaves the market at $279,376.
    expect((v.querySelector('input') as HTMLInputElement).value).toBe('279,376');
  });

  test('the current value is annotated too, on its own mark', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const now = container.querySelector('.pay-now span') as HTMLElement;
    expect(now.textContent).toBe('now $250,000');
    expect(parseFloat(now.style.left)).toBeCloseTo(at(container, 'now'), 5);
  });

  test('an untouched ticket annotates the market it is showing', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    expect(container.querySelector('.pay-now span')?.textContent).toBe('now $250,000');
    expect(container.querySelector('.pay-new')).toBeNull();
  });

  test('the two annotations never share a row, so they cannot collide', () => {
    // A one credit bet barely moves the price, which is exactly when a pair
    // of labels centred on their own marks would sit on top of each other.
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '1' } });
    expect(Math.abs(at(container, 'now') - at(container, 'push'))).toBeLessThan(1);
    const newRow = container.querySelector('.pay-new') as HTMLElement;
    const nowRow = container.querySelector('.pay-now') as HTMLElement;
    expect(newRow.contains(nowRow)).toBe(false);
    expect(nowRow.contains(newRow)).toBe(false);
    // One positioned label per row, so there is nothing for either to hit.
    expect(newRow.querySelectorAll(':scope > span')).toHaveLength(1);
    expect(nowRow.querySelectorAll(':scope > span')).toHaveLength(1);
  });

  test('the current-value label pins inside the card at the ends of the range', () => {
    const { container } = render(<TradeTicket {...payBase} consensus={5_000} />);
    const now = container.querySelector('.pay-now span') as HTMLElement;
    expect(now.style.left).toBe('0px');
    expect(now.style.transform).toBe('');
  });

  test('a resting order pushes nothing, so it draws no push mark', () => {
    const { container } = render(<TradeTicket {...payBase} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });
    expect(container.querySelector('.pay-mark--push')).toBeNull();
    expect(at(container, 'be-higher')).toBeCloseTo(8, 5);
  });

  test('a market with no range keeps the old fact rows instead', () => {
    const { container } = render(<TradeTicket {...payBase} rangeMin={undefined} rangeMax={undefined} />);
    fireEvent.click(screen.getByText('Higher'));
    expect(container.querySelector('.pay-track')).toBeNull();
    expect(container.querySelector('.pay-stop')).toBeNull();
  });

  test('a stake of nothing prices nothing', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '' } });
    expect(container.querySelectorAll('.pay-mark')).toHaveLength(1);
    expect(container.querySelector('.pay-stop')).toBeNull();
  });

  test('a held position is marked at what it paid, and priced the same way', () => {
    // 100 shares for 20 cr breaks even at $100,000 on a $0..$500k range, and
    // is worth 100 credits at the top, so 80 more than it cost.
    const { container } = render(
      <TradeTicket
        {...payBase}
        manageMode
        initialDir="higher"
        positions={[{ direction: 'higher', shares: 100, totalCost: 20 }]}
      />,
    );
    expect(at(container, 'be-higher')).toBeCloseTo(20, 5);
    expect(container.querySelector('.pay-mark--push')).toBeNull();
    const rows = scale(container);
    expect(rows[0][1]).toBe(-20);
    expect(rows[4][1]).toBe(80);
  });
});
