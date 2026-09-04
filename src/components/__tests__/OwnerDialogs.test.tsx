import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The owner's three dialogs (docs/owner-on-the-floor.md, "The v1 controls").
 *
 * What matters: a metric is a name and what it is, nothing else reaches the
 * API from dialog 1; the add-date dialog appends to the STORED horizons and
 * writes the liquidity as the metric's own; calendar picks are rolling
 * entries, a typed date is absolute; and the inject dialog moves exactly the
 * amount typed. The dialogs never lie about money: buttons carry their cost.
 */

const createMetricIn = vi.fn(async () => ({ id: 'm-new', name: 'Steam wishlists' }));
const createWorkspace = vi.fn(async () => ({ id: 'ws-new', ownerHandle: 'viktor', slug: 'meridian' }));
const STORED_METRIC = {
  id: 'm1',
  name: 'LookPilot net 2026 (USD)',
  timePreference: { enabled: false, halfLife: 1, customHorizons: ['2026-12'] },
};
const getMetric = vi.fn(async () => STORED_METRIC);
const patchMetric = vi.fn(async () => ({}));
const reportMetricValue = vi.fn(async () => ({}));
const injectLiquidity = vi.fn(async () => ({}));

vi.mock('../../lib/api', () => ({
  api: {
    createMetricIn: (...a: unknown[]) => createMetricIn(...(a as [])),
    createWorkspace: (...a: unknown[]) => createWorkspace(...(a as [])),
    getMetric: (...a: unknown[]) => getMetric(...(a as [])),
    patchMetric: (...a: unknown[]) => patchMetric(...(a as [])),
    reportMetricValue: (...a: unknown[]) => reportMetricValue(...(a as [])),
    injectLiquidity: (...a: unknown[]) => injectLiquidity(...(a as [])),
  },
}));

// Raw source, for the invariant that is about the route itself.
import appSrc from '../../App.tsx?raw';
import { MarketFacts } from '../MarketFacts';
import {
  AddDateDialog,
  CreateWorkspaceDialog,
  InjectLiquidityDialog,
  NewMetricDialog,
  ReportValueDialog,
} from '../OwnerDialogs';

beforeEach(() => {
  createMetricIn.mockClear();
  createWorkspace.mockClear();
  // Reset, not clear: a once-implementation a test queued and did not use
  // must not leak into the next one.
  getMetric.mockReset();
  getMetric.mockImplementation(async () => STORED_METRIC);
  patchMetric.mockReset();
  patchMetric.mockImplementation(async () => ({}));
  injectLiquidity.mockReset();
  injectLiquidity.mockImplementation(async () => ({}));
  reportMetricValue.mockClear();
});

describe('dialog 1: new metric', () => {
  test('sends the name and the settlement words, nothing else', async () => {
    const onCreated = vi.fn();
    render(<NewMetricDialog workspaceId="ws" onClose={() => {}} onCreated={onCreated} />);
    fireEvent.change(screen.getByPlaceholderText('Steam wishlists'), { target: { value: '  Steam wishlists  ' } });
    fireEvent.change(screen.getByPlaceholderText(/Where the number comes from/), {
      target: { value: 'Total outstanding wishlists, deletions netted out.' },
    });
    fireEvent.click(screen.getByText('Add the metric'));
    await waitFor(() =>
      expect(createMetricIn).toHaveBeenCalledWith('ws', {
        name: 'Steam wishlists',
        description: 'Total outstanding wishlists, deletions netted out.',
      }),
    );
    expect(onCreated).toHaveBeenCalledWith({ id: 'm-new', name: 'Steam wishlists' });
  });

  test('a nameless metric never reaches the API', async () => {
    render(<NewMetricDialog workspaceId="ws" onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Add the metric'));
    await waitFor(() => expect(screen.getByText('A name.')).toBeTruthy());
    expect(createMetricIn).not.toHaveBeenCalled();
  });

  test('says what happens next, because the flow does not stop before a date', () => {
    render(<NewMetricDialog workspaceId="ws" onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByText('Next: give it a date. A metric with no date has no market.')).toBeTruthy();
  });
});

describe('dialog 2: add a date, right after the metric is created', () => {
  /**
   * The same form the sheet's rows fold behind "+ Add a date"
   * (docs/owner-on-the-floor.md, "Adding a date"): how often, which period
   * it starts with, and the two numbers every row carries. It writes ONE
   * PUT: the entry into customHorizons and its numbers into horizonCredits.
   */
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderIt = (onDone = vi.fn(), extra: { defaultCredits?: number; spendable?: number } = {}) =>
    render(
      <AddDateDialog
        workspaceId="ws"
        metricId="m1"
        metricName="LookPilot net 2026 (USD)"
        defaultCredits={extra.defaultCredits ?? 1200}
        spendable={extra.spendable ?? 50000}
        onClose={() => {}}
        onDone={onDone}
      />,
    );
  const ready = async () => {
    const go = await screen.findByRole('button', { name: /Open the weekly book/ });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
  };

  test('the head names the metric, and the form asks how often first', async () => {
    renderIt();
    await ready();
    expect(screen.getByText('Add a date · LookPilot net 2026 (USD)')).toBeTruthy();
    const row = screen.getByRole('group', { name: 'How often' });
    expect(Array.from(row.querySelectorAll('button')).map(b => b.textContent)).toEqual([
      'hourly',
      'daily',
      'weekly',
      'monthly',
      'yearly',
      'once',
    ]);
  });

  // A fresh workspace carries 0.5 credits per auto-funded market, so the
  // dialog used to prefill 1 and opened the owner's first market at a credit
  // (walkthrough, 2026-08-30). A market nobody can move is worse than none.
  test('a decoration-sized workspace default is not what the first book opens with', async () => {
    renderIt(vi.fn(), { defaultCredits: 0.5, spendable: 50000 });
    await ready();
    expect((screen.getByLabelText('Credits behind the book') as HTMLInputElement).value).toBe('1,000');
  });

  test('the book number says whose credits it is, and the proposal number starts at 0', async () => {
    renderIt(vi.fn(), { spendable: 5000 });
    await ready();
    expect(screen.getByText('The book opens with · of your 5,000 cr')).toBeTruthy();
    expect((screen.getByLabelText('Credits behind the book') as HTMLInputElement).value).toBe('1,200');
    expect((screen.getByLabelText('Credits behind each proposal') as HTMLInputElement).value).toBe('0');
  });

  test('the prefill never asks for more than the owner holds', async () => {
    renderIt(vi.fn(), { spendable: 200 });
    await ready();
    expect((screen.getByLabelText('Credits behind the book') as HTMLInputElement).value).toBe('200');
  });

  test('a repeat is a ROLLING entry appended to the stored horizons, both numbers keyed by it', async () => {
    const onDone = vi.fn();
    renderIt(onDone);
    await ready();
    fireEvent.click(screen.getByText('monthly'));
    fireEvent.change(screen.getByLabelText('Credits behind each proposal'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: /Open the monthly book · 1,200 cr/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledTimes(1));
    expect(patchMetric).toHaveBeenCalledWith('ws', 'm1', {
      timePreference: {
        enabled: false,
        halfLife: 1,
        // The stored '2026-12' survives; the rolling entry joins it.
        customHorizons: ['2026-12', '+0m'],
        horizonCredits: { '+0m': { book: 1200, proposal: 250 } },
      },
    });
    // The book number lives on the entry now, never on the metric.
    expect(patchMetric.mock.calls[0][2]).not.toHaveProperty('liquidityCredits');
    expect(onDone).toHaveBeenCalled();
  });

  test('once asks for a day and an optional UTC hour, and the entry carries the hour', async () => {
    renderIt();
    await ready();
    fireEvent.click(screen.getByText('once'));
    fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-09-30' } });
    fireEvent.change(screen.getByLabelText('Pick an hour, UTC'), { target: { value: '14:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Open the book/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalled());
    expect(patchMetric.mock.calls[0][2]).toMatchObject({
      timePreference: {
        customHorizons: ['2026-12', '2026-09-30T14'],
        horizonCredits: { '2026-09-30T14': { book: 1200, proposal: 0 } },
      },
    });
  });

  test('the hour is disabled until a day is picked', async () => {
    renderIt();
    await ready();
    fireEvent.click(screen.getByText('once'));
    const time = screen.getByLabelText('Pick an hour, UTC') as HTMLInputElement;
    expect(time.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-09-30' } });
    expect(time.disabled).toBe(false);
  });

  test('the book number typed is the number sent, and the button restates it', async () => {
    renderIt();
    await ready();
    fireEvent.change(screen.getByLabelText('Credits behind the book'), { target: { value: '2,500' } });
    fireEvent.click(screen.getByRole('button', { name: /Open the weekly book · 2,500 cr/ }));
    await waitFor(() => expect(patchMetric).toHaveBeenCalled());
    expect(patchMetric.mock.calls[0][2]).toMatchObject({
      timePreference: { horizonCredits: { '+0w': { book: 2500, proposal: 0 } } },
    });
  });

  test('the form is not live before the stored dates are read, so adding one never drops another', async () => {
    getMetric.mockImplementationOnce(() => new Promise(() => {}));
    renderIt();
    const go = document.querySelector('.ticket-go') as HTMLButtonElement | null;
    if (go) {
      expect(go.disabled).toBe(true);
      fireEvent.click(go);
    }
    expect(patchMetric).not.toHaveBeenCalled();
  });
});

describe('dialog 3: inject liquidity', () => {
  /**
   * Anyone who can trade can fund a market now (owner ask 2026-09-02), so
   * the dialog is read by traders and not only by owners. It has to say the
   * thing a trader does not know: credits put behind a market are not scored
   * as profit on that market (docs/seasons.md, "Profit out of a book you
   * funded is not score"). Telling them afterwards, in the standings, is
   * telling them too late.
   */
  test('says what funding a market does to the funder score', () => {
    render(
      <InjectLiquidityDialog
        workspaceId="ws"
        marketId="mkt-1"
        marketLabel="LookPilot net 2026 (USD) · this week"
        pool={9800}
        traders={9}
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    expect(screen.getByText(/not scored as profit on this market/i)).toBeInTheDocument();
  });

  test('moves exactly the amount typed, into the named market, on the named floor', async () => {
    const onDone = vi.fn();
    render(
      <InjectLiquidityDialog
        workspaceId="ws"
        marketId="mkt-1"
        marketLabel="LookPilot net 2026 (USD) · this week"
        pool={9800}
        traders={9}
        onClose={() => {}}
        onDone={onDone}
      />,
    );
    expect(screen.getByText('9,800 cr')).toBeTruthy();
    const input = screen.getByLabelText('Credits to add to the pool');
    fireEvent.change(input, { target: { value: '2000' } });
    // The consequence is said before the injection: the pool after.
    expect(screen.getByText('11,800 cr')).toBeTruthy();
    fireEvent.click(screen.getByText('Add 2,000 cr'));
    await waitFor(() => expect(injectLiquidity).toHaveBeenCalledWith('mkt-1', 2000, 'ws'));
    expect(onDone).toHaveBeenCalled();
  });

  test('a non-number never reaches the API', async () => {
    render(
      <InjectLiquidityDialog
        workspaceId="ws"
        marketId="mkt-1"
        marketLabel="x"
        pool={100}
        traders={0}
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Credits to add to the pool'), { target: { value: 'lots' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add/ }));
    await waitFor(() => expect(screen.getByText('A number of credits.')).toBeTruthy());
    expect(injectLiquidity).not.toHaveBeenCalled();
  });
});

describe('dialog 3: a baseline market whose date has no row falls back to the metric-level number', () => {
  const owner = (over: Partial<React.ComponentProps<typeof InjectLiquidityDialog>> = {}) => (
    <InjectLiquidityDialog
      workspaceId="ws"
      marketId="mkt-1"
      marketLabel="LookPilot net 2026 (USD) · this week"
      pool={2412}
      traders={7}
      metricId="m1"
      metricName="LookPilot net 2026 (USD)"
      canManage
      defaultCredits={1000}
      onClose={() => {}}
      onDone={() => {}}
      {...over}
    />
  );
  const metricWith = (liquidityCredits: number | null) =>
    getMetric.mockResolvedValueOnce({
      id: 'm1',
      name: 'LookPilot net 2026 (USD)',
      liquidityCredits,
      timePreference: { enabled: false, halfLife: 1, customHorizons: ['+0w'] },
    } as never);

  test('a trader is shown one number only, and never writes the metric', async () => {
    render(owner({ canManage: false }));
    fireEvent.change(screen.getByLabelText('Credits to add to the pool'), { target: { value: '2000' } });
    expect(screen.queryByLabelText('Credits every new market on this metric opens with')).toBeNull();
    fireEvent.click(screen.getByText('Add 2,000 cr'));
    await waitFor(() => expect(injectLiquidity).toHaveBeenCalledWith('mkt-1', 2000, 'ws'));
    expect(getMetric).not.toHaveBeenCalled();
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('a proposal branch never respawns, so it offers one number even to the owner', () => {
    render(owner({ metricId: undefined }));
    expect(screen.queryByLabelText('Credits every new market on this metric opens with')).toBeNull();
    expect(getMetric).not.toHaveBeenCalled();
  });

  test("the owner sees the second number prefilled with the metric's own standing liquidity", async () => {
    metricWith(500);
    render(owner());
    const standing = await screen.findByLabelText('Credits every new market on this metric opens with');
    await waitFor(() => expect((standing as HTMLInputElement).value).toBe('500'));
    expect(screen.getByText(/each time it opens again/i)).toBeInTheDocument();
  });

  test('a metric with no number of its own is prefilled with the workspace default', async () => {
    metricWith(null);
    render(owner({ defaultCredits: 1386 }));
    const standing = await screen.findByLabelText('Credits every new market on this metric opens with');
    await waitFor(() => expect((standing as HTMLInputElement).value).toBe('1,386'));
  });

  test('the facts row says what the next market opens with, and what it was when that changes', async () => {
    metricWith(0.5);
    render(owner());
    const standing = await screen.findByLabelText('Credits every new market on this metric opens with');
    await waitFor(() => expect((standing as HTMLInputElement).value).toBe('0.5'));
    expect(screen.getByText(/next market on this metric opens with/i)).toBeInTheDocument();
    expect(screen.queryByText(/was 0\.5/)).toBeNull();
    fireEvent.change(standing, { target: { value: '500' } });
    expect(screen.getByText('500 cr')).toBeInTheDocument();
    expect(screen.getByText(/was 0\.5/)).toBeInTheDocument();
  });

  test('the note says the number is shared by every date on the metric', async () => {
    metricWith(500);
    render(owner());
    await screen.findByLabelText('Credits every new market on this metric opens with');
    expect(screen.getByText(/every new LookPilot net 2026 \(USD\) market/i)).toBeInTheDocument();
  });

  test('submitting moves the credits AND writes the changed standing number; the button names both', async () => {
    metricWith(0.5);
    const onDone = vi.fn();
    render(owner({ onDone }));
    const standing = await screen.findByLabelText('Credits every new market on this metric opens with');
    await waitFor(() => expect((standing as HTMLInputElement).value).toBe('0.5'));
    fireEvent.change(standing, { target: { value: '500' } });
    fireEvent.click(screen.getByText('Add 1,000 cr · 500 cr on every opening'));
    await waitFor(() => expect(injectLiquidity).toHaveBeenCalledWith('mkt-1', 1000, 'ws'));
    expect(patchMetric).toHaveBeenCalledWith('ws', 'm1', { liquidityCredits: 500 });
    expect(onDone).toHaveBeenCalled();
  });

  test('an unchanged standing number is not written', async () => {
    metricWith(500);
    render(owner());
    const standing = await screen.findByLabelText('Credits every new market on this metric opens with');
    await waitFor(() => expect((standing as HTMLInputElement).value).toBe('500'));
    fireEvent.click(screen.getByRole('button', { name: /^Add 1,000 cr/ }));
    await waitFor(() => expect(injectLiquidity).toHaveBeenCalled());
    expect(patchMetric).not.toHaveBeenCalled();
    // Unchanged, the button carries the one act it performs.
    expect(screen.queryByText(/on every opening/)).toBeNull();
  });

  test('zero is a valid standing number: new markets on this metric open unfunded', async () => {
    metricWith(500);
    render(owner());
    const standing = await screen.findByLabelText('Credits every new market on this metric opens with');
    await waitFor(() => expect((standing as HTMLInputElement).value).toBe('500'));
    fireEvent.change(standing, { target: { value: '0' } });
    fireEvent.click(screen.getByText('Add 1,000 cr · 0 cr on every opening'));
    await waitFor(() => expect(patchMetric).toHaveBeenCalledWith('ws', 'm1', { liquidityCredits: 0 }));
  });

  test('a non-number in the second field reaches no API', async () => {
    metricWith(500);
    render(owner());
    const standing = await screen.findByLabelText('Credits every new market on this metric opens with');
    fireEvent.change(standing, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add/ }));
    await waitFor(() => expect(screen.getByText('A number of credits for every opening.')).toBeTruthy());
    expect(injectLiquidity).not.toHaveBeenCalled();
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('the standing number is written before the credits move, so a refused write moves nothing', async () => {
    metricWith(0.5);
    patchMetric.mockRejectedValueOnce(new Error('Forbidden'));
    render(owner());
    const standing = await screen.findByLabelText('Credits every new market on this metric opens with');
    await waitFor(() => expect((standing as HTMLInputElement).value).toBe('0.5'));
    fireEvent.change(standing, { target: { value: '500' } });
    fireEvent.click(screen.getByText('Add 1,000 cr · 500 cr on every opening'));
    await waitFor(() => expect(screen.getByText('Forbidden')).toBeTruthy());
    expect(injectLiquidity).not.toHaveBeenCalled();
  });
});

describe('dialog 3: three numbers for a manager on a baseline market with a date row', () => {
  /**
   * The market's own date row (dialog 2) rides in the inject dialog: what the
   * book opens with each time this date comes round, and what a proposal's
   * branch on it opens with (docs/owner-on-the-floor.md, "Three numbers for
   * someone who can manage the floor"). Written to horizonCredits with the
   * whole timePreference, before the credits move, only when changed.
   */
  const owner = (over: Partial<React.ComponentProps<typeof InjectLiquidityDialog>> = {}) => (
    <InjectLiquidityDialog
      workspaceId="ws"
      marketId="mkt-1"
      marketLabel="Daily active users · this week"
      pool={3000}
      traders={4}
      metricId="m1"
      metricName="Daily active users"
      targetDate="2026-12"
      canManage
      defaultCredits={1000}
      onClose={() => {}}
      onDone={() => {}}
      {...over}
    />
  );
  const stored = (over: { liquidityCredits?: number | null; horizonCredits?: Record<string, unknown> } = {}) =>
    getMetric.mockResolvedValueOnce({
      id: 'm1',
      name: 'Daily active users',
      liquidityCredits: over.liquidityCredits ?? null,
      timePreference: {
        enabled: false,
        halfLife: 1,
        customHorizons: ['+0w', '2026-12'],
        ...(over.horizonCredits ? { horizonCredits: over.horizonCredits } : {}),
      },
    } as never);
  const bookField = () => screen.findByLabelText('Credits the book on this date opens with');
  const proposalField = () => screen.getByLabelText('Credits behind each proposal on this date');

  test("the book number is the row's, and the proposal number defaults to 0", async () => {
    stored({ horizonCredits: { '2026-12': { book: 500 } } });
    render(owner());
    const book = await bookField();
    await waitFor(() => expect((book as HTMLInputElement).value).toBe('500'));
    expect((proposalField() as HTMLInputElement).value).toBe('0');
    expect(screen.getByText('Each time it opens again')).toBeTruthy();
    expect(screen.getByText('Behind each proposal on this date')).toBeTruthy();
  });

  test("a row with no book number shows the metric's standing number, then the workspace default", async () => {
    stored({ liquidityCredits: 700 });
    render(owner());
    await waitFor(() =>
      expect((screen.getByLabelText('Credits the book on this date opens with') as HTMLInputElement).value).toBe('700'),
    );
    stored({ liquidityCredits: null });
    render(owner({ defaultCredits: 1386, marketId: 'mkt-2' }));
    await waitFor(() =>
      expect(
        screen.getAllByLabelText('Credits the book on this date opens with').map(e => (e as HTMLInputElement).value),
      ).toContain('1,386'),
    );
  });

  test('the facts rows say what the next book and the next proposal on this date open with, and what they were', async () => {
    stored({ horizonCredits: { '2026-12': { book: 500, proposal: 0 } } });
    render(owner());
    await waitFor(() =>
      expect((screen.getByLabelText('Credits the book on this date opens with') as HTMLInputElement).value).toBe('500'),
    );
    expect(screen.getByText('Next market on this date opens with')).toBeTruthy();
    expect(screen.getByText('Next proposal on this date opens with')).toBeTruthy();
    expect(screen.queryByText(/was 0/)).toBeNull();
    fireEvent.change(proposalField(), { target: { value: '250' } });
    expect(screen.getByText(/was 0$/)).toBeTruthy();
    expect(screen.getByText('Add 1,000 cr · 250 cr behind each proposal')).toBeTruthy();
  });

  test('the note says what the third number is and what zero means', async () => {
    stored();
    render(owner());
    await bookField();
    expect(screen.getByText(/at zero, the proposer funds their own/)).toBeTruthy();
    expect(screen.getByText(/proposal's market on this date opens with/)).toBeTruthy();
  });

  test('a changed proposal number is written to horizonCredits, whole timePreference, before the credits move', async () => {
    stored({ horizonCredits: { '+0w': { book: 300, proposal: 50 }, '2026-12': { book: 500 } } });
    const onDone = vi.fn();
    const order: string[] = [];
    patchMetric.mockImplementationOnce(async () => {
      order.push('patch');
      return {};
    });
    injectLiquidity.mockImplementationOnce(async () => {
      order.push('inject');
      return {};
    });
    render(owner({ onDone }));
    await waitFor(() =>
      expect((screen.getByLabelText('Credits the book on this date opens with') as HTMLInputElement).value).toBe('500'),
    );
    fireEvent.change(proposalField(), { target: { value: '250' } });
    fireEvent.click(screen.getByText('Add 1,000 cr · 250 cr behind each proposal'));
    await waitFor(() => expect(injectLiquidity).toHaveBeenCalledWith('mkt-1', 1000, 'ws'));
    expect(patchMetric).toHaveBeenCalledWith('ws', 'm1', {
      timePreference: {
        enabled: false,
        halfLife: 1,
        customHorizons: ['+0w', '2026-12'],
        horizonCredits: { '+0w': { book: 300, proposal: 50 }, '2026-12': { book: 500, proposal: 250 } },
      },
    });
    expect(order).toEqual(['patch', 'inject']);
    expect(onDone).toHaveBeenCalled();
  });

  test('a changed book number is written too, and the button names both changes', async () => {
    stored({ horizonCredits: { '2026-12': { book: 500 } } });
    render(owner());
    const book = await bookField();
    await waitFor(() => expect((book as HTMLInputElement).value).toBe('500'));
    fireEvent.change(book, { target: { value: '800' } });
    expect(screen.getByText('Add 1,000 cr · 800 cr on every opening')).toBeTruthy();
    fireEvent.change(proposalField(), { target: { value: '250' } });
    fireEvent.click(screen.getByText('Add 1,000 cr · 800 cr on every opening · 250 cr behind each proposal'));
    await waitFor(() => expect(injectLiquidity).toHaveBeenCalled());
    expect(patchMetric.mock.calls[0][2]).toMatchObject({
      timePreference: { horizonCredits: { '2026-12': { book: 800, proposal: 250 } } },
    });
  });

  test('unchanged numbers are not written', async () => {
    stored({ horizonCredits: { '2026-12': { book: 500, proposal: 250 } } });
    render(owner());
    await waitFor(() =>
      expect((screen.getByLabelText('Credits the book on this date opens with') as HTMLInputElement).value).toBe('500'),
    );
    fireEvent.click(screen.getByText('Add 1,000 cr'));
    await waitFor(() => expect(injectLiquidity).toHaveBeenCalled());
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('zero is a valid answer for either: the book opens unfunded, the proposer funds their own', async () => {
    stored({ horizonCredits: { '2026-12': { book: 500, proposal: 250 } } });
    render(owner());
    const book = await bookField();
    await waitFor(() => expect((book as HTMLInputElement).value).toBe('500'));
    fireEvent.change(book, { target: { value: '0' } });
    fireEvent.change(proposalField(), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Add 1,000 cr · 0 cr on every opening · 0 cr behind each proposal'));
    await waitFor(() => expect(injectLiquidity).toHaveBeenCalled());
    expect(patchMetric.mock.calls[0][2]).toMatchObject({
      timePreference: { horizonCredits: { '2026-12': { book: 0, proposal: 0 } } },
    });
  });

  test('a refused write moves nothing', async () => {
    stored({ horizonCredits: { '2026-12': { book: 500 } } });
    patchMetric.mockRejectedValueOnce(new Error('Forbidden'));
    render(owner());
    await bookField();
    fireEvent.change(proposalField(), { target: { value: '250' } });
    fireEvent.click(screen.getByText('Add 1,000 cr · 250 cr behind each proposal'));
    await waitFor(() => expect(screen.getByText('Forbidden')).toBeTruthy());
    expect(injectLiquidity).not.toHaveBeenCalled();
  });

  test('a non-number in the third field reaches no API', async () => {
    stored();
    render(owner());
    await bookField();
    fireEvent.change(proposalField(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add/ }));
    await waitFor(() => expect(screen.getByText('A number of credits behind each proposal.')).toBeTruthy());
    expect(injectLiquidity).not.toHaveBeenCalled();
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('a trader sees the amount only, and never reads or writes the metric', async () => {
    render(owner({ canManage: false }));
    expect(screen.queryByLabelText('Credits the book on this date opens with')).toBeNull();
    expect(screen.queryByLabelText('Credits behind each proposal on this date')).toBeNull();
    fireEvent.change(screen.getByLabelText('Credits to add to the pool'), { target: { value: '2000' } });
    fireEvent.click(screen.getByText('Add 2,000 cr'));
    await waitFor(() => expect(injectLiquidity).toHaveBeenCalledWith('mkt-1', 2000, 'ws'));
    expect(getMetric).not.toHaveBeenCalled();
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('a proposal branch never respawns, so it is one number even for the owner', () => {
    render(owner({ metricId: undefined }));
    expect(screen.queryByLabelText('Credits the book on this date opens with')).toBeNull();
    expect(screen.queryByLabelText('Credits behind each proposal on this date')).toBeNull();
  });
});

describe('the facts row', () => {
  test('a visitor sees the numbers and no way to change them; the owner gets Inject', () => {
    const { rerender } = render(<MarketFacts traders={3} pool={1200} volume={800} />);
    expect(screen.queryByText('Inject')).toBeNull();
    rerender(<MarketFacts traders={3} pool={1200} volume={800} canManage onInject={() => {}} />);
    expect(screen.getByText('Inject')).toBeTruthy();
  });
});

describe('dialog 0: create your own floor', () => {
  test('a floor is a name, and the caller is handed its path BY ID, never by slug', async () => {
    // A bare slug resolves an ambiguous slug to none (unique per owner, not
    // globally), so a stranger's unlisted floor sharing the slug would 404
    // the fresh owner's landing. The id form always resolves.
    const onCreated = vi.fn();
    render(<CreateWorkspaceDialog onClose={() => {}} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText('Floor name'), { target: { value: '  Meridian  ' } });
    fireEvent.click(screen.getByText('Open my market'));
    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith({ name: 'Meridian' }));
    expect(onCreated).toHaveBeenCalledWith('/marketplace/ws-new');
  });

  test('a nameless floor never reaches the API', async () => {
    const onCreated = vi.fn();
    render(<CreateWorkspaceDialog onClose={() => {}} onCreated={onCreated} />);
    fireEvent.click(screen.getByText('Open my market'));
    await waitFor(() => expect(screen.getByText('A name.')).toBeTruthy());
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  test('every path this dialog can hand back has a route behind it', () => {
    // The 2026-08-28 bug: onCreated handed back /{owner}/{slug}, no route
    // matched, and the fresh owner bounced to the floors list. The dialog
    // produces exactly two shapes; both must exist in App.tsx.
    expect(appSrc).toContain('path="/:slug"');
    expect(appSrc).toContain('path="/marketplace/:workspaceId"');
    expect(appSrc).not.toContain('path="/:owner/:slug"');
  });
});

describe('dialog 4: report the number', () => {
  const props = {
    workspaceId: 'ws',
    metricId: 'm1',
    metricName: 'LookPilot net 2026 (USD)',
    unit: '$',
    lastValue: 44439,
    lastAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    marketSays: 46120,
    settlesLabel: '3d',
    rangeMax: 500000,
    rangeEditable: false,
    onClose: () => {},
  };

  test('sends the reading with the value it replaces, and the note', async () => {
    const onDone = vi.fn();
    render(<ReportValueDialog {...props} onDone={onDone} />);
    const input = screen.getByLabelText('The new reading');
    fireEvent.change(input, { target: { value: '46,120' } });
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'the Daily Deal ran' } });
    fireEvent.click(screen.getByText(/Report \$46,120/));
    await waitFor(() =>
      expect(reportMetricValue).toHaveBeenCalledWith('ws', 'm1', {
        value: 46120,
        // oldValue is what the route needs to write the public updates row.
        oldValue: 44439,
        updateNote: 'the Daily Deal ran',
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  test("shows the market's own number beside the one being typed", () => {
    render(<ReportValueDialog {...props} onDone={() => {}} />);
    // The one fact that cannot be got anywhere else, and the reason to look.
    expect(screen.getByText('The market has been saying')).toBeTruthy();
    expect(screen.getByText('46,120')).toBeTruthy();
  });

  test('the delta speaks direction, against the reading it replaces', () => {
    render(<ReportValueDialog {...props} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('The new reading'), { target: { value: '46120' } });
    const up = screen.getByText('+1,681');
    expect(up.className).toContain('is-up');
    fireEvent.change(screen.getByLabelText('The new reading'), { target: { value: '40000' } });
    expect(screen.getByText('-4,439').className).toContain('is-down');
  });

  test('an empty or unparseable reading never reaches the API', async () => {
    render(<ReportValueDialog {...props} lastValue={null} lastAt={null} marketSays={null} onDone={() => {}} />);
    const go = screen.getByRole('button', { name: /Report/ });
    expect((go as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(go);
    await waitFor(() => expect(reportMetricValue).not.toHaveBeenCalled());
  });

  test('the first reading asks for the range instead of a delta, and sends it', async () => {
    render(
      <ReportValueDialog
        {...props}
        lastValue={null}
        lastAt={null}
        marketSays={null}
        rangeMax={1000}
        rangeEditable={true}
        onDone={() => {}}
      />,
    );
    // No previous reading and no market opinion: neither line is drawn.
    expect(screen.queryByText('The market has been saying')).toBeNull();
    expect(screen.getByText(/Nobody has traded yet, so this also sets the range/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('The new reading'), { target: { value: '430' } });
    fireEvent.change(screen.getByLabelText('Highest it could plausibly reach'), { target: { value: '2000' } });
    fireEvent.click(screen.getByText(/Report \$430/));
    await waitFor(() =>
      expect(reportMetricValue).toHaveBeenCalledWith('ws', 'm1', {
        value: 430,
        oldValue: 0,
        updateNote: '',
        marketRangeMax: 2000,
      }),
    );
  });

  // The walkthrough case (2026-08-30): creating a metric logs a reading, so
  // "first reading" never came round again and an owner whose real number was
  // 4,200 had no control that could widen a 0-1,000 market.
  test('an untraded metric can still be given a range, reading or no reading', async () => {
    render(
      <ReportValueDialog
        {...props}
        lastValue={0}
        marketSays={500}
        rangeMax={1000}
        rangeEditable={true}
        onDone={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('The new reading'), { target: { value: '4200' } });
    // Left alone, the range follows the number up with headroom instead of
    // silently capping it.
    expect((screen.getByLabelText('Highest it could plausibly reach') as HTMLInputElement).value).toBe('8,400');
    fireEvent.click(screen.getByText(/Report \$4,200/));
    await waitFor(() =>
      expect(reportMetricValue).toHaveBeenCalledWith('ws', 'm1', {
        value: 4200,
        oldValue: 0,
        updateNote: '',
        marketRangeMax: 8400,
      }),
    );
  });

  // Owner ask 2026-08-31: a September total is typed in October and belongs to
  // September, which is what a market with a reporting lag settles on.
  test('a closed period can be reported into, and the reading is dated to it', async () => {
    render(
      <ReportValueDialog
        {...props}
        lastValue={0}
        rangeEditable={false}
        periodLabel="September"
        periodEnd="2026-09-30T23:59:59.000Z"
        onDone={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('The new reading'), { target: { value: '4812' } });
    fireEvent.click(screen.getByText(/This is September's number/));
    fireEvent.click(screen.getByText(/Report \$4,812/));
    await waitFor(() =>
      expect(reportMetricValue).toHaveBeenCalledWith('ws', 'm1', {
        value: 4812,
        oldValue: 0,
        updateNote: '',
        asOf: '2026-09-30T23:59:59.000Z',
      }),
    );
  });

  test('and a reading of now carries no date at all, which is the usual case', async () => {
    render(<ReportValueDialog {...props} lastValue={0} rangeEditable={false} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('The new reading'), { target: { value: '4812' } });
    expect(screen.queryByText(/not today's/)).toBeNull();
    fireEvent.click(screen.getByText(/Report \$4,812/));
    await waitFor(() => expect(reportMetricValue.mock.calls[0][2]).not.toHaveProperty('asOf'));
  });

  // Owner ask 2026-08-31: past values have to be easy from the page, not only
  // for the one period the checkbox covers.
  test('any past day and hour can be filed, and it says where it lands', async () => {
    render(<ReportValueDialog {...props} lastValue={0} rangeEditable={false} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('The new reading'), { target: { value: '4812' } });
    fireEvent.change(screen.getByLabelText('The day this reading was true'), { target: { value: '2026-08-29' } });
    fireEvent.change(screen.getByLabelText('The hour it was true, UTC'), { target: { value: '18:00' } });
    expect(screen.getByText(/Filed at 2026-08-29, 18:00 UTC/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Report \$4,812/));
    await waitFor(() => expect(reportMetricValue.mock.calls[0][2]).toMatchObject({ asOf: '2026-08-29T18:00:00.000Z' }));
  });

  test('a day with no hour lands at the end of that day, where the market looks', async () => {
    render(<ReportValueDialog {...props} lastValue={0} rangeEditable={false} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('The new reading'), { target: { value: '4812' } });
    fireEvent.change(screen.getByLabelText('The day this reading was true'), { target: { value: '2026-08-29' } });
    fireEvent.click(screen.getByText(/Report \$4,812/));
    await waitFor(() => expect(reportMetricValue.mock.calls[0][2]).toMatchObject({ asOf: '2026-08-29T23:59:00.000Z' }));
  });

  test('a future day is refused on the page, not by the server', async () => {
    render(<ReportValueDialog {...props} lastValue={0} rangeEditable={false} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('The new reading'), { target: { value: '4812' } });
    fireEvent.change(screen.getByLabelText('The day this reading was true'), { target: { value: '2099-01-01' } });
    expect(screen.getByText(/in the future, so it is not a measurement/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Report \$4,812/));
    await waitFor(() => expect(reportMetricValue.mock.calls[0][2]).not.toHaveProperty('asOf'));
  });

  // Owner ask 2026-09-01: N/A is an answer, not a gap. An implied valuation
  // with no round closed is not a company worth nothing.
  test('the number can be reported as not existing, and that is not a zero', async () => {
    render(<ReportValueDialog {...props} lastValue={0} rangeEditable={false} onDone={() => {}} />);
    fireEvent.click(screen.getByText(/There is no number for this/));
    expect(screen.getByText('Report it as not existing')).toBeTruthy();
    expect(screen.getByText(/voids as N\/A, with every position refunded/)).toBeTruthy();
    fireEvent.click(screen.getByText('Report it as not existing'));
    await waitFor(() => expect(reportMetricValue.mock.calls[0][2]).toMatchObject({ na: true }));
  });

  test('and it needs no number typed, because there is not one', async () => {
    render(<ReportValueDialog {...props} lastValue={null} lastAt={null} rangeEditable={false} onDone={() => {}} />);
    const go = screen.getByRole('button', { name: /Report/ }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByText(/There is no number for this/));
    expect((screen.getByRole('button', { name: /Report it as not existing/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  test('a range the owner typed under the reading is refused, not sent', async () => {
    render(<ReportValueDialog {...props} lastValue={0} rangeMax={1000} rangeEditable={true} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('The new reading'), { target: { value: '4200' } });
    fireEvent.change(screen.getByLabelText('Highest it could plausibly reach'), { target: { value: '1000' } });
    fireEvent.click(screen.getByText(/Report \$4,200/));
    await waitFor(() => expect(screen.getByText(/range has to reach the number/)).toBeTruthy());
    expect(reportMetricValue).not.toHaveBeenCalled();
  });

  test('once trades froze the machinery it says what a number above the band does', () => {
    render(<ReportValueDialog {...props} rangeMax={50000} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('The new reading'), { target: { value: '90000' } });
    expect(screen.queryByLabelText('Highest it could plausibly reach')).toBeNull();
    expect(screen.getByText(/frozen by trades: it settles at the top/)).toBeTruthy();
  });
});
