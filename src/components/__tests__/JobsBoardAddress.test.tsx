import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * A proposal has a number and an address, and the proposer sees their own
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
  workspaceSlug: 'telarchy',
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

describe('a proposal has an address', () => {
  test('the link control copies telarchy.com/<slug>#proposal=<id> and does not select the row', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const onSelect = vi.fn();
    board({ onSelect });
    const link = screen.getByRole('button', { name: 'Copy link to #7' });
    fireEvent.click(link);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/telarchy#proposal=p-7`);
    expect(onSelect).not.toHaveBeenCalled();
    // The control says it did it, briefly.
    expect(await screen.findByText('Copied')).toBeTruthy();
  });
});

describe('the proposer sees their own proposal', () => {
  test('a pending proposal by the viewer prints "yours"; another\'s does not', () => {
    board({ viewerId: 'odoacre' });
    expect(screen.getByTitle('Replace the slogan').textContent).toMatch(/yours/);
    expect(screen.getByTitle('Apply to YC').textContent).not.toMatch(/yours/);
  });

  test('a signed-out viewer sees no "yours" anywhere', () => {
    board({ viewerId: null, signedIn: false });
    expect(screen.queryByText('yours')).toBeNull();
  });

  test('a decided proposal by the viewer does not print "yours": the mark is for the live ballot', () => {
    board({
      viewerId: 'odoacre',
      // Nothing pending, so the decided ones are the list and no fold hides them.
      proposals: [proposal('p-9', 9, 'Old idea', 'odoacre', 'approved')],
    });
    expect(screen.getByTitle('Old idea').textContent).not.toMatch(/yours/);
  });
});
