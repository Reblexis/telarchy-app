import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The owner's metrics page (docs/metrics-page.md).
 *
 * What matters here is not that rows render. It is that the page never lies
 * about money or about what a click does: a chip says the date its market
 * settles on, a metric with no date says so in the words the doc fixes, and
 * closing a market that has other people's trades on it asks first.
 */

const overview = {
  defaultCredits: 1200,
  autoFund: true,
  metrics: [
    {
      id: 'm1',
      name: 'Paying customers',
      description: 'Active Stripe subscriptions.',
      rangeMin: 0,
      rangeMax: 5000,
      credits: null,
      curve: false,
      horizons: [
        { marketId: 'k1', targetDate: '2026-09', settlesOn: '2026-09-30T23:59:59.000Z', pool: 1240, trades: 0 },
        { marketId: 'k2', targetDate: '2026-12', settlesOn: '2026-12-31T23:59:59.000Z', pool: 980, trades: 7 },
      ],
    },
    {
      id: 'm2',
      name: 'Net promoter score',
      description: 'Not measured yet.',
      rangeMin: 0,
      rangeMax: 100,
      credits: 600,
      curve: false,
      horizons: [],
    },
    {
      id: 'm3',
      name: 'Implied valuation',
      description: 'From the last round.',
      rangeMin: 0,
      rangeMax: 1000000,
      credits: null,
      curve: true,
      horizons: [{ marketId: 'k3', targetDate: '2027', settlesOn: '2027-12-31T23:59:59.000Z', pool: 400, trades: 0 }],
    },
  ],
};

const getMetricsOverview = vi.fn(async () => overview);
const getMarketplaceWorkspace = vi.fn(async () => ({ workspaceId: 'ws', name: 'Meridian', slug: 'meridian' }));
const getProfile = vi.fn(async () => ({ capabilities: ['read', 'trade', 'manage'] }));
const patchMetric = vi.fn(async () => ({}));

vi.mock('../../lib/api', () => ({
  api: {
    getMetricsOverview: () => getMetricsOverview(),
    getMarketplaceWorkspace: () => getMarketplaceWorkspace(),
    getProfile: () => getProfile(),
    patchMetric: (...a: unknown[]) => patchMetric(...(a as [])),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u' }, loading: false }) }));
vi.mock('../../components/PageTopBar', () => ({ PageTopBar: () => null }));

import { MetricsPage } from '../MetricsPage';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/meridian/metrics']}>
      <Routes>
        <Route path="/:slug/metrics" element={<MetricsPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  getMetricsOverview.mockClear();
  patchMetric.mockClear();
  // spyOn reuses the existing spy, so the history has to be cleared here or
  // one test sees the previous test's confirm.
  vi.spyOn(window, 'confirm').mockReturnValue(true).mockClear();
});

describe('the metrics page', () => {
  test('a chip carries the date its market settles on and what it holds', async () => {
    renderPage();
    expect(await screen.findByText('Paying customers')).toBeTruthy();
    // Not "2026-09": the owner reads a date, and the words alone would not say
    // which day the market resolves against.
    expect(screen.getByText(/to 30 Sep/)).toBeTruthy();
    expect(screen.getByText('1,240 cr')).toBeTruthy();
    expect(screen.getByText('980 cr')).toBeTruthy();
  });

  test('a metric with no date says it has no market, in the words the doc fixes', async () => {
    renderPage();
    expect(await screen.findByText('No market. Add a date and this number gets a price.')).toBeTruthy();
  });

  test('the workspace default is stated once, and an unset metric shows it as a placeholder', async () => {
    renderPage();
    expect(await screen.findByText(/a new market opens with 1,200 cr/)).toBeTruthy();
    const unset = screen.getByLabelText('Credits a new market on Paying customers opens with') as HTMLInputElement;
    expect(unset.value).toBe('');
    expect(unset.placeholder).toBe('1,200');
    const set = screen.getByLabelText('Credits a new market on Net promoter score opens with') as HTMLInputElement;
    expect(set.value).toBe('600');
  });

  test('typing credits writes them on blur, and clearing puts the metric back on the default', async () => {
    renderPage();
    const input = await screen.findByLabelText('Credits a new market on Paying customers opens with');
    fireEvent.change(input, { target: { value: '2400' } });
    fireEvent.blur(input);
    await waitFor(() => expect(patchMetric).toHaveBeenCalledWith('ws', 'm1', { liquidityCredits: 2400 }));

    patchMetric.mockClear();
    const set = screen.getByLabelText('Credits a new market on Net promoter score opens with');
    fireEvent.change(set, { target: { value: '' } });
    fireEvent.blur(set);
    await waitFor(() => expect(patchMetric).toHaveBeenCalledWith('ws', 'm2', { liquidityCredits: null }));
  });

  test('adding a date sends the existing horizons plus the new one', async () => {
    renderPage();
    const addButtons = await screen.findAllByRole('button', { name: /date/i });
    fireEvent.click(addButtons[0]);
    fireEvent.click(screen.getAllByText('This year')[0]);
    await waitFor(() => expect(patchMetric).toHaveBeenCalled());
    const [, , body] = patchMetric.mock.calls[0] as unknown as [
      string,
      string,
      { timePreference: { customHorizons: string[] } },
    ];
    expect(body.timePreference.customHorizons).toContain('2026-09');
    expect(body.timePreference.customHorizons).toContain('2026-12');
    expect(body.timePreference.customHorizons).toHaveLength(3);
  });

  test('closing a market with trades on it asks first, and a refusal changes nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    const close = await screen.findByLabelText('Close the 2026-12 market');
    fireEvent.click(close);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('7 trades stand'));
    expect(patchMetric).not.toHaveBeenCalled();
  });

  test('closing an untraded market does not ask, and drops just that date', async () => {
    renderPage();
    const close = await screen.findByLabelText('Close the 2026-09 market');
    fireEvent.click(close);
    expect(window.confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(patchMetric).toHaveBeenCalled());
    const [, , body] = patchMetric.mock.calls[0] as unknown as [
      string,
      string,
      { timePreference: { customHorizons: string[] } },
    ];
    expect(body.timePreference.customHorizons).toEqual(['2026-12']);
  });

  test('a curve metric keeps its chips read-only and says why', async () => {
    renderPage();
    expect(await screen.findByText(/decay curve/)).toBeTruthy();
    expect(screen.queryByLabelText('Close the 2027 market')).toBeNull();
  });
});
