import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The liquidity wallet in the top bar (owner ask 2026-09-01: "liquidity
 * credits are not shown anywhere").
 *
 * Two purses, so two chips: the balance trades, the wallet can only ever go
 * behind a market. The one thing that must not happen is the two being added
 * together or mistaken for each other.
 */

const getParticipant = vi.fn(async () => ({
  nickname: 'viktor36',
  balance: 984000,
  liquidityBalance: 128400,
  earnedBetting: 0,
}));
const listWorkspaces = vi.fn(async () => [] as Array<{ id: string; slug: string | null }>);
vi.mock('../../lib/api', () => ({
  api: { getParticipant: () => getParticipant(), listWorkspaces: () => listWorkspaces() },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u' }, logout: () => {} }) }));
vi.mock('../../hooks/useEarnAvailable', () => ({ useEarnAvailable: () => null }));

import { AccountMenu } from '../AccountMenu';

const menu = (props: Partial<Parameters<typeof AccountMenu>[0]> = {}) =>
  render(
    <MemoryRouter>
      <AccountMenu {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  listWorkspaces.mockReset();
  listWorkspaces.mockResolvedValue([] as never);
  getParticipant.mockClear();
  getParticipant.mockResolvedValue({
    nickname: 'viktor36',
    balance: 984000,
    liquidityBalance: 128400,
    earnedBetting: 0,
  } as never);
});

describe('the wallet chip', () => {
  test('stands beside the balance and never inside it', async () => {
    menu({ floor: { idOrSlug: 'lookpilot', name: 'LookPilot' } });
    expect(await screen.findByText('984k cr')).toBeTruthy();
    const wallet = await screen.findByLabelText(/Liquidity wallet/);
    expect(wallet.textContent).toContain('128k');
  });

  test('leads to the funding page of the market you are standing on', async () => {
    menu({ floor: { idOrSlug: 'lookpilot', name: 'LookPilot' } });
    const wallet = await screen.findByLabelText(/Liquidity wallet/);
    expect(wallet.getAttribute('href')).toBe('/lookpilot/funding');
  });

  // The operator door used to catch this click and offered a setup
  // conversation, not a way to spend the money the chip is showing (owner,
  // 2026-09-01: "whats even weirder is that the + at liquidity number leads
  // to it"). /manage is gone; the click lands on a floor of your own.
  test('off a floor, it leads to the funding page of a floor you own', async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1', slug: 'northwind' }] as never);
    menu();
    const wallet = await screen.findByLabelText(/Liquidity wallet/);
    await waitFor(() => expect(wallet.getAttribute('href')).toBe('/northwind/funding'));
  });

  test('a floor with no slug is still reachable by id', async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1', slug: null }] as never);
    menu();
    const wallet = await screen.findByLabelText(/Liquidity wallet/);
    await waitFor(() => expect(wallet.getAttribute('href')).toBe('/marketplace/ws-1/funding'));
  });

  test('and to the home page when you own no floor to fund', async () => {
    menu();
    const wallet = await screen.findByLabelText(/Liquidity wallet/);
    await waitFor(() => expect(wallet.getAttribute('href')).toBe('/'));
  });

  test('an empty wallet is nothing to carry around, unless you could fill it', async () => {
    getParticipant.mockResolvedValue({
      nickname: 'trader',
      balance: 500,
      liquidityBalance: 0,
      earnedBetting: 0,
    } as never);
    const { unmount } = menu({ floor: { idOrSlug: 'lookpilot', name: 'LookPilot' } });
    await screen.findByText('500 cr');
    expect(screen.queryByLabelText(/Liquidity wallet|Buy liquidity/)).toBeNull();
    unmount();

    // Someone who can put liquidity behind THIS market gets the plus, which
    // is the only thing an empty wallet has to say.
    menu({ floor: { idOrSlug: 'lookpilot', name: 'LookPilot' }, canFund: true });
    await waitFor(() => expect(screen.getByLabelText('Buy liquidity credits')).toBeTruthy());
    expect(screen.getByLabelText('Buy liquidity credits').textContent).toContain('+');
  });
});
