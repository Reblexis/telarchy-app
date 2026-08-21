/**
 * Which store a request belongs to. Every case here is a way to lose data if
 * it goes the wrong way, so they are all spelled out.
 */

import { isBetaRequest, isProdHost } from '../lib/request-env';

describe('beta or production', () => {
  test('the public domain is production', () => {
    expect(isBetaRequest('/api/proposals', 'telarchy.com')).toBe(false);
    expect(isBetaRequest('/api/proposals', 'www.telarchy.com')).toBe(false);
    expect(isBetaRequest('/', 'telarchy.com')).toBe(false);
  });

  test('the beta path is the beta, even on the public domain', () => {
    // This is how a published revision forwards to the candidate.
    expect(isBetaRequest('/beta/api/proposals', 'telarchy.com')).toBe(true);
    expect(isBetaRequest('/beta', 'telarchy.com')).toBe(true);
  });

  test("the candidate's own URL is the beta, path or no path", () => {
    expect(isBetaRequest('/api/proposals', 'candidate---api-ksc7usrtbq-uc.a.run.app')).toBe(true);
    expect(isBetaRequest('/beta/api/proposals', 'candidate---api-ksc7usrtbq-uc.a.run.app')).toBe(true);
  });

  test('a promoted revision serves production, because the host decides', () => {
    // The revision that was the candidate yesterday answers telarchy.com
    // today. Nothing about the process changed, so nothing about the process
    // may be part of the answer.
    expect(isBetaRequest('/api/predictions/trade', 'telarchy.com')).toBe(false);
  });

  test('unknown or local hosts are production, because the loud failure is safer', () => {
    // Test data on the live floor is visible and fixable; a real trade written
    // into a store nobody reads is not.
    expect(isProdHost(undefined)).toBe(true);
    expect(isBetaRequest('/api/status', undefined)).toBe(false);
    expect(isBetaRequest('/api/status', 'localhost:8080')).toBe(false);
    expect(isBetaRequest('/api/status', '127.0.0.1:5173')).toBe(false);
  });

  test('a port never changes the answer', () => {
    expect(isBetaRequest('/api/status', 'telarchy.com:443')).toBe(false);
  });
});
