import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The account dialog: management left the corner popover for a real
 * dialog (owner direction 2026-08-10). What matters: the provider pills
 * switch which fields are asked for, and saving sends a STRUCTURED
 * method ({ provider, ...fields }), not a broad free-text handle.
 */

const upsertProfile = vi.fn(async () => ({}));
const getParticipant = vi.fn(async () => ({
  nickname: 'trader-1',
  balance: 1000,
  earnedBetting: 50,
  payoutHandle: 'PayPal: old@x.com',
  payoutMethod: { provider: 'paypal', email: 'old@x.com' },
}));
// The resolved matrix GET /api/auth/me serves: what the Notifications tab
// renders. Defaults as the model states them (lib/notification-prefs.ts).
const cell = (web: boolean, email: boolean, mobile: boolean) => ({ web, email, mobile });
const getProfile = vi.fn(async () => ({
  notificationChannels: {
    comment: cell(true, true, true),
    reply: cell(true, true, true),
    contract: cell(true, false, false),
    anyComment: cell(false, false, false),
    settled: cell(true, true, true),
    decision: cell(true, true, true),
  },
}));

/* The dialog absorbed the deleted console account page (2026-08-19), so it
   now also reads the instance's settlement switch, the deposit address and
   the prize season. All three answer "nothing to show" here, which is the
   simulation-instance shape: credits and season render nothing at all. */
vi.mock('../../lib/api', () => ({
  api: {
    upsertProfile: (...a: unknown[]) => upsertProfile(...(a as [])),
    getParticipant: () => getParticipant(),
    getProfile: () => getProfile(),
    getPushKey: async () => ({ configured: false, publicKey: null }),
    getStatus: async () => ({ usdcSettlementEnabled: false }),
    getDepositAddress: async () => null,
    getMySeason: async () => null,
    // "Your AI" lists the bots you own beneath the prompt, so opening that
    // tab reads them. One of them here so the tab renders a real row.
    getMyAgents: async () => [
      { id: 'me', authUserId: 'u-1', balance: 100, earned: 0, totalTrades: 0, lastTradeAt: null },
      { id: 'my-trader', authUserId: null, balance: 25, earned: 4, totalTrades: 2, lastTradeAt: null },
    ],
    transferCredits: async () => ({ id: 't1' }),
    createAgent: async () => ({ agentId: 'x', apiKey: 'k', initialCredits: 0 }),
  },
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { name: 'Trader', email: 't@x.com', image: null }, logout: async () => {} }),
}));

import { AccountDialog } from '../AccountDialog';

/** The dialog links to /earn, so it renders inside a router here exactly
 *  as it does in the app. */
const renderDialog = () =>
  render(
    <MemoryRouter>
      <AccountDialog onClose={() => {}} initialTab="money" />
    </MemoryRouter>,
  );

beforeEach(() => {
  upsertProfile.mockClear();
});

describe('the account dialog', () => {
  test('hydrates the stored provider and its fields', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByLabelText('PayPal email')).toBeTruthy());
    expect((screen.getByLabelText('PayPal email') as HTMLInputElement).value).toBe('old@x.com');
  });

  test('switching provider switches the asked-for fields', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText('Bank')).toBeTruthy());
    fireEvent.click(screen.getByText('Bank'));
    expect(screen.getByLabelText('IBAN')).toBeTruthy();
    expect(screen.getByLabelText('Account holder')).toBeTruthy();
    fireEvent.click(screen.getByText('Crypto'));
    expect(screen.getByLabelText('Address')).toBeTruthy();
    expect(screen.getByText('Ethereum')).toBeTruthy();
  });

  test('saving sends the structured method', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText('Bank')).toBeTruthy());
    fireEvent.click(screen.getByText('Bank'));
    fireEvent.change(screen.getByLabelText('IBAN'), { target: { value: 'DE89 3704 0044 0532 0130 00' } });
    fireEvent.change(screen.getByLabelText('Account holder'), { target: { value: 'Jan Novak' } });
    fireEvent.click(screen.getByText('Save payment details'));
    await waitFor(() =>
      expect(upsertProfile).toHaveBeenCalledWith({
        payoutMethod: { provider: 'bank', iban: 'DE89 3704 0044 0532 0130 00', holder: 'Jan Novak' },
      }),
    );
  });

  test('a server refusal lands beside the save, verbatim', async () => {
    upsertProfile.mockRejectedValueOnce(new Error('That IBAN does not check out; copy it exactly from your bank'));
    renderDialog();
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
      nickname: 'trader-1',
      balance: 1000,
      earnedBetting: 50,
      payoutHandle: 'Crypto',
      payoutMethod: { provider: 'crypto', network: 'ethereum', address: '0x' + 'a'.repeat(40) },
    } as never);
    renderDialog();
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
    await waitFor(() =>
      expect(upsertProfile).toHaveBeenCalledWith({
        payoutMethod: {
          provider: 'crypto',
          network: 'ethereum',
          asset: 'USDC',
          address: '0x' + 'a'.repeat(40),
          note: 'memo 42',
        },
      }),
    );
  });

  test('the highlighted chain and the offered assets are the same chain', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText('Crypto')).toBeTruthy());
    fireEvent.click(screen.getByText('Crypto'));

    const active = ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Solana', 'Bitcoin'].filter(n =>
      screen.getByText(n).className.includes('is-active'),
    );
    expect(active).toEqual(['Base']);
    // Base settles USDC and ETH, not USDT: the asset row must match the
    // highlighted chain, not a different default.
    expect(screen.queryByText('USDT')).toBeNull();
    expect(screen.getByText('ETH')).toBeTruthy();
  });

  test('switching chain drops an asset the new chain cannot settle', async () => {
    renderDialog();
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
describe('the notification matrix', () => {
  test('shows every kind with its three channel cells, defaults included', async () => {
    render(<AccountDialog onClose={() => {}} initialTab="emails" />);
    const mineWeb = await screen.findByRole('switch', { name: /comments on my proposal: Web/i });
    expect(mineWeb.getAttribute('aria-checked')).toBe('true');
    // The new-proposal firehose: bell on, mail and push off.
    expect(screen.getByRole('switch', { name: /goes on the ballot: Web/i }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: /goes on the ballot: Email/i }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(screen.getByRole('switch', { name: /goes on the ballot: Mobile/i }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(screen.getByRole('switch', { name: /market I traded settles: Email/i }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  test('one click sends only that cell', async () => {
    render(<AccountDialog onClose={() => {}} initialTab="emails" />);
    const ballotEmail = await screen.findByRole('switch', { name: /goes on the ballot: Email/i });
    fireEvent.click(ballotEmail);
    await waitFor(() =>
      expect(upsertProfile).toHaveBeenCalledWith({ notificationChannels: { contract: { email: true } } }),
    );
    expect(ballotEmail.getAttribute('aria-checked')).toBe('true');
  });

  test('a refused save puts the cell back', async () => {
    upsertProfile.mockImplementationOnce(async () => {
      throw new Error('nope');
    });
    render(<AccountDialog onClose={() => {}} initialTab="emails" />);
    const ballotEmail = await screen.findByRole('switch', { name: /goes on the ballot: Email/i });
    fireEvent.click(ballotEmail);
    await waitFor(() => expect(screen.getByText('nope')).toBeTruthy());
    expect(ballotEmail.getAttribute('aria-checked')).toBe('false');
  });

  test('a mobile cell cannot go on while push is unconfigured, and says why', async () => {
    render(<AccountDialog onClose={() => {}} initialTab="emails" />);
    const ballotMobile = await screen.findByRole('switch', { name: /goes on the ballot: Mobile/i });
    fireEvent.click(ballotMobile);
    await waitFor(() => expect(screen.getByText(/not set up on this server/i)).toBeTruthy());
    expect(ballotMobile.getAttribute('aria-checked')).toBe('false');
    expect(upsertProfile).not.toHaveBeenCalled();
  });
});

/**
 * The section rail (owner report 2026-08-19: the dialog scrolled and nobody
 * noticed). What matters: the dialog opens on Profile, every section is
 * NAMED on screen whether or not it is the one showing, and picking one
 * swaps the fields in place.
 */
describe('the section rail', () => {
  test('opens on Profile and names every section', async () => {
    render(<AccountDialog onClose={() => {}} />);
    expect(await screen.findByLabelText('Username')).toBeTruthy();
    for (const name of ['Profile', 'Money', 'Notifications', 'Security']) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
    expect(screen.getByRole('tab', { name: 'Profile' }).getAttribute('aria-selected')).toBe('true');
    // A setting in another section is announced by its tab, not hidden below
    // a fold: the payment fields are not rendered until Money is picked.
    expect(screen.queryByLabelText('PayPal email')).toBeNull();
  });

  test('picking a section swaps the fields', async () => {
    render(<AccountDialog onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Notifications' }));
    expect(await screen.findByRole('switch', { name: /comments on my proposal: Web/i })).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull();
  });
});

/**
 * "Your AI": the prompt that points someone's own agent at the same public
 * brief the floor's Ask field reads (moved off the floor 2026-08-20). What
 * matters: opened from a floor it names THAT floor's endpoint, opened from
 * anywhere else it still hands out something runnable, and both forms carry
 * the honesty instruction that keeps a stranger's agent as careful as ours.
 */
describe('the agent prompt', () => {
  test('names the floor it was opened from', async () => {
    render(<AccountDialog onClose={() => {}} floor={{ idOrSlug: 'lookpilot', name: 'LookPilot' }} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Your AI' }));
    const prompt = screen.getByText(/api\/marketplace\/lookpilot\/context/);
    expect(prompt.textContent).toContain('?format=md');
    expect(prompt.textContent).toContain('/api/help');
    expect(prompt.textContent).toContain('only that brief');
  });

  test('without a floor it still hands out something runnable', async () => {
    render(<AccountDialog onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Your AI' }));
    const prompt = screen.getByText(/workspaces\/public/);
    expect(prompt.textContent).toContain('/context?format=md');
    expect(prompt.textContent).toContain('only those briefs');
  });

  test('the same tab lists the bots you own, under the prompt', async () => {
    // Two senses of "your AI" share the tab: the agent you run against the
    // API, and the participants Telarchy runs for you.
    render(<AccountDialog onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Your AI' }));
    expect(await screen.findByText('my-trader')).toBeInTheDocument();
    expect(screen.getByText(/\+4 cr earned/)).toBeInTheDocument();
  });
});
