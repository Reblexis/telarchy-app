import { GUIDE_SECTIONS } from '../content/guides';
import { HELP } from '../lib/help-catalog';
import { GUIDE_CATEGORIES } from '../routes/guides';

/**
 * Static check of the /api/guides structure: every section is tagged with a
 * known category and an order; categories are exhaustive (no orphaned
 * sections); ordering is unique within a category. The Stripe-style
 * grouping is the proposal the GuidesPage UI and external readers depend
 * on, so a typo here surfaces as a build failure rather than a confusing
 * UI later.
 *
 * Static (no DB, no server boot): reads the source as text + a small
 * regex.
 */

// The catalog is no longer read as source: it interpolates its guide lists
// from GUIDE_SECTIONS, so these tests assert on the rendered HELP object.

/**
 * The /api/help catalog advertises the guide sections in two places: the root
 * discovery payload and the GET /api/guides/:section entry. Both are
 * hand-maintained prose, so they drift silently when a section is added --
 * which is how `onboarding` came to be listed in one and missing from the
 * other while being the runbook agents are told to follow end to end. A
 * section absent from the catalog is undiscoverable to an API-only consumer,
 * so pin both lists to the sections that actually exist.
 */

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
    // Rebuilt 2026-08-30 around the reader's job rather than the product's
    // parts: someone arrives wanting to forecast, or wanting their own numbers
    // priced. 'metrics' became 'run' and absorbed the owner-side guides.
    expect(categoryIds).toEqual(['start', 'forecast', 'run', 'api']);
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

  test('the API category runs walkthrough, then worked examples, then reference', () => {
    const ids = sections
      .filter(s => s.category === 'api')
      .sort((a, b) => a.order - b.order)
      .map(s => s.id);
    // The loop first (it is what a builder came for), auth once they have a
    // reason to care, examples, then the catalog they will live in afterwards.
    expect(ids.indexOf('agent-api')).toBeLessThan(ids.indexOf('auth-and-keys'));
    expect(ids.indexOf('auth-and-keys')).toBeLessThan(ids.indexOf('recipes'));
    expect(ids.indexOf('recipes')).toBeLessThan(ids.indexOf('api-reference'));
  });

  test('the owner path opens the floor, then chooses the number, then decides', () => {
    const ids = sections
      .filter(s => s.category === 'run')
      .sort((a, b) => a.order - b.order)
      .map(s => s.id);
    expect(ids[0]).toBe('creating');
    expect(ids.indexOf('metric-design')).toBeLessThan(ids.indexOf('proposals'));
  });

  test('the forecaster path opens with how a market pays', () => {
    const ids = sections
      .filter(s => s.category === 'forecast')
      .sort((a, b) => a.order - b.order)
      .map(s => s.id);
    expect(ids[0]).toBe('markets');
    expect(ids).toContain('seasons');
  });

  test('/api/help advertises every guide section, in both of its lists', () => {
    // Both lists are now interpolated from GUIDE_SECTIONS rather than typed
    // out, because the hand-written ones listed 16 of 19 after this rebuild.
    // Assert the rendered catalog, which is what a caller actually reads.
    const actual = sections.map(s => s.id).sort();
    const rendered = [
      String(HELP.guides),
      HELP.endpoints.find(e => e.path === '/api/guides/:section')?.description ?? '',
    ];
    for (const text of rendered) {
      const advertised = (text.match(/[a-z][a-z-]*(?=,|\)|\.)/g) ?? []).filter(id => actual.includes(id));
      expect([...new Set(advertised)].sort()).toEqual(actual);
    }
  });

  test('the onboarding runbook is advertised (an agent-first product cannot hide it)', () => {
    expect(sections.map(s => s.id)).toContain('onboarding');
    expect(String(HELP.guides)).toContain('onboarding');
    expect(HELP.endpoints.find(e => e.path === '/api/guides/:section')?.description).toContain('onboarding');
  });
});
