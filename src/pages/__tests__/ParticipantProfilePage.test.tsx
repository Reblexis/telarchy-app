import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A trader's public record (docs/ui-conventions.md, "The participant
 * profile"): the strip of numbers the platform already reports elsewhere,
 * the balance line, and rows that each lead back to the market, the trade
 * rows to the trade itself.
 */

const getPublicProfile = vi.fn();
vi.mock('../../lib/api', () => ({ api: { getPublicProfile: (id: string) => getPublicProfile(id) } }));
vi.mock('../../components/PageTopBar', () => ({ PageTopBar: () => null }));

import { ParticipantProfilePage } from '../ParticipantProfilePage';

const WS = '2015d2e5-999c-4f94-aa19-e3733451732f';
const MKT = 'ca7d62b5-954f-4e04-8bc0-7eeb94fbbec4';
const COND = '5cea073a-0947-49b9-be70-aeeb2fb3eda3';
const PROP = '01969f53-24d9-43ad-bc57-ac5838cc9ae6';
const now = Date.now();
const ago = (h: number) => new Date(now - h * 3600_000).toISOString();

const base = {
  id: 'nScjsunIDFLtUOmqAAR1Oj8Ln0WlLjPA',
  nickname: 'vire',
  image: null,
  manifoldUsername: 'spacedroplet',
  intent: null,
  bio: null,
  joinedAt: '2026-08-21T14:39:18.443Z',
  parent: null,
  children: [],
  balance: 99306,
  stats: {
    rank: 1,
    calibration: null,
    accuracy: null,
    totalEarnings: 6336.66,
    settledEarnings: 0,
    openEarnings: 6336.66,
    resolvedMarkets: 0,
    totalTrades: 5,
    tradedVolume: 11244,
    lastTradeAt: ago(2),
  },
  activeWorkspaces: [{ id: WS, name: 'Telarchy' }],
  openPositions: [
    {
      workspaceId: WS,
      workspaceName: 'Telarchy',
      workspaceSlug: 'telarchy',
      marketId: MKT,
      proposalId: null,
      metricName: 'Active traders',
      targetDate: '2026-09',
      resolvesOn: '2026-10-01T00:00:00Z',
      direction: 'higher',
      shares: 43471.1,
      totalCost: 11214,
      status: 'open',
      probabilityHigher: 0.4035,
      consensus: 20.18,
      actualValue: null,
      worth: 17541,
      profit: 6327,
    },
    {
      workspaceId: WS,
      workspaceName: 'Telarchy',
      workspaceSlug: 'telarchy',
      marketId: COND,
      proposalId: PROP,
      proposalTitle: 'I will spend 10 minutes giving the best advice I can',
      metricName: 'Active traders',
      targetDate: '2026-09',
      resolvesOn: '2026-10-01T00:00:00Z',
      direction: 'higher',
      shares: 58.0076,
      totalCost: 30,
      status: 'conditional',
      probabilityHigher: 0.6158,
      consensus: 30.79,
      actualValue: null,
      worth: 35.7,
      profit: 5.7,
    },
  ],
  recentTrades: [
    {
      id: 'efeb9859-53bc-4ff0-b338-b37847991411',
      workspaceId: WS,
      workspaceName: 'Telarchy',
      workspaceSlug: 'telarchy',
      marketId: MKT,
      proposalId: null,
      metricName: 'Active traders',
      targetDate: '2026-09',
      direction: 'higher',
      kind: 'buy',
      shares: 21191.72,
      cost: 6300,
      price: 0.2973,
      consensusBefore: 18.9,
      consensusAfter: 20.18,
      createdAt: ago(2),
    },
    {
      id: 'af6a1ead-5915-4836-b329-23d0b72ffe33',
      workspaceId: WS,
      workspaceName: 'Telarchy',
      workspaceSlug: 'telarchy',
      marketId: COND,
      proposalId: PROP,
      metricName: 'Active traders',
      targetDate: '2026-09',
      direction: 'higher',
      kind: 'buy',
      shares: 58.0076,
      cost: 30,
      price: 0.5172,
      consensusBefore: null,
      consensusAfter: null,
      createdAt: ago(170),
    },
    {
      id: 'sold-1',
      workspaceId: WS,
      workspaceName: 'Telarchy',
      workspaceSlug: 'telarchy',
      marketId: MKT,
      proposalId: null,
      metricName: 'Active traders',
      targetDate: '2026-09',
      direction: 'lower',
      kind: 'sell',
      shares: 120,
      cost: -84,
      price: 0.7,
      consensusBefore: 22.4,
      consensusAfter: 22.9,
      createdAt: ago(200),
    },
    {
      id: 'redeem-1',
      workspaceId: WS,
      workspaceName: 'Telarchy',
      workspaceSlug: 'telarchy',
      marketId: MKT,
      proposalId: null,
      metricName: 'Active traders',
      targetDate: '2026-09',
      direction: null,
      kind: 'redeem',
      shares: 1,
      cost: -1,
      price: null,
      consensusBefore: null,
      consensusAfter: null,
      createdAt: ago(240),
    },
  ],
  proposedJobs: [
    {
      id: PROP,
      workspaceId: WS,
      workspaceSlug: 'telarchy',
      workspaceName: 'Telarchy',
      title: '$50: I will spend 10 minutes giving the best advice I can',
      askUsd: 50,
      status: 'approved',
      createdAt: ago(170),
    },
  ],
  balanceHistory: [
    { at: '2026-08-30T00:00:00Z', balance: 110256 },
    { at: '2026-09-01T00:00:00Z', balance: 105581 },
    { at: '2026-09-04T12:00:58Z', balance: 99306 },
  ],
  profitHistory: [
    { at: '2026-09-01T00:00:00Z', profit: 1204 },
    { at: '2026-09-04T12:00:58Z', profit: 6336.66 },
  ],
  pnlHistory: [],
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/participants/vire']}>
      <Routes>
        <Route path="/participants/:id" element={<ParticipantProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  getPublicProfile.mockReset();
  getPublicProfile.mockResolvedValue(base);
});

describe('the header', () => {
  test('says since when they trade and where they stand', async () => {
    renderPage();
    expect(await screen.findByText(/Trading since Aug 21, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/#1 on the leaderboard/)).toBeInTheDocument();
  });

  test('a participant with no rank gets no rank line', async () => {
    getPublicProfile.mockResolvedValue({ ...base, stats: { ...base.stats, rank: null } });
    renderPage();
    await screen.findByText(/Trading since/);
    expect(screen.queryByText(/on the leaderboard/)).toBeNull();
  });
});

describe('the stats strip', () => {
  test('profit is the board number with its settled and open split', async () => {
    renderPage();
    const profit = await screen.findByTestId('prof-stat-profit');
    expect(profit.textContent).toContain('+6,337 cr');
    expect(profit.textContent).toContain('0 settled');
    expect(profit.textContent).toContain('+6,337 open');
    expect(profit.querySelector('.is-up')).not.toBeNull();
  });

  test('balance is the live tradeable balance, with what sits in positions', async () => {
    renderPage();
    const bal = await screen.findByTestId('prof-stat-balance');
    expect(bal.textContent).toContain('99,306 cr');
    // 17,541 + 35.7, rounded.
    expect(bal.textContent).toContain('17,577 cr in positions');
  });

  test('trades count, credits traded and the last one', async () => {
    renderPage();
    const tr = await screen.findByTestId('prof-stat-trades');
    expect(tr.textContent).toContain('5');
    expect(tr.textContent).toContain('11,244 cr traded');
    expect(tr.textContent).toContain('2h ago');
  });

  test('a loss reads red', async () => {
    getPublicProfile.mockResolvedValue({
      ...base,
      stats: { ...base.stats, totalEarnings: -120, settledEarnings: -120, openEarnings: 0 },
    });
    renderPage();
    const profit = await screen.findByTestId('prof-stat-profit');
    expect(profit.textContent).toContain('-120 cr');
    expect(profit.querySelector('.is-down')).not.toBeNull();
  });
});

describe('the balance chart', () => {
  // The floor's market chart, in ink (docs/ui-conventions.md, "The
  // participant profile"): the same crosshair, tooltip and range words.
  test('is the floor chart with the balance as its series, in ink', async () => {
    renderPage();
    const chart = await screen.findByRole('img', { name: /balance/i });
    expect(chart.tagName.toLowerCase()).toBe('svg');
    expect(chart.closest('.mchart')!.className).toContain('mchart--ink');
    expect(chart.getAttribute('aria-label')).toContain('99,306');
    expect(screen.getByRole('button', { name: '1W' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1M' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('hovering names the balance at that moment, never the market', async () => {
    renderPage();
    const chart = await screen.findByRole('img', { name: /balance/i });
    chart.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 720,
      height: 260,
      right: 720,
      bottom: 260,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent(chart, new MouseEvent('pointermove', { bubbles: true, clientX: 700, clientY: 100 }));
    await new Promise(r => requestAnimationFrame(() => r(null)));
    const tip = await waitFor(() => {
      const el = document.querySelector('.mchart-tip');
      if (!el) throw new Error('no tip yet');
      return el;
    });
    expect(tip.textContent).toContain('balance');
    expect(tip.textContent).not.toContain('market');
    expect(tip.textContent).toContain('99,306');
  });

  test('a single point draws nothing', async () => {
    getPublicProfile.mockResolvedValue({ ...base, balanceHistory: [{ at: '2026-09-04T12:00:00Z', balance: 99306 }] });
    renderPage();
    await screen.findByText(/Trading since/);
    expect(screen.queryByRole('img', { name: /balance/i })).toBeNull();
  });
});

describe('the pressable strip', () => {
  // Manifold's balance / invested / profit tiles: the pressed cell is the
  // series the chart draws (docs/ui-conventions.md, "The participant
  // profile"). Balance on arrival; Trades is a number, not a series.
  test('Balance is pressed on arrival and Trades is not a button', async () => {
    renderPage();
    const balance = await screen.findByRole('button', { name: /^balance/i });
    expect(balance).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^profit/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /^trades/i })).toBeNull();
  });

  test('pressing Profit draws the profit instead', async () => {
    renderPage();
    const profit = await screen.findByRole('button', { name: /^profit/i });
    fireEvent.click(profit);
    expect(profit).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^balance/i })).toHaveAttribute('aria-pressed', 'false');
    const chart = screen.getByRole('img', { name: /^the profit over time/i });
    expect(chart.getAttribute('aria-label')).toContain('6,337');
    expect(screen.queryByRole('img', { name: /^the balance over time/i })).toBeNull();
  });

  test('a profit history with under two points says when it starts', async () => {
    getPublicProfile.mockResolvedValue({ ...base, profitHistory: [{ at: '2026-09-04T12:00:58Z', profit: 6336.66 }] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^profit/i }));
    expect(screen.queryByRole('img', { name: /over time/i })).toBeNull();
    expect(screen.getByText('Recorded once a day; the first point lands tomorrow.')).toBeInTheDocument();
  });

  test('an older payload without profitHistory still renders', async () => {
    const { profitHistory: _omit, ...older } = base;
    getPublicProfile.mockResolvedValue(older);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^profit/i }));
    expect(screen.getByText('Recorded once a day; the first point lands tomorrow.')).toBeInTheDocument();
  });
});

describe('positions', () => {
  test('a row names the market, the holding, the call, and the profit with worth and spent', async () => {
    renderPage();
    const row = (await screen.findAllByText('Active traders · Sep 2026', { selector: '.prof-row-title' }))[0].closest(
      'li',
    )!;
    expect(row.textContent).toContain('43,471 higher');
    expect(row.textContent).toContain('market at 20.18');
    expect(row.textContent).toContain('40% higher');
    expect(row.textContent).toContain('+6,327 cr');
    expect(row.textContent).toContain('worth 17,541');
    expect(row.textContent).toContain('spent 11,214');
    expect(row.querySelector('a')).toHaveAttribute('href', `/telarchy#market=${MKT}`);
  });

  test('a conditional position says which proposal and links to it', async () => {
    renderPage();
    const row = (await screen.findByText(/if "I will spend 10 minutes/)).closest('li')!;
    expect(row.querySelector('a')).toHaveAttribute('href', `/telarchy#proposal=${PROP}`);
  });
});

describe('trades', () => {
  test('a buy says what was bought, the price per share, and how far it moved the market', async () => {
    renderPage();
    const row = (await screen.findByText('Bought 21,192 higher on Active traders · Sep 2026')).closest('li')!;
    expect(row.textContent).toContain('0.297 cr a share');
    expect(row.textContent).toContain('moved the market 18.9 → 20.18');
    expect(row.textContent).toContain('6,300 cr');
    expect(row.textContent).toContain('2h ago');
  });

  test('every trade row is a link to that trade on its floor', async () => {
    renderPage();
    const row = (await screen.findByText('Bought 21,192 higher on Active traders · Sep 2026')).closest('li')!;
    expect(row.querySelector('a')).toHaveAttribute(
      'href',
      `/telarchy#market=${MKT}&trade=efeb9859-53bc-4ff0-b338-b37847991411`,
    );
  });

  test('a trade on a proposal branch links through the proposal', async () => {
    renderPage();
    const row = (await screen.findByText('Bought 58.0 higher on Active traders · Sep 2026')).closest('li')!;
    expect(row.querySelector('a')).toHaveAttribute(
      'href',
      `/telarchy#proposal=${PROP}&trade=af6a1ead-5915-4836-b329-23d0b72ffe33`,
    );
  });

  test('a trade that did not record the call shows the price alone', async () => {
    renderPage();
    const row = (await screen.findByText('Bought 58.0 higher on Active traders · Sep 2026')).closest('li')!;
    expect(row.textContent).toContain('0.517 cr a share');
    expect(row.textContent).not.toContain('moved the market');
  });

  test('a sell reads as a sale with proceeds', async () => {
    renderPage();
    const row = (await screen.findByText('Sold 120 lower on Active traders · Sep 2026')).closest('li')!;
    expect(row.textContent).toContain('+84 cr');
    expect(row.textContent).toContain('0.700 cr a share');
    expect(row.textContent).toContain('moved the market 22.4 → 22.9');
  });

  test('a redemption is neither a trade nor a move', async () => {
    renderPage();
    const row = (await screen.findByText('Redeemed 1.0 matched pairs')).closest('li')!;
    expect(row.textContent).not.toContain('a share');
    expect(row.textContent).not.toContain('moved the market');
    expect(row.querySelector('a')).toHaveAttribute('href', `/telarchy#market=${MKT}&trade=redeem-1`);
  });
});

describe('proposals', () => {
  test('the section is called Proposals and each row links to the proposal', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Proposals' })).toBeInTheDocument();
    expect(screen.queryByText(/Proposed jobs/)).toBeNull();
    const row = screen
      .getByText('I will spend 10 minutes giving the best advice I can', { selector: '.prof-row-title' })
      .closest('li')!;
    expect(row.textContent).toContain('asks $50');
    expect(row.textContent).toContain('approved');
    expect(row.querySelector('a')).toHaveAttribute('href', `/telarchy#proposal=${PROP}`);
  });
});
