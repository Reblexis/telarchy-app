/**
 * The store build's mobile address (docs/mobile.md, "Notifications").
 *
 * A Capacitor webview cannot receive Web Push, so a store build registers an
 * FCM device token instead and the server delivers over that transport. This
 * module is the only place in the frontend that knows the difference: callers
 * ask to be reachable on the mobile channel and get whichever transport the
 * shell they are running in can actually receive.
 *
 * On the web every call here declines to act and says so, so the caller falls
 * through to the Web Push path unchanged. That is deliberate: prompting in a
 * browser through the native plugin would ask for a permission the browser
 * grants through a different API and leave the user with a switch that is on
 * and delivers nothing.
 *
 * A device token is an address for the Telarchy API. It goes there and nowhere
 * else.
 */

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from './api';

export type NativePushOutcome =
  /** Not a store build; the caller should use Web Push. */
  | 'not-native'
  /** The device token is filed as one of this participant's addresses. */
  | 'registered'
  /** The person said no. */
  | 'denied'
  /** A store build that cannot register: no push service, or it never answered. */
  | 'unavailable';

/** How long to wait for the platform's registration callback. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** The token this shell last filed, so it can be withdrawn again. */
let filedToken: string | null = null;

export function inNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Make this store build one of the participant's mobile addresses. Resolves to
 * an outcome rather than throwing, because every failure here is a state the
 * switch has to render, not an exception the dialog should surface as a crash.
 */
export async function subscribeNativePush(opts: { timeoutMs?: number } = {}): Promise<NativePushOutcome> {
  if (!inNativeShell()) return 'not-native';

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return 'denied';

  // Clear first: a user toggling the switch several times would otherwise
  // stack listeners, and each one would file the token again.
  await PushNotifications.removeAllListeners();

  const token = await new Promise<string | null>(resolve => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    // A shell with no push service configured never calls back at all, and a
    // switch that spins forever is worse than one that says it cannot.
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    void PushNotifications.addListener('registration', (t: unknown) => {
      finish((t as { value?: string })?.value ?? null);
    });
    void PushNotifications.addListener('registrationError', (e: unknown) => {
      console.error('native push registration failed:', e);
      finish(null);
    });
    void PushNotifications.register();
  });

  if (!token) return 'unavailable';

  await api.registerPushSubscription({ transport: 'fcm', token });
  filedToken = token;
  return 'registered';
}

/** Withdraw this store build's address (the mobile switch going dark). */
export async function unsubscribeNativePush(): Promise<void> {
  if (!filedToken) return;
  await api.deletePushSubscription(filedToken);
  filedToken = null;
}
