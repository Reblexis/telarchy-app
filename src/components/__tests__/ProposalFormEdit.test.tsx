/**
 * Editing a proposal is the posting form again (docs/ui-conventions.md,
 * "Editing one"): same fields, filled in, and what cannot change is not
 * offered.
 *
 * THE RULE: nothing moves a deadline, so the form offers no window. What
 * editing does to liquidity is in ProposalFormLiquidity.test.tsx.
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
};
const base = {
  onClose: () => {},
  workspaceName: 'Telarchy',
  metricNames: ['Revenue'],
  proposalReward: 500,
  decisionMinutes: 1440,
  liquidityCredits: 0,
  tradingCredits: 4000,
  books: [
    {
      metricId: 'rev',
      metricLabel: 'Revenue',
      targetDate: '2030-09',
      dateLabel: '30 Sep',
      opensWith: 0,
      holds: 6000,
      sides: 2,
    },
  ],
};
const renderEdit = (props: Record<string, unknown> = {}) =>
  render(<ProposalForm {...base} edit={edit} onSave={async () => {}} {...(props as object)} />);
const go = () => document.querySelector('.ticket-go') as HTMLButtonElement;

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
    fireEvent.change(screen.getByLabelText(/each market/i), { target: { value: '500' } });
    fireEvent.click(go());
    await waitFor(() => expect(screen.getByText(/Insufficient balance/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(go().disabled).toBe(false);
  });
});
