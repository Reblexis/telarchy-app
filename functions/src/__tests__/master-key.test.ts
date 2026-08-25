import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isMasterKey, masterKeyConfigured } from '../lib/master-key';

const saved = { API_KEY: process.env.API_KEY, API_KEY_PREVIOUS: process.env.API_KEY_PREVIOUS };
afterEach(() => {
  if (saved.API_KEY === undefined) delete process.env.API_KEY;
  else process.env.API_KEY = saved.API_KEY;
  if (saved.API_KEY_PREVIOUS === undefined) delete process.env.API_KEY_PREVIOUS;
  else process.env.API_KEY_PREVIOUS = saved.API_KEY_PREVIOUS;
});

describe('isMasterKey', () => {
  test('current key is accepted', () => {
    process.env.API_KEY = 'current-key-0123456789';
    delete process.env.API_KEY_PREVIOUS;
    expect(isMasterKey('current-key-0123456789')).toBe(true);
    expect(isMasterKey('current-key-012345678X')).toBe(false);
  });

  test('previous key is accepted while set, rejected once unset', () => {
    process.env.API_KEY = 'new-key-0123456789ab';
    process.env.API_KEY_PREVIOUS = 'old-key-0123456789ab';
    expect(isMasterKey('old-key-0123456789ab')).toBe(true);
    expect(isMasterKey('new-key-0123456789ab')).toBe(true);
    delete process.env.API_KEY_PREVIOUS;
    expect(isMasterKey('old-key-0123456789ab')).toBe(false);
    process.env.API_KEY_PREVIOUS = '';
    expect(isMasterKey('old-key-0123456789ab')).toBe(false);
  });

  test('nothing configured rejects everything without throwing', () => {
    delete process.env.API_KEY;
    delete process.env.API_KEY_PREVIOUS;
    expect(isMasterKey('anything')).toBe(false);
    expect(isMasterKey('')).toBe(false);
    expect(isMasterKey(undefined)).toBe(false);
    expect(masterKeyConfigured()).toBe(false);
  });

  test('wrong length rejects without throwing', () => {
    process.env.API_KEY = 'abc';
    expect(isMasterKey('abcd')).toBe(false);
    expect(isMasterKey('ab')).toBe(false);
    expect(masterKeyConfigured()).toBe(true);
  });
});

describe('single reader', () => {
  test('process.env.API_KEY is read only in lib/master-key.ts', () => {
    const root = join(__dirname, '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          if (!p.endsWith('__tests__')) walk(p);
          continue;
        }
        if (!/\.ts$/.test(entry) || p.endsWith('master-key.test.ts')) continue;
        const text = readFileSync(p, 'utf8');
        if (/process\.env\.API_KEY\b(?!_PREVIOUS)/.test(text) && !p.endsWith(join('lib', 'master-key.ts'))) {
          hits.push(p.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
