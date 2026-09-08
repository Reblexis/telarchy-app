import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Stage 4 of the 2026-09-08 floor redesign (docs/ui-conventions.md, "The
 * proposal view", P1 to P9): the centre column with a proposal on screen,
 * in the order the doc lists. Every test is named after the rule it pins.
 */

const fx = vi.hoisted(() => ({ ref: null as null | import('./floor-fixture').Fx }));

vi.mock('../../hooks/useAuth', async () => {
  const { makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  const state = fx.ref;
  return { useAuth: () => ({ user: state.auth.user, loading: state.auth.loading, logout: async () => {} }) };
});
vi.mock('../../hooks/useEarnAvailable', async () => {
  const { makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  const state = fx.ref;
  return { useEarnAvailable: (signedIn: boolean) => (signedIn ? state.earn : null), clearEarnAvailableCache: () => {} };
});
vi.mock('../../lib/api', async () => {
  const { apiMock, makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  return apiMock(fx.ref);
});

const { TradePage } = await import('../TradePage');
const { renderFloor, resetFx, signIn, installObservers, freezeClock } = await import('./floor-fixture');
const { stakePreview } = await import('../../lib/market-quote');
const state = () => fx.ref!;
const CSS = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');

beforeEach(() => {
  resetFx(state());
  installObservers();
  freezeClock();
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The floor with proposal #3 open, the way a reader opens it: its address. */
async function proposal(hash = '#proposal=3') {
  const r = renderFloor(TradePage, [`/telarchy${hash}`]);
  await screen.findByText('← Back to the market');
  return r;
}

const col = (branch: 'approved' | 'declined') => document.querySelector(`.pubws-ticket-col--${branch}`) as HTMLElement;

describe('P1, back and label', () => {
  test('"← Back to the market" on the left, and the proposal, its status and its edited day on the right', async () => {
    await proposal();
    expect(screen.getByText('← Back to the market')).toBeTruthy();
    const label = document.querySelector('.pubws-proposal-label') as HTMLElement;
    expect(label.textContent?.replace(/\s+/g, ' ')).toBe('PROPOSAL #3 · PENDING · EDITED 20 AUG');
  });

  test('the edited day only when the words were edited', async () => {
    await proposal('#proposal=31');
    expect((document.querySelector('.pubws-proposal-label') as HTMLElement).textContent).toBe('PROPOSAL #31 · PENDING');
  });

  test("back deselects and restores the floor's address", async () => {
    await proposal();
    fireEvent.click(screen.getByText('← Back to the market'));
    await waitFor(() => expect(document.querySelector('.pubws-proposal-label')).toBeNull());
    expect(window.location.hash).toBe('');
  });
});

describe('P2, headline and the conditional question', () => {
  test("the proposal's title, then the question line in the question's own voice", async () => {
    await proposal();
    const title = document.querySelector('.pubws-proposal-title') as HTMLElement;
    // The price lives in the work row, not in the headline.
    expect(title.textContent).toBe('Ship an open-source reference trading agent with a tutorial');
    const ask = document.querySelector('h2.pubws-instrument-ask') as HTMLElement;
    expect(ask.textContent?.replace(/\s+/g, ' ')).toBe(
      "If telarchy-agents is paid $200 to do this, what will Telarchy's Active traders this month be?",
    );
    // The headline comes first, and the question is directly under it.
    expect(title.nextElementSibling).toBe(ask);
  });

  test('the stylesheet sets the headline in the display face at 32px', () => {
    expect(CSS).toMatch(/\.pubws-proposal-title\s*{[^}]*font-family:\s*'Fraunces'/);
    expect(CSS).toMatch(/\.pubws-proposal-title\s*{[^}]*font-size:\s*32px/);
  });
});

describe('P3, the work', () => {
  test('label THE WORK, the first two sentences, and "full scope" outside the clamped text', async () => {
    await proposal();
    const work = document.querySelector('.pubws-work') as HTMLElement;
    expect(within(work).getByText('THE WORK')).toBeTruthy();
    const text = work.querySelector('.pubws-work-text') as HTMLElement;
    expect(text.textContent).toBe(
      'Agents are first-class participants here, and there is currently no worked example of one. A Manifold quant who would happily write a trading bot has nothing to start from.',
    );
    const more = within(work).getByRole('button', { name: 'full scope' });
    expect(text.contains(more)).toBe(false);
    fireEvent.click(more);
    expect((work.querySelector('.pubws-work-text') as HTMLElement).textContent).toContain(
      'The tutorial covers keys, the market list and one trade.',
    );
  });

  test('under the text an icon row: what it asks, who is paid, and in which world', async () => {
    await proposal();
    const facts = document.querySelector('.pubws-work-facts') as HTMLElement;
    const words = (facts.textContent ?? '').replace(/\s+/g, ' ');
    expect(words).toContain('$200');
    expect(words).toContain('telarchy-agents');
    expect(words).toContain('if approved');
  });

  test('a free proposal asks $0', async () => {
    await proposal('#proposal=31');
    expect((document.querySelector('.pubws-work-facts') as HTMLElement).textContent).toContain('$0');
  });

  test('the owner gets "Edit proposal" on the label line, a stranger does not', async () => {
    await proposal();
    expect(screen.queryByRole('button', { name: 'Edit proposal' })).toBeNull();
    signIn(state(), 'owner');
    await proposal();
    const edit = screen.getByRole('button', { name: 'Edit proposal' });
    expect(edit.closest('.pubws-work-label')).toBeTruthy();
  });
});

describe('P4, the pair band', () => {
  test('three cells: the two calls in their colours and the difference in ink, captioned with the unit', async () => {
    await proposal();
    const band = document.querySelector('.pubws-pair') as HTMLElement;
    const cells = [...band.querySelectorAll('.pubws-pair-cell')];
    expect(cells.length).toBe(3);
    expect(cells[0].querySelector('.pubws-stat-what')?.textContent).toBe('if approved');
    expect(cells[0].querySelector('.pubws-price')?.textContent).toBe('17.04');
    expect(cells[0].querySelector('.pubws-price')?.className).toContain('is-up');
    expect(cells[1].querySelector('.pubws-stat-what')?.textContent).toBe('if declined');
    expect(cells[1].querySelector('.pubws-price')?.textContent).toBe('17.00');
    expect(cells[1].querySelector('.pubws-price')?.className).toContain('is-down');
    // The difference is INK, so green never reads as a verdict.
    const diff = cells[2].querySelector('.pubws-price') as HTMLElement;
    expect(diff.textContent).toBe('+0.04');
    expect(diff.className).not.toContain('is-up');
    expect(cells[2].querySelector('.pubws-stat-what')?.textContent?.replace(/\s+/g, ' ')).toBe(
      'difference in market calls · Active traders',
    );
  });

  test("each call carries its own book's facts under it", async () => {
    await proposal();
    const rows = [...document.querySelectorAll('.pubws-pair-cell [aria-label="This book"]')];
    expect(rows.length).toBe(2);
    expect(rows[0].textContent?.replace(/\s+/g, ' ')).toContain('295');
    expect(rows[1].textContent?.replace(/\s+/g, ' ')).toContain('329');
  });

  test("the thin-books line sits under the difference when the pair sits away from the market's own call", async () => {
    await proposal();
    const why = document.querySelector('.pubws-pair-why') as HTMLElement;
    expect(why.textContent).toContain('19.8');
    expect(why.closest('.pubws-pair-cell')?.textContent).toContain('+0.04');
  });

  test('a pair with no liquidity prints "no price yet" in both calls and "nothing to read yet" in the difference', async () => {
    const ws = state().ws();
    const proposals = (ws.proposals as Array<Record<string, unknown>>).map(p =>
      p.id === 'job-paid'
        ? {
            ...p,
            markets: (p.markets as Array<Record<string, unknown>>).map(m => ({
              ...m,
              approvedConsensus: null,
              declinedConsensus: null,
              approvedLiquidity: 0,
              declinedLiquidity: 0,
              approvedPool: 0,
              declinedPool: 0,
            })),
          }
        : p,
    );
    state().overrides = { proposals };
    await proposal();
    const cells = [...document.querySelectorAll('.pubws-pair-cell')];
    expect(cells[0].querySelector('.pubws-price')?.textContent).toBe('no price yet');
    expect(cells[1].querySelector('.pubws-price')?.textContent).toBe('no price yet');
    expect(cells[2].querySelector('.pubws-price')?.textContent).toBe('nothing to read yet');
  });

  /** Ported from the deleted decision-row file: the band has to add up at a
   *  glance (critics' round 2 of 2026-09-08, "17.0, 17.0, difference +0.04"
   *  reads as wrong). The two calls print with enough decimals to reconcile
   *  the difference, and the chart's branch labels use the same rule. */
  const withPair = async (approved: number, declined: number) => {
    const ws = state().ws();
    const proposals = (ws.proposals as Array<Record<string, unknown>>).map(p =>
      p.id === 'job-paid'
        ? {
            ...p,
            markets: (p.markets as Array<Record<string, unknown>>).map(m =>
              m.targetDate === '2026-09' && m.metricId === 'metric-active'
                ? {
                    ...m,
                    approvedConsensus: approved,
                    declinedConsensus: declined,
                    delta: approved - declined,
                    approvedProbability: approved / 50,
                    declinedProbability: declined / 50,
                  }
                : m,
            ),
          }
        : p,
    );
    state().overrides = { proposals };
    await proposal();
  };
  const priced = () => [...document.querySelectorAll('.pubws-pair-cell .pubws-price')].map(e => e.textContent);

  test('two calls that would print equal at their usual precision grow decimals until they differ', async () => {
    // Whole numbers from 100 up: "150" and "150" beside "+0.40" is the bug.
    await withPair(150.4, 150);
    expect(priced()).toEqual(['150.40', '150.00', '+0.40']);
  });

  test('a wide difference keeps the usual precision: no decimals invented', async () => {
    await withPair(25, 12);
    // The metric's own precision, one decimal at this size, and no second
    // one invented to reconcile a difference that already reconciles.
    expect(priced()).toEqual(['25.0', '12.0', '+13.0']);
  });

  test("the chart's branch labels print at the band's precision, so the two surfaces agree", async () => {
    await withPair(150.4, 150);
    await waitFor(() => expect(document.querySelector('.nchart-pair-label--approved')).toBeTruthy());
    expect(document.querySelector('.nchart-pair-label--approved')?.textContent).toBe('if approved 150.40');
    expect(document.querySelector('.nchart-pair-label--declined')?.textContent).toBe('if declined 150.00');
    expect(document.querySelector('.nchart-pair-delta')?.textContent).toBe('+0.40');
  });

  test('the band and the rail print the same difference', async () => {
    const { formatImpact } = await import('../../lib/formatImpact');
    await withPair(17.45, 17);
    const expected = formatImpact(0.45, '');
    expect(expected).toBe('+0.45');
    expect(priced()[2]).toBe(expected);
    const rail = document.querySelector('.pubws-rail--right .pubws-ballot-row.is-selected .pubws-ballot-delta');
    expect(rail?.textContent).toBe(expected);
  });

  test('the difference is captioned from the same label helper as the chart caption', async () => {
    const { captionLabel, metricLabelOf } = await import('../../lib/floor-horizons');
    await proposal();
    const expected = captionLabel(metricLabelOf('Active traders'), 'Telarchy');
    expect(expected).toBe('Active traders');
    expect(document.querySelector('.pubws-pair-unit')?.textContent).toBe(expected);
  });

  test("the facts under each call are that branch's own, never the baseline's", async () => {
    await proposal();
    const rows = [...document.querySelectorAll('.pubws-pair-cell [aria-label="This book"]')];
    const words = rows.map(r => (r.textContent ?? '').replace(/\s+/g, ' '));
    // The month baseline holds 38,000 cr across 21 traders; the branches hold
    // 295 and 329 across 4 and 3.
    for (const w of words) {
      expect(w).not.toContain('38');
      expect(w).not.toContain('21');
    }
    expect(words[0]).toContain('4');
    expect(words[1]).toContain('3');
  });

  test('equal pools read "in each"', async () => {
    const ws = state().ws();
    const proposals = (ws.proposals as Array<Record<string, unknown>>).map(p =>
      p.id === 'job-paid'
        ? {
            ...p,
            markets: (p.markets as Array<Record<string, unknown>>).map(m =>
              m.targetDate === '2026-09' && m.metricId === 'metric-active'
                ? { ...m, approvedPool: 295, declinedPool: 295 }
                : m,
            ),
          }
        : p,
    );
    state().overrides = { proposals };
    await proposal();
    expect((document.querySelector('.pubws-pair-why') as HTMLElement).textContent).toBe(
      "Both books trade thin (295 cr in each); the market's own call is 19.8.",
    );
  });

  test("a pair that straddles or hugs the market's call gets no line", async () => {
    // 19.5 and 18.0 sit 0.3 and 1.8 from the call of 19.8, and are 1.5
    // apart: the band explains itself.
    await withPair(19.5, 18);
    expect(document.querySelector('.pubws-pair-why')).toBeNull();
  });

  test('on a phone the three cells stay side by side', () => {
    expect(CSS).toMatch(/\.pubws-pair\s*{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)/);
  });
});

describe('P5, the decision band', () => {
  test('it PRECEDES the tickets in DOM order, because a decision is laid out as a decision before it is asked', async () => {
    signIn(state(), 'owner');
    await proposal();
    const band = document.querySelector('.pubws-decide') as HTMLElement;
    const tickets = document.querySelector('.pubws-tickets') as HTMLElement;
    expect(band.compareDocumentPosition(tickets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('one sentence says what Approve, Decline and Remove each do to the money', async () => {
    signIn(state(), 'owner');
    await proposal();
    expect((document.querySelector('.pubws-decide-line') as HTMLElement).textContent?.replace(/\s+/g, ' ')).toBe(
      'Approving pays telarchy-agents $200 now. The if-declined book is voided and stakes returned; the if-approved book pays at the real number. Declining is the reverse and pays nothing.',
    );
  });

  test('"Approve, pay $200" opens the payment review, whose confirm is "Approve and pay $200"', async () => {
    signIn(state(), 'owner');
    await proposal();
    fireEvent.click(screen.getByRole('button', { name: 'Approve, pay $200' }));
    const review = document.querySelector('.pubws-review') as HTMLElement;
    expect(review.textContent).toContain('telarchy-agents');
    expect(review.textContent).toContain('$200');
    fireEvent.click(within(review).getByRole('button', { name: 'Approve and pay $200' }));
    await waitFor(() => expect(state().calls.approveProposal).toHaveBeenCalledWith('job-paid'));
  });

  test('"Decline proposal" stays off until a reason is typed, and the reason is published on the proposal', async () => {
    signIn(state(), 'owner');
    await proposal();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    const go = screen.getByRole('button', { name: 'Decline proposal' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Decline reason'), { target: { value: 'not now' } });
    expect((screen.getByRole('button', { name: 'Decline proposal' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Decline proposal' }));
    await waitFor(() => expect(state().calls.declineProposal).toHaveBeenCalled());
  });

  test('"Remove" is a text link and voids both books after one confirm naming that', async () => {
    signIn(state(), 'owner');
    await proposal();
    const remove = screen.getByRole('button', { name: 'Remove' });
    expect(remove.className).toContain('pubws-decide-remove');
    fireEvent.click(remove);
    const confirm = await screen.findByRole('button', { name: 'Remove proposal' });
    expect(document.querySelector('.pubws-decide-confirm')?.textContent).toMatch(
      /voids both books and refunds everyone/,
    );
    fireEvent.click(confirm);
    await waitFor(() => expect(state().calls.removeProposal).toHaveBeenCalledWith('job-paid'));
  });

  test("everyone else sees one line in the band's place and no buttons", async () => {
    signIn(state(), 'trader');
    await proposal();
    expect((document.querySelector('.pubws-decide') as HTMLElement).textContent?.replace(/\s+/g, ' ')).toBe(
      'The owner decides. Approving is the payment.',
    );
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
  });

  test('a decided proposal prints its decision and day there instead', async () => {
    signIn(state(), 'owner');
    await proposal('#proposal=2');
    expect((document.querySelector('.pubws-decide') as HTMLElement).textContent?.replace(/\s+/g, ' ')).toBe(
      'Approved 2 Sep · paid $20',
    );
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });
});

describe('P6, two tickets side by side', () => {
  test("each is headed by its branch word and that branch's call", async () => {
    await proposal();
    expect(col('approved').querySelector('.pubws-ticket-head')?.textContent?.replace(/\s+/g, ' ')).toBe(
      'IF APPROVED · 17.04',
    );
    expect(col('declined').querySelector('.pubws-ticket-head')?.textContent?.replace(/\s+/g, ' ')).toBe(
      'IF DECLINED · 17.00',
    );
  });

  test("each verb's preview is quoted from ITS branch's book", async () => {
    // A pair the two worlds price far apart, so a preview borrowed from the
    // other book prints a number this one never would.
    const ws = state().ws();
    const proposals = (ws.proposals as Array<Record<string, unknown>>).map(p =>
      p.id === 'job-paid'
        ? {
            ...p,
            markets: (p.markets as Array<Record<string, unknown>>).map(m => ({
              ...m,
              declinedConsensus: 5,
              declinedProbability: 0.1,
              declinedLiquidity: 900,
            })),
          }
        : p,
    );
    state().overrides = { proposals };
    await proposal();
    const q = (probability: number, liquidity: number) => stakePreview('', 0, 50, probability, liquidity, 'higher', 25);
    const approved = q(17.04 / 50, 425);
    const declined = q(0.1, 900);
    expect(approved?.line).not.toBe(declined?.line);
    expect(col('approved').textContent).toContain(approved?.line);
    expect(col('declined').textContent).toContain(declined?.line);
  });

  test('a stake typed in either is the stake in both', async () => {
    await proposal();
    const fields = screen.getAllByLabelText('Stake') as HTMLInputElement[];
    expect(fields.length).toBe(2);
    fireEvent.change(fields[0], { target: { value: '100' } });
    await waitFor(() => expect((screen.getAllByLabelText('Stake')[1] as HTMLInputElement).value).toBe('100'));
  });

  test('a verb opens the inline ticket in that column, titled by the verb and the branch', async () => {
    signIn(state(), 'trader');
    await proposal();
    fireEvent.click(within(col('approved')).getByRole('button', { name: /Bet Higher/ }));
    await waitFor(() => expect(col('approved').querySelector('.pubws-ticket-inline')).toBeTruthy());
    expect(col('approved').textContent).toContain('Bet Higher · if approved');
    expect(col('declined').querySelector('.pubws-ticket-inline')).toBeNull();
  });

  test('under each ticket its branch rule, and under both, once, what the surviving book pays', async () => {
    await proposal();
    expect(col('approved').querySelector('.pubws-branch-rule')?.textContent).toBe(
      'If the owner declines, this book is voided and your stake returns.',
    );
    expect(col('declined').querySelector('.pubws-branch-rule')?.textContent).toBe(
      'If the owner approves, this book is voided and your stake returns.',
    );
    const both = document.querySelectorAll('.pubws-pair-rule');
    expect(both.length).toBe(1);
    expect(both[0].textContent).toBe('The book left standing pays at the real number on 30 Sep.');
  });

  test('there is no "switch" link and no pill toggle', async () => {
    await proposal();
    expect(screen.queryByRole('button', { name: 'switch' })).toBeNull();
    expect(document.querySelector('.pubws-branch')).toBeNull();
    expect(document.querySelector('.pubws-bet-book')).toBeNull();
  });

  test('an unfunded branch renders the unfunded state in its own column, and the other still trades', async () => {
    const ws = state().ws();
    const proposals = (ws.proposals as Array<Record<string, unknown>>).map(p =>
      p.id === 'job-paid'
        ? {
            ...p,
            markets: (p.markets as Array<Record<string, unknown>>).map(m => ({ ...m, declinedLiquidity: 0 })),
          }
        : p,
    );
    state().overrides = { proposals };
    await proposal();
    expect(col('declined').textContent).toContain('Nobody has funded a book for this market yet');
    expect(within(col('declined')).queryByRole('button', { name: /Bet Higher/ })).toBeNull();
    expect(within(col('approved')).getByRole('button', { name: /Bet Higher/ })).toBeTruthy();
  });

  /** The offer to fund or deepen a book appears ONCE per book on screen, in
   *  the panel where that book is traded (docs/ui-conventions.md, "The verbs
   *  and the inline ticket", reconciled 2026-09-08). On a proposal that panel
   *  is the branch's own column. */
  test('each column carries the offer to fund or deepen ITS book, once, and it targets that book', async () => {
    signIn(state(), 'owner');
    await proposal();
    // One per column, two on the screen, each naming its own book.
    expect(screen.getAllByRole('button', { name: 'Inject liquidity' }).length).toBe(2);
    expect(within(col('approved')).getAllByRole('button', { name: 'Inject liquidity' }).length).toBe(1);
    fireEvent.click(within(col('declined')).getByRole('button', { name: 'Inject liquidity' }));
    const dialog = await screen.findByRole('dialog');
    // The dialog names the book it is about to change: injecting into the
    // baseline, or into the other branch, would put the credits in a book
    // nobody asked about.
    expect(dialog.textContent).toContain('if declined');
    expect(dialog.textContent).not.toContain('if approved');
    const { api } = await import('../../lib/api');
    fireEvent.click(dialog.querySelector('.ticket-go') as HTMLElement);
    await waitFor(() => expect(vi.mocked(api.injectLiquidity)).toHaveBeenCalledWith('d-month', 1000, 'ws-1'));
  });

  test('an unfunded branch offers it once too: in the unfunded state, not twice in the column', async () => {
    signIn(state(), 'owner');
    const ws = state().ws();
    const proposals = (ws.proposals as Array<Record<string, unknown>>).map(p =>
      p.id === 'job-paid'
        ? {
            ...p,
            markets: (p.markets as Array<Record<string, unknown>>).map(m => ({ ...m, declinedLiquidity: 0 })),
          }
        : p,
    );
    state().overrides = { proposals };
    await proposal();
    expect(within(col('declined')).getAllByRole('button', { name: 'Inject liquidity' }).length).toBe(1);
    expect(within(col('approved')).getAllByRole('button', { name: 'Inject liquidity' }).length).toBe(1);
  });

  test("a position on a branch sits under THAT branch's ticket", async () => {
    signIn(state(), 'trader');
    const { api } = await import('../../lib/api');
    vi.mocked(api.getPositions).mockImplementation((async (marketId: string) =>
      marketId === 'd-month' ? [{ direction: 'lower', shares: 12, totalCost: 40 }] : []) as never);
    await proposal();
    // The book the reader is not composing in still shows what they hold.
    await waitFor(() => expect(col('declined').querySelector('.pubws-position')).toBeTruthy());
    expect(col('approved').querySelector('.pubws-position')).toBeNull();
  });

  test('the stylesheet stacks the two columns when the centre column is under 900px', () => {
    expect(CSS).toMatch(/\.pubws-tickets-wrap\s*{[^}]*container-type:\s*inline-size/);
    expect(CSS).toMatch(
      /@container\s*\(max-width:\s*899px\)\s*{\s*\.pubws-tickets\s*{[^}]*grid-template-columns:\s*1fr/,
    );
  });
});

describe('P7 to P9, the chart, the activity and the standings', () => {
  test("the chart carries the pair: both branch lines beside the market's own", async () => {
    await proposal();
    await waitFor(() => expect(document.querySelector('.nchart-branch--approved')).toBeTruthy());
    expect(document.querySelector('.nchart-branch--declined')).toBeTruthy();
    expect(document.querySelector('.nchart-call')).toBeTruthy();
  });

  test('the tab row reads both pools, and offers no Inject it cannot name a book for', async () => {
    signIn(state(), 'owner');
    await proposal();
    const trailing = document.querySelector('.pubws-pool-inject') as HTMLElement;
    expect(trailing.textContent?.replace(/\s+/g, ' ')).toContain('295 cr · 329 cr');
    // The row covers the pair, so a single "Inject liquidity" here could
    // only mean one of two books on screen. Each branch is deepened from
    // its own column (docs/ui-conventions.md, "The verbs and the inline
    // ticket": the offer appears once per book, in the panel where that
    // book is traded).
    expect(within(trailing).queryByRole('button', { name: 'Inject liquidity' })).toBeNull();
  });

  test('the standings name the traders on this proposal', async () => {
    await proposal();
    // Printed in caps by the stylesheet; the DOM carries the sentence.
    await waitFor(() => expect(screen.getByText('Traders on this proposal')).toBeTruthy());
    expect(screen.getByText('Top contractors')).toBeTruthy();
  });
});
