import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The funding page (docs/liquidity-purchases.md).
 *
 * What matters is not that a form renders. It is that the page never implies
 * the payment buys a prize or a balance: credits go into this floor's pools,
 * the operator is not eligible for the season either way, and nothing moves
 * until Stripe confirms. And that a disabled instance says so instead of
 * offering a button that answers 503.
 */

const getMarketplaceWorkspace = vi.fn(async () => ({
  workspaceId: 'ws',
  name: 'LookPilot',
  slug: 'lookpilot',
  openMarketCount: 4,
}));
const getProfile = vi.fn(async () => ({ capabilities: ['read', 'trade', 'manage'] }));
const getParticipant = vi.fn(async () => ({ balance: 10000, liquidityBalance: 128400 }));
const getLiquidityPurchases = vi.fn(async () => ({
  purchases: [
    {
      id: 'p1',
      usdAmount: 120,
      credits: 120000,
      creditsPerUsd: 1000,
      status: 'completed',
      allocation: null,
      createdAt: '2026-08-14T10:00:00Z',
      completedAt: '2026-08-14T10:01:00Z',
    },
  ],
}));
const buyLiquidityCredits = vi.fn(async () => ({ url: 'https://checkout.stripe.com/c/pay/abc', credits: 50000 }));

vi.mock('../../lib/api', () => ({
  api: {
    getMarketplaceWorkspace: () => getMarketplaceWorkspace(),
    getProfile: () => getProfile(),
    getParticipant: () => getParticipant(),
    getLiquidityPurchases: (...a: unknown[]) => getLiquidityPurchases(...(a as [])),
    buyLiquidityCredits: (...a: unknown[]) => buyLiquidityCredits(...(a as [])),
  },
}));
let signedIn = true;
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: signedIn ? { id: 'u' } : null, loading: false }) }));
vi.mock('../../components/PageTopBar', () => ({ PageTopBar: () => null }));

import { FundingPage } from '../FundingPage';

const renderPage = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/lookpilot/funding${search}`]}>
      <Routes>
        <Route path="/:slug/funding" element={<FundingPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  signedIn = true;
  getLiquidityPurchases.mockClear();
  getLiquidityPurchases.mockResolvedValue({
    purchases: [
      {
        id: 'p1',
        usdAmount: 120,
        credits: 120000,
        creditsPerUsd: 1000,
        status: 'completed',
        allocation: null,
        createdAt: '2026-08-14T10:00:00Z',
        completedAt: '2026-08-14T10:01:00Z',
      },
    ],
  } as never);
  buyLiquidityCredits.mockClear();
  buyLiquidityCredits.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/abc', credits: 50000 } as never);
});

describe('the funding page', () => {
  test('shows the wallet and what it can be spent on', async () => {
    renderPage();
    expect(await screen.findByText('128,400')).toBeTruthy();
    expect(screen.getByText('credits in your liquidity wallet')).toBeTruthy();
    expect(screen.getByText('open markets to place them in')).toBeTruthy();
  });

  test('says what the money is and is not, without making anyone read the doc', async () => {
    renderPage();
    await screen.findByText('128,400');
    const note = screen.getByText(/can only ever go into your own market pools/);
    // The three claims that keep this a service rather than contest entry.
    expect(note.textContent).toMatch(/never a balance you can trade or withdraw/);
    expect(note.textContent).toMatch(/comes back to the wallet/);
    expect(note.textContent).toMatch(/does not enter you into the prize season/);
  });

  test('the button carries the whole trade: dollars in, credits out', async () => {
    renderPage();
    await screen.findByText('128,400');
    expect(screen.getByText('Pay $50.00 for 50,000 credits')).toBeTruthy();
    fireEvent.click(screen.getByText('$250'));
    expect(screen.getByText('Pay $250.00 for 250,000 credits')).toBeTruthy();
  });

  test('a purchase hands off to Stripe and nothing is claimed before it confirms', async () => {
    renderPage();
    await screen.findByText('128,400');
    fireEvent.click(screen.getByText('Pay $50.00 for 50,000 credits'));
    await waitFor(() => expect(buyLiquidityCredits).toHaveBeenCalledWith('ws', 50));
    expect(screen.getByText(/nothing changes until it confirms/i)).toBeTruthy();
  });

  test('an amount outside the API bounds cannot be submitted', async () => {
    renderPage();
    await screen.findByText('128,400');
    const amt = screen.getByLabelText('Amount in US dollars');
    fireEvent.change(amt, { target: { value: '2' } });
    expect((screen.getByRole('button', { name: /Pay by card/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(amt, { target: { value: '9000' } });
    expect((screen.getByRole('button', { name: /Pay by card/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(buyLiquidityCredits).not.toHaveBeenCalled();
  });

  test('a disabled instance says so in the words the server used', async () => {
    buyLiquidityCredits.mockRejectedValueOnce(
      new Error('Liquidity purchases are disabled on this instance (no Stripe configuration).') as never,
    );
    renderPage();
    await screen.findByText('128,400');
    fireEvent.click(screen.getByText('Pay $50.00 for 50,000 credits'));
    expect(await screen.findByText(/disabled on this instance/)).toBeTruthy();
  });

  test('a visitor is sent back to the market, not shown a buy form', async () => {
    signedIn = false;
    renderPage();
    expect(await screen.findByText(/This page is the owner's/)).toBeTruthy();
    expect(screen.queryByLabelText('Amount in US dollars')).toBeNull();
  });
});

/**
 * Coming back from Stripe. The owner paid $5 on 2026-09-01 and landed on the
 * operator door, which offers to open a market and says nothing about money:
 * "i just bought it. 5 credits.. and it redirected me to otto? wtf". The
 * return belongs here, and here it has to account for the payment.
 */
describe('the return from Stripe', () => {
  test('a completed purchase is confirmed by amount and credits', async () => {
    renderPage('?liquidity=purchased');
    expect(await screen.findByText(/payment received/i)).toBeInTheDocument();
    expect(await screen.findByText(/120,000 credits are in your wallet/i)).toBeInTheDocument();
  });

  test('a purchase Stripe has not confirmed yet says it is still coming, not that nothing happened', async () => {
    getLiquidityPurchases.mockResolvedValue({
      purchases: [
        {
          id: 'p2',
          usdAmount: 5,
          credits: 5000,
          creditsPerUsd: 1000,
          status: 'pending',
          allocation: null,
          createdAt: '2026-09-01T11:41:00Z',
          completedAt: null,
        },
      ],
    } as never);
    renderPage('?liquidity=purchased');
    expect(await screen.findByText(/payment received/i)).toBeInTheDocument();
    expect(screen.getByText(/still confirming/i)).toBeInTheDocument();
    // It keeps looking rather than leaving a stale number on screen.
    await waitFor(() => expect(getLiquidityPurchases.mock.calls.length).toBeGreaterThan(1), { timeout: 6000 });
  });

  test('a cancelled return says nothing was charged and confirms no payment', async () => {
    renderPage('?liquidity=cancelled');
    expect(await screen.findByText(/nothing was charged/i)).toBeInTheDocument();
    expect(screen.queryByText(/payment received/i)).not.toBeInTheDocument();
  });

  test('arriving without either says neither', async () => {
    renderPage();
    expect(await screen.findByText(/credits in your liquidity wallet/i)).toBeInTheDocument();
    expect(screen.queryByText(/payment received/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing was charged/i)).not.toBeInTheDocument();
  });
});
