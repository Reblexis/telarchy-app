import { readFileSync } from 'fs';
import { resolve, join } from 'path';

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
const GUIDES_TS = join(REPO_ROOT, 'functions/src/routes/guides.ts');

function parseSections(): Array<{ id: string; category: string; order: number; title: string }> {
  const src = readFileSync(GUIDES_TS, 'utf8');
  const re = /id:\s*'([a-z0-9-]+)',\s*\n\s*title:\s*'([^']+)',\s*\n\s*description:\s*'[^']*',\s*\n\s*category:\s*'([a-z]+)',\s*\n\s*order:\s*(\d+),/g;
  const out: Array<{ id: string; category: string; order: number; title: string }> = [];
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    out.push({ id: m[1], title: m[2], category: m[3], order: parseInt(m[4], 10) });
  }
  return out;
}

function parseCategoryIds(): string[] {
  const src = readFileSync(GUIDES_TS, 'utf8');
  const block = src.slice(src.indexOf('GUIDE_CATEGORIES'), src.indexOf('interface GuideSection'));
  const re = /\{\s*id:\s*'([a-z]+)'/g;
  const out: string[] = [];
  for (let m = re.exec(block); m !== null; m = re.exec(block)) out.push(m[1]);
  return out;
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
      throw new Error(`Order values that aren't multiples of 10 (consider re-spacing): ${offenders.map(s => `${s.id}:${s.order}`).join(', ')}`);
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
});
