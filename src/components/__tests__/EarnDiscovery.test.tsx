import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('the earn button beside the balance', () => {
  const css = readFileSync(resolve(__dirname, '../../style.css'), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    if (at < 0) throw new Error(`no rule for ${selector}`);
    return css.slice(at, css.indexOf('}', at));
  };

  test('THE FILL ALWAYS MEANS CREDITS WAITING: filled while there is something to earn', async () => {
    const { container } = renderDoor();
    await screen.findByText('Earn +5,200');
    expect(container.querySelector('.acctmenu-earn')).toHaveClass('has-reward');
  });

  test('THE FILL ALWAYS MEANS CREDITS WAITING: an outline once nothing is left', async () => {
    vi.mocked(api.getMyEarn).mockResolvedValue({ earned: 5300, available: 0, streak: null, rules: [] } as never);
    const { container } = renderDoor();
    await waitFor(() => expect(container.querySelector('.acctmenu-earn')?.textContent).toContain('Get credits'));
    expect(container.querySelector('.acctmenu-earn')).not.toHaveClass('has-reward');
  });

  test('THE FILL ALWAYS MEANS CREDITS WAITING: a failed read is an outline too', async () => {
    vi.mocked(api.getMyEarn).mockRejectedValue(new Error('offline'));
    const { container } = renderDoor();
    await waitFor(() => expect(vi.mocked(api.getMyEarn)).toHaveBeenCalled());
    expect(container.querySelector('.acctmenu-earn')).not.toHaveClass('has-reward');
  });

  test('the button face is part of the balance link, never a second link', async () => {
    renderDoor();
    await screen.findByText('Earn +5,200');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toContainElement(screen.getByText('500 cr'));
    expect(screen.getByRole('link')).toContainElement(screen.getByText('Earn +5,200'));
  });

  test('balance and button sit on one row', () => {
    expect(rule('.acctmenu-credits')).not.toMatch(/flex-direction:\s*column/);
    expect(rule('.acctmenu-credits')).toMatch(/align-items:\s*center/);
  });

  test('the waiting state is filled with the accent, the empty state has a border and no fill', () => {
    expect(rule('.acctmenu-earn.has-reward')).toMatch(/background:\s*var\(--accent\)/);
    expect(rule('.acctmenu-earn')).toMatch(/border:\s*1px solid var\(--border-strong\)/);
    expect(rule('.acctmenu-earn')).not.toMatch(/background:\s*var\(--accent/);
  });

  test('the button is a button size, not the smallest text on the bar', () => {
    const size = Number(rule('.acctmenu-earn').match(/font:\s*\d+\s+([.\d]+)rem/)?.[1]);
    expect(size).toBeGreaterThanOrEqual(0.74);
  });

  test('no width hides the button', () => {
    for (const m of css.matchAll(/\.acctmenu-earn[^{]*\{([^}]*)\}/g)) {
      expect(m[1]).not.toMatch(/display:\s*none/);
    }
  });
});
