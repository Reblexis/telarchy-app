import { slugify, uniqueSlugForOwner } from '../lib/slug';

/**
 * Minimal stub mimicking the drizzle query chain uniqueSlugForOwner uses
 * (tx.select(...).from(...).where(...) resolving to rows). Returns the preset
 * alias rows regardless of arguments; we only exercise the dedup logic.
 */
function fakeTx(slugs: string[]) {
  const rows = slugs.map(slug => ({ slug }));
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  return chain as any;
}

describe('slugify', () => {
  test('lowercases and hyphenates', () => {
    expect(slugify('Q3 Growth')).toBe('q3-growth');
    expect(slugify('Acme Corp')).toBe('acme-corp');
  });

  test('collapses runs of non-alphanumerics and trims hyphens', () => {
    expect(slugify('  Hello,   World!! ')).toBe('hello-world');
    expect(slugify('a---b__c')).toBe('a-b-c');
  });

  test('falls back to "workspace" for empty/symbol-only names', () => {
    expect(slugify('!!!')).toBe('workspace');
    expect(slugify('   ')).toBe('workspace');
  });
});

describe('uniqueSlugForOwner', () => {
  test('returns the base slug when free', async () => {
    expect(await uniqueSlugForOwner(fakeTx([]), 'owner', 'Q3 Growth')).toBe('q3-growth');
  });

  test('suffixes -2, -3 when the base is taken by the owner', async () => {
    expect(await uniqueSlugForOwner(fakeTx(['q3-growth']), 'owner', 'Q3 Growth')).toBe('q3-growth-2');
    expect(await uniqueSlugForOwner(fakeTx(['q3-growth', 'q3-growth-2']), 'owner', 'Q3 Growth')).toBe('q3-growth-3');
  });

  test('matching is case-insensitive', async () => {
    expect(await uniqueSlugForOwner(fakeTx(['Q3-Growth']), 'owner', 'q3 growth')).toBe('q3-growth-2');
  });
});
