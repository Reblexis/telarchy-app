/**
 * Editing a proposal is the posting form again (docs/ui-conventions.md,
 * "Editing one"): same fields, filled in, and what cannot change is not
 * offered.
 *
 * THE RULES: nothing moves a deadline, so the form offers no window; and
 * liquidity only goes IN, so the number is an amount added, never a total.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: { getParticipant: vi.fn(async () => ({ payoutHandle: 'pay@example.com' })) },
}));

const { ProposalForm } = await import('../ProposalForm');

const edit = {
  ask: 80,
  title: 'rewrite the store page',
  description: 'A better store page.',
  decideBy: new Date(Date.now() + 36 * 3600_000).toISOString(),
  pool: 6000,
};
const base = {
  onClose: () => {},
  workspaceName: 'Telarchy',
  metricNames: ['Revenue'],
  proposalReward: 500,
  decisionMinutes: 1440,
  spendable: 4000,
};
const renderEdit = (props: Record<string, unknown> = {}) =>
  render(<ProposalForm {...base} edit={edit} onSave={async () => {}} {...(props as object)} />);
const go = () => document.querySelector('.ticket-go') as HTMLButtonElement;
const chip = (name: string) => screen.getByRole('button', { name });

afterEach(() => vi.clearAllMocks());

describe('the same form, filled in', () => {
  test('price, title and pitch arrive filled and the confirm says Save', () => {
    renderEdit();
    expect((screen.getByLabelText(/Price in USD/) as HTMLInputElement).value).toBe('80');
    expect((screen.getByLabelText('Proposal title') as HTMLInputElement).value).toBe('rewrite the store page');
    expect((screen.getByLabelText('Proposal pitch') as HTMLTextAreaElement).value).toBe('A better store page.');
    expect(go().textContent).toMatch(/^Save/);
    expect(go().textContent).not.toMatch(/Free to post/);
  });

  test('a free proposal arrives with an empty price', () => {
    renderEdit({ edit: { ...edit, ask: null } });
    expect((screen.getByLabelText(/Price in USD/) as HTMLInputElement).value).toBe('');
  });

  test('saving the words sends the composed title, the pitch and the price, and no liquidity', async () => {
    const onSave = vi.fn(async () => {});
    renderEdit({ onSave });
    fireEvent.change(screen.getByLabelText('Proposal title'), { target: { value: 'rewrite the whole page' } });
    fireEvent.click(go());
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toEqual({
      title: '$80: rewrite the whole page',
      description: 'A better store page.',
      askUsd: 80,
    });
    expect(onSave.mock.calls[0][1]).toBeUndefined();
  });

  test('a title emptied out cannot be saved', () => {
    renderEdit();
    fireEvent.change(screen.getByLabelText('Proposal title'), { target: { value: '  ' } });
    expect(go().disabled).toBe(true);
  });
});

describe('nothing moves a deadline, so the form offers no window', () => {
  test('no window chips, no custom window, one line that says when and that it is fixed', () => {
    renderEdit();
    expect(screen.queryByRole('button', { name: '1 day' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'custom' })).toBeNull();
    expect(screen.getByText(/cannot be moved/i)).toBeTruthy();
  });

  test('options cannot change after posting, so there is no Options row', () => {
    renderEdit();
    expect(screen.queryByRole('button', { name: /^Options/ })).toBeNull();
  });
});

describe('liquidity only goes in: the number is an amount added, never a total', () => {
  test('the row reads "Add liquidity", none is preselected, and it says what the markets hold now', () => {
    renderEdit();
    const row = screen.getByLabelText('Add liquidity');
    expect(chip('none').getAttribute('aria-pressed')).toBe('true');
    expect(row.parentElement?.textContent).toMatch(/6,000\s*cr/);
  });

  test('picking 500 sends 500 as the amount to add and the confirm says so', async () => {
    const onSave = vi.fn(async () => {});
    renderEdit({ onSave });
    fireEvent.click(chip('500'));
    expect(go().textContent).toMatch(/Adds 500\s*cr/);
    fireEvent.click(go());
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).toBe(500);
  });

  test('more than they hold disables Save and names what they hold', () => {
    renderEdit({ spendable: 300 });
    fireEvent.click(chip('500'));
    expect(go().disabled).toBe(true);
    expect(screen.getByText(/You hold 300 cr/)).toBeTruthy();
  });

  test('a proposal with no liquidity yet says so instead of a zero', () => {
    renderEdit({ edit: { ...edit, pool: 0 } });
    expect(screen.getByLabelText('Add liquidity').parentElement?.textContent).toMatch(/hold nothing yet/i);
  });
});

describe('an edit never asks for payout details again', () => {
  test('a paid proposal saves on an account with no payout handle: it was snapshotted at posting', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getParticipant).mockResolvedValueOnce({ payoutHandle: null } as never);
    renderEdit();
    await waitFor(() => expect(api.getParticipant).toHaveBeenCalled());
    expect(go().disabled).toBe(false);
    expect(screen.queryByText(/needs payment details/)).toBeNull();
  });
});

describe('a refused save stays open and says why', () => {
  test('the error is shown and the form does not close', async () => {
    const onClose = vi.fn();
    renderEdit({ onClose, onSave: vi.fn(async () => Promise.reject(new Error('Insufficient balance: need 500'))) });
    fireEvent.click(chip('500'));
    fireEvent.click(go());
    await waitFor(() => expect(screen.getByText(/Insufficient balance/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(go().disabled).toBe(false);
  });
});
