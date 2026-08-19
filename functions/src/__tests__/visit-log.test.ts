import { shouldLogVisit } from '../lib/visit-log';

/**
 * The cockpit must not count itself. Before 2026-08-19 every /admin load was
 * logged like any other document load, so the owner reading the page raised
 * its own visits, uniques and top-pages numbers: the one number on the page
 * that is supposed to mean "a stranger showed up".
 */
describe('visitor log path filter', () => {
  it('does not log the operator cockpit', () => {
    expect(shouldLogVisit('/admin')).toBe(false);
    expect(shouldLogVisit('/admin/anything')).toBe(false);
  });

  it('logs every public page, including paths that merely start with the word', () => {
    for (const p of ['/', '/lookpilot', '/leaderboard', '/season', '/administrator', '/adminish']) {
      expect(shouldLogVisit(p)).toBe(true);
    }
  });
});
