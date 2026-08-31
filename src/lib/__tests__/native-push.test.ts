import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The store build's mobile address (docs/mobile.md).
 *
 * A Capacitor webview cannot receive Web Push, so a store build registers an
 * FCM device token instead. This module is the only place that difference
 * lives; everything above it asks for "the mobile channel" and gets whichever
 * transport the shell it is running in can actually receive.
 *
 * Two rules worth naming. The browser path must be untouched: on the web this
 * has to decline to act, or it would prompt for a permission the browser
 * grants through a different API and leave the user with a dead switch. And a
 * device token is an address for OUR server: it goes to the Telarchy API and
 * nowhere else.
 */

const isNativePlatform = vi.fn(() => false);
const requestPermissions = vi.fn(async () => ({ receive: 'granted' }));
const register = vi.fn(async () => {});
const addListener = vi.fn(async (_event: string, _cb: (arg: unknown) => void) => ({ remove: vi.fn() }));
const removeAllListeners = vi.fn(async () => {});

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: () => requestPermissions(),
    register: () => register(),
    addListener: (e: string, cb: (arg: unknown) => void) => addListener(e, cb),
    removeAllListeners: () => removeAllListeners(),
  },
}));

const registerPushSubscription = vi.fn(async () => ({ ok: true }));
const deletePushSubscription = vi.fn(async () => ({ ok: true }));
vi.mock('../api', () => ({
  api: {
    registerPushSubscription: (b: unknown) => registerPushSubscription(b as never),
    deletePushSubscription: (e: string) => deletePushSubscription(e as never),
  },
}));

import { inNativeShell, subscribeNativePush, unsubscribeNativePush } from '../native-push';

/** Make addListener hand the named event the given argument, once. */
function shellEmits(event: string, arg: unknown) {
  addListener.mockImplementation(async (e: string, cb: (a: unknown) => void) => {
    if (e === event) setTimeout(() => cb(arg), 0);
    return { remove: vi.fn() };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isNativePlatform.mockReturnValue(false);
  requestPermissions.mockResolvedValue({ receive: 'granted' });
  addListener.mockImplementation(async () => ({ remove: vi.fn() }));
});

describe('on the web, the browser path is left alone', () => {
  test('a browser is not a native shell', () => {
    expect(inNativeShell()).toBe(false);
  });

  test('subscribing declines to act, so the caller falls through to Web Push', async () => {
    await expect(subscribeNativePush()).resolves.toBe('not-native');
  });

  test('it asks for no permission and registers no address in a browser', async () => {
    await subscribeNativePush();
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(registerPushSubscription).not.toHaveBeenCalled();
  });
});

describe('in a store build', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(true);
  });

  test('a granted permission files the device token as an fcm address', async () => {
    shellEmits('registration', { value: 'device-token-xyz' });

    await expect(subscribeNativePush()).resolves.toBe('registered');

    expect(registerPushSubscription).toHaveBeenCalledWith({ transport: 'fcm', token: 'device-token-xyz' });
  });

  test('it waits for the token rather than filing an empty address', async () => {
    shellEmits('registration', { value: 'late-token' });
    await subscribeNativePush();
    const [body] = registerPushSubscription.mock.calls[0] as unknown as [{ token: string }];
    expect(body.token).toBe('late-token');
  });

  test('the token goes to the Telarchy API and nowhere else', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    shellEmits('registration', { value: 'device-token-xyz' });

    await subscribeNativePush();

    expect(registerPushSubscription).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('a refused permission registers nothing', async () => {
    requestPermissions.mockResolvedValue({ receive: 'denied' });

    await expect(subscribeNativePush()).resolves.toBe('denied');
    expect(register).not.toHaveBeenCalled();
    expect(registerPushSubscription).not.toHaveBeenCalled();
  });

  test('a registration error is an outcome, not a crash', async () => {
    shellEmits('registrationError', { error: 'no google-services.json' });

    await expect(subscribeNativePush()).resolves.toBe('unavailable');
    expect(registerPushSubscription).not.toHaveBeenCalled();
  });

  test('a shell that never answers gives up instead of hanging', async () => {
    // addListener resolves and nothing is ever emitted.
    await expect(subscribeNativePush({ timeoutMs: 10 })).resolves.toBe('unavailable');
    expect(registerPushSubscription).not.toHaveBeenCalled();
  });

  test('subscribing twice does not stack listeners on the shell', async () => {
    shellEmits('registration', { value: 'device-token-xyz' });
    await subscribeNativePush();
    await subscribeNativePush();
    // Every attempt clears its predecessors before listening again; without
    // this a user toggling the switch a few times gets duplicate deliveries.
    expect(removeAllListeners).toHaveBeenCalledTimes(2);
  });

  test('unsubscribing forgets the token that was filed', async () => {
    shellEmits('registration', { value: 'device-token-xyz' });
    await subscribeNativePush();

    await unsubscribeNativePush();

    expect(deletePushSubscription).toHaveBeenCalledWith('device-token-xyz');
  });

  test('unsubscribing without a token is a no-op, not a bad request', async () => {
    await unsubscribeNativePush();
    expect(deletePushSubscription).not.toHaveBeenCalled();
  });
});
