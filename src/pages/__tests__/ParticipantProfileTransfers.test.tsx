import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The profile's Transfers section (docs/ui-conventions.md, "The participant
 * profile", Transfers): one row per credit transfer sent or received, in
 * plain words, the counterparty linking to their profile, the memo as the
 * sub-line, the signed credits on the right.
 */

const getPublicProfile = vi.fn();
vi.mock('../../lib/api', () => ({ api: { getPublicProfile: (id: string) => getPublicProfile(id) } }));
vi.mock('../../components/PageTopBar', () => ({ PageTopBar: () => null }));

import { ParticipantProfilePage } from '../ParticipantProfilePage';

const now = Date.now();
const ago = (h: number) => new Date(now - h * 3600_000).toISOString();

const base = {
  id: 'bot-1',
  nickname: 'bobalobascrob',
  image: null,
  manifoldUsername: null,
  intent: null,
  bio: null,
  joinedAt: '2026-09-12T14:39:18.443Z',
  parent: null,
  children: [],
  balance: 29571,
  stats: {
    rank: 2,
    calibration: null,
    accuracy: null,
    totalEarnings: 100,
    settledEarnings: 100,
    openEarnings: 0,
    resolvedMarkets: 1,
    totalTrades: 1,
    tradedVolume: 10,
    lastTradeAt: ago(2),
  },
  activeWorkspaces: [],
  openPositions: [],
  recentTrades: [],
  proposedJobs: [],
  balanceHistory: [],
  pnlHistory: [],
  transfers: [
    {
      id: 'x-out',
      direction: 'out',
      counterparty: { id: 'human-1', nickname: 'bobalob-ascrob' },
      credits: 15000,
      memo: 'park savings away from the bot',
      createdAt: ago(1),
    },
    {
      id: 'x-in',
      direction: 'in',
      counterparty: { id: 'human-1', nickname: 'bobalob-ascrob' },
      credits: 10000,
      memo: '',
      createdAt: ago(5),
    },
  ],
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/participants/bobalobascrob']}>
      <Routes>
        <Route path="/participants/:id" element={<ParticipantProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );

/** A row title is a span whose text is split around the counterparty link. */
const titled = (text: string) =>
  screen.findByText((_c, el) => el?.className === 'prof-row-title' && el.textContent === text);

beforeEach(() => {
  getPublicProfile.mockReset();
  getPublicProfile.mockResolvedValue(base);
});

describe('the profile lists transfers', () => {
  test('a sent transfer reads "Sent N cr to <handle>" and links to the counterparty', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Transfers' })).toBeInTheDocument();
    const row = (await titled('Sent 15,000 cr to bobalob-ascrob')).closest('li')!;
    expect(row).toHaveTextContent('park savings away from the bot');
    expect(row).toHaveTextContent('-15,000 cr');
    expect(row.querySelector('a')!.getAttribute('href')).toBe('/participants/human-1');
  });

  test('a received transfer reads "Received N cr from <handle>" with the credits positive', async () => {
    renderPage();
    const row = (await titled('Received 10,000 cr from bobalob-ascrob')).closest('li')!;
    expect(row).toHaveTextContent('+10,000 cr');
  });

  test('no transfers: the section says so', async () => {
    getPublicProfile.mockResolvedValue({ ...base, transfers: [] });
    renderPage();
    const heading = await screen.findByRole('heading', { name: 'Transfers' });
    expect(heading.closest('section')).toHaveTextContent(/nothing yet/i);
  });

  test('an older payload without the field renders without the section crashing the page', async () => {
    const { transfers: _t, ...older } = base;
    getPublicProfile.mockResolvedValue(older);
    renderPage();
    expect(await screen.findByText('bobalobascrob')).toBeInTheDocument();
  });
});
