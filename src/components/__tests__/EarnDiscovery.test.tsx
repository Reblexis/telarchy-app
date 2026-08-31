import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Discovery goes where the lack is felt (owner ask 2026-08-30), and the
 * discipline is the absence: every one of these surfaces has to vanish
 * for an account with nothing left to earn, or it becomes the permanent
 * "earn credits!" furniture the design exists to avoid.
 */

vi.mock('../../lib/api', () => ({ api: { getMyEarn: vi.fn() } }));

import { clearEarnAvailableCache } from '../../hooks/useEarnAvailable';
import { api } from '../../lib/api';
import { EarnDoor } from '../EarnDoor';

const renderDoor = () =>
  render(
    <MemoryRouter>
      <EarnDoor />
    </MemoryRouter>,
  );

beforeEach(() => {
  clearEarnAvailableCache();
  vi.mocked(api.getMyEarn).mockResolvedValue({ earned: 100, available: 5200, streak: null, rules: [] } as never);
});

describe('the top bar earn door', () => {
  test('shows what is unclaimed', async () => {
    renderDoor();
    expect(await screen.findByText('+5,200')).toBeInTheDocument();
  });

  test('DISAPPEARS once there is nothing left to earn', async () => {
    vi.mocked(api.getMyEarn).mockResolvedValue({ earned: 5300, available: 0, streak: null, rules: [] } as never);
    const { container } = renderDoor();
    await waitFor(() => expect(vi.mocked(api.getMyEarn)).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.earndoor')).toBeNull());
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
    expect(await screen.findByText('+50')).toBeInTheDocument();
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
    await waitFor(() => expect(container.querySelector('.earndoor')).toBeNull());
  });

  test('the streak adds to what is still unclaimed', async () => {
    vi.mocked(api.getMyEarn).mockResolvedValue({
      earned: 100,
      available: 200,
      streak: { days: 0, earnedToday: false, todayCredits: 0, nextCredits: 25 },
      rules: [],
    } as never);
    renderDoor();
    expect(await screen.findByText('+225')).toBeInTheDocument();
  });

  test('a failed read shows nothing rather than a wrong zero', async () => {
    vi.mocked(api.getMyEarn).mockRejectedValue(new Error('offline'));
    const { container } = renderDoor();
    await waitFor(() => expect(vi.mocked(api.getMyEarn)).toHaveBeenCalled());
    expect(container.querySelector('.earndoor')).toBeNull();
  });
});
