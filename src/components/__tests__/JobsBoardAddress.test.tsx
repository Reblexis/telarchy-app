import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * A proposal has a number, and the proposer sees their own
 * proposal (docs/ui-conventions.md, the two paragraphs of those names).
 *
 * The visitor this is for (Otto conversation, 2026-09-04): wanted to ask
 * what a proposal meant and could not name it, then posted one at $0,
 * reloaded the floor and could not find it, because an unfunded proposal
 * sits last on the ballot and nothing marked it as theirs.
 */

vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { JobsBoard } from '../JobsBoard';

const pair = () => ({
  metricId: 'rev',
  metricName: 'Net revenue (USD)',
  targetDate: '2026-12',
  resolvesOn: '2026-12-31T00:00:00Z',
  approvedConsensus: 5_100,
  declinedConsensus: 5_000,
  delta: 100,
  approvedMarketId: 'a-1',
  declinedMarketId: 'd-1',
  approvedProbability: 0.5,
  approvedLiquidity: 100,
  declinedProbability: 0.5,
  declinedLiquidity: 100,
  approvedPool: 50,
  declinedPool: 50,
  approvedTraders: 1,
  declinedTraders: 0,
  approvedVolume: 0,
  declinedVolume: 0,
  rangeMin: 0,
  rangeMax: 25_000,
});

const proposal = (id: string, number: number, title: string, by: string, status = 'pending') =>
  ({
    id,
    number,
    title,
    description: '',
    askUsd: null,
    proposedByName: by,
    proposedByHandle: by,
    createdAt: '2026-09-04T10:00:00Z',
    status,
    resolvedAt: status === 'pending' ? null : '2026-09-04T12:00:00Z',
    marketPairCount: 1,
    markets: [pair()],
  }) as never;

const base = {
  unit: '$',
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  workspaceName: 'Telarchy',
};

const board = (props: Partial<React.ComponentProps<typeof JobsBoard>>) =>
  render(
    <MemoryRouter>
      <JobsBoard
        {...base}
        proposals={[proposal('p-7', 7, 'Replace the slogan', 'odoacre'), proposal('p-3', 3, 'Apply to YC', 'viktor')]}
        selectedId={null}
        {...props}
      />
    </MemoryRouter>,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a proposal has a number', () => {
  test('the row prints #<number> before the title', () => {
    board({});
    const row = screen.getByTitle('Replace the slogan');
    expect(row.textContent).toMatch(/#7/);
    // The number leads: it is how a person names the proposal.
    expect(row.textContent!.indexOf('#7')).toBeLessThan(row.textContent!.indexOf('Replace the slogan'));
  });

  test('a proposal from before numbers existed prints no number', () => {
    const old = { ...(proposal('p-old', 0, 'Old one', 'ada') as object), number: undefined } as never;
    board({ proposals: [old] });
    expect(screen.getByTitle('Old one').textContent).not.toMatch(/#/);
  });
});

describe('a proposal has an address but no link control', () => {
  test('the row carries no copy-link control: the number is enough (owner decision 2026-09-04)', () => {
    board({});
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
  });
});

/**
 * There is no "yours" tag on a row (docs/ui-conventions.md, "The proposals
 * board", revised 2026-09-08): a proposer's own rows read as theirs because
 * the proposer is NOT NAMED on them, and the owner's count lives in the
 * foot.
 */
describe('the proposer is named only when they are not the viewer', () => {
  test('the viewer is never named on their own row, and no row wears a "yours" tag', () => {
    board({ viewerId: 'odoacre' });
    expect(screen.getByTitle('Replace the slogan').textContent).not.toMatch(/odoacre/);
    expect(screen.getByTitle('Replace the slogan').textContent).not.toMatch(/yours/);
    expect(document.querySelector('.pubws-ballot-yours')).toBeNull();
  });

  test("somebody else's row names them", () => {
    board({ viewerId: 'odoacre' });
    expect(screen.getByTitle('Apply to YC').textContent).toMatch(/by /);
  });

  test('a signed-out viewer reads every proposer, and no "yours" anywhere', () => {
    board({ viewerId: null, signedIn: false });
    expect(screen.queryByText('yours')).toBeNull();
    expect(screen.getByTitle('Replace the slogan').textContent).toMatch(/by /);
  });
});
