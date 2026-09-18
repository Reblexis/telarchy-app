import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The send ticket (docs/ui-conventions.md, "The participant profile",
 * Sending credits): a transfer cannot be taken back and costs season score,
 * so it takes two presses, never exceeds the tradeable balance, and says
 * when it does not know whether it happened.
 */

const getParticipant = vi.fn();
const getMySeason = vi.fn();
const transferCredits = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    getParticipant: () => getParticipant(),
    getMySeason: () => getMySeason(),
    transferCredits: (...a: unknown[]) => transferCredits(...a),
  },
}));
vi.mock('../FloorModal', () => ({
  FloorModal: ({ children, label }: { children: React.ReactNode; label: string }) => (
    <div role="dialog" aria-label={label}>
      {children}
    </div>
  ),
}));

import { SendCreditsTicket } from '../SendCreditsTicket';

const season = (over: Record<string, unknown> = {}) => ({
  season: { id: 's0', name: 'Season 0', status: 'running' },
  optedIn: true,
  canEnter: true,
  ...over,
});

const onClose = vi.fn();
const onSent = vi.fn();
const open = () =>
  render(<SendCreditsTicket to={{ id: 'agent-mira', handle: 'mira' }} onClose={onClose} onSent={onSent} />);
const amount = () => screen.getByLabelText('Amount in credits') as HTMLInputElement;
const type = (v: string) => fireEvent.change(amount(), { target: { value: v } });
const button = () => screen.getByTestId('send-credits-submit') as HTMLButtonElement;
const ready = () => waitFor(() => expect(screen.getByTestId('send-balance-after').textContent).toBe('12,400 cr'));

beforeEach(() => {
  vi.clearAllMocks();
  getParticipant.mockResolvedValue({ id: 'me', nickname: 'viktor36', balance: 12400, liquidityBalance: 90000 });
  getMySeason.mockResolvedValue(season());
  transferCredits.mockResolvedValue({ ok: true });
});

describe('the send ticket', () => {
  test('names the recipient and starts with nothing to send', async () => {
    open();
    await ready();
    expect(screen.getByText('Send to')).toBeTruthy();
    expect(screen.getByText('mira')).toBeTruthy();
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe('Send');
    expect(screen.getByText('Sent credits cannot be taken back.')).toBeTruthy();
  });

  test('NOTHING IS SENT ON THE FIRST PRESS: it asks once more, naming the amount and the person', async () => {
    open();
    await ready();
    type('500');
    expect(button().textContent).toBe('Send 500 cr');
    fireEvent.click(button());
    expect(transferCredits).not.toHaveBeenCalled();
    expect(button().textContent).toBe('Confirm: 500 cr to mira');
  });

  test('the second press sends to the recipient id with the note, then reports the amount', async () => {
    open();
    await ready();
    type('500');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '  thanks for the tip  ' } });
    fireEvent.click(button());
    fireEvent.click(button());
    await waitFor(() => expect(onSent).toHaveBeenCalledWith(500));
    expect(transferCredits).toHaveBeenCalledTimes(1);
    expect(transferCredits).toHaveBeenCalledWith('agent-mira', 500, 'thanks for the tip');
  });

  test('an empty note is not sent as a memo', async () => {
    open();
    await ready();
    type('20');
    fireEvent.click(button());
    fireEvent.click(button());
    await waitFor(() => expect(transferCredits).toHaveBeenCalledWith('agent-mira', 20, undefined));
  });

  test('the note holds at most 200 characters and says it is public', async () => {
    open();
    await ready();
    const note = screen.getByLabelText('Note') as HTMLInputElement;
    expect(note.maxLength).toBe(200);
    expect(note.placeholder).toBe('Note, shown on both profiles');
  });

  test('CHANGING THE AMOUNT DISARMS THE CONFIRMATION', async () => {
    open();
    await ready();
    type('500');
    fireEvent.click(button());
    type('5000');
    expect(button().textContent).toBe('Send 5,000 cr');
    fireEvent.click(button());
    expect(transferCredits).not.toHaveBeenCalled();
    expect(button().textContent).toBe('Confirm: 5,000 cr to mira');
  });

  test('AN AMOUNT ABOVE THE BALANCE CANNOT BE SENT', async () => {
    open();
    await ready();
    type('12401');
    expect(button().disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('You have 12,400 cr. Send that or less.');
    fireEvent.click(button());
    expect(transferCredits).not.toHaveBeenCalled();
  });

  test('the whole balance, to the credit, can be sent', async () => {
    open();
    await ready();
    type('12400');
    expect(button().disabled).toBe(false);
    expect(screen.getByTestId('send-balance-after').textContent).toBe('0 cr');
  });

  test.each(['', '0', '-5', 'abc', '0.0'])('an amount of "%s" sends nothing', async v => {
    open();
    await ready();
    type(v);
    expect(button().disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a fractional amount is sent as typed', async () => {
    open();
    await ready();
    type('12.5');
    fireEvent.click(button());
    fireEvent.click(button());
    await waitFor(() => expect(transferCredits).toHaveBeenCalledWith('agent-mira', 12.5, undefined));
  });

  test('nothing can be sent before the balance is known', async () => {
    getParticipant.mockReturnValue(new Promise(() => {}));
    open();
    type('500');
    expect(button().disabled).toBe(true);
  });

  test('the quick amounts fill the field', async () => {
    open();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '1,000' }));
    expect(amount().value).toBe('1000');
    expect(screen.getByTestId('send-balance-after').textContent).toBe('11,400 cr');
  });

  test('ALL IS THE TRADEABLE BALANCE, NEVER THE LIQUIDITY WALLET', async () => {
    open();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(amount().value).toBe('12400');
    expect(document.body.textContent).not.toContain('90,000');
  });

  test('THE SEASON COST IS SHOWN WHILE A SEASON RUNS AND THE SENDER IS IN IT', async () => {
    open();
    await ready();
    type('500');
    await waitFor(() => expect(screen.getByText('Your Season 0 score')).toBeTruthy());
    expect(screen.getByTestId('send-season-cost').textContent).toBe('-500');
  });

  test.each([
    ['the season has not started', season({ season: { id: 's1', name: 'Season 1', status: 'draft' } })],
    ['the season is settled', season({ season: { id: 's0', name: 'Season 0', status: 'settled' } })],
    ['the sender has not entered', season({ optedIn: false })],
    ['there is no season', season({ season: null })],
  ])('no season line when %s', async (_why, entry) => {
    getMySeason.mockResolvedValue(entry);
    open();
    await ready();
    type('500');
    await waitFor(() => expect(getMySeason).toHaveBeenCalled());
    expect(screen.queryByTestId('send-season-cost')).toBeNull();
  });

  test('a failed season read hides the season line and blocks nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getMySeason.mockRejectedValue(new Error('Season entry request failed: 500'));
    open();
    await ready();
    type('500');
    expect(screen.queryByTestId('send-season-cost')).toBeNull();
    expect(button().disabled).toBe(false);
  });

  test('a refusal the server explains is shown and may be retried', async () => {
    transferCredits.mockRejectedValueOnce(Object.assign(new Error('Insufficient balance'), { status: 409 }));
    open();
    await ready();
    type('500');
    fireEvent.click(button());
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Insufficient balance'));
    expect(onSent).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe('Send 500 cr');
  });

  test.each([
    ['the reply never arrived', new TypeError('Failed to fetch')],
    ['the server broke mid-send', Object.assign(new Error('API error'), { status: 500 })],
  ])('AN UNCERTAIN SEND IS NEVER REPEATED: %s', async (_why, failure) => {
    transferCredits.mockRejectedValueOnce(failure);
    open();
    await ready();
    type('500');
    fireEvent.click(button());
    fireEvent.click(button());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'The result is uncertain. Check your transfers before sending again.',
      ),
    );
    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(transferCredits).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();
  });

  test('A DOUBLE PRESS ON CONFIRM SENDS ONCE', async () => {
    let finish: (v: unknown) => void = () => {};
    transferCredits.mockReturnValue(new Promise(r => (finish = r)));
    open();
    await ready();
    type('500');
    fireEvent.click(button());
    fireEvent.click(button());
    fireEvent.click(button());
    fireEvent.click(button());
    expect(transferCredits).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
  });
});
