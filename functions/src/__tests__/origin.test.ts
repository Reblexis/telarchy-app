import { mailFrom, privacyContact, publicOrigin } from '../lib/origin';

const KEYS = ['PUBLIC_ORIGIN', 'BETTER_AUTH_URL', 'MAIL_FROM', 'PRIVACY_CONTACT'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('instance identity from the environment', () => {
  test('defaults are the managed instance', () => {
    expect(publicOrigin()).toBe('https://telarchy.com');
    expect(mailFrom()).toBe('Telarchy <floor@telarchy.com>');
    expect(privacyContact()).toBe('viktor.cihal@gmail.com');
  });

  test('PUBLIC_ORIGIN wins over BETTER_AUTH_URL, trailing slashes dropped', () => {
    process.env.BETTER_AUTH_URL = 'https://auth.example.com/';
    expect(publicOrigin()).toBe('https://auth.example.com');
    process.env.PUBLIC_ORIGIN = 'https://markets.example.com//';
    expect(publicOrigin()).toBe('https://markets.example.com');
  });

  test('MAIL_FROM and PRIVACY_CONTACT override, blank means default', () => {
    process.env.MAIL_FROM = 'Acme Markets <markets@acme.example>';
    process.env.PRIVACY_CONTACT = 'privacy@acme.example';
    expect(mailFrom()).toBe('Acme Markets <markets@acme.example>');
    expect(privacyContact()).toBe('privacy@acme.example');
    process.env.MAIL_FROM = '   ';
    expect(mailFrom()).toBe('Telarchy <floor@telarchy.com>');
  });
});
