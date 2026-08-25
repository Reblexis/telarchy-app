import { describe, expect, test } from 'vitest';
import { captureRefFromLocation, REF_MAX_AGE_SECONDS, readRefCookie, storeRef } from '../ref';

const jar = () => ({ cookie: '' });

describe('ref attribution cookie', () => {
  test('a valid slug is stored for 30 days, Lax, site-wide', () => {
    const doc = jar();
    expect(storeRef('github', doc)).toBe('github');
    expect(doc.cookie).toBe(`ta_ref=github; Max-Age=${REF_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`);
    expect(REF_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  test('an invalid slug is not stored', () => {
    const doc = jar();
    expect(storeRef('GitHub', doc)).toBeNull();
    expect(storeRef('a'.repeat(33), doc)).toBeNull();
    expect(storeRef('<script>', doc)).toBeNull();
    expect(storeRef('', doc)).toBeNull();
    expect(storeRef(null, doc)).toBeNull();
    expect(doc.cookie).toBe('');
  });

  test('captureRefFromLocation reads ?ref= and ignores other params', () => {
    const doc = jar();
    expect(captureRefFromLocation('?utm=1&ref=manifold', doc)).toBe('manifold');
    expect(readRefCookie(doc)).toBe('manifold');
    const untouched = jar();
    expect(captureRefFromLocation('?utm=1', untouched)).toBeNull();
    expect(untouched.cookie).toBe('');
  });

  test('readRefCookie tolerates other cookies and rejects a tampered value', () => {
    expect(readRefCookie({ cookie: 'a=1; ta_ref=hn; b=2' })).toBe('hn');
    expect(readRefCookie({ cookie: 'ta_ref=not%20valid' })).toBeNull();
    expect(readRefCookie({ cookie: '' })).toBeNull();
  });
});
