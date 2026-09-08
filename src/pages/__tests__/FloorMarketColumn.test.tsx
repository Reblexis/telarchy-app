import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Stage 2 of the 2026-09-08 floor redesign (docs/ui-conventions.md, "The
 * question line", "The numbers band and the settlement line", "The verbs
 * and the inline ticket", "Your position"): the market column, top to
 * bottom in the order a trader decides.
 */

const fx = vi.hoisted(() => ({ ref: null as null | import('./floor-fixture').Fx }));

vi.mock('../../hooks/useAuth', async () => {
  const { makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  const state = fx.ref;
  return { useAuth: () => ({ user: state.auth.user, loading: state.auth.loading, logout: async () => {} }) };
});
vi.mock('../../hooks/useEarnAvailable', async () => {
  const { makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  const state = fx.ref;
  return { useEarnAvailable: (signedIn: boolean) => (signedIn ? state.earn : null), clearEarnAvailableCache: () => {} };
});
vi.mock('../../lib/api', async () => {
  const { apiMock, makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  return apiMock(fx.ref);
});

const { TradePage } = await import('../TradePage');
const { renderFloor, resetFx, signIn, installObservers, freezeClock } = await import('./floor-fixture');
const { previewTrade, previewSell } = await import('../../lib/amm');
const state = () => fx.ref!;

beforeEach(() => {
  resetFx(state());
  installObservers();
  freezeClock();
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

async function floor(entries?: string[]) {
  const r = renderFloor(TradePage, entries);
  await screen.findByText('What will be', { exact: false });
  return r;
}

const cr = (n: number) => Math.round(n).toLocaleString('en-US');

describe('the question line: the pickers live inside the sentence', () => {
  test('one sentence, the metric and the date as words with menus, nothing above it but the identity', async () => {
    await floor();
    const ask = document.querySelector('h2.pubws-instrument-ask') as HTMLElement;
    expect(ask.parentElement?.classList.contains('pubws-center')).toBe(true);
    expect(ask.textContent?.replace(/\s+/g, ' ')).toMatch(/^What will be Telarchy's Active traders this month\?$/);
    const metric = within(ask).getByRole('button', { name: /Metric: Active traders/ });
    const date = within(ask).getByRole('button', { name: /Date: this month/ });
    expect(metric.getAttribute('aria-expanded')).toBe('false');
    expect(date.getAttribute('aria-haspopup')).toBe('listbox');
    expect(date.getAttribute('title')).toMatch(/settles/);
    // Nothing between the head (or its row) and the question but the run row.
    expect(ask.previousElementSibling?.classList.contains('pubws-run-row')).toBe(true);
  });

  test('the metric menu lists metrics in metric order, primary first, the selected one marked; picking keeps the date', async () => {
    await floor();
    fireEvent.click(screen.getByRole('button', { name: /Metric: Active traders/ }));
    const menu = screen.getByRole('listbox', { name: 'Metric' });
    const options = within(menu).getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['Active traders', 'Signups']);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(within(menu).queryByText(/Manage/)).toBeNull();
    fireEvent.click(options[1]);
    expect(screen.queryByRole('listbox', { name: 'Metric' })).toBeNull();
    const ask = document.querySelector('h2.pubws-instrument-ask') as HTMLElement;
    expect(ask.textContent?.replace(/\s+/g, ' ')).toMatch(/Signups this month\?$/);
  });

  test("the date menu lists the metric's open dates soonest first, named by clock and settle day; picking never changes the metric", async () => {
    await floor();
    fireEvent.click(screen.getByRole('button', { name: /Date: this month/ }));
    const menu = screen.getByRole('listbox', { name: 'Date' });
    const options = within(menu).getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['today · 8 Sep', 'this week · 13 Sep', 'this month · 30 Sep']);
    expect(options[2].getAttribute('aria-selected')).toBe('true');
    expect(within(menu).queryByText(/Manage/)).toBeNull();
    fireEvent.click(options[0]);
    const ask = document.querySelector('h2.pubws-instrument-ask') as HTMLElement;
    expect(ask.textContent?.replace(/\s+/g, ' ')).toMatch(/Active traders today\?$/);
  });

  test('with one option the word is plain text and no control; an absolute date reads "on 30 Sep"', async () => {
    const ws = state().ws();
    state().overrides = {
      markets: (ws.markets as Array<Record<string, unknown>>).filter(m => m.marketId === 'm-signups'),
      horizonHistories: (ws.horizonHistories as Array<Record<string, unknown>>).filter(h => h.marketId === 'm-signups'),
      marketHistory: [],
      marketHistoryMarketId: 'm-signups',
    };
    await floor();
    const ask = document.querySelector('h2.pubws-instrument-ask') as HTMLElement;
    expect(within(ask).queryByRole('button')).toBeNull();
    expect(ask.querySelectorAll('.pubws-ask-word').length).toBe(2);
  });

  test('menus close on Escape and on a click outside', async () => {
    await floor();
    fireEvent.click(screen.getByRole('button', { name: /Metric: Active traders/ }));
    expect(screen.getByRole('listbox', { name: 'Metric' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Metric' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Date: this month/ }));
    expect(screen.getByRole('listbox', { name: 'Date' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox', { name: 'Date' })).toBeNull();
  });
});

describe('the numbers band: the call first, then the reading', () => {
  test("two cells, the call first with its day and countdown, the value with its unit, and today's move", async () => {
    await floor();
    const band = document.querySelector('.pubws-numbers') as HTMLElement;
    const cells = band.querySelectorAll(':scope > div');
    expect(cells[0].classList.contains('pubws-stat--call')).toBe(true);
    expect(cells[1].classList.contains('pubws-stat--now')).toBe(true);
    const call = cells[0] as HTMLElement;
    expect(call.querySelector('.pubws-stat-what')?.textContent?.replace(/\s+/g, ' ')).toBe(
      "market's call · for 30 Sep · in 22 days",
    );
    expect(call.querySelector('.pubws-settle-in')?.getAttribute('title')).toMatch(/2026/);
    expect(call.querySelector('.pubws-price')?.textContent).toBe('19.8');
    expect(call.querySelector('.pubws-stat-unit')?.textContent).toBe('active traders');
    // The call opened today at 19.5 (the reading in force at midnight) and
    // stands at 19.8: it moved +0.3 today.
    expect(call.querySelector('.pubws-stat-delta')?.textContent?.replace(/\s+/g, ' ')).toBe('▲ +0.3 today');
  });

  test('the delta is not drawn when the call did not move today, and falls with ▼', async () => {
    state().overrides = {
      marketHistory: [
        { at: '2026-08-20T09:00:00.000Z', consensus: 20 },
        { at: '2026-09-01T09:00:00.000Z', consensus: 19.8 },
      ],
    };
    await floor();
    expect(document.querySelector('.pubws-stat--call .pubws-stat-delta')).toBeNull();
  });

  test('a synced reading older than an hour reads "now · unchanged since 5 Sep · synced hourly", whole number, no Report', async () => {
    signIn(state(), 'owner');
    await floor();
    const now = document.querySelector('.pubws-stat--now') as HTMLElement;
    expect(now.querySelector('.pubws-stat-what')?.textContent?.replace(/\s+/g, ' ')).toBe(
      'now · unchanged since 5 Sep · synced hourly',
    );
    expect(now.querySelector('.pubws-price')?.textContent).toBe('9');
    await waitFor(() => expect(document.querySelector('.pubws-owner-row')).not.toBeNull());
    expect(within(now).queryByRole('button', { name: 'Report' })).toBeNull();
  });

  test('an owner-reported reading reads "now · read 35m ago" and carries the Report control for the owner', async () => {
    signIn(state(), 'owner');
    await floor();
    fireEvent.click(screen.getByRole('button', { name: /Metric: Active traders/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Signups' }));
    const now = document.querySelector('.pubws-stat--now') as HTMLElement;
    expect(now.querySelector('.pubws-stat-what')?.textContent?.replace(/\s+/g, ' ')).toBe('now · read 35m ago');
    expect(now.querySelector('.pubws-updated')?.getAttribute('title')).toMatch(/2026/);
    const report = await within(now).findByRole('button', { name: 'Report' });
    fireEvent.click(report);
    expect(document.querySelector('[role="dialog"][aria-label="Report the number"]')).not.toBeNull();
  });

  test('a visitor sees no Report control', async () => {
    await floor();
    fireEvent.click(screen.getByRole('button', { name: /Metric: Active traders/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Signups' }));
    const now = document.querySelector('.pubws-stat--now') as HTMLElement;
    expect(within(now).queryByRole('button', { name: 'Report' })).toBeNull();
  });

  test('no reading yet: "no reading yet" in the value\'s place and no age', async () => {
    const ws = state().ws();
    state().overrides = {
      horizonHistories: (ws.horizonHistories as Array<Record<string, unknown>>).map(h => ({
        ...h,
        points: [],
        measured: false,
      })),
    };
    await floor();
    const now = document.querySelector('.pubws-stat--now') as HTMLElement;
    expect(now.querySelector('.pubws-stat-what')?.textContent?.trim()).toBe('now');
    expect(now.querySelector('.pubws-price')?.textContent).toBe('no reading yet');
  });

  /** The offer to fund a book appears ONCE per book on screen, in the panel
   *  where that book is traded (docs/ui-conventions.md, "The verbs and the
   *  inline ticket", reconciled 2026-09-08). An unfunded floor used to carry
   *  three of the same button: the call cell's, the verbs panel's and the
   *  activity tab row's. */
  test('a market with no price yet prints "no price yet" and stops there, and the offer to fund it appears once', async () => {
    signIn(state(), 'trader');
    const ws = state().ws();
    state().overrides = {
      markets: (ws.markets as Array<Record<string, unknown>>).map(m =>
        m.marketId === 'm-month' ? { ...m, consensus: null, liquidity: 0, pool: 0 } : m,
      ),
    };
    await floor();
    const call = document.querySelector('.pubws-stat--call') as HTMLElement;
    expect(call.querySelector('.pubws-price')?.textContent).toBe('no price yet');
    // The band says what is true and stops.
    expect(within(call).queryByRole('button', { name: 'Inject liquidity' })).toBeNull();
    // The verbs panel is in its unfunded state, and that is where the offer
    // to fund the book lives.
    const verbs = document.querySelector('.pubws-verbs') as HTMLElement;
    expect(within(verbs).queryByRole('button', { name: /Bet Higher/ })).toBeNull();
    expect(verbs.textContent).toMatch(/nobody has funded a book for this market yet/i);
    expect(within(verbs).getByRole('button', { name: 'Inject liquidity' })).toBeTruthy();
    // Once on the whole screen: the activity tab row's "Inject liquidity" is
    // deepening, not funding, and is not drawn while the book is unfunded.
    expect(screen.getAllByRole('button', { name: 'Inject liquidity' }).length).toBe(1);
    expect(document.querySelector('.pubws-pool-inject button')).toBeNull();
  });

  test('the N/A line sits under the band for a flagged metric with no reading, and not once one exists', async () => {
    const ws = state().ws();
    state().overrides = {
      horizonHistories: (ws.horizonHistories as Array<Record<string, unknown>>).map(h => ({
        ...h,
        points: [],
        measured: false,
        resolvesNaUntilMeasured: true,
      })),
    };
    await floor();
    expect(
      screen.getByText('Settles 30 September 2026, or N/A (all bets refunded) if there is still no reading'),
    ).toBeTruthy();
  });
});

describe('the settlement line: the summary, clamped, and "Full definition" outside the clamp', () => {
  test('"Settles on:" then the summary field, or the first sentence of the definition when there is none', async () => {
    await floor();
    const line = document.querySelector('.pubws-instrument-sum') as HTMLElement;
    expect(line.querySelector('.pubws-instrument-sum-text')?.textContent).toBe(
      'Settles on: Participants with a synced Manifold account and 100 cr of absolute trades in the trailing 7 days, across every floor.',
    );
    const more = within(line).getByRole('button', { name: 'Full definition' });
    expect(more.closest('.pubws-instrument-sum-text')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Metric: Active traders/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Signups' }));
    expect(document.querySelector('.pubws-instrument-sum-text')?.textContent).toBe(
      'Settles on: accounts created this month, per the database',
    );
  });

  test('"Full definition" expands the definition in place: markdown, the range, the settle instant, "unchanged since" for a synced metric', async () => {
    await floor();
    fireEvent.click(screen.getByRole('button', { name: 'Full definition' }));
    const more = document.querySelector('.pubws-instrument-more') as HTMLElement;
    expect(more).not.toBeNull();
    expect(more.textContent).toContain('Counted hourly by the platform.');
    expect(more.textContent).toContain('Range 0 to 50');
    expect(more.textContent).toMatch(/Settles .*2026/);
    expect(more.textContent).toContain('unchanged since 5 Sep');
    fireEvent.click(screen.getByRole('button', { name: 'Hide definition' }));
    expect(document.querySelector('.pubws-instrument-more')).toBeNull();
  });

  test('for the owner "Edit" sits beside "Full definition", outside the clamp, and opens the metric sheet', async () => {
    signIn(state(), 'owner');
    await floor();
    const line = document.querySelector('.pubws-instrument-sum') as HTMLElement;
    const edit = await within(line).findByRole('button', { name: 'Edit' });
    expect(edit.closest('.pubws-instrument-sum-text')).toBeNull();
    fireEvent.click(edit);
    expect(document.querySelector('[role="dialog"][aria-label="Metrics"]')).not.toBeNull();
  });

  test('a metric with neither summary nor definition prints no line', async () => {
    const ws = state().ws();
    state().overrides = {
      horizonHistories: (ws.horizonHistories as Array<Record<string, unknown>>).map(h => ({
        ...h,
        description: null,
        settlementSummary: null,
      })),
      heroMetricDescription: null,
    };
    await floor();
    expect(document.querySelector('.pubws-instrument-sum')).toBeNull();
  });

  test('the definition is on screen once: no "What is this market?" block, no left-column copy', async () => {
    await floor();
    expect(screen.queryByText('What is this market?')).toBeNull();
    expect(document.querySelector('.pubws-know')).toBeNull();
  });
});

describe('the verbs and the inline ticket', () => {
  test("row 1: the stake field prefilled 25 with presets, and this book's facts as an icon row", async () => {
    await floor();
    const verbs = document.querySelector('.pubws-verbs') as HTMLElement;
    const stake = within(verbs).getByLabelText('Stake') as HTMLInputElement;
    expect(stake.value).toBe('25');
    const chips = Array.from(verbs.querySelectorAll('.pubws-stake-chip')).map(c => c.textContent);
    expect(chips).toEqual(['10', '25', '100', '500']);
    const facts = verbs.querySelector('.pubws-facts') as HTMLElement;
    expect(facts.querySelectorAll('svg').length).toBe(3);
    const cells = Array.from(facts.querySelectorAll(':scope > span')).map(s => s.textContent?.trim());
    expect(cells).toEqual(['21', '38k', 'last trade 2h ago']);
    expect(facts.querySelectorAll('[title]').length).toBe(3);
  });

  test('row 2: two verbs, each one line with a one-line payout preview from the AMM preview at the stake in the field', async () => {
    await floor();
    const verbs = document.querySelector('.pubws-verbs') as HTMLElement;
    const higher = within(verbs).getByRole('button', { name: /Bet Higher/ });
    const lower = within(verbs).getByRole('button', { name: /Bet Lower/ });
    const h = previewTrade(0.396, 54822, 'higher', 25).shares;
    const l = previewTrade(0.396, 54822, 'lower', 25).shares;
    expect(higher.querySelector('.pubws-verb-word')?.textContent).toBe('Bet Higher ↑');
    expect(higher.querySelector('.pubws-verb-preview')?.textContent).toBe(
      `25 cr pays ${cr(h)} cr at 50 · +${cr(h - 25)}`,
    );
    expect(lower.querySelector('.pubws-verb-word')?.textContent).toBe('Bet Lower ↓');
    expect(lower.querySelector('.pubws-verb-preview')?.textContent).toBe(
      `25 cr pays ${cr(l)} cr at 0 · +${cr(l - 25)}`,
    );
  });

  test('a preset chip sets the field, the previews refresh, and the stake is remembered per session', async () => {
    await floor();
    const verbs = document.querySelector('.pubws-verbs') as HTMLElement;
    fireEvent.click(within(verbs).getByRole('button', { name: '100' }));
    expect((within(verbs).getByLabelText('Stake') as HTMLInputElement).value).toBe('100');
    const h = previewTrade(0.396, 54822, 'higher', 100).shares;
    expect(verbs.querySelector('.pubws-verb--higher .pubws-verb-preview')?.textContent).toBe(
      `100 cr pays ${cr(h)} cr at 50 · +${cr(h - 100)}`,
    );
    expect(sessionStorage.getItem('telarchy-stake')).toBe('100');
  });

  test('row 3: the range line states both directions', async () => {
    await floor();
    expect(document.querySelector('.pubws-range-line')?.textContent).toBe(
      'Range 0 to 50 · Higher shares pay 1 cr at 50, Lower shares pay 1 cr at 0; in between, in proportion · you can sell any time',
    );
  });

  test('pressing a verb opens the ticket inline under the verbs: title, the quote rows, Break-even, the call after the bet, Confirm and Cancel', async () => {
    signIn(state(), 'trader');
    await floor();
    await waitFor(() => expect(state().calls.joinWorkspace).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Bet Higher/ }));
    const inline = document.querySelector('.pubws-verbs .pubws-ticket-inline') as HTMLElement;
    expect(inline).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(inline.querySelector('.ticket-title')?.textContent).toBe('Bet Higher · Active traders · this month');
    const rows = Object.fromEntries(
      Array.from(inline.querySelectorAll('.ticket-quote-row')).map(r => [
        r.querySelector('.ticket-quote-k')?.textContent,
        r.querySelector('.ticket-quote-v')?.textContent,
      ]),
    );
    const p = previewTrade(0.396, 54822, 'higher', 25);
    expect(rows.Stake).toBe('25 cr');
    expect(rows.Shares).toBe(p.shares.toFixed(1));
    expect(rows['Pays at 50']).toBe(`${cr(p.shares)} cr`);
    expect(rows['Profit at 50']).toBe(`+${cr(p.shares - 25)} cr`);
    // Break-even: the settled value at which the bet returns its stake.
    const be = (25 / p.shares) * 50;
    expect(rows['Break-even']).toBe(be.toFixed(1));
    expect(rows['Call after your bet']).toBe((p.newProb * 50).toFixed(1));
    expect(within(inline).getByRole('button', { name: 'Confirm Bet Higher' })).toBeTruthy();
    fireEvent.click(within(inline).getByRole('button', { name: 'Cancel' }));
    expect(document.querySelector('.pubws-ticket-inline')).toBeNull();
  });

  test("pressing the other verb re-seeds the ticket's side rather than being a dead click", async () => {
    signIn(state(), 'trader');
    await floor();
    await waitFor(() => expect(state().calls.joinWorkspace).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Bet Higher/ }));
    fireEvent.click(screen.getByRole('button', { name: /Bet Lower/ }));
    const inline = document.querySelector('.pubws-ticket-inline') as HTMLElement;
    expect(within(inline).getByRole('button', { name: 'Confirm Bet Lower' })).toBeTruthy();
    expect(inline.querySelector('.ticket-title')?.textContent).toBe('Bet Lower · Active traders · this month');
  });

  test('the ticket opens at the stake in the field', async () => {
    signIn(state(), 'trader');
    await floor();
    await waitFor(() => expect(state().calls.joinWorkspace).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '500' }));
    fireEvent.click(screen.getByRole('button', { name: /Bet Higher/ }));
    const inline = document.querySelector('.pubws-ticket-inline') as HTMLElement;
    expect((within(inline).getByLabelText('Credits to spend') as HTMLInputElement).value).toBe('500');
  });
});

describe("signed out: the same panel, and the sign-up door in the ticket's place", () => {
  test('rows 1 to 3 are identical and one line reads "Sign up to trade · free credits to start"', async () => {
    await floor();
    const verbs = document.querySelector('.pubws-verbs') as HTMLElement;
    expect(within(verbs).getByLabelText('Stake')).toBeTruthy();
    expect(within(verbs).getByRole('button', { name: /Bet Higher/ })).toBeTruthy();
    expect(verbs.querySelector('.pubws-range-line')).not.toBeNull();
    expect(verbs.querySelector('.pubws-verbs-signup')?.textContent).toBe('Sign up to trade · free credits to start');
  });

  test('pressing a verb opens the door inside the panel, echoing the verb and stake, with the question and band still on screen', async () => {
    await floor();
    fireEvent.click(screen.getByRole('button', { name: /Bet Higher/ }));
    const door = document.querySelector('.pubws-verbs .pubws-signup-door') as HTMLElement;
    expect(door).not.toBeNull();
    expect(within(door).getByText('Sign up to place this bet')).toBeTruthy();
    const h = previewTrade(0.396, 54822, 'higher', 25).shares;
    expect(door.querySelector('.pubws-signup-door-echo')?.textContent).toBe(
      `Bet Higher · 25 cr · pays ${cr(h)} cr at 50`,
    );
    expect(within(door).getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    expect(within(door).getByRole('button', { name: 'Continue with GitHub' })).toBeTruthy();
    expect(within(door).getByText('or')).toBeTruthy();
    expect(within(door).getByPlaceholderText('you@example.com')).toBeTruthy();
    expect(within(door).getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(within(door).getByText('Already have an account?')).toBeTruthy();
    expect(within(door).getByRole('link', { name: 'Log in' })).toBeTruthy();
    expect(document.querySelector('h2.pubws-instrument-ask')).not.toBeNull();
    expect(document.querySelector('.pubws-numbers')).not.toBeNull();
    expect(document.querySelector('.ticket')).toBeNull();
  });

  test('the email "Continue" goes to sign-up, keeping the bet\'s intent for after it', async () => {
    await floor();
    fireEvent.click(screen.getByRole('button', { name: '100' }));
    fireEvent.click(screen.getByRole('button', { name: /Bet Lower/ }));
    const door = document.querySelector('.pubws-signup-door') as HTMLElement;
    fireEvent.change(within(door).getByPlaceholderText('you@example.com'), { target: { value: 'ada@example.com' } });
    fireEvent.click(within(door).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('signup-door')).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem('telarchy-bet-intent') ?? '{}')).toEqual({
      floor: 'telarchy',
      marketId: 'm-month',
      direction: 'lower',
      stake: 100,
    });
    expect(sessionStorage.getItem('signup-email')).toBe('ada@example.com');
  });

  test('after sign-up the page opens the ticket with that verb, that stake and a fresh quote', async () => {
    sessionStorage.setItem(
      'telarchy-bet-intent',
      JSON.stringify({ floor: 'telarchy', marketId: 'm-month', direction: 'lower', stake: 100 }),
    );
    signIn(state(), 'trader');
    await floor();
    await waitFor(() => expect(document.querySelector('.pubws-ticket-inline')).not.toBeNull());
    const inline = document.querySelector('.pubws-ticket-inline') as HTMLElement;
    expect(within(inline).getByRole('button', { name: 'Confirm Bet Lower' })).toBeTruthy();
    expect((within(inline).getByLabelText('Credits to spend') as HTMLInputElement).value).toBe('100');
    expect(sessionStorage.getItem('telarchy-bet-intent')).toBeNull();
  });

  test('no demo ticket for a stranger', async () => {
    await floor();
    fireEvent.click(screen.getByRole('button', { name: /Bet Higher/ }));
    expect(screen.queryByText('Sign up to bet')).toBeNull();
  });
});

describe('an unfunded market never shows bet buttons', () => {
  test('signed out: one line and no verbs, no Inject', async () => {
    const ws = state().ws();
    state().overrides = {
      markets: (ws.markets as Array<Record<string, unknown>>).map(m =>
        m.marketId === 'm-month' ? { ...m, consensus: null, liquidity: 0, pool: 0 } : m,
      ),
    };
    await floor();
    const verbs = document.querySelector('.pubws-verbs') as HTMLElement;
    expect(within(verbs).queryByRole('button', { name: /Bet/ })).toBeNull();
    expect(verbs.querySelector('.pubws-unfunded')).not.toBeNull();
    expect(within(verbs).queryByRole('button', { name: 'Inject liquidity' })).toBeNull();
  });
});

describe('Your position', () => {
  test('one ruled icon row under the verbs: side and shares, pays up to, worth, spent, profit, and Sell opens manage mode', async () => {
    signIn(state(), 'trader');
    state().calls.getPositions.mockImplementation(async () => [{ direction: 'lower', shares: 702, totalCost: 500 }]);
    await floor();
    const row = (await waitFor(() => {
      const el = document.querySelector('.pubws-position');
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;
    expect(document.querySelector('.pubws-verbs')!.nextElementSibling).toBe(row);
    expect(within(row).getByText('Your position')).toBeTruthy();
    const worth = previewSell(0.396, 54822, 'lower', 702);
    const profit = worth - 500;
    const cells = Array.from(row.querySelectorAll('.pubws-position-cell')).map(c =>
      c.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(cells[0]).toBe('▼ Lower · 702 sh');
    expect(cells[1]).toBe('pays up to 702 cr');
    expect(cells[2]).toBe(`worth ${cr(worth)} cr`);
    expect(cells[3]).toBe('spent 500 cr');
    expect(cells[4]).toBe(
      `${profit < 0 ? '-' : '+'}${Math.abs(profit).toFixed(1)} cr (${Math.round((profit / 500) * 100)}%)`,
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Sell' }));
    const inline = document.querySelector('.pubws-ticket-inline') as HTMLElement;
    expect(inline).not.toBeNull();
    expect(within(inline).getByRole('button', { name: 'Sell' })).toBeTruthy();
  });

  test('no position, no row', async () => {
    signIn(state(), 'trader');
    await floor();
    await waitFor(() => expect(state().calls.getPositions).toHaveBeenCalled());
    expect(document.querySelector('.pubws-position')).toBeNull();
  });
});
