import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A HIDDEN TAB ASKS FOR NOTHING (docs/ui-conventions.md, "A hidden tab asks
 * for nothing"; "The top bar and the account menu"): the balance re-reads
 * every thirty seconds while the tab is visible, and `/api/agents/me` from
 * idle background tabs was one of the most polled routes on the site.
 */

const getParticipant = vi.fn(async () => ({
  nickname: 'viktor36',
  balance: 984000,
  liquidityBalance: 0,
  earnedBetting: 0,
}));
vi.mock('../../lib/api', () => ({
  api: { getParticipant: () => getParticipant(), listWorkspaces: async () => [] },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u' }, logout: () => {} }) }));
vi.mock('../../hooks/useEarnAvailable', () => ({ useEarnAvailable: () => null }));

import { AccountMenu } from '../AccountMenu';

let visibility: 'visible' | 'hidden' = 'visible';
const setVisibility = async (next: 'visible' | 'hidden') => {
  visibility = next;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

beforeEach(() => {
  getParticipant.mockClear();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => visibility === 'hidden' });
});
afterEach(() => {
  vi.useRealTimers();
  visibility = 'visible';
});

describe('THE BALANCE ASKS NOTHING WHILE THE TAB IS HIDDEN', () => {
  test('visible: every thirty seconds, as before', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <MemoryRouter>
        <AccountMenu floor={{ idOrSlug: 'lookpilot', name: 'LookPilot' }} />
      </MemoryRouter>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const opened = getParticipant.mock.calls.length;
    expect(opened).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(getParticipant.mock.calls.length).toBe(opened + 3);
  });

  test('hidden: no read however long, one read at once on return, then the thirty seconds again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <MemoryRouter>
        <AccountMenu floor={{ idOrSlug: 'lookpilot', name: 'LookPilot' }} />
      </MemoryRouter>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getAllByText(/984/).length).toBeGreaterThan(0);
    const opened = getParticipant.mock.calls.length;
    await setVisibility('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(getParticipant.mock.calls.length).toBe(opened);
    await setVisibility('visible');
    expect(getParticipant.mock.calls.length).toBe(opened + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(getParticipant.mock.calls.length).toBe(opened + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(getParticipant.mock.calls.length).toBe(opened + 2);
  });
});
