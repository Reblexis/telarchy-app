/**
 * Owner notifications (lib/notify.ts): env-gated, never throwing. The
 * routes that call this treat it as fire-and-forget; a Resend outage or
 * missing key must never turn a signup or a proposal into a 500.
 */

import { notifyOwner } from '../lib/notify';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.OWNER_NOTIFY_EMAIL;
});

describe('notifyOwner', () => {
  test('sends through Resend when configured', async () => {
    process.env.RESEND_API_KEY = 'k';
    process.env.OWNER_NOTIFY_EMAIL = 'owner@example.com';
    const calls: Array<{ url: string; body: any }> = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response('{}', { status: 200 });
    }) as any;

    await notifyOwner('subject', 'body');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('api.resend.com');
    expect(calls[0].body.to).toEqual(['owner@example.com']);
    expect(calls[0].body.subject).toBe('subject');
  });

  test('does nothing without config, and swallows transport failures', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('no network');
    }) as any;
    await expect(notifyOwner('s', 'b')).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();

    process.env.RESEND_API_KEY = 'k';
    process.env.OWNER_NOTIFY_EMAIL = 'owner@example.com';
    await expect(notifyOwner('s', 'b')).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
