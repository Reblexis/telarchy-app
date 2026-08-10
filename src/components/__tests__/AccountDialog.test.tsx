import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * The account dialog: management left the corner popover for a real
 * dialog (owner direction 2026-08-10). What matters: the provider pills
 * switch which fields are asked for, and saving sends a STRUCTURED
 * method ({ provider, ...fields }), not a broad free-text handle.
 */

const upsertProfile = vi.fn(async () => ({}));
const getParticipant = vi.fn(async () => ({
  nickname: 'trader-1', balance: 1000, earnedBetting: 50,
  payoutHandle: 'PayPal: old@x.com',
  payoutMethod: { provider: 'paypal', email: 'old@x.com' },
}));

vi.mock('../../lib/api', () => ({
  api: {
    upsertProfile: (...a: unknown[]) => upsertProfile(...a as []),
    getParticipant: () => getParticipant(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { name: 'Trader', email: 't@x.com', image: null }, logout: async () => {} }),
}));

import { AccountDialog } from '../AccountDialog';

beforeEach(() => { upsertProfile.mockClear(); });

describe('the account dialog', () => {
  test('hydrates the stored provider and its fields', async () => {
    render(<AccountDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('PayPal email')).toBeTruthy());
    expect((screen.getByLabelText('PayPal email') as HTMLInputElement).value).toBe('old@x.com');
  });

  test('switching provider switches the asked-for fields', async () => {
    render(<AccountDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Bank')).toBeTruthy());
    fireEvent.click(screen.getByText('Bank'));
    expect(screen.getByLabelText('IBAN')).toBeTruthy();
    expect(screen.getByLabelText('Account holder')).toBeTruthy();
    fireEvent.click(screen.getByText('Crypto'));
    expect(screen.getByLabelText('Address')).toBeTruthy();
    expect(screen.getByText('Ethereum')).toBeTruthy();
  });

  test('saving sends the structured method', async () => {
    render(<AccountDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Bank')).toBeTruthy());
    fireEvent.click(screen.getByText('Bank'));
    fireEvent.change(screen.getByLabelText('IBAN'), { target: { value: 'DE89 3704 0044 0532 0130 00' } });
    fireEvent.change(screen.getByLabelText('Account holder'), { target: { value: 'Jan Novak' } });
    fireEvent.click(screen.getByText('Save payment details'));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith({
      payoutMethod: { provider: 'bank', iban: 'DE89 3704 0044 0532 0130 00', holder: 'Jan Novak' },
    }));
  });

  test('a server refusal lands beside the save, verbatim', async () => {
    upsertProfile.mockRejectedValueOnce(new Error('That IBAN does not check out; copy it exactly from your bank'));
    render(<AccountDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Bank')).toBeTruthy());
    fireEvent.click(screen.getByText('Bank'));
    fireEvent.change(screen.getByLabelText('IBAN'), { target: { value: 'DE00' } });
    fireEvent.click(screen.getByText('Save payment details'));
    await waitFor(() => expect(screen.getByText(/does not check out/)).toBeTruthy());
  });
});
