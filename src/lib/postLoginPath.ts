/**
 * Post-login destination. Trader-first (vision.md, 2026-08-08): an account
 * with no workspace yet lands on the marketplace (the trader home), and a
 * member lands on their workspace's markets tab, because trading is the
 * default thing an account does here. The owner surfaces are reached from
 * the sidebar by those who hold them.
 */
export function postLoginPath(profile: { authRole?: string }): string {
  return profile.authRole === 'pending' ? '/marketplace' : '/markets';
}
