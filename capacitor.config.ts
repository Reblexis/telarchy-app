import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The store shells (docs/mobile.md).
 *
 * `server.url` is the whole design: the app is a shell around the live site,
 * not a copy of it. A push to main reaches store users the same way it reaches
 * the web, and only a change to the shell itself (native permissions, the push
 * transport, the launch screen) needs a store submission.
 *
 * `webDir` still points at the built site, because Capacitor requires one and
 * the CI build copies it in as the offline fallback.
 */
const config: CapacitorConfig = {
  appId: 'com.telarchy.app',
  appName: 'Telarchy',
  webDir: 'dist',
  server: {
    url: process.env.CAPACITOR_SERVER_URL || 'https://telarchy.com',
    // The shell only ever loads Telarchy; anything else opens in the real
    // browser, so a link in a proposal cannot render inside our chrome and
    // borrow the app's identity.
    allowNavigation: ['telarchy.com'],
  },
  android: {
    // The launch screen wears the page's own colour rather than white.
    backgroundColor: '#fbf9f4',
  },
  ios: {
    backgroundColor: '#fbf9f4',
  },
  plugins: {
    PushNotifications: {
      // The system notification is presented by the OS; the shell's only job
      // is handing the token to /api/notifications/push-subscriptions.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
