/**
 * onApiMutation fires after successful mutating API calls and stays quiet on
 * reads and failures. The sidebar credit counter relies on this to refetch
 * the balance immediately after a spend (trade, liquidity top-up, proposal
 * subsidy) instead of waiting for a route change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, onApiMutation } from '../api';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('onApiMutation', () => {
  let listener: ReturnType<typeof vi.fn>;
  let unsubscribe: () => void;

  beforeEach(() => {
    listener = vi.fn();
    unsubscribe = onApiMutation(listener);
  });

  afterEach(() => {
    unsubscribe();
    vi.restoreAllMocks();
  });

  test('fires after a successful POST', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ ok: true })),
    );
    await api.injectLiquidityBulk(1, 'proposal-1');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('does not fire on GET', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ balance: 10 })),
    );
    await api.getParticipant();
    expect(listener).not.toHaveBeenCalled();
  });

  test('does not fire when the mutation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ error: 'Insufficient balance' }, 400)),
    );
    await expect(api.injectLiquidityBulk(1, 'proposal-1')).rejects.toThrow('Insufficient balance');
    expect(listener).not.toHaveBeenCalled();
  });

  test('unsubscribe stops notifications', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ ok: true })),
    );
    unsubscribe();
    await api.injectLiquidityBulk(1, 'proposal-1');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe = onApiMutation(listener); // restore for afterEach symmetry
  });
});
