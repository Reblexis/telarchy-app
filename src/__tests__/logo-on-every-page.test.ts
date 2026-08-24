import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every page wears the real lockup, not the word set in a serif.
 *
 * Owner direction 2026-08-24: "make sure that this is present on every site
 * not the generic telarchy text you did there and other sites." Five surfaces
 * had drifted to a Fraunces "Telarchy" in the top bar (the operator door,
 * About, Contact, the legal pages and every auth screen), which are exactly
 * the pages a stranger meets first, and a plain word there reads as a
 * different, plainer product than the one they came from.
 *
 * A grep rather than a render test on purpose: the failure mode is a NEW page
 * written the easy way, and no render test covers a page nobody has written.
 */

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('the mark', () => {
  test('no page sets the word Telarchy where the lockup belongs', () => {
    const offenders = tsxFiles(SRC)
      .filter(f => /className="pubws-wordmark"[^>]*>\s*Telarchy/.test(readFileSync(f, 'utf8')))
      .map(f => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  test('every top bar carries the lockup, its own or an inherited one', () => {
    const missing = tsxFiles(SRC)
      .filter(f => {
        const src = readFileSync(f, 'utf8');
        if (!src.includes('pubws-topbar')) return false;
        // A page either renders the bar itself or hands it to TopBar /
        // AuthShell, both of which carry the lockup.
        return !(src.includes('<Logo') || src.includes('<TopBar') || src.includes('<AuthShell'));
      })
      .map(f => f.slice(SRC.length + 1));
    expect(missing).toEqual([]);
  });
});
