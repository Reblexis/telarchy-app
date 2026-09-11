import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * A bot says it is one on EVERY public surface that prints a participant's
 * name (docs/ui-conventions.md, "A bot says it is one"). A new list that
 * prints names without the mark is how a bot quietly reads as a person
 * again, so any component that links a participant's profile or prints a
 * proposer's or commenter's name must render <BotMark>.
 */

// Vitest runs from the app root.
const SRC = join(process.cwd(), 'src');

// Not public surfaces, each for a stated reason.
const EXEMPT: Record<string, string> = {
  'App.tsx': 'the route table, prints no names',
  'components/MyAgents.tsx': "the owner's own bots page: every row is a bot by construction",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

const NAME_SITES = /\/participants\/\$\{|proposedByName|fromName\b/;

describe('every surface that prints a participant name marks bots', () => {
  const files = walk(SRC)
    .map(p => ({ rel: p.slice(SRC.length).replace(/^\//, ''), text: readFileSync(p, 'utf8') }))
    .filter(f => NAME_SITES.test(f.text) && !(f.rel in EXEMPT));

  test('there are such surfaces (the scan is looking in the right place)', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  test.each(files.map(f => [f.rel, f.text]))('%s renders <BotMark>', (_rel, text) => {
    expect(text).toContain('<BotMark');
  });
});
