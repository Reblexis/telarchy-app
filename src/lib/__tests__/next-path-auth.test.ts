import { describe, expect, test } from 'vitest';
import { authPath, safeNextPath } from '../nextPath';

/**
 * Being asked for an account should not cost you the page you were on.
 *
 * Owner direction 2026-08-24: "if i sign up from there it shouldnt
 * disappear.. same for when i sign up from any other page". Every call site
 * sent people to a bare /signup, so a market, a season entry or a
 * half-finished setup was gone by the time they had one.
 */

describe('the auth door', () => {
  test('carries where you were standing', () => {
    expect(authPath('signup', { pathname: '/lookpilot' })).toBe('/signup?next=%2Flookpilot');
    expect(authPath('login', { pathname: '/season', search: '?ref=x' })).toBe('/login?next=%2Fseason%3Fref%3Dx');
  });

  test('does not send you back to a door you came through', () => {
    // Otherwise logging in from the signup page bounces between the two.
    expect(authPath('signup', { pathname: '/login' })).toBe('/signup');
    expect(authPath('login', { pathname: '/signup', search: '?next=%2Fmanage' })).toBe('/login');
  });

  test('refuses a path that could leave the site', () => {
    // safeNextPath is the guard; this pins that authPath actually applies it.
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(authPath('signup', { pathname: '//evil.example' })).toBe('/signup');
  });

  test('keeps the hash, which is where the account dialog lives', () => {
    expect(authPath('login', { pathname: '/lookpilot', hash: '#account' })).toBe('/login?next=%2Flookpilot%23account');
  });
});
