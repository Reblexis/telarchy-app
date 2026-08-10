/**
 * The alpha wall (owner decision 2026-08-10): until the management console
 * comes out of alpha, the ONLY public surface is the trading floor
 * (telarchy.com/lookpilot). Everything else -- the app shell, workspace
 * console, account settings, admin -- is reachable only after visiting
 * /alpha once in this browser, which sets this flag. There is deliberately
 * no link to /alpha anywhere; it is operator knowledge, not a feature.
 *
 * This is a curtain, not a lock: every hidden page still enforces its own
 * auth and capabilities server-side. The wall only decides what the public
 * can stumble into.
 */

const KEY = 'telarchy-alpha';

export function hasAlphaAccess(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function grantAlphaAccess(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* private mode: stay public */ }
}

export function revokeAlphaAccess(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
}
