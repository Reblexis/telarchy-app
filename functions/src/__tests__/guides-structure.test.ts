import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { GUIDE_SECTIONS } from '../content/guides';
import { GUIDE_CATEGORIES } from '../routes/guides';

/**
 * Static check of the /api/guides structure: every section is tagged with a
 * known category and an order; categories are exhaustive (no orphaned
 * sections); ordering is unique within a category. The Stripe-style
 * grouping is the contract the GuidesPage UI and external readers depend
 * on, so a typo here surfaces as a build failure rather than a confusing
 * UI later.
 *
 * Static (no DB, no server boot): reads the source as text + a small
 * regex.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const APP_TS = join(REPO_ROOT, 'functions/src/lib/help-catalog.ts');

/**
 * The /api/help catalog advertises the guide sections in two places: the root
 * discovery payload and the GET /api/guides/:section entry. Both are
 * hand-maintained prose, so they drift silently when a section is added --
 * which is how `onboarding` came to be listed in one and missing from the
 * other while being the runbook agents are told to follow end to end. A
 * section absent from the catalog is undiscoverable to an API-only consumer,
 * so pin both lists to the sections that actually exist.
 */
function parseAdvertisedSections(): { root: string[]; endpoint: string[] } {
  const src = readFileSync(APP_TS, 'utf8');
  const between = (haystack: string, start: string, end: string): string[] => {
    const from = haystack.indexOf(start);
    if (from === -1)
      throw new Error(`app.ts: could not locate "${start}" -- the help catalog wording changed; update this test`);
    const to = haystack.indexOf(end, from + start.length);
    if (to === -1) throw new Error(`app.ts: could not locate "${end}" after "${start}"`);
    return haystack
      .slice(from + start.length, to)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  };
  return {
    root: between(src, 'markdown for a specific section (', ')'),
    endpoint: between(src, 'Guide section as plain markdown. Sections: ', '. No auth required.'),
  };
}

// The sections are data now (docs/guides/*.md -> functions/src/content/guides.ts,
// 2026-08-25), so the structure checks read the real objects instead of the
// router's source text.
function parseSections(): Array<{ id: string; category: string; order: number; title: string }> {
  return GUIDE_SECTIONS.map(({ id, category, order, title }) => ({ id, category, order, title }));
}

function parseCategoryIds(): string[] {
  return GUIDE_CATEGORIES.map(c => c.id);
}

describe('/api/guides structure', () => {
  let sections: ReturnType<typeof parseSections>;
  let categoryIds: string[];

  beforeAll(() => {
    sections = parseSections();
    categoryIds = parseCategoryIds();
  });

  test('parses a non-empty section list', () => {
    expect(sections.length).toBeGreaterThanOrEqual(15);
  });

  test('parses the documented category list', () => {
    expect(categoryIds).toEqual(['start', 'metrics', 'forecast', 'api']);
  });

  test('every section is tagged with a known category', () => {
    const known = new Set(categoryIds);
    const orphans = sections.filter(s => !known.has(s.category));
    if (orphans.length > 0) {
      throw new Error(`Sections with unknown category: ${orphans.map(s => `${s.id} -> ${s.category}`).join(', ')}`);
    }
  });

  test('every category has at least one section', () => {
    for (const cat of categoryIds) {
      const inCat = sections.filter(s => s.category === cat);
      expect({ cat, count: inCat.length }).toEqual({ cat, count: expect.any(Number) });
      if (inCat.length === 0) throw new Error(`Category "${cat}" has no sections — drop the category or assign one`);
    }
  });

  test('order values are unique within each category (no ambiguous render order)', () => {
    for (const cat of categoryIds) {
      const orders = sections.filter(s => s.category === cat).map(s => s.order);
      const uniq = new Set(orders);
      if (orders.length !== uniq.size) {
        throw new Error(`Duplicate order values in category "${cat}": ${orders.join(', ')}`);
      }
    }
  });

  test('order values use 10/20/30 spacing so inserts do not require renumbering', () => {
    // Soft check: every order is a multiple of 10. If a future insert needs
    // to land between two existing items it can use 15, 25, etc., but the
    // baseline should stay tidy.
    const offenders = sections.filter(s => s.order % 10 !== 0);
    if (offenders.length > 0) {
      throw new Error(
        `Order values that aren't multiples of 10 (consider re-spacing): ${offenders.map(s => `${s.id}:${s.order}`).join(', ')}`,
      );
    }
  });

  test('"start" is the first category and contains the overview', () => {
    expect(categoryIds[0]).toBe('start');
    const inStart = sections.filter(s => s.category === 'start').sort((a, b) => a.order - b.order);
    expect(inStart[0]?.id).toBe('overview');
  });

  test('the API category contains auth-and-keys before agent-api before recipes before api-reference', () => {
    const inApi = sections.filter(s => s.category === 'api').sort((a, b) => a.order - b.order);
    const ids = inApi.map(s => s.id);
    expect(ids.indexOf('auth-and-keys')).toBeLessThan(ids.indexOf('agent-api'));
    expect(ids.indexOf('agent-api')).toBeLessThan(ids.indexOf('recipes'));
    expect(ids.indexOf('recipes')).toBeLessThan(ids.indexOf('api-reference'));
  });

  test('the metrics category leads with metric-design (theory before mechanics)', () => {
    const inMetrics = sections.filter(s => s.category === 'metrics').sort((a, b) => a.order - b.order);
    expect(inMetrics[0]?.id).toBe('metric-design');
  });

  test('/api/help advertises every guide section, in both of its lists', () => {
    const advertised = parseAdvertisedSections();
    const actual = sections.map(s => s.id).sort();
    expect([...advertised.root].sort()).toEqual(actual);
    expect([...advertised.endpoint].sort()).toEqual(actual);
  });

  test('the onboarding runbook is advertised (an agent-first product cannot hide it)', () => {
    const advertised = parseAdvertisedSections();
    expect(sections.map(s => s.id)).toContain('onboarding');
    expect(advertised.root).toContain('onboarding');
    expect(advertised.endpoint).toContain('onboarding');
  });
});
