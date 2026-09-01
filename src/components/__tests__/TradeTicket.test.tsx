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
    expect(container.querySelector('.scale')).toBeTruthy();
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
    // buys 312.5 shares: the whole stake gone at the bottom of the range
    // and 287.5 credits up at the top, breaking even at the limit itself.
    const cr = Array.from(container.querySelectorAll('.scale-cr > span')).map(e => e.textContent ?? '');
    expect(cr[0]).toBe('-25 cr');
    expect(cr[cr.length - 1]).toBe('+288 cr');
  });

  test('a lower bet is worth most at the bottom of the range', () => {
    const { container } = render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByText('Lower'));
    const cr = Array.from(container.querySelectorAll('.scale-cr > span')).map(e => e.textContent ?? '');
    expect(cr[0]?.startsWith('+')).toBe(true);
    expect(cr[cr.length - 1]).toBe('-25 cr');
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
    const { container } = render(<TradeTicket {...payBase} />);
    expect(container.querySelector('.pay-track')).toBeTruthy();
    expect(container.querySelector('.scale')).toBeNull();
  });

  test('the line carries two rows and nothing else: credits over it, values under', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
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
    fireEvent.click(screen.getByText('Higher'));
    const s = stops(container);
    expect(s[0].at).toBe(0);
    expect(s[s.length - 1].at).toBe(100);
    expect(s[s.length - 1].credits.startsWith('+')).toBe(true);
    expect(s[0].credits.startsWith('-')).toBe(true);
  });

  test('the break-even is a stop, and it is the one that reads 0 cr', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const zero = stops(container).filter(s => s.credits === '0 cr');
    expect(zero).toHaveLength(1);
    expect(zero[0].at).toBeCloseTo(52.94, 1);
  });

  test('no two stops crowd: every pair is at least a seventh of the range apart', () => {
    for (const p of [0.02, 0.2, 0.5, 0.7, 0.86, 0.97]) {
      const { container, unmount } = render(<TradeTicket {...payBase} probability={p} liquidity={800} />);
      fireEvent.click(screen.getByText('Higher'));
      const at = stops(container).map(s => s.at);
      expect(at.length).toBeGreaterThanOrEqual(3);
      expect(at.length).toBeLessThanOrEqual(5);
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(13);
      unmount();
    }
  });

  test('a stop near an edge leans away from it rather than over its neighbour', () => {
    const { container } = render(<TradeTicket {...payBase} probability={0.86} liquidity={800} />);
    fireEvent.click(screen.getByText('Higher'));
    const near = Array.from(container.querySelectorAll('.scale-val > span')).find(
      e => Number((e as HTMLElement).dataset.at) > 82 && Number((e as HTMLElement).dataset.at) < 100,
    ) as HTMLElement;
    expect(near.style.transform).toBe('translateX(-100%)');
  });

  test('the ends pin to the card, so no label hangs off it', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const els = Array.from(container.querySelectorAll('.scale-val > span')) as HTMLElement[];
    expect(els[0].style.left).toBe('0px');
    expect(els[els.length - 1].style.right).toBe('0px');
  });

  test('the rule turns colour where the bet starts paying', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const lose = container.querySelector('.rule-lose') as HTMLElement;
    expect(parseFloat(lose.style.width)).toBeCloseTo(52.94, 1);
  });

  test('THE STAKE AND THE VALUE IT BUYS ARE ONE LINE, and both are typeable', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const compose = container.querySelector('.compose') as HTMLElement;
    expect(compose.contains(screen.getByLabelText('Credits to spend'))).toBe(true);
    expect(compose.contains(screen.getByLabelText('Bet the market to this value in $'))).toBe(true);
  });

  test('typing into the value half composes a bet that lands there', () => {
    render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const target = screen.getByLabelText('Bet the market to this value in $');
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: '400000' } });
    expect(screen.getByText(/Bet to \$400,000, up to \d+ cr/)).toBeTruthy();
  });

  test('typing into the stake half goes back to spending a budget', () => {
    render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '40' } });
    expect(screen.getByText('Bet 40 cr on Higher')).toBeTruthy();
  });

  test('a market with no range draws nothing, and still takes a bet', () => {
    const { container } = render(<TradeTicket {...payBase} rangeMin={undefined} rangeMax={undefined} />);
    fireEvent.click(screen.getByText('Higher'));
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
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '' } });
    expect(container.querySelector('.scale')).toBeNull();
  });

  test('THE INTERIOR STOPS NEVER MOVE, WHATEVER THE STAKE', () => {
    // They used to be spaced off the break-even, so every drag of the
    // slider slid every label sideways (owner, 2026-09-01: "the numbers are
    // kind of twitching when i move the slider"). They sit at fixed thirds
    // now: an interior stop is either at its third or not drawn, and the
    // only label that travels is the break-even, which really is moving.
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
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
    fireEvent.click(screen.getByText('Higher'));
    for (let amount = 1; amount <= 60; amount += 1) {
      fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: String(amount) } });
      // A stake small enough can be worth under a credit at several stops,
      // so several may legitimately read "0 cr"; none may read "-0 cr".
      const all = Array.from(container.querySelectorAll('.scale-cr > span')).map(e => e.textContent ?? '');
      expect(all.some(x => x.includes('-0 cr'))).toBe(false);
    }
  });

  test('HOVERING THE LINE READS OUT THE EXACT PROFIT OR LOSS THERE', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const scale = container.querySelector('.scale') as HTMLElement;
    scale.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 40 }) as DOMRect;
    fireEvent.pointerMove(scale, { clientX: 100 });
    // A quarter along the range is $125,000; 25 cr bought 47.2 shares, so
    // that settles at 47.2266 * 0.25 - 25 = -13 credits.
    const cur = container.querySelector('.scale-cr .scale-cursor') as HTMLElement;
    expect(cur.textContent).toBe('-13 cr');
    expect(container.querySelector('.scale-val .scale-cursor')?.textContent).toBe('$125k');
  });

  test('the readout follows the pointer and the static stops stand down', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const scale = container.querySelector('.scale') as HTMLElement;
    scale.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 40 }) as DOMRect;
    expect(container.querySelector('.scale.is-reading')).toBeNull();
    fireEvent.pointerMove(scale, { clientX: 300 });
    expect(container.querySelector('.scale.is-reading')).toBeTruthy();
    expect(Number((container.querySelector('.scale-cr .scale-cursor') as HTMLElement).dataset.at)).toBeCloseTo(75, 5);
    expect(container.querySelector('.scale-cr .scale-cursor')?.textContent).toBe('+10 cr');
  });

  test('leaving the line puts the readout away', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    const scale = container.querySelector('.scale') as HTMLElement;
    scale.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 40 }) as DOMRect;
    fireEvent.pointerMove(scale, { clientX: 100 });
    fireEvent.pointerLeave(scale);
    expect(container.querySelector('.scale-cursor')).toBeNull();
  });

  test('a line with no width on screen reads out nothing rather than dividing by it', () => {
    const { container } = render(<TradeTicket {...payBase} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.pointerMove(container.querySelector('.scale') as HTMLElement, { clientX: 40 });
    expect(container.querySelector('.scale-cursor')).toBeNull();
  });

  test('A RESTING ORDER NAMES ITS LIMIT, never a landing it will not cause', () => {
    // A resting order moves nothing until it fills, so the value the ticket
    // shows beside the stake has to be the limit itself. It used to show
    // the landing of a market buy that was not being placed.
    const { container } = render(<TradeTicket {...payBase} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('Limit'));
    const compose = container.querySelector('.compose') as HTMLElement;
    expect(compose.contains(screen.getByLabelText('Limit price in $'))).toBe(true);
    expect(screen.queryByLabelText('Bet the market to this value in $')).toBeNull();
  });

  test('and the price lives in the composer, not in a second row of its own', () => {
    const { container } = render(<TradeTicket {...payBase} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('Limit'));
    expect(container.querySelectorAll('.compose')).toHaveLength(1);
    expect(container.querySelector('.ticket-amt--price')).toBeNull();
    expect(container.querySelectorAll('.compose input')).toHaveLength(2);
  });

  test('typing the limit into the composer composes the whole instruction', () => {
    render(<TradeTicket {...payBase} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('Limit'));
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '40000' } });
    expect(screen.getByText('Buy Higher with 25 cr under $40,000')).toBeTruthy();
  });

  test('the line prices the FILL, not a walk the order never takes', () => {
    const { container } = render(<TradeTicket {...payBase} onPlaceLimit={async () => {}} />);
    fireEvent.click(screen.getByText('Higher'));
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
    fireEvent.click(screen.getByText('Higher'));
    fireEvent.click(screen.getByText('Limit'));
    // Buying higher waits for a cheaper price, so a limit above the current
    // call would fill at once: the ticket says so and draws no payoff.
    fireEvent.change(screen.getByLabelText('Limit price in $'), { target: { value: '400000' } });
    expect(container.querySelector('.scale')).toBeNull();
    expect(screen.getByText(/or it fills right now/)).toBeTruthy();
  });

  test('a held position is priced the same way, at what it actually paid', () => {
    const { container } = render(
      <TradeTicket
        {...payBase}
        manageMode
        initialDir="higher"
        positions={[{ direction: 'higher', shares: 100, totalCost: 20 }]}
      />,
    );
    const s = stops(container);
    expect(s[0].credits).toBe('-20 cr');
    expect(s[s.length - 1].credits).toBe('+80 cr');
    expect(s.find(x => x.credits === '0 cr')?.at).toBeCloseTo(20, 5);
  });
});
