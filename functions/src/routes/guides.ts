import { Router } from 'express';
import { GUIDE_SECTIONS, type GuideSection } from '../content/guides';

export const guidesRouter = Router();

/**
 * Guides are grouped into a small fixed set of categories. The order of the
 * categories array below is the order they render in the UI; the order of
 * sections within each category is determined by the `order` field on each
 * section.
 *
 * Stripe-style: a tight first-time path (Start here), then concepts, then
 * the build surface. New sections should pick the category that matches the
 * reader's proposal, not the writer's.
 */
export type GuideCategoryId = 'start' | 'metrics' | 'forecast' | 'api';

export const GUIDE_CATEGORIES: Array<{ id: GuideCategoryId; title: string; description: string }> = [
  { id: 'start', title: 'Start here', description: 'A 5-minute orientation. Read this first.' },
  {
    id: 'metrics',
    title: 'Define your metrics',
    description: 'How to design, create, and compose metrics so the system optimizes what you actually want.',
  },
  {
    id: 'forecast',
    title: 'Forecast and decide',
    description:
      'How prediction markets price proposals against your metrics, and how decisions flow through proposals.',
  },
  {
    id: 'api',
    title: 'Build with the API',
    description: 'Authenticate, write bots, observe them, and look up endpoints.',
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

// GET /api/guides/:section - markdown for a specific section
guidesRouter.get('/:section', (req, res) => {
  const section = sectionMap.get(req.params.section);
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
