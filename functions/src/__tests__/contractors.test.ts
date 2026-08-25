import { type ContractorJob, computeContractors, jobImpact } from '../lib/contractors';

const HERO = 'metric-hero';

const job = (overrides: Partial<ContractorJob>): ContractorJob => ({
  proposalId: 'p1',
  proposedBy: 'ana',
  status: 'pending',
  askUsd: null,
  pairs: [],
  ...overrides,
});

const pair = (approved: number | null, declined: number | null, metricId = HERO, targetDate = '2026-12-31') => ({
  metricId,
  targetDate,
  approvedConsensus: approved,
  declinedConsensus: declined,
});

const names = new Map<string, string | null>([
  ['ana', 'Ana'],
  ['bo', 'Bo'],
  ['cy', null],
]);

describe('jobImpact', () => {
  test('is the approved branch minus the declined branch', () => {
    expect(jobImpact(job({ pairs: [pair(80346.46, 77315.69)] }), HERO)).toBeCloseTo(3030.77, 2);
  });

  test('is negative when the market thinks the job hurts the metric', () => {
    expect(jobImpact(job({ pairs: [pair(74550.05, 77315.69)] }), HERO)).toBeCloseTo(-2765.64, 2);
  });

  test('is null until both branches are priced', () => {
    expect(jobImpact(job({ pairs: [pair(80000, null)] }), HERO)).toBeNull();
    expect(jobImpact(job({ pairs: [] }), HERO)).toBeNull();
  });

  test('ignores pairs on other metrics, so the score stays in one unit', () => {
    const j = job({ pairs: [pair(500, 100, 'metric-other'), pair(80, 60)] });
    expect(jobImpact(j, HERO)).toBe(20);
  });

  test('takes the largest-magnitude horizon rather than summing them', () => {
    const j = job({ pairs: [pair(80, 60, HERO, '2026-09-30'), pair(120, 60, HERO, '2026-12-31')] });
    expect(jobImpact(j, HERO)).toBe(60);
  });
});

describe('computeContractors', () => {
  test('a job posted minutes ago counts as soon as the market prices it', () => {
    const rows = computeContractors(
      [job({ proposedBy: 'ana', status: 'pending', pairs: [pair(1200, 1000)] })],
      HERO,
      names,
      5,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'ana',
      name: 'Ana',
      impact: 200,
      jobs: 1,
      pendingJobs: 1,
      pricedJobs: 1,
      earnedUsd: 0,
    });
  });

  test('ranks on priced impact, not on dollars collected', () => {
    // Bo has been paid $5000 for approved work the market prices at +10;
    // Ana has collected nothing and is sitting on a pending job priced at
    // +900. Ana leads (owner direction 2026-08-14).
    const rows = computeContractors(
      [
        job({ proposalId: 'p1', proposedBy: 'ana', status: 'pending', pairs: [pair(1900, 1000)] }),
        job({ proposalId: 'p2', proposedBy: 'bo', status: 'approved', askUsd: 5000, pairs: [pair(1010, 1000)] }),
      ],
      HERO,
      names,
      5,
    );
    expect(rows.map(r => r.id)).toEqual(['ana', 'bo']);
    expect(rows[0].earnedUsd).toBe(0);
    expect(rows[1].earnedUsd).toBe(5000);
  });

  test('declined, withdrawn, and removed jobs score nothing at all', () => {
    const rows = computeContractors(
      [
        job({ proposalId: 'p1', proposedBy: 'ana', status: 'declined', askUsd: 10, pairs: [pair(9000, 1000)] }),
        job({ proposalId: 'p2', proposedBy: 'bo', status: 'withdrawn', pairs: [pair(9000, 1000)] }),
        job({ proposalId: 'p3', proposedBy: 'cy', status: 'removed', pairs: [pair(9000, 1000)] }),
      ],
      HERO,
      names,
      5,
    );
    expect(rows).toEqual([]);
  });

  test("sums a poster's live jobs, so a bad job subtracts from a good one", () => {
    const rows = computeContractors(
      [
        job({ proposalId: 'p1', proposedBy: 'ana', status: 'pending', pairs: [pair(80346.46, 77315.69)] }),
        job({ proposalId: 'p2', proposedBy: 'ana', status: 'pending', pairs: [pair(74550.05, 77315.69)] }),
      ],
      HERO,
      names,
      5,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].impact).toBeCloseTo(265.13, 2);
    expect(rows[0].jobs).toBe(2);
  });

  test('an unpriced job keeps its poster on the board at zero, flagged unpriced', () => {
    const rows = computeContractors(
      [
        job({ proposalId: 'p1', proposedBy: 'ana', status: 'pending', pairs: [] }),
        job({ proposalId: 'p2', proposedBy: 'bo', status: 'pending', pairs: [pair(1100, 1000)] }),
      ],
      HERO,
      names,
      5,
    );
    expect(rows.map(r => r.id)).toEqual(['bo', 'ana']);
    expect(rows[1]).toMatchObject({ id: 'ana', impact: 0, jobs: 1, pricedJobs: 0 });
  });

  test('a job priced against a metric that is not the hero contributes nothing', () => {
    const rows = computeContractors(
      [job({ proposedBy: 'ana', status: 'pending', pairs: [pair(5000, 1000, 'metric-other')] })],
      HERO,
      names,
      5,
    );
    expect(rows[0]).toMatchObject({ impact: 0, pricedJobs: 0 });
  });

  test('with no hero metric the board falls back to dollars and reports impact null', () => {
    const rows = computeContractors(
      [
        job({ proposalId: 'p1', proposedBy: 'ana', status: 'approved', askUsd: 100, pairs: [pair(9000, 1000)] }),
        job({ proposalId: 'p2', proposedBy: 'bo', status: 'approved', askUsd: 900, pairs: [] }),
      ],
      null,
      names,
      5,
    );
    expect(rows.map(r => r.id)).toEqual(['bo', 'ana']);
    expect(rows.every(r => r.impact === null)).toBe(true);
  });

  test('honours the limit', () => {
    const rows = computeContractors(
      [
        job({ proposalId: 'p1', proposedBy: 'ana', pairs: [pair(1300, 1000)] }),
        job({ proposalId: 'p2', proposedBy: 'bo', pairs: [pair(1200, 1000)] }),
        job({ proposalId: 'p3', proposedBy: 'cy', pairs: [pair(1100, 1000)] }),
      ],
      HERO,
      names,
      2,
    );
    expect(rows.map(r => r.id)).toEqual(['ana', 'bo']);
  });
});
