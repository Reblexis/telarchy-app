import { Router } from 'express';
import { GUIDE_SECTIONS, type GuideSection } from '../content/guides';

export const guidesRouter = Router();

/**
 * Guides are grouped into a small fixed set of categories. The order of the
 * categories array below is the order they render in the UI; the order of
 * sections within each category is determined by the `order` field on each
 * section.
 *
 * The categories are the reader's two jobs, not the product's parts: someone
 * arrives either wanting to forecast and earn, or wanting their own numbers
 * priced. Start here orients and sends them down one of the two; the API
 * category is the reference behind both, for whoever is building a
 * participant. A section belongs to the category matching the reader's job,
 * never the writer's module. Rebuilt 2026-08-30 (owner: the guides did not
 * reflect current capabilities), when the split replaced a mechanism-first
 * ordering that never mentioned seasons, prizes, limit orders or the
 * Manifold import.
 */
export type GuideCategoryId = 'start' | 'forecast' | 'run' | 'api';

export const GUIDE_CATEGORIES: Array<{ id: GuideCategoryId; title: string; description: string }> = [
  { id: 'start', title: 'Start here', description: 'What this is, and which of the two paths below is yours.' },
  {
    id: 'forecast',
    title: 'Forecast and earn',
    description:
      'Trade a real company\u2019s numbers: how a market pays, where credits come from, and how a season pays money.',
  },
  {
    id: 'run',
    title: 'Run your own numbers',
    description: 'List the metrics that decide the most, then read proposals as numbers instead of pitches.',
  },
  {
    id: 'api',
    title: 'Build with the API',
    description: 'Register a participant, authenticate, trade, propose, and report what it is doing.',
  },
];

// The sections themselves are documentation and live as markdown under
// docs/guides/ (docs govern). scripts/build-guides.mjs generates the module
// below from them; guides-content.test.ts fails when the two drift.
const sections: GuideSection[] = GUIDE_SECTIONS;

const sectionMap = new Map(sections.map(s => [s.id, s]));

/**
 * Sort sections deterministically: category-first (in the order of
 * GUIDE_CATEGORIES), then by `order` within the category. This is the order
 * everyone reads guides in — UI sidebar, /api/guides JSON, and any client
 * that mirrors the index. Don't sort by title or by id; those produce
 * arbitrary orderings that don't reflect the journey.
 */
function compareSections(a: GuideSection, b: GuideSection): number {
  const aCat = GUIDE_CATEGORIES.findIndex(c => c.id === a.category);
  const bCat = GUIDE_CATEGORIES.findIndex(c => c.id === b.category);
  if (aCat !== bCat) return aCat - bCat;
  return a.order - b.order;
}

// GET /api/guides - flat array of every section, sorted by category and then
// by order. Each item carries its `category` so structured renderers can
// group without re-deriving the order. Category metadata (titles +
// descriptions) is exposed via GET /api/guides/_categories below.
guidesRouter.get('/', (_req, res) => {
  const sorted = [...sections].sort(compareSections);
  res.json(
    sorted.map(({ id, title, description, category, order }) => ({
      id,
      title,
      description,
      category,
      order,
      path: `/api/guides/${id}`,
    })),
  );
});

// GET /api/guides/_categories - category metadata, in render order. Kept
// separate so /api/guides remains a clean array. The leading underscore
// can never collide with a real section id (slugs are kebab-case).
guidesRouter.get('/_categories', (_req, res) => {
  res.json(GUIDE_CATEGORIES);
});

/**
 * Section ids that a link printed before a rename still carries: served as
 * the section they became, so a bookmark, an llms.txt copy or an agent's
 * prompt written against the old address keeps working. `contracts` became
 * `get-paid` when the floor stopped calling a proposal a contract
 * (docs/ui-conventions.md, "The thing on the ballot is a PROPOSAL").
 */
export const GUIDE_ALIASES: Record<string, string> = { contracts: 'get-paid' };

// GET /api/guides/:section - markdown for a specific section
guidesRouter.get('/:section', (req, res) => {
  const section = sectionMap.get(GUIDE_ALIASES[req.params.section] ?? req.params.section);
  if (!section) {
    // Self-correcting 404: agents often arrive via a stale or guessed link.
    // Listing the valid ids lets them retry without crawling the website.
    res.status(404).json({
      error: `Unknown guide section: ${req.params.section}`,
      sections: sections.map(s => s.id),
      index: '/api/guides',
    });
    return;
  }
  res.type('text/markdown').send(section.content);
});
