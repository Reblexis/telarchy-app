import { createAuthClient } from 'better-auth/react';

// Auth must always go through the current origin so OAuth state cookies
// land on the same domain as the callback URL (e.g. telarchy.com).
// Using a cross-origin API URL would set cookies on the wrong domain,
// causing state_mismatch errors after the OAuth redirect.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
});
