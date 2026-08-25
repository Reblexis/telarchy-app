/**
 * The notification matrix model (docs/vision.md, "Participant notifications",
 * revised 2026-08-24): kinds x channels, defaults, overrides, and the shape
 * POST /api/auth/profile accepts. Pure functions, no database.
 */

import {
  applyMatrixUpdate,
  CHANNEL_DEFAULTS,
  channelOn,
  NOTIFICATION_KINDS,
  resolveMatrix,
} from '../lib/notification-prefs';

describe('the defaults are the design', () => {
  test('answers to your own activity are on everywhere, firehoses off', () => {
    for (const kind of ['comment', 'reply', 'settled', 'decision'] as const) {
      expect(CHANNEL_DEFAULTS[kind]).toEqual({ web: true, email: true, mobile: true });
    }
    expect(CHANNEL_DEFAULTS.anyComment).toEqual({ web: false, email: false, mobile: false });
    // The bell has always shown new contracts; mail and push stay opt-in.
    expect(CHANNEL_DEFAULTS.contract).toEqual({ web: true, email: false, mobile: false });
  });
});

describe('channelOn', () => {
  test('an untouched account reads the defaults', () => {
    expect(channelOn(null, 'reply', 'web')).toBe(true);
    expect(channelOn({}, 'anyComment', 'web')).toBe(false);
  });

  test('an override wins over the default, in both directions', () => {
    expect(channelOn({ reply: { web: false } }, 'reply', 'web')).toBe(false);
    expect(channelOn({ anyComment: { web: true } }, 'anyComment', 'web')).toBe(true);
    // A cell the override does not name keeps its default.
    expect(channelOn({ reply: { web: false } }, 'reply', 'mobile')).toBe(true);
  });
});

describe('resolveMatrix', () => {
  test('carries every kind, with email cells taken from the legacy columns', () => {
    const emails = { comment: true, reply: false, contract: false, anyComment: true, settled: true, decision: true };
    const m = resolveMatrix({ settled: { web: false } }, emails);
    expect(Object.keys(m).sort()).toEqual([...NOTIFICATION_KINDS].sort());
    expect(m.reply.email).toBe(false);
    expect(m.anyComment.email).toBe(true);
    expect(m.settled.web).toBe(false);
    expect(m.settled.mobile).toBe(true);
  });
});

describe('applyMatrixUpdate', () => {
  test('merges named cells and routes email cells to the columns', () => {
    const r = applyMatrixUpdate(
      { reply: { web: false } },
      {
        reply: { mobile: false },
        settled: { email: false },
        anyComment: { web: true },
      },
    );
    if ('error' in r) throw new Error(r.error);
    // The earlier web override survives a later mobile-only update.
    expect(r.overrides.reply).toEqual({ web: false, mobile: false });
    expect(r.overrides.anyComment).toEqual({ web: true });
    // Email never lands in the overrides: the boolean column owns that cell.
    expect(r.overrides.settled).toBeUndefined();
    expect(r.emailUpdates).toEqual({ settled: false });
  });

  test('refuses unknown kinds, unknown channels, and non-boolean cells', () => {
    expect(applyMatrixUpdate(null, { banana: { web: true } })).toHaveProperty('error');
    expect(applyMatrixUpdate(null, { reply: { fax: true } })).toHaveProperty('error');
    expect(applyMatrixUpdate(null, { reply: { web: 'yes' } })).toHaveProperty('error');
    expect(applyMatrixUpdate(null, [])).toHaveProperty('error');
  });
});
