import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * The board row of a proposal with options (docs/ui-conventions.md, "A
 * proposal with options shows one world per option"): the row prints the
 * leader's lead prefixed with the leader's label, "open" until two options
 * are priced, the ruling band reads "Chose <label>", a manager chooses an
 * option from the row, and the form's "Options" row posts up to six labels.
 */

vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { deltaAt, JobsBoard, optionIdsOf, poolOf } from '../JobsBoard';

const option = (id: string, label: string, consensus: number | null, delta: number | null, pool = 100) => ({
  id,
  label,
  marketId: `m-${id}`,
  consensus,
  probability: consensus === null ? null : 0.5,
  liquidity: consensus === null ? 0 : 100,
  pool,
  traders: 1,
  volume: 0,
  delta,
});

const optionRow = (options: ReturnType<typeof option>[], delta: number | null) => ({
  metricId: 'len',
  metricName: 'Reached length',
  targetDate: '2026-09-11T17:30',
  resolvesOn: '2026-09-11T17:31:00Z',
  approvedConsensus: null,
  declinedConsensus: null,
  delta,
  approvedMarketId: null,
  declinedMarketId: null,
  approvedProbability: null,
  approvedLiquidity: null,
  declinedProbability: null,
  declinedLiquidity: null,
  approvedPool: null,
  declinedPool: null,
  approvedTraders: null,
  declinedTraders: null,
  approvedVolume: null,
  declinedVolume: null,
  options,
  rangeMin: 0,
  rangeMax: 144,
});

const priced = () =>
  optionRow(
    [
      option('forward', 'Continue', 7.2, -1.7, 300),
      option('left', 'Turn left', 8.9, 1.7, 200),
      option('right', 'Turn right', 5.1, -3.8, 100),
    ],
    1.7,
  );
const onePriced = () =>
  optionRow([option('forward', 'Continue', null, null, 0), option('left', 'Turn left', 8.9, null, 200)], null);

const proposal = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    number: 42,
    title: 'Step 42: which way?',
    description: '',
    askUsd: 0,
    proposedByName: 'snake-operator',
    proposedByHandle: 'snake-operator',
    createdAt: '2026-09-11T16:00:00Z',
    decideBy: new Date(Date.now() + 30 * 60_000).toISOString(),
    status: 'pending',
    options: [
      { id: 'forward', label: 'Continue' },
      { id: 'left', label: 'Turn left' },
      { id: 'right', label: 'Turn right' },
    ],
    decidedOption: null,
    marketPairCount: 1,
    markets: [priced()],
    ...over,
  }) as never;

const base = {
  unit: '',
  selectedId: null,
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  workspaceName: 'Snake',
  horizonDate: '2026-09-11T17:30',
  horizonMetricId: 'len',
};

const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const renderBoard = (props: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <JobsBoard {...base} proposals={[proposal()]} {...(props as object)} />
    </MemoryRouter>,
  );

afterEach(() => vi.clearAllMocks());

describe("THE BOARD ROW PRINTS THE LEADER'S LEAD", () => {
  test('"Turn left +1.7": the label in the mono caption register, then the lead', () => {
    const { container } = renderBoard();
    const impact = container.querySelector('.pubws-ballot-impact') as HTMLElement;
    expect(words(impact)).toMatch(/^Turn left \+1\.7$/);
    expect(impact.querySelector('.pubws-ballot-lead')?.textContent).toBe('Turn left');
    expect(impact.querySelector('.pubws-ballot-delta')?.classList.contains('is-up')).toBe(true);
    expect(container.textContent).not.toMatch(/NaN/);
  });

  test('"open" until two options are priced, with no label in front', () => {
    const { container } = renderBoard({ proposals: [proposal({ markets: [onePriced()] })] });
    const impact = container.querySelector('.pubws-ballot-impact') as HTMLElement;
    expect(words(impact)).toBe('open');
    expect(impact.querySelector('.pubws-ballot-lead')).toBeNull();
  });

  test('the pool behind an option proposal is the sum of its option pools', () => {
    expect(poolOf(proposal())).toBe(600);
    const { container } = renderBoard();
    expect(words(container.querySelector('.pubws-ballot-pool'))).toBe('600');
  });

  test("deltaAt reads the row's delta, which is the leader's lead", () => {
    expect(deltaAt(proposal(), '2026-09-11T17:30', 'len')).toBe(1.7);
    expect(deltaAt(proposal({ markets: [onePriced()] }), '2026-09-11T17:30', 'len')).toBeNull();
  });

  test('a two-branch row beside an option row keeps its plain "+" number, no label', () => {
    const plain = proposal({
      id: 'c2',
      number: 43,
      options: null,
      markets: [
        {
          ...optionRow([], 0.4),
          options: null,
          approvedConsensus: 6.4,
          declinedConsensus: 6,
          approvedMarketId: 'm-a',
          declinedMarketId: 'm-d',
          approvedLiquidity: 100,
          declinedLiquidity: 100,
          approvedPool: 50,
          declinedPool: 50,
        },
      ],
    });
    const { container } = renderBoard({ proposals: [proposal(), plain] });
    const impacts = [...container.querySelectorAll('.pubws-ballot-impact')].map(words);
    expect(impacts).toContain('+0.4');
    expect(impacts).toContain('Turn left +1.7');
  });
});

describe('THE RULING BAND READS "Chose <label>"', () => {
  test("in the approved pill's colours, on the decided row", () => {
    const { container } = renderBoard({
      proposals: [proposal({ status: 'approved', decidedOption: 'left', resolvedAt: '2026-09-11T17:00:00Z' })],
    });
    const pill = container.querySelector('.pubws-ballot-status') as HTMLElement;
    expect(words(pill)).toMatch(/^Chose Turn left$/i);
    expect(pill.classList.contains('is-approved')).toBe(true);
  });

  test('a declined option proposal still reads declined', () => {
    const { container } = renderBoard({
      proposals: [proposal({ status: 'declined', resolvedAt: '2026-09-11T17:00:00Z', declineReason: 'no' })],
    });
    expect(words(container.querySelector('.pubws-ballot-status'))).toBe('declined');
  });
});

describe('A MANAGER CHOOSES AN OPTION FROM THE ROW', () => {
  test('the row offers Choose, not Approve; Choose opens one confirm per option, the leader first; pressing one rules with that option', async () => {
    const onRule = vi.fn();
    const { container } = renderBoard({ canManage: true, onRule });
    const acts = container.querySelector('.pubws-prow-acts') as HTMLElement;
    expect(within(acts).queryByRole('button', { name: /^Approve/ })).toBeNull();
    fireEvent.click(within(acts).getByRole('button', { name: 'Choose' }));
    const band = container.querySelector('.pubws-rule') as HTMLElement;
    const choices = [...band.querySelectorAll('button')].map(words);
    expect(choices).toEqual(['Choose Turn left', 'Choose Continue', 'Choose Turn right', 'Cancel']);
    // The leader's confirm is the one in the approve colour, as on the page's bar.
    expect(band.querySelectorAll('.pubws-decide--approve')).toHaveLength(1);
    expect(words(band.querySelector('.pubws-decide--approve'))).toBe('Choose Turn left');
    expect(words(band.querySelector('.pubws-rule-what'))).toMatch(/voids every other option/);
    fireEvent.click(within(band).getByRole('button', { name: 'Choose Continue' }));
    await waitFor(() => expect(onRule).toHaveBeenCalledWith('c1', 'approve', undefined, 'forward'));
    expect(container.querySelector('.pubws-rule')).toBeNull();
  });

  test('Decline still asks for the reason, as on any row', () => {
    const onRule = vi.fn();
    const { container } = renderBoard({ canManage: true, onRule });
    const acts = container.querySelector('.pubws-prow-acts') as HTMLElement;
    fireEvent.click(within(acts).getByRole('button', { name: 'Decline' }));
    expect(container.querySelector('.pubws-rule-reason')).toBeTruthy();
  });
});

describe('POSTING ONE: the "Options" row on the form', () => {
  const openForm = async () => {
    fireEvent.click(screen.getByRole('button', { name: /Propose work on this number/ }));
    await waitFor(() => expect(screen.getByLabelText('Proposal title')).toBeTruthy());
  };
  const optionInputs = () => screen.queryAllByLabelText(/^Option \d label$/) as HTMLInputElement[];
  const fill = async (title: string) => {
    fireEvent.change(screen.getByLabelText('Proposal title'), { target: { value: title } });
  };

  test('closed by default: no option fields until the row is opened, and a plain proposal posts with no options', async () => {
    const onPropose = vi.fn(async () => {});
    renderBoard({ onPropose });
    await openForm();
    expect(optionInputs()).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^Options/ })).toBeTruthy();
    await fill('Ship the thing');
    fireEvent.click(screen.getByRole('button', { name: /^Propose(?! work)/ }));
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(onPropose.mock.calls[0][4]).toBeUndefined();
  });

  test('opened, it holds two label fields and "add option" up to six', async () => {
    renderBoard();
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: /^Options/ }));
    expect(optionInputs()).toHaveLength(2);
    const add = () => screen.getByRole('button', { name: /add option/i });
    fireEvent.click(add());
    fireEvent.click(add());
    fireEvent.click(add());
    fireEvent.click(add());
    expect(optionInputs()).toHaveLength(6);
    expect(screen.queryByRole('button', { name: /add option/i })).toBeNull();
  });

  test('ids are the labels lowercased and hyphenated, deduplicated with a number; the labels travel as typed', async () => {
    const onPropose = vi.fn(async () => {});
    renderBoard({ onPropose });
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: /^Options/ }));
    fireEvent.click(screen.getByRole('button', { name: /add option/i }));
    const [a, b, c] = optionInputs();
    fireEvent.change(a, { target: { value: 'Turn left' } });
    fireEvent.change(b, { target: { value: 'Headline B!' } });
    fireEvent.change(c, { target: { value: 'turn LEFT' } });
    await fill('Which way?');
    fireEvent.click(screen.getByRole('button', { name: /^Propose(?! work)/ }));
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(onPropose.mock.calls[0][4]).toEqual([
      { id: 'turn-left', label: 'Turn left' },
      { id: 'headline-b', label: 'Headline B!' },
      { id: 'turn-left-2', label: 'turn LEFT' },
    ]);
  });

  test('an emptied label drops its option, and fewer than two filled labels post a two-branch proposal', async () => {
    const onPropose = vi.fn(async () => {});
    renderBoard({ onPropose });
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: /^Options/ }));
    const [a, b] = optionInputs();
    fireEvent.change(a, { target: { value: 'Turn left' } });
    fireEvent.change(b, { target: { value: '   ' } });
    await fill('Which way?');
    fireEvent.click(screen.getByRole('button', { name: /^Propose(?! work)/ }));
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(onPropose.mock.calls[0][4]).toBeUndefined();
  });

  test('optionIdsOf: the id rule on its own', () => {
    expect(optionIdsOf(['Turn left', 'Turn right'])).toEqual(['turn-left', 'turn-right']);
    expect(optionIdsOf(['Go', 'go', 'GO'])).toEqual(['go', 'go-2', 'go-3']);
    expect(optionIdsOf(['  Headline  B  '])).toEqual(['headline-b']);
    // Never the reserved branch names, and never empty.
    expect(optionIdsOf(['approved', 'declined', '!!!'])).toEqual(['approved-2', 'declined-2', 'option-3']);
  });
});
