/**
 * The form's liquidity (docs/ui-conventions.md, "Posting one"): a switch,
 * "same for all" or "per market". One shows ONE number beside the price, the
 * other shows the grid per metric and date, and the two are never on screen
 * together (owner, 2026-09-17).
 *
 * THE RULES: posting is free unless the proposer says otherwise; what the
 * confirm says they spend is what they spend (every side of every book);
 * liquidity credits are shown being spent before trading credits; and the
 * form never lets them name more than both purses hold.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: { getParticipant: vi.fn(async () => ({ payoutHandle: 'pay@example.com' })) },
}));

const { ProposalForm } = await import('../ProposalForm');

const far = new Date(Date.now() + 90 * 86400_000).toISOString();
const soon = new Date(Date.now() + 2 * 3600_000).toISOString();
const book = (metricId: string, metricLabel: string, targetDate: string, dateLabel: string, over = {}) => ({
  metricId,
  metricLabel,
  targetDate,
  dateLabel,
  opensWith: 0,
  periodEndsOn: far,
  ...over,
});
const books = [
  book('tr', 'Traders', '2030-W38', '21 Sep', { opensWith: 3000 }),
  book('tr', 'Traders', '2030-09', '30 Sep', { opensWith: 3000 }),
  book('rev', 'Revenue', '2030-W38', '21 Sep'),
  book('rev', 'Revenue', '2030-09', '30 Sep'),
];
const base = {
  onClose: () => {},
  workspaceName: 'Telarchy',
  metricNames: ['Traders'],
  proposalReward: 0,
  decisionMinutes: 1440,
  liquidityCredits: 300,
  tradingCredits: 4010,
  books,
};
const renderNew = (props: Record<string, unknown> = {}) =>
  render(<ProposalForm {...base} onPropose={async () => {}} {...(props as object)} />);
const go = () => document.querySelector('.ticket-go') as HTMLButtonElement;
const each = () => screen.getByLabelText(/each market/i) as HTMLInputElement;
const cell = (metric: string, date: string) => screen.getByLabelText(`${metric}, ${date}`) as HTMLInputElement;
const title = () => fireEvent.change(screen.getByLabelText('Proposal title'), { target: { value: 'Ship it' } });
const sorted = (cells: Array<{ metricId: string; targetDate: string }>) =>
  [...cells].sort((a, b) => `${a.metricId}${a.targetDate}`.localeCompare(`${b.metricId}${b.targetDate}`));

afterEach(() => vi.clearAllMocks());

describe('posting is free unless the proposer says otherwise', () => {
  test('the number starts empty, the grid is closed, the confirm says free, and no liquidity is sent', async () => {
    const onPropose = vi.fn(async () => {});
    renderNew({ onPropose });
    title();
    expect(each().value).toBe('');
    expect(screen.queryByLabelText('Traders, 21 Sep')).toBeNull();
    expect(go().textContent).toMatch(/Free to post/);
    fireEvent.click(go());
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(onPropose.mock.calls[0][5]).toBeUndefined();
  });
});

describe('one number fills every book', () => {
  test('100 each book sends all four books at 100 and the confirm names the whole bill, both sides', async () => {
    const onPropose = vi.fn(async () => {});
    renderNew({ onPropose });
    title();
    fireEvent.change(each(), { target: { value: '1x00' } });
    expect(each().value).toBe('100');
    // Four books, two sides each.
    expect(go().textContent).toMatch(/Puts 800\s*cr/);
    fireEvent.click(go());
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(sorted(onPropose.mock.calls[0][5])).toEqual(
      sorted(books.map(b => ({ metricId: b.metricId, targetDate: b.targetDate, amount: 100 }))),
    );
  });

  test('with three options typed, every book has three sides and the bill says so', () => {
    renderNew();
    fireEvent.click(screen.getByRole('button', { name: /^Options/ }));
    const labels = screen.getAllByLabelText(/^Option \d label$/);
    fireEvent.change(labels[0], { target: { value: 'A' } });
    fireEvent.change(labels[1], { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: /add option/i }));
    fireEvent.change(screen.getAllByLabelText(/^Option \d label$/)[2], { target: { value: 'C' } });
    fireEvent.change(each(), { target: { value: '100' } });
    expect(go().textContent).toMatch(/Puts 1,200\s*cr/);
  });
});

describe('set per date: the proposer chooses per metric and date', () => {
  test('the grid opens already filled with the one number, a row per date and a column per metric', () => {
    renderNew();
    fireEvent.change(each(), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'per market' }));
    expect(cell('Traders', '21 Sep').value).toBe('100');
    expect(cell('Revenue', '30 Sep').value).toBe('100');
  });

  test('only the books with a number are sent, zeros and blanks are left out', async () => {
    const onPropose = vi.fn(async () => {});
    renderNew({ onPropose });
    title();
    fireEvent.click(screen.getByRole('button', { name: 'per market' }));
    fireEvent.change(cell('Traders', '30 Sep'), { target: { value: '500' } });
    fireEvent.change(cell('Revenue', '21 Sep'), { target: { value: '0' } });
    expect(go().textContent).toMatch(/Puts 1,000\s*cr/);
    fireEvent.click(go());
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(onPropose.mock.calls[0][5]).toEqual([{ metricId: 'tr', targetDate: '2030-09', amount: 500 }]);
  });

  test('ONE OR THE OTHER: per market hides the big number, same for all hides the grid', () => {
    renderNew();
    expect(screen.getByRole('button', { name: 'same for all' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Traders, 21 Sep')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'per market' }));
    expect(screen.getByRole('button', { name: 'per market' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText(/each market/i)).toBeNull();
    expect(cell('Traders', '21 Sep')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'same for all' }));
    expect(each()).toBeTruthy();
    expect(screen.queryByLabelText('Traders, 21 Sep')).toBeNull();
  });

  test('switching back keeps the number while every market agrees', () => {
    renderNew();
    fireEvent.change(each(), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'per market' }));
    fireEvent.click(screen.getByRole('button', { name: 'same for all' }));
    expect(each().value).toBe('100');
    expect(go().textContent).toMatch(/Puts 800\s*cr/);
  });

  test('switching back once the markets differ starts from nothing, never from a number nobody typed', () => {
    renderNew();
    title();
    fireEvent.change(each(), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'per market' }));
    fireEvent.change(cell('Traders', '30 Sep'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'same for all' }));
    expect(each().value).toBe('');
    expect(go().textContent).toMatch(/Free to post/);
  });

  test('each book shows what the floor already adds, and says nothing where it adds nothing', () => {
    renderNew();
    fireEvent.click(screen.getByRole('button', { name: 'per market' }));
    expect(cell('Traders', '21 Sep').closest('.jobform-cell')?.textContent).toMatch(/\+3,000/);
    expect(cell('Revenue', '21 Sep').closest('.jobform-cell')?.textContent ?? '').not.toMatch(/\+/);
  });

  test('a book that settles before the chosen deadline is not offered, and is never sent', async () => {
    const onPropose = vi.fn(async () => {});
    renderNew({
      onPropose,
      books: [...books.slice(1), book('tr', 'Traders', '2030-W38', '21 Sep', { periodEndsOn: soon })],
    });
    title();
    fireEvent.change(each(), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'per market' }));
    expect(screen.queryByLabelText('Traders, 21 Sep')).toBeNull();
    expect(go().textContent).toMatch(/Puts 600\s*cr/);
    fireEvent.click(go());
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(onPropose.mock.calls[0][5]).toHaveLength(3);
  });
});

describe('LIQUIDITY CREDITS ARE SHOWN SPENT FIRST, TRADING CREDITS SECOND', () => {
  const facts = () => document.querySelector('.jobform-facts') as HTMLElement;

  test('a bill the wallet covers leaves the trading credits alone', () => {
    renderNew();
    fireEvent.change(each(), { target: { value: '25' } });
    // 25 x 4 books x 2 sides = 200 of the wallet's 300.
    expect(facts().textContent).toMatch(/300\s*→\s*100/);
    expect(facts().textContent).toMatch(/4,010(?!\s*→)/);
  });

  test('what the wallet cannot cover comes off the trading credits', () => {
    renderNew();
    fireEvent.change(each(), { target: { value: '100' } });
    // 800: the wallet's 300, then 500 of the 4,010.
    expect(facts().textContent).toMatch(/300\s*→\s*0/);
    expect(facts().textContent).toMatch(/4,010\s*→\s*3,510/);
  });

  test('no facts until there is a number', () => {
    renderNew();
    expect(document.querySelector('.jobform-facts')).toBeNull();
  });
});

describe('the form never lets a proposer name more than both purses hold', () => {
  test('a bill above the two purses disables the confirm and names what they hold', async () => {
    const onPropose = vi.fn(async () => {});
    renderNew({ onPropose });
    title();
    fireEvent.change(each(), { target: { value: '600' } });
    expect(go().disabled).toBe(true);
    expect(go().textContent).toMatch(/You hold 4,310\s*cr/);
    fireEvent.click(go());
    expect(onPropose).not.toHaveBeenCalled();
  });

  test('a bill equal to the two purses is allowed', () => {
    renderNew({ liquidityCredits: 300, tradingCredits: 500 });
    title();
    fireEvent.change(each(), { target: { value: '100' } });
    expect(go().disabled).toBe(false);
  });

  test('unknown purses (signed out, not loaded) never block: the server decides', () => {
    renderNew({ liquidityCredits: null, tradingCredits: null });
    title();
    fireEvent.change(each(), { target: { value: '9000' } });
    expect(go().disabled).toBe(false);
  });
});

describe('a floor with nothing to price offers no liquidity', () => {
  test('no books, no number', () => {
    renderNew({ books: [] });
    expect(screen.queryByLabelText(/each market/i)).toBeNull();
  });
});

describe('editing: the numbers are amounts added, per book', () => {
  const edit = {
    ask: 80,
    title: 'rewrite the store page',
    description: 'A better store page.',
    decideBy: far,
  };
  const held = books.map((b, i) => ({ ...b, holds: i === 0 ? 6082 : 0, sides: 2 }));

  test('the number reads "Add liquidity, each market", and a book shows what it holds now', () => {
    render(<ProposalForm {...base} books={held} edit={edit} onSave={async () => {}} />);
    expect(each()).toBeTruthy();
    expect(screen.getByText(/Add liquidity, each market/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'per market' }));
    expect(
      within(cell('Traders', '21 Sep').closest('.jobform-cell') as HTMLElement).getByText(/holds 6,082/),
    ).toBeTruthy();
  });

  test('Save sends the words and the books with a number; none picked sends no list', async () => {
    const onSave = vi.fn(async () => {});
    render(<ProposalForm {...base} books={held} edit={edit} onSave={onSave} />);
    fireEvent.click(go());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][1]).toBeUndefined();
  });

  test('a per-book amount is sent as that book alone and the confirm says what it adds', async () => {
    const onSave = vi.fn(async () => {});
    render(<ProposalForm {...base} books={held} edit={edit} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'per market' }));
    fireEvent.change(cell('Revenue', '30 Sep'), { target: { value: '50' } });
    expect(go().textContent).toMatch(/Adds 100\s*cr/);
    fireEvent.click(go());
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).toEqual([{ metricId: 'rev', targetDate: '2030-09', amount: 50 }]);
  });
});
