import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/**
 * The impact a contract prints is the approved-minus-declined delta of the
 * pair for the metric AND the date on screen (owner report 2026-08-26: "the
 * impact shown doesn match the actual approved-declined result of the
 * markets"). The fixture is the grid the old fixtures never had: two metrics
 * read on the same three dates, six pairs per contract, the larger delta on
 * the OTHER metric.
 */

vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { deltaAt, JobsBoard } from '../JobsBoard';

const pair = (metricId: string, targetDate: string, approved: number, declined: number) => ({
  metricId,
  metricName: metricId === 'rev' ? 'LookPilot net revenue (USD)' : 'LookPilot Steam reviews',
  targetDate,
  resolvesOn: '2026-09-01T00:00:00Z',
  approvedConsensus: approved,
  declinedConsensus: declined,
  delta: approved - declined,
  approvedMarketId: `${metricId}-${targetDate}-a`,
  declinedMarketId: `${metricId}-${targetDate}-d`,
  approvedProbability: 0.5,
  approvedLiquidity: 100,
  declinedProbability: 0.5,
  declinedLiquidity: 100,
  rangeMin: 0,
  rangeMax: 25_000,
});

// Largest impact first, as the payload ships them: the reviews pair leads on
// every date, and revenue's own delta is the small one.
const job = {
  id: 'job-1',
  title: '$80: rewrite the store page',
  description: 'Rewrite it.',
  askUsd: 80,
  proposedByName: 'Jason',
  createdAt: '2026-08-25T10:00:00Z',
  status: 'pending',
  marketPairCount: 6,
  markets: [
    pair('rvw', '2026-W35', 340, 280),
    pair('rvw', '2026-08-25', 300, 280),
    pair('rvw', '2026-09', 330, 300),
    pair('rev', '2026-W35', 4_900, 4_864),
    pair('rev', '2026-09', 7_300, 7_272),
    pair('rev', '2026-08-25', 4_870, 4_864),
  ],
} as never;

const base = {
  proposals: [job],
  unit: '$',
  selectedId: null,
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  workspaceName: 'LookPilot',
};

describe('the impact a contract prints', () => {
  test('is the pair of the metric AND date on screen, not the largest on that date', () => {
    expect(deltaAt(job, '2026-W35', 'rev')).toBe(36);
    expect(deltaAt(job, '2026-W35', 'rvw')).toBe(60);
    expect(deltaAt(job, '2026-08-25', 'rev')).toBe(6);
    expect(deltaAt(job, '2026-09', 'rev')).toBe(28);
  });

  test('renders that number under the revenue caption', () => {
    render(
      <MemoryRouter>
        <JobsBoard {...base} horizonDate="2026-W35" horizonMetricId="rev" />
      </MemoryRouter>,
    );
    // approved 4,900 minus declined 4,864 on revenue this week; 60 is the
    // reviews delta the date-only match used to print here.
    expect(screen.getByText('+$36.0')).toBeTruthy();
    expect(screen.queryByText('+$60.0')).toBeNull();
  });

  test('and the reviews number under the reviews caption', () => {
    render(
      <MemoryRouter>
        <JobsBoard {...base} horizonDate="2026-W35" horizonMetricId="rvw" />
      </MemoryRouter>,
    );
    expect(screen.getByText('+$60.0')).toBeTruthy();
  });

  test('a payload without metricId on its pairs still matches by date', () => {
    const legacy = { ...job, markets: job.markets.map((m: { metricId?: string }) => ({ ...m, metricId: undefined })) };
    expect(deltaAt(legacy as never, '2026-09', 'rev')).toBe(30);
  });
});
