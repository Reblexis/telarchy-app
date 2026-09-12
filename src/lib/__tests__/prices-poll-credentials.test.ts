import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from '../api';

// A branch preview lives under /beta and is routed by the session cookie, so a
// prices poll that omits credentials reaches no branch: every poll answered 404
// and the hook backed off to about eight seconds (found on the
// realtime-prices-guard preview, 2026-09-12). The route reads no session, so
// sending the cookie costs nothing.
describe('the prices poll', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('A BRANCH PREVIEW PRICES POLL CARRIES THE SESSION COOKIE SO IT REACHES ITS BRANCH', async () => {
    const calls: Array<RequestInit | undefined> = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      calls.push(init);
      return new Response(null, { status: 304 });
    });
    const read = await api.getFloorPrices('snake', '"v1"');
    expect(read).toEqual({ changed: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.credentials).not.toBe('omit');
  });
});
