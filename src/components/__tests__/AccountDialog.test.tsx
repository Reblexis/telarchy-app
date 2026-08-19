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
  notifications: { commentOnMyProposal: true, replyToMyComment: true, newProposal: false },
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

/**
 * The crypto method grew chains and a required asset on 2026-08-15. These
 * pin the two things that broke when it did: a method saved before assets
 * existed must still be editable, and the picker must offer exactly what the
 * server accepts.
 */
describe('crypto payment details', () => {
  test('a method saved before assets existed is backfilled, not left unsavable', async () => {
    // The stored shape from before the change: chain, address, no asset.
    getParticipant.mockResolvedValueOnce({
      nickname: 'trader-1', balance: 1000, earnedBetting: 50,
      payoutHandle: 'Crypto',
      payoutMethod: { provider: 'crypto', network: 'ethereum', address: '0x' + 'a'.repeat(40) },
    } as never);
    render(<AccountDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Address')).toBeTruthy());

    // An asset pill is active, so saving cannot 400 with "Pick what to be
    // paid in" about a field the user never touched.
    const usdc = screen.getByText('USDC');
    expect(usdc.className).toContain('is-active');

    // The save button appears once something changes. Touch the note, the
    // field this user actually came to edit, and save: the backfilled asset
    // has to ride along or the request 400s on a field they never saw.
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'memo 42' } });
    fireEvent.click(screen.getByText('Save payment details'));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith({
      payoutMethod: {
        provider: 'crypto', network: 'ethereum', asset: 'USDC',
        address: '0x' + 'a'.repeat(40), note: 'memo 42',
      },
    }));
  });

  test('the highlighted chain and the offered assets are the same chain', async () => {
    render(<AccountDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Crypto')).toBeTruthy());
    fireEvent.click(screen.getByText('Crypto'));

    const active = ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Solana', 'Bitcoin']
      .filter(n => screen.getByText(n).className.includes('is-active'));
    expect(active).toEqual(['Base']);
    // Base settles USDC and ETH, not USDT: the asset row must match the
    // highlighted chain, not a different default.
    expect(screen.queryByText('USDT')).toBeNull();
    expect(screen.getByText('ETH')).toBeTruthy();
  });

  test('switching chain drops an asset the new chain cannot settle', async () => {
    render(<AccountDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Crypto')).toBeTruthy());
    fireEvent.click(screen.getByText('Crypto'));
    fireEvent.click(screen.getByText('Ethereum'));
    fireEvent.click(screen.getByText('USDT'));
    fireEvent.click(screen.getByText('Bitcoin'));
    // Bitcoin settles BTC only, so the stale USDT pick cannot survive.
    expect(screen.getByText('BTC').className).toContain('is-active');
    expect(screen.queryByText('USDT')).toBeNull();
  });
});

/**
 * The picker's chains and assets are a hand-copy of CRYPTO_NETWORKS and
 * CRYPTO_ASSETS in functions/src/lib/payout.ts, and nothing but a comment
 * held them together. Adding a chain server-side would silently leave the
 * picker unable to offer it; adding one here would produce a 400 on save.
 */
describe('the picker matches what the server accepts', () => {
  test('same chains, same assets, same order', async () => {
    const { NETWORKS, ASSETS } = await import('../AccountDialog');
    const server = await import('../../../functions/src/lib/payout');
    expect(NETWORKS.map(n => n.id)).toEqual([...server.CRYPTO_NETWORKS]);
    for (const network of server.CRYPTO_NETWORKS) {
      expect(ASSETS[network]).toEqual([...server.CRYPTO_ASSETS[network]]);
    }
    expect(Object.keys(ASSETS).sort()).toEqual([...server.CRYPTO_NETWORKS].sort());
  });
});

/**
 * The email switches (docs/vision.md, "Participant email notifications").
 * What matters: the stored state is what is shown, one click sends ONE key
 * (so flipping one switch cannot silently rewrite the other two), and a
 * refusal puts the switch back rather than lying about what is stored.
 */
describe('the email switches', () => {
  test('show what is stored, defaults included', async () => {
    render(<AccountDialog onClose={() => {}} />);
    const mine = await screen.findByRole('switch', { name: /comments on my contract/i });
    const ballot = screen.getByRole('switch', { name: /new contract goes on the ballot/i });
    await waitFor(() => expect(mine.getAttribute('aria-checked')).toBe('true'));
    expect(ballot.getAttribute('aria-checked')).toBe('false');
  });

  test('one click sends only that switch', async () => {
    render(<AccountDialog onClose={() => {}} />);
    const ballot = await screen.findByRole('switch', { name: /new contract goes on the ballot/i });
    fireEvent.click(ballot);
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith({ notifications: { newProposal: true } }));
    expect(ballot.getAttribute('aria-checked')).toBe('true');
  });

  test('a refused save puts the switch back', async () => {
    upsertProfile.mockImplementationOnce(async () => { throw new Error('nope'); });
    render(<AccountDialog onClose={() => {}} />);
    const ballot = await screen.findByRole('switch', { name: /new contract goes on the ballot/i });
    fireEvent.click(ballot);
    await waitFor(() => expect(screen.getByText('nope')).toBeTruthy());
    expect(ballot.getAttribute('aria-checked')).toBe('false');
  });
});
