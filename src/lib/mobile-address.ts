/**
 * Becoming reachable on the mobile channel (docs/mobile.md).
 *
 * One entry point for both shells, because the caller (the Mobile switch in
 * the account dialog) must not know which transport it is getting. The switch
 * means "notify this device"; which of Web Push or FCM can carry that is a
 * property of where the code is running, and that is decided here.
 *
 * A store build must never fall back to the browser path. A Capacitor webview
 * has a Notification API and a service worker that both appear to work, so the
 * browser path SUCCEEDS there and files a Web Push address the server can
 * never deliver to: the switch would sit on, the person would be told nothing,
 * and no notification would arrive for the life of the install. A native shell
 * that cannot register therefore says so.
 */

import { api } from './api';
import { subscribeNativePush } from './native-push';

/** The browser's base64url VAPID key as the byte array subscribe() wants. */
function vapidKeyBytes(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/**
 * File this device as one of the participant's mobile addresses. Throws with a
 * message the dialog can show; the caller reverts its switch on a throw.
 */
export async function ensureMobileAddress(): Promise<void> {
  const native = await subscribeNativePush();
  if (native === 'registered') return;
  if (native === 'denied') {
    throw new Error('Notifications are switched off for Telarchy; allow them in your phone settings');
  }
  if (native === 'unavailable') {
    throw new Error('This app could not register for notifications; try again after reopening it');
  }

  // A browser, so Web Push.
  const { configured, publicKey } = await api.getPushKey();
  if (!configured || !publicKey) throw new Error('Push notifications are not set up on this server yet');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('This browser does not support push notifications');
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('The browser blocked notifications; allow them in site settings');
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(publicKey) as BufferSource,
    }));
  await api.registerPushSubscription(sub.toJSON());
}
