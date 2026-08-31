import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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
const getMetric = vi.fn(async () => ({
  id: 'm1',
  name: 'LookPilot net 2026 (USD)',
  timePreference: { enabled: false, halfLife: 1, customHorizons: ['2026-12'] },
}));
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
  getMetric.mockClear();
  patchMetric.mockClear();
  reportMetricValue.mockClear();
  injectLiquidity.mockClear();
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

describe('dialog 2: add a date', () => {
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

  // A fresh workspace carries 0.5 credits per auto-funded market, so the
  // dialog used to prefill 1 and opened the owner's first market at a credit
  // (walkthrough, 2026-08-30). A market nobody can move is worse than none.
  test('a decoration-sized workspace default is not what the first market opens with', () => {
    renderIt(vi.fn(), { defaultCredits: 0.5, spendable: 50000 });
    expect(screen.getByText(/Open the market · 1,000 cr/)).toBeTruthy();
  });

  test('the prefill never asks for more than the owner holds', () => {
    renderIt(vi.fn(), { defaultCredits: 0.5, spendable: 200 });
    expect(screen.getByText(/Open the market · 200 cr/)).toBeTruthy();
  });

  test('the heading names the metric and what is behind it, both from the caller', () => {
    renderIt(vi.fn(), { spendable: 200 });
    expect(screen.getByText('Liquidity behind LookPilot net 2026 (USD) · from your 200 cr')).toBeTruthy();
  });

  test('a calendar pick is a ROLLING entry appended to the stored horizons, with the liquidity as the metric depth', async () => {
    renderIt();
    // "this week" is preselected; the button carries the prefilled cost.
    fireEvent.click(screen.getByText(/Open the market · 1,200 cr/));
    await waitFor(() => expect(patchMetric).toHaveBeenCalled());
    const [wsId, id, body] = patchMetric.mock.calls[0] as unknown as [
      string,
      string,
      { liquidityCredits: number; timePreference: { enabled: boolean; customHorizons: string[] } },
    ];
    expect(wsId).toBe('ws');
    expect(id).toBe('m1');
    expect(body.liquidityCredits).toBe(1200);
    // The stored '2026-12' survives; the rolling entry joins it.
    expect(body.timePreference.customHorizons).toEqual(['2026-12', '+0w']);
    expect(body.timePreference.enabled).toBe(false);
  });

  test('the picker is always there; a picked day is one-shot and deselects the chips', async () => {
    renderIt();
    // No mode toggle (Manifold's shape): the date input is already rendered.
    const input = screen.getByLabelText('Pick a date');
    fireEvent.change(input, { target: { value: '2026-09-30' } });
    // The chip is no longer the selection.
    expect(screen.getByText('this week').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByText(/Open the market/));
    await waitFor(() => expect(patchMetric).toHaveBeenCalled());
    const [, , body] = patchMetric.mock.calls[0] as unknown as [
      string,
      string,
      { timePreference: { customHorizons: string[] } },
    ];
    expect(body.timePreference.customHorizons).toEqual(['2026-12', '2026-09-30']);
  });

  test('an hour makes an hour market: the entry gains its UTC hour and the fact says when', async () => {
    renderIt();
    fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-09-30' } });
    const time = screen.getByLabelText('Pick an hour, UTC');
    // Minutes snap to the hour: markets settle on the hour, never at :30.
    fireEvent.change(time, { target: { value: '14:30' } });
    expect(screen.getByText(/14:59 UTC/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Open the market/));
    await waitFor(() => expect(patchMetric).toHaveBeenCalled());
    const [, , body] = patchMetric.mock.calls[0] as unknown as [
      string,
      string,
      { timePreference: { customHorizons: string[] } },
    ];
    expect(body.timePreference.customHorizons).toEqual(['2026-12', '2026-09-30T14']);
  });

  test('the hour is disabled until a day is picked, and a chip clears both', () => {
    renderIt();
    const time = screen.getByLabelText('Pick an hour, UTC') as HTMLInputElement;
    expect(time.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-09-30' } });
    expect(time.disabled).toBe(false);
    fireEvent.change(time, { target: { value: '14:00' } });
    fireEvent.click(screen.getByText('this month'));
    expect(time.value).toBe('');
    expect(time.disabled).toBe(true);
  });

  test('clicking a chip clears the picked day and goes back to rolling', async () => {
    renderIt();
    const input = screen.getByLabelText('Pick a date') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByText('this month'));
    expect(input.value).toBe('');
    fireEvent.click(screen.getByText(/Open the market/));
    await waitFor(() => expect(patchMetric).toHaveBeenCalled());
    const [, , body] = patchMetric.mock.calls[0] as unknown as [
      string,
      string,
      { timePreference: { customHorizons: string[] } },
    ];
    expect(body.timePreference.customHorizons).toEqual(['2026-12', '+0m']);
  });

  test('the liquidity typed is the liquidity sent, and the button restates it', async () => {
    renderIt();
    const amount = screen.getByLabelText('Credits behind the market');
    fireEvent.change(amount, { target: { value: '2,500' } });
    expect(screen.getByText(/Open the market · 2,500 cr/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Open the market · 2,500 cr/));
    await waitFor(() => expect(patchMetric).toHaveBeenCalled());
    const [, , body] = patchMetric.mock.calls[0] as unknown as [string, string, { liquidityCredits: number }];
    expect(body.liquidityCredits).toBe(2500);
  });
});

describe('dialog 3: inject liquidity', () => {
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
