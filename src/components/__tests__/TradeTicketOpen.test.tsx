import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { TradeTicket } from '../TradeTicket';

/**
 * The ticket opens composed, and selling is a tab on it
 * (docs/ui-conventions.md, "The ticket", revised 2026-09-09; owner asks the
 * same day: "the bet dialog should start like this" with a side already
 * chosen at 0 cr, and "could sell be possible from there as well? just like
 * its in kalshi").
 *
 * The ticket is the floor's right rail now, on screen before anyone has
 * decided anything, so an untouched one that asks for a side first spends the
 * reader's first look on a question the page could answer itself.
 */
const base = {
  probability: 0.2,
  liquidity: 500,
  positions: [],
  onTrade: async () => {},
  onSell: async () => {},
  balance: 10_000,
  unit: '$',
  consensus: 100_000,
  rangeMin: 0,
  rangeMax: 500_000,
};

const held = {
  direction: 'higher' as const,
  shares: 40,
  totalCost: 25,
};

describe('the ticket opens composed', () => {
  test('a side is already chosen, at nothing, with the whole composer on screen', () => {
    const { container } = render(<TradeTicket {...base} />);
    const sides = screen.getByRole('group', { name: 'Direction' });
    const higher = within(sides).getByRole('button', { name: /Higher/ });
    expect(higher.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Credits to spend')).toBeTruthy();
    // The whole composer, which since 2026-09-09 means the slider and its
    // ends rather than a range bar: nothing is pictured before a stake.
    expect(container.querySelector('.ticket-slider')).toBeTruthy();
    expect(container.querySelector('.ticket-slider-ends')).toBeTruthy();
    const go = screen.getByRole('button', { name: /^Bet 0 cr on Higher$/ }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
  });

  test('the other side is one press, and the confirm follows it', () => {
    render(<TradeTicket {...base} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Direction' })).getByRole('button', { name: /Lower/ }));
    expect(screen.getByRole('button', { name: /^Bet 0 cr on Lower$/ })).toBeTruthy();
  });

  test('an amount arms the confirm', () => {
    render(<TradeTicket {...base} />);
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '40' } });
    const go = screen.getByRole('button', { name: /^Bet 40 cr on Higher$/ }) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
  });

  test('nothing asks the reader to pick a side any more', () => {
    render(<TradeTicket {...base} />);
    expect(screen.queryByText(/Pick a side/i)).toBeNull();
  });
});

describe('selling is a tab on the ticket', () => {
  test('Buy and Sell are the ticket\u2019s two tabs, Buy first', () => {
    render(<TradeTicket {...base} positions={[held]} />);
    const tabs = screen.getByRole('group', { name: 'Buy or sell' });
    const names = [...tabs.querySelectorAll('button')].map(b => b.textContent);
    expect(names).toEqual(['Buy', 'Sell']);
    expect(within(tabs).getByRole('button', { name: 'Buy' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('Sell shows what is held and what it fetches, and Buy is not on screen', () => {
    const { container } = render(<TradeTicket {...base} positions={[held]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    expect(container.querySelector('.ticket-pos')).toBeTruthy();
    expect(screen.queryByLabelText('Credits to spend')).toBeNull();
    // The row says what it is worth; pressing its Sell opens the amount and
    // the one confirm, exactly as the position panel's did.
    expect(screen.getByText('Worth now')).toBeTruthy();
    fireEvent.click(
      within(container.querySelector('.ticket-pos-head') as HTMLElement).getByRole('button', { name: 'Sell' }),
    );
    expect(screen.getByText(/^Sell all for/)).toBeTruthy();
  });

  test('selling calls back with the position and the shares', async () => {
    const sold: unknown[] = [];
    render(<TradeTicket {...base} positions={[held]} onSell={async (...a: unknown[]) => void sold.push(a)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    const { container } = render(<div />);
    void container;
    fireEvent.click(
      within(document.querySelector('.ticket-pos-head') as HTMLElement).getByRole('button', { name: 'Sell' }),
    );
    fireEvent.click(screen.getByText(/^Sell all for/));
    expect(sold).toHaveLength(1);
  });

  test('holding nothing, Sell says so instead of showing a dead control', () => {
    render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    expect(screen.getByText(/nothing to sell/i)).toBeTruthy();
    expect(screen.queryByText(/^Sell all for/)).toBeNull();
  });

  test('a manage-mode ticket opens on Sell', () => {
    render(<TradeTicket {...base} positions={[held]} manageMode />);
    const tabs = screen.getByRole('group', { name: 'Buy or sell' });
    expect(within(tabs).getByRole('button', { name: 'Sell' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the tabs come first, and the price mode belongs to Buy', () => {
  /**
   * Found on the branch preview, 2026-09-09: the Sell tab's own content
   * rendered ABOVE the tab row that selects it, and the Quick/Limit toggle
   * stayed on screen while selling, where there is no order to price.
   */
  const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  test('the Sell tab renders under the tabs, never above them', () => {
    const { container } = render(<TradeTicket {...base} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    const tabs = container.querySelector('.ticket-tabs') as Element;
    const invite = container.querySelector('.ticket-invite') as Element;
    expect(invite).toBeTruthy();
    expect(follows(tabs, invite)).toBe(true);
  });

  test('a held position also renders under the tabs', () => {
    const { container } = render(<TradeTicket {...base} positions={[held]} manageMode />);
    const tabs = container.querySelector('.ticket-tabs') as Element;
    const rows = container.querySelector('.ticket-pos') as Element;
    expect(rows).toBeTruthy();
    expect(follows(tabs, rows)).toBe(true);
  });

  test('Quick and Limit are gone on the Sell tab', () => {
    render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    expect(screen.getByRole('button', { name: 'Quick' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    expect(screen.queryByRole('button', { name: 'Quick' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Limit' })).toBeNull();
  });
});

describe('one rule of chrome', () => {
  /**
   * The rail is 293px wide (docs/ui-conventions.md, "The ticket": "The card
   * carries ONE rule of chrome"). Viktor, 2026-09-09, of the card that had
   * four rows of it and an unstyled tab row: "wtf is this".
   */
  const css = () => {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(dirname(dirname(here)), 'style.css'), 'utf8');
  };
  const rule = (sel: string) => {
    const m = css().match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : null;
  };

  test('the tab row is a rule, and the chosen tab is underlined', () => {
    expect(rule('.ticket-tabs')).toMatch(/border-bottom/);
    expect(rule('.ticket-tab')).toBeTruthy();
    expect(rule('.ticket-tab.is-active')).toMatch(/border-bottom/);
  });

  test('the two sides are one 50/50 row at the card&rsquo;s full width', () => {
    const seg = rule('.ticket-seg');
    expect(seg).toMatch(/grid-template-columns:\s*1fr 1fr/);
    expect(seg).not.toMatch(/margin:\s*0 auto/);
  });

  test('the order type rides the tab row, not a row of its own', () => {
    const { container } = render(<TradeTicket {...base} onPlaceLimit={async () => {}} />);
    const tabs = container.querySelector('.ticket-tabs') as HTMLElement;
    expect(tabs.querySelector('.ticket-mode')).toBeTruthy();
    expect(container.querySelector('.ticket-head .ticket-mode')).toBeNull();
  });

  test('nothing closes the ticket, because the rail draws it again', () => {
    const { container } = render(<TradeTicket {...base} />);
    expect(container.querySelector('.ticket-close')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});

describe('the ticket names its own subject', () => {
  /**
   * Kalshi carries the event and the subject inside the card, between the
   * BUY/SELL row and the side prices. Ours had a "YOUR TRADE" label, a line
   * of prose and a hairline stranded ABOVE the card (owner report
   * 2026-09-09: "it looks super weird").
   */
  test('the subject sits under the tab rule, context quiet and title bold', () => {
    const { container } = render(
      <TradeTicket {...base} subject={{ context: 'LookPilot · settles 30 Sep', title: 'Net revenue, this month' }} />,
    );
    const subject = container.querySelector('.ticket-subject') as HTMLElement;
    expect(subject).toBeTruthy();
    expect(subject.querySelector('.ticket-subject-ctx')?.textContent).toBe('LookPilot · settles 30 Sep');
    expect(subject.querySelector('.ticket-subject-title')?.textContent).toBe('Net revenue, this month');
    const tabs = container.querySelector('.ticket-tabs') as Element;
    const sides = container.querySelector('.ticket-seg') as Element;
    expect(tabs.compareDocumentPosition(subject) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(subject.compareDocumentPosition(sides) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('a ticket with no subject draws no empty block', () => {
    const { container } = render(<TradeTicket {...base} />);
    expect(container.querySelector('.ticket-subject')).toBeNull();
  });
});

describe('the stake is one group, and nothing is pictured before a bet', () => {
  test('the slider says what its own ends are, in credits', () => {
    render(<TradeTicket {...base} />);
    expect(screen.getByText('1 cr')).toBeTruthy();
    expect(screen.getByText(/10k cr, all you have/)).toBeTruthy();
  });

  test('at 0 cr nothing is pictured: no range bar, no payoff line', () => {
    const { container } = render(<TradeTicket {...base} />);
    expect(container.querySelector('.pay')).toBeNull();
    expect(container.querySelector('.scale')).toBeNull();
  });

  test('a stake draws the payoff line', () => {
    const { container } = render(<TradeTicket {...base} />);
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '250' } });
    expect(container.querySelector('.scale')).toBeTruthy();
  });

  test('a side pill quotes its ceiling compactly, so the pill is one line', () => {
    // liquidity 5,000 at 20c: 8,047 cr exact, "8k cr" compact.
    render(<TradeTicket {...base} liquidity={5_000} />);
    const sides = screen.getByRole('group', { name: 'Direction' });
    const higher = within(sides).getByRole('button', { name: /Higher/ }).textContent ?? '';
    expect(higher).toMatch(/up to [\d.]+k cr/);
    expect(higher).not.toMatch(/\d,\d{3}/);
  });
});

describe('the sell panel pictures the sale', () => {
  const held = { direction: 'higher' as const, shares: 40, totalCost: 25 };

  const openSell = (container: HTMLElement) =>
    fireEvent.click(
      within(container.querySelector('.ticket-pos-head') as HTMLElement).getByRole('button', { name: 'Sell' }),
    );

  test('the position states what it cost and what it is worth', () => {
    render(<TradeTicket {...base} positions={[held]} manageMode />);
    expect(screen.getByText('You paid')).toBeTruthy();
    expect(screen.getByText('Worth now')).toBeTruthy();
    expect(screen.getByText(/40\.0 shares/)).toBeTruthy();
  });

  test('no settlement payoff line on Sell: it prices a bet nobody is placing', () => {
    const { container } = render(<TradeTicket {...base} positions={[held]} manageMode />);
    expect(container.querySelector('.pay')).toBeNull();
    expect(container.querySelector('.scale')).toBeNull();
  });

  test('opening the sell panel shows what you get and the profit or loss', () => {
    const { container } = render(<TradeTicket {...base} positions={[held]} manageMode />);
    openSell(container);
    expect(screen.getByText('You get')).toBeTruthy();
    expect(screen.getByText('Profit / loss')).toBeTruthy();
    expect(screen.getByText('Selling')).toBeTruthy();
  });

  test('the sell confirm is ink: selling is not a direction', () => {
    const { container } = render(<TradeTicket {...base} positions={[held]} manageMode />);
    openSell(container);
    const go = screen.getByRole('button', { name: /^Sell all for/ });
    expect(go.className).toContain('ticket-go--ink');
    expect(go.className).not.toMatch(/ticket-go--(higher|lower)/);
  });
});

describe('the sell size is a size, not a direction', () => {
  const held = { direction: 'lower' as const, shares: 1_194, totalCost: 1_780 };

  test('the size slider wears no direction colour', () => {
    const { container } = render(<TradeTicket {...base} positions={[held]} manageMode />);
    fireEvent.click(
      within(container.querySelector('.ticket-pos-head') as HTMLElement).getByRole('button', { name: 'Sell' }),
    );
    const slider = container.querySelector('.ticket-sell-panel .ticket-slider') as HTMLElement;
    expect(slider.className).not.toMatch(/ticket-slider--(higher|lower)/);
  });

  test('the size row is short enough not to wrap at 293px', () => {
    const { container } = render(<TradeTicket {...base} positions={[held]} manageMode />);
    fireEvent.click(
      within(container.querySelector('.ticket-pos-head') as HTMLElement).getByRole('button', { name: 'Sell' }),
    );
    // "1,194 of 1,194", not "1,194 of 1,194 shares": the head row above it
    // already says shares.
    expect(screen.getByText('1,194 of 1,194')).toBeTruthy();
  });

  test('the balance end of the stake slider is compact', () => {
    render(<TradeTicket {...base} balance={946_418} />);
    expect(screen.getByText(/946\.4k cr, all you have/)).toBeTruthy();
  });
});
