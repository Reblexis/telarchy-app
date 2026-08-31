import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Becoming reachable on the mobile channel (docs/mobile.md).
 *
 * One entry point for both shells, because the caller (the Mobile switch in
 * the account dialog) must not know which transport it is getting. The switch
 * means "notify this device"; which of Web Push or FCM can carry that is a
 * property of where the code is running, decided here and nowhere else.
 *
 * The rule these protect: a store build must never take the browser path.
 * A Capacitor webview has a Notification API and a service worker that both
 * appear to work, so the browser path SUCCEEDS there and files a Web Push
 * address the server can never deliver to. The switch would then be on, the
 * user would be told nothing, and no notification would ever arrive.
 */

const subscribeNativePush = vi.fn(async () => 'not-native' as string);
vi.mock('../native-push', () => ({
  subscribeNativePush: () => subscribeNativePush(),
}));

const getPushKey = vi.fn(async () => ({ configured: true, publicKey: 'BPk' }));
const registerPushSubscription = vi.fn(async () => ({ ok: true }));
vi.mock('../api', () => ({
  api: {
    getPushKey: () => getPushKey(),
    registerPushSubscription: (b: unknown) => registerPushSubscription(b as never),
  },
}));

import { ensureMobileAddress } from '../mobile-address';

const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: 'https://push.example/x', keys: {} }) }));
const swRegister = vi.fn(async () => ({
  pushManager: { getSubscription: async () => null, subscribe: () => subscribe() },
}));
const requestPermission = vi.fn(async () => 'granted');

beforeEach(() => {
  vi.clearAllMocks();
  subscribeNativePush.mockResolvedValue('not-native');
  getPushKey.mockResolvedValue({ configured: true, publicKey: 'BPk' });
  requestPermission.mockResolvedValue('granted');
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register: swRegister },
    configurable: true,
  });
  (globalThis as unknown as { PushManager: unknown }).PushManager = class {};
  (globalThis as unknown as { Notification: unknown }).Notification = { requestPermission };
});

describe('a store build takes the native path', () => {
  test('a registered device is done, and the browser is never touched', async () => {
    subscribeNativePush.mockResolvedValue('registered');

    await expect(ensureMobileAddress()).resolves.toBeUndefined();

    expect(swRegister).not.toHaveBeenCalled();
    expect(registerPushSubscription).not.toHaveBeenCalled();
    expect(getPushKey).not.toHaveBeenCalled();
  });

  test('a refused permission is reported, and no Web Push address is filed instead', async () => {
    subscribeNativePush.mockResolvedValue('denied');

    await expect(ensureMobileAddress()).rejects.toThrow(/settings/i);
    expect(swRegister).not.toHaveBeenCalled();
  });

  test('a shell that cannot register says so rather than falling back', async () => {
    // Falling back here is the bug this names: the fallback would appear to
    // work and deliver nothing for the life of the install.
    subscribeNativePush.mockResolvedValue('unavailable');

    await expect(ensureMobileAddress()).rejects.toThrow();
    expect(swRegister).not.toHaveBeenCalled();
    expect(registerPushSubscription).not.toHaveBeenCalled();
  });
});

describe('a browser takes the Web Push path, exactly as before', () => {
  test('it registers the worker and files the subscription', async () => {
    await ensureMobileAddress();

    expect(swRegister).toHaveBeenCalledWith('/sw.js');
    expect(registerPushSubscription).toHaveBeenCalledWith({ endpoint: 'https://push.example/x', keys: {} });
  });

  test('a server with push switched off is reported', async () => {
    getPushKey.mockResolvedValue({ configured: false, publicKey: null });
    await expect(ensureMobileAddress()).rejects.toThrow(/not set up/i);
  });

  test('a browser that blocks notifications is reported', async () => {
    requestPermission.mockResolvedValue('denied');
    await expect(ensureMobileAddress()).rejects.toThrow(/blocked/i);
  });

  test('a browser without the APIs is reported', async () => {
    (globalThis as unknown as { PushManager?: unknown }).PushManager = undefined;
    delete (globalThis as unknown as { PushManager?: unknown }).PushManager;
    await expect(ensureMobileAddress()).rejects.toThrow(/does not support/i);
  });

  test('an existing subscription is reused rather than re-created', async () => {
    const existing = { toJSON: () => ({ endpoint: 'https://push.example/old', keys: {} }) };
    swRegister.mockResolvedValue({
      pushManager: { getSubscription: async () => existing, subscribe: () => subscribe() },
    } as never);

    await ensureMobileAddress();

    expect(subscribe).not.toHaveBeenCalled();
    expect(registerPushSubscription).toHaveBeenCalledWith({ endpoint: 'https://push.example/old', keys: {} });
  });
});
