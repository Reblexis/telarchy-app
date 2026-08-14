import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { LeaderboardRail } from '../FloorRails';
import type { LeaderboardEntry, PublicContractor } from '../../lib/api';

const trader = (o: Partial<LeaderboardEntry>): LeaderboardEntry => ({
  rank: 1,
  id: 'a',
  nickname: 'ana',
  calibration: null,
  accuracy: null,
  totalEarnings: 0,
  resolvedMarkets: 0,
  totalTrades: 3,
  lastTradeAt: null,
  ...o,
} as LeaderboardEntry);

const contractor = (o: Partial<PublicContractor>): PublicContractor => ({
  id: 'c',
  name: 'cara',
  impact: 0,
  jobs: 1,
  pendingJobs: 1,
  pricedJobs: 1,
  earnedUsd: 0,
  ...o,
});

const contractorsBlock = () =>
  screen.getByRole('heading', { name: 'Top contractors' }).closest('section') as HTMLElement;

describe('LeaderboardRail contractors', () => {
  test('shows the market valuation of a job nobody has paid for yet', () => {
    render(<LeaderboardRail entries={[]} contractors={[contractor({ impact: 412, earnedUsd: 0 })]} />);
    const block = within(contractorsBlock());
    expect(block.getByText(/\+412/)).toBeInTheDocument();
    expect(block.getByText(/1 job/)).toBeInTheDocument();
  });

  test('a job the market prices as harmful reads negative', () => {
    render(<LeaderboardRail entries={[]} contractors={[contractor({ impact: -40.5 })]} />);
    expect(within(contractorsBlock()).getByText(/-40\.5/)).toBeInTheDocument();
  });

  test('dollars earned move to the second line, not the score slot', () => {
    render(<LeaderboardRail entries={[]} contractors={[
      contractor({ impact: 180, jobs: 3, pendingJobs: 1, earnedUsd: 900 }),
    ]} />);
    const block = within(contractorsBlock());
    expect(block.getByText(/3 jobs · 1 live · \$900 earned/)).toBeInTheDocument();
    expect(block.getByText(/\+180/)).toBeInTheDocument();
  });

  test('an unpriced job says so instead of printing a confident zero', () => {
    render(<LeaderboardRail entries={[]} contractors={[contractor({ impact: 0, pricedJobs: 0 })]} />);
    expect(within(contractorsBlock()).getByText('not priced yet')).toBeInTheDocument();
  });

  test('with no hero metric to price against, the rail falls back to dollars', () => {
    render(<LeaderboardRail entries={[]} contractors={[
      contractor({ impact: null, pricedJobs: 0, jobs: 2, pendingJobs: 0, earnedUsd: 1200 }),
    ]} />);
    expect(within(contractorsBlock()).getByText('$1,200')).toBeInTheDocument();
  });

  test('the hero metric unit prefixes the score', () => {
    render(<LeaderboardRail entries={[]} contractors={[contractor({ impact: 2500 })]} unit="$" />);
    expect(within(contractorsBlock()).getByText(/\+\$2,500/)).toBeInTheDocument();
  });

  test('an empty board still invites the first job', () => {
    render(<LeaderboardRail entries={[]} contractors={[]} />);
    expect(screen.getByText(/No jobs on the board yet/)).toBeInTheDocument();
  });
});

describe('LeaderboardRail traders', () => {
  test('signs the profit and skips participants who never traded', () => {
    render(<LeaderboardRail
      entries={[
        trader({ id: 'a', nickname: 'ana', totalEarnings: 120, totalTrades: 4 }),
        trader({ id: 'b', nickname: 'bo', totalEarnings: -30, totalTrades: 2, rank: 2 }),
        trader({ id: 'c', nickname: 'cy', totalEarnings: 0, totalTrades: 0, rank: 3 }),
      ]}
    />);
    const block = within(screen.getByRole('heading', { name: 'Top traders' }).closest('section') as HTMLElement);
    expect(block.getByText('+120 cr')).toBeInTheDocument();
    expect(block.getByText('-30 cr')).toBeInTheDocument();
    expect(block.queryByText('cy')).not.toBeInTheDocument();
  });
});
