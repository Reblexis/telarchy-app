import {
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  FEEDBACK_STATUSES,
  isValidFeedbackKind,
  isValidFeedbackStatus,
  trimWithLimit,
} from '../lib/feedback-validation';

describe('FEEDBACK_KINDS', () => {
  test('exposes the three submission kinds', () => {
    expect([...FEEDBACK_KINDS].sort()).toEqual(['bug', 'feedback', 'help']);
  });
});

describe('FEEDBACK_STATUSES', () => {
  test('exposes the four lifecycle statuses', () => {
    expect([...FEEDBACK_STATUSES]).toEqual(['open', 'triaged', 'resolved', 'closed']);
  });
});

describe('isValidFeedbackKind', () => {
  test('accepts known kinds', () => {
    for (const k of FEEDBACK_KINDS) expect(isValidFeedbackKind(k)).toBe(true);
  });
  test('rejects unknown / non-string', () => {
    expect(isValidFeedbackKind('spam')).toBe(false);
    expect(isValidFeedbackKind('Bug')).toBe(false); // case-sensitive
    expect(isValidFeedbackKind('')).toBe(false);
    expect(isValidFeedbackKind(undefined)).toBe(false);
    expect(isValidFeedbackKind(null)).toBe(false);
    expect(isValidFeedbackKind(42)).toBe(false);
  });
});

describe('isValidFeedbackStatus', () => {
  test('accepts known statuses', () => {
    for (const s of FEEDBACK_STATUSES) expect(isValidFeedbackStatus(s)).toBe(true);
  });
  test('rejects unknown', () => {
    expect(isValidFeedbackStatus('done')).toBe(false);
    expect(isValidFeedbackStatus('OPEN')).toBe(false);
    expect(isValidFeedbackStatus(undefined)).toBe(false);
  });
});

describe('trimWithLimit', () => {
  test('returns null for non-string or empty', () => {
    expect(trimWithLimit(undefined, 10)).toBeNull();
    expect(trimWithLimit(null, 10)).toBeNull();
    expect(trimWithLimit(42, 10)).toBeNull();
    expect(trimWithLimit('', 10)).toBeNull();
    expect(trimWithLimit('   ', 10)).toBeNull();
  });

  test('trims whitespace and preserves content under limit', () => {
    expect(trimWithLimit('  hello world  ', 100)).toBe('hello world');
  });

  test('truncates strings longer than the limit', () => {
    const s = 'a'.repeat(50);
    expect(trimWithLimit(s, 10)).toBe('a'.repeat(10));
  });

  test('respects FEEDBACK_LIMITS', () => {
    expect(FEEDBACK_LIMITS.subject).toBe(200);
    expect(FEEDBACK_LIMITS.body).toBe(10_000);
    const big = 'x'.repeat(15_000);
    expect(trimWithLimit(big, FEEDBACK_LIMITS.body)?.length).toBe(10_000);
  });
});
