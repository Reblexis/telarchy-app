import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Discovery goes where the lack is felt (owner ask 2026-08-30), and the
 * balance remains useful even when there is no reward to advertise.
 * Only the available reward disappears; the Get credits destination stays.
 */

vi.mock('../../lib/api', () => ({ api: { getMyEarn: vi.fn() } }));

import { clearEarnAvailableCache } from '../../hooks/useEarnAvailable';
import { api } from '../../lib/api';
import { CreditsBalanceLink } from '../CreditsBalanceLink';

const renderDoor = () =>
  render(
    <MemoryRouter>
      <CreditsBalanceLink balance={500} />
    </MemoryRouter>,
  );

beforeEach(() => {
  clearEarnAvailableCache();
  vi.mocked(api.getMyEarn).mockResolvedValue({ earned: 100, available: 5200, streak: null, rules: [] } as never);
});

describe('earning from the top bar balance', () => {
  test('shows what is unclaimed', async () => {
    renderDoor();
    expect(await screen.findByText('Earn +5,200')).toBeInTheDocument();
    expect(screen.getByText('500 cr')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/earn');
  });

  test('keeps the balance and Get credits link when no reward is available', async () => {
    vi.mocked(api.getMyEarn).mockResolvedValue({ earned: 5300, available: 0, streak: null, rules: [] } as never);
    const { container } = renderDoor();
    await waitFor(() => expect(vi.mocked(api.getMyEarn)).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.acctmenu-earn')?.textContent).toContain('Get credits'));
  });

  test("TODAY'S UNCLAIMED STREAK COUNTS, so the door survives a finished list", async () => {
    // The bug (owner report 2026-08-31: "where is the earn credits
    // button?"): every one-time earn taken meant available 0 and the door
    // vanished, even though trading that day was worth 50 credits.
    vi.mocked(api.getMyEarn).mockResolvedValue({
      earned: 5300,
      available: 0,
      streak: { days: 1, earnedToday: false, todayCredits: 0, nextCredits: 50 },
      rules: [],
    } as never);
    renderDoor();
    expect(await screen.findByText('Earn +50')).toBeInTheDocument();
  });

  test('a streak already earned today does not keep the door open', async () => {
    // Otherwise it nags all day for something already taken, which is the
    // permanent furniture this design refuses.
    vi.mocked(api.getMyEarn).mockResolvedValue({
      earned: 5375,
      available: 0,
      streak: { days: 2, earnedToday: true, todayCredits: 50, nextCredits: 75 },
      rules: [],
    } as never);
    const { container } = renderDoor();
    await waitFor(() => expect(vi.mocked(api.getMyEarn)).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.acctmenu-earn')?.textContent).toContain('Get credits'));
  });

  test('the streak adds to what is still unclaimed', async () => {
    vi.mocked(api.getMyEarn).mockResolvedValue({
      earned: 100,
      available: 200,
      streak: { days: 0, earnedToday: false, todayCredits: 0, nextCredits: 25 },
      rules: [],
    } as never);
    renderDoor();
    expect(await screen.findByText('Earn +225')).toBeInTheDocument();
  });

  test('a failed read shows Get credits rather than a wrong reward amount', async () => {
    vi.mocked(api.getMyEarn).mockRejectedValue(new Error('offline'));
    const { container } = renderDoor();
    await waitFor(() => expect(vi.mocked(api.getMyEarn)).toHaveBeenCalled());
    expect(container.querySelector('.acctmenu-earn')?.textContent).toContain('Get credits');
  });
});
