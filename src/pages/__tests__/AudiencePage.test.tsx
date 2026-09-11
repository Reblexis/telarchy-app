import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AUDIENCE_PAGES } from '../../content/audiencePages.generated';

/**
 * /owners is laid out as a board (docs/audience-pages.md, "/owners is laid
 * out as a board", redrawn 2026-09-05): the hero with its catch line, a
 * strip of live figures, the product moment (Telarchy's own proposals
 * column, live) beside the section that explains it, the meeting-and-floor
 * pair, one drawing at full width, "What you keep" beside the FAQ, one
 * closing row. The copy is the copy in the doc, unchanged; only the shape
 * differs, and every other audience page keeps the document column.
 */

const mocks = vi.hoisted(() => ({
  getStats: vi.fn(),
  getMarketplaceWorkspace: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../../lib/api', async importOriginal => {
  const mod = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...mod,
    api: {
      ...mod.api,
      getPublicWorkspaces: vi.fn(async () => []),
      getStats: mocks.getStats,
      getMarketplaceWorkspace: mocks.getMarketplaceWorkspace,
    },
  };
});

import { AudienceViz } from '../../components/AudienceViz';
import { AudiencePage } from '../AudiencePage';

const renderRoute = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <AudiencePage route={route} />
    </MemoryRouter>,
  );

const owners = AUDIENCE_PAGES.find(p => p.route === '/owners');
if (!owners) throw new Error('/owners is not a generated page');

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A promise that never settles: the page as it is while the request is out. */
const pending = () => new Promise<never>(() => {});

const STATS = { marketsActive: 12, agentsActive: 34, tradesThisWeek: 56 };

// Telarchy's own floor in miniature: two open markets on one metric, the
// furthest-resolving one primary (the floor opens on it), and a ballot whose
// pending rows are NOT in pool order in the payload, so the panel has to sort
// them the way the floor does (pool first, impact breaking a tie).
const PRIMARY = '2026-09-30';
const SOON = '2026-09-07';
const market = (id: string, targetDate: string) => ({
  marketId: id,
  metricId: 'wat',
  metricName: 'Weekly active traders',
  metricOrder: 0,
  targetDate,
  resolvesOn: `${targetDate}T00:00:00Z`,
  consensus: 40,
  probability: 0.5,
  liquidity: 100,
  pool: 500,
  rangeMin: 0,
  rangeMax: 200,
});
const pair = (id: string, targetDate: string, delta: number | null, pool: number) => ({
  metricId: 'wat',
  metricName: 'Weekly active traders',
  targetDate,
  resolvesOn: `${targetDate}T00:00:00Z`,
  approvedConsensus: delta === null ? null : 40 + delta,
  declinedConsensus: 40,
  delta,
  approvedMarketId: `${id}-a-${targetDate}`,
  declinedMarketId: `${id}-d-${targetDate}`,
  approvedProbability: 0.5,
  approvedLiquidity: 100,
  declinedProbability: 0.5,
  declinedLiquidity: 100,
  approvedPool: pool / 2,
  declinedPool: pool / 2,
  approvedTraders: 1,
  declinedTraders: 1,
  approvedVolume: 0,
  declinedVolume: 0,
  rangeMin: 0,
  rangeMax: 200,
});
const proposal = (
  id: string,
  title: string,
  by: string,
  delta: number | null,
  pool: number,
  status: 'pending' | 'approved' | 'declined' = 'pending',
) => ({
  id,
  number: Number(id.replace(/\D/g, '')),
  title,
  description: '',
  askUsd: 20,
  status,
  resolvedAt: status === 'pending' ? null : '2026-09-01T00:00:00Z',
  proposedByName: by,
  proposedByHandle: by.toLowerCase(),
  createdAt: '2026-08-25T10:00:00Z',
  marketPairCount: 2,
  markets: [pair(id, PRIMARY, delta, pool), pair(id, SOON, delta === null ? null : delta / 10, pool / 5)],
});
const PROPOSALS = [
  proposal('p1', 'Publish a LessWrong post', 'Jason', 2.5, 40),
  proposal('p2', 'Ship the Manifold bridge', 'Ada', 12, 900),
  proposal('p3', 'Run a referral week', 'Grace', -3, 900),
  proposal('p4', 'Sponsor a hackathon', 'Linus', 120, 300),
  proposal('p5', 'Write the API cookbook', 'Ken', null, 0),
  proposal('p6', 'Translate the site to German', 'Margaret', 0.4, 60),
  proposal('p7', 'Rebuild the leaderboard', 'Dennis', 7, 250),
  proposal('p8', 'A decided one, out of the ballot', 'Alan', 500, 5000, 'approved'),
  proposal('p9', 'Another decided one', 'Barbara', 400, 4000, 'declined'),
];
/* The floor's order (revised 2026-09-11, docs/ui-conventions.md, "A pending
   row keeps its place for its whole life"): deadline, then the feed's action
   order, then creation and number, pending only. Nothing that moves with a
   trade can move a row, so these seven, posted together and unnumbered, read
   in the order they were posted. */
const FLOOR_ORDER = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
const WORKSPACE = {
  workspaceId: 'ws-telarchy',
  name: 'Telarchy',
  slug: 'telarchy',
  markets: [market('m-soon', SOON), market('m-primary', PRIMARY)],
  proposals: PROPOSALS,
};

const resolveBoth = () => {
  mocks.getStats.mockResolvedValue(STATS);
  mocks.getMarketplaceWorkspace.mockResolvedValue(WORKSPACE);
};

beforeEach(() => {
  mocks.getStats.mockReset();
  mocks.getMarketplaceWorkspace.mockReset();
});

const blocks = owners.blocks;
const catchBlock = blocks.find(b => b.kind === 'catch') as { text: string };
const showSection = (() => {
  const i = blocks.findIndex(b => b.kind === 'show');
  const before = blocks.slice(0, i);
  const h2 = [...before].reverse().find(b => b.kind === 'h2') as { text: string };
  const p = [...before].reverse().find(b => b.kind === 'p') as { lead?: string; text: string };
  const ol = blocks.slice(i).find(b => b.kind === 'ol') as { items: string[] };
  return { heading: h2.text, lead: p.lead, text: p.text, items: ol.items };
})();
const table = blocks.find(b => b.kind === 'table') as { head: string[]; rows: string[][]; leads?: (string | null)[][] };
const vizSection = (() => {
  const i = blocks.findIndex(b => b.kind === 'viz');
  const before = blocks.slice(0, i);
  const h2 = [...before].reverse().find(b => b.kind === 'h2') as { text: string };
  const p = [...before].reverse().find(b => b.kind === 'p') as { lead?: string; text: string };
  return { heading: h2.text, lead: p.lead, text: p.text, name: (blocks[i] as { name: string }).name };
})();
const ul = blocks.find(b => b.kind === 'ul') as { items: string[]; leads?: (string | null)[] };
const faq = blocks.find(b => b.kind === 'faq') as { items: { q: string; a: string }[] };

describe('/owners as a board: the hero', () => {
  test('the H1 over the glow, the lead, one pill (the first CTA), the second CTA as a quiet link, and the catch line under them in the caption register', () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    const main = container.querySelector('main');
    expect(main).toHaveClass('own');
    expect(main?.querySelector('.mkt-glow')).toBeTruthy();
    const hero = main?.querySelector('.own-hero');
    expect(hero).toBeTruthy();
    const h1 = hero?.querySelector('h1');
    expect(h1).toHaveClass('mkt-thesis');
    expect(h1?.textContent).toBe(owners.h1);
    expect(hero?.querySelector('.mkt-lead')?.textContent).toBe((blocks[0] as { text: string }).text);

    const cta = hero?.querySelector('.own-hero-cta');
    const pills = cta?.querySelectorAll('.mkt-season-cta') ?? [];
    expect(pills).toHaveLength(1);
    expect(pills[0]?.textContent).toBe(owners.cta[0].label);
    expect(pills[0]?.getAttribute('href')).toBe(owners.cta[0].href);
    const quiet = cta?.querySelectorAll('.own-quiet') ?? [];
    expect(quiet).toHaveLength(1);
    expect(quiet[0]?.textContent).toContain(owners.cta[1].label);
    expect(quiet[0]?.getAttribute('href')).toBe(owners.cta[1].href);

    // The catch line: under the actions, mono caption register, the doc's words.
    const catchLine = hero?.querySelector('.own-catch');
    expect(catchLine?.textContent).toBe(catchBlock.text);
    expect(catchLine).toHaveClass('own-caption');
    const kids = [...(hero?.children ?? [])];
    expect(kids.indexOf(cta as Element)).toBeLessThan(kids.indexOf(catchLine as Element));
  });
});

describe('/owners as a board: the live strip', () => {
  test('shows three ghosts while GET /api/marketplace/stats is out', () => {
    mocks.getStats.mockReturnValue(pending());
    mocks.getMarketplaceWorkspace.mockReturnValue(pending());
    const { container } = renderRoute('/owners');
    const strip = container.querySelector('.own-live');
    expect(strip).toBeTruthy();
    expect(strip?.querySelectorAll('.pubws-ghost').length).toBeGreaterThanOrEqual(3);
    expect(strip?.querySelectorAll('.own-live-n')).toHaveLength(0);
  });

  test('renders open markets, forecasters (human or AI) and forecasts this week from the stats, in that order, once they resolve', async () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    await waitFor(() => expect(container.querySelectorAll('.own-live-n')).toHaveLength(3));
    const strip = container.querySelector('.own-live');
    const figs = [...(strip?.querySelectorAll('.own-live-fig') ?? [])];
    expect(figs.map(f => f.querySelector('.own-live-n')?.textContent)).toEqual(['12', '34', '56']);
    expect(figs.map(f => f.querySelector('.own-live-label')?.textContent)).toEqual([
      'open markets',
      'forecasters, human or AI',
      'forecasts this week',
    ]);
    expect(strip?.querySelectorAll('.pubws-ghost')).toHaveLength(0);
    expect(mocks.getStats).toHaveBeenCalledTimes(1);
  });

  test('THE STRIP IS NOT RENDERED WHEN THE STATS REQUEST FAILS', async () => {
    mocks.getStats.mockRejectedValue(new Error('Stats request failed: 503'));
    mocks.getMarketplaceWorkspace.mockResolvedValue(WORKSPACE);
    const { container } = renderRoute('/owners');
    await waitFor(() => expect(container.querySelector('.own-live')).toBeNull());
    // The rest of the page is unharmed.
    expect(container.querySelector('.own-hero')).toBeTruthy();
    expect(container.querySelector('.own-show')).toBeTruthy();
  });
});

describe('/owners as a board: the product moment', () => {
  test('the section is a two-column row: label, lead sentence, the rest and the numbered list on the left, the panel on the right', async () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    const show = container.querySelector('.own-show');
    expect(show).toBeTruthy();
    const copy = show?.querySelector('.own-show-copy');
    expect(copy?.querySelector('.own-label')?.textContent).toBe(showSection.heading);
    expect(copy?.querySelector('.own-cell-title')?.textContent).toBe(showSection.lead);
    expect(copy?.querySelector('.own-cell-rest')?.textContent).toBe(showSection.text);
    const steps = copy?.querySelectorAll('.own-step') ?? [];
    expect(steps).toHaveLength(showSection.items.length);
    expect(steps[0]?.querySelector('.own-step-n')?.textContent).toBe('1');
    expect(steps[0]?.textContent).toContain(showSection.items[0]);
    // The panel is the second column, after the copy.
    await waitFor(() => expect(show?.querySelector('.own-shot')).toBeTruthy());
    const kids = [...(show?.children ?? [])];
    expect(kids.indexOf(copy as Element)).toBeLessThan(kids.indexOf(show?.querySelector('.own-shot') as Element));
  });

  test('shows ghost rows in the panel while GET /api/marketplace/telarchy is out', () => {
    mocks.getStats.mockResolvedValue(STATS);
    mocks.getMarketplaceWorkspace.mockReturnValue(pending());
    const { container } = renderRoute('/owners');
    const shot = container.querySelector('.own-shot');
    expect(shot).toBeTruthy();
    expect(shot?.querySelectorAll('.pubws-ghost').length).toBeGreaterThan(0);
    expect(shot?.querySelectorAll('.own-shot-row')).toHaveLength(0);
    expect(mocks.getMarketplaceWorkspace).toHaveBeenCalledWith('telarchy');
  });

  test("LISTS THE PENDING PROPOSALS OF THE TELARCHY FLOOR IN THE FLOOR'S ORDER, at most six, each with its impact in the direction colour, the credits behind it and the proposer", async () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    await waitFor(() => expect(container.querySelectorAll('.own-shot-row').length).toBeGreaterThan(0));
    const rows = [...container.querySelectorAll('.own-shot-row')];
    expect(rows).toHaveLength(6);
    const byId = Object.fromEntries(PROPOSALS.map(p => [p.id, p]));
    const expected = FLOOR_ORDER.slice(0, 6).map(id => byId[id]);
    expect(rows.map(r => r.querySelector('.own-shot-title')?.textContent)).toEqual(expected.map(p => p.title));
    // Decided proposals never appear, however large their numbers.
    expect(container.textContent).not.toContain('A decided one');
    expect(container.textContent).not.toContain('Another decided one');
    // The impact figure is the primary horizon's delta (the furthest market,
    // the one the floor opens on), formatted as the floor formats it and
    // coloured by direction; the credits are the pool behind the proposal.
    const impacts = rows.map(r => r.querySelector('.pubws-ballot-delta'));
    expect(impacts.map(d => d?.textContent)).toEqual(['+2.5', '+12.0', '-3.0', '+120', 'open', '+0.4']);
    expect(impacts[1]).toHaveClass('is-up');
    expect(impacts[2]).toHaveClass('is-down');
    // Both branches of EVERY pair, added up, as the floor's pool figure is.
    expect(rows.map(r => r.querySelector('.own-shot-pool')?.textContent)).toEqual([
      '48',
      '1,080',
      '1,080',
      '360',
      '0',
      '72',
    ]);
    expect(rows.map(r => r.querySelector('.own-shot-by')?.textContent)).toEqual(
      expected.map(p => `by ${p.proposedByName}`),
    );
    expect(container.querySelector('.own-shot')?.querySelectorAll('.pubws-ghost')).toHaveLength(0);
  });

  test('an unpriced proposal prints "open" and a seventh row is cut', async () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    await waitFor(() => expect(container.querySelectorAll('.own-shot-row')).toHaveLength(6));
    const rows = [...container.querySelectorAll('.own-shot-row')];
    expect(rows[4]?.querySelector('.own-shot-title')?.textContent).toBe('Write the API cookbook');
    expect(rows[4]?.querySelector('.pubws-ballot-delta')?.textContent).toBe('open');
    // The seventh pending proposal is cut, whatever is behind it.
    expect(container.textContent).not.toContain('Rebuild the leaderboard');
  });

  test('THE PANEL IS ONE LINK TO THE FLOOR, labelled for assistive technology', async () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    await waitFor(() => expect(container.querySelector('.own-shot')).toBeTruthy());
    const shot = container.querySelector('.own-shot');
    expect(shot?.tagName).toBe('A');
    expect(shot?.getAttribute('href')).toBe('/telarchy');
    expect(shot?.getAttribute('aria-label')).toBe("Proposals on Telarchy's own floor, live");
    // The bottom fade is drawn inside the panel, not on the rows.
    expect(shot?.querySelector('.own-shot-fade')).toBeTruthy();
  });

  test('NOTHING IS RENDERED IN THE PANEL SLOT WHEN THE FLOOR REQUEST FAILS; the copy stays', async () => {
    mocks.getStats.mockResolvedValue(STATS);
    mocks.getMarketplaceWorkspace.mockRejectedValue(new Error('Marketplace workspace request failed: 500'));
    const { container } = renderRoute('/owners');
    await waitFor(() => expect(container.querySelector('.own-shot')).toBeNull());
    expect(container.querySelector('.own-show-copy .own-cell-title')?.textContent).toBe(showSection.lead);
  });

  test('a floor with no ballot in its payload renders no panel either', async () => {
    mocks.getStats.mockResolvedValue(STATS);
    mocks.getMarketplaceWorkspace.mockResolvedValue({ ...WORKSPACE, proposals: undefined });
    const { container } = renderRoute('/owners');
    await waitFor(() => expect(container.querySelector('.own-shot')).toBeNull());
  });
});

describe('/owners as a board: the pair, the drawing, the two lists, the close', () => {
  test('the two-column one-row table renders as two cells, the headers as labels, the bold lead as the sentence over the rest', () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    const pairEl = container.querySelector('.own-pair');
    expect(pairEl).toBeTruthy();
    // The section's heading stands over the row in the label register.
    expect(container.querySelector('.own-pair-section > .own-label')?.textContent).toBe('The meeting, and the floor');
    const cells = [...(pairEl?.querySelectorAll('.own-pair-cell') ?? [])];
    expect(cells).toHaveLength(2);
    expect(table.rows).toHaveLength(1);
    cells.forEach((cell, i) => {
      expect(cell.querySelector('.own-label')?.textContent).toBe(table.head[i]);
      const lead = table.leads?.[0][i] ?? '';
      expect(cell.querySelector('.own-cell-title')?.textContent).toBe(lead);
      expect(cell.querySelector('.own-cell-rest')?.textContent).toBe(table.rows[0][i].slice(lead.length).trim());
    });
    // No document table on this route.
    expect(container.querySelector('.pubws-aud-table')).toBeNull();
  });

  test('THE DRAWING IS FULL WIDTH: label, sentence, then the svg as a direct child of the section, never inside a cell', () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    const viz = container.querySelector('.own-viz');
    expect(viz).toBeTruthy();
    expect(viz?.querySelector('.own-label')?.textContent).toBe(vizSection.heading);
    expect(viz?.querySelector('.own-cell-title')?.textContent).toBe(vizSection.lead);
    const svgs = container.querySelectorAll('svg.viz');
    expect(svgs).toHaveLength(1);
    const svg = svgs[0];
    expect(svg.parentElement).toBe(viz);
    expect(svg.closest('.own-cell, .own-pair-cell, .own-two, .own-show')).toBeNull();
    expect(container.querySelector('.own-board')).toBeNull();
    expect(container.querySelector('.own-cell')).toBeNull();
  });

  test('"What you keep" beside the FAQ: each bullet\'s lead in the display face then its text; each question beside its answer', () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    const two = container.querySelector('.own-two');
    expect(two?.querySelectorAll('.own-col')).toHaveLength(2);
    const keeps = [...(two?.querySelectorAll('.own-keep') ?? [])];
    expect(keeps).toHaveLength(ul.items.length);
    keeps.forEach((k, i) => {
      const lead = ul.leads?.[i] ?? '';
      expect(k.querySelector('.own-keep-lead')?.textContent).toBe(lead);
      expect(squash(k.textContent ?? '')).toBe(squash(ul.items[i]));
    });
    const qas = two?.querySelectorAll('.own-qa') ?? [];
    expect(qas).toHaveLength(faq.items.length);
    expect(qas[0]?.querySelector('.own-q')?.textContent).toBe(faq.items[0].q);
    expect(qas[0]?.querySelector('.own-a')?.textContent).toBe(faq.items[0].a);
  });

  test('the closing row: the pill, the quiet link, and the catch line under them', () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    const close = container.querySelector('.own-close');
    const links = close?.querySelectorAll('a') ?? [];
    expect(links).toHaveLength(owners.cta.length);
    expect(links[0]).toHaveClass('own-pill');
    expect(links[0]?.textContent).toBe(owners.cta[0].label);
    expect(links[1]).toHaveClass('own-quiet');
    expect(links[1]?.getAttribute('href')).toBe(owners.cta[1].href);
    expect(close?.querySelector('.own-catch')?.textContent).toBe(catchBlock.text);
  });

  test('in that order down the page, then the sibling links and the footer', async () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    const main = container.querySelector('main') as HTMLElement;
    await waitFor(() => expect(main.querySelector('.own-shot')).toBeTruthy());
    const kids = [...main.children];
    const at = (sel: string) => {
      const el = main.querySelector(sel);
      return kids.findIndex(k => k === el || k.contains(el as Node));
    };
    const order = [
      '.own-hero',
      '.own-live',
      '.own-show',
      '.own-pair',
      '.own-viz',
      '.own-two',
      '.own-close',
      '.pubws-aud-nav',
      'footer',
    ].map(at);
    expect(order.every(n => n >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(container.querySelector('.pubws-topbar')).toBeTruthy();
    // Nothing of the document layout survives on this route.
    expect(main.querySelector('.pubws-story')).toBeNull();
    expect(main.querySelector('.pubws-aud-lead-cta')).toBeNull();
  });

  test('THE COPY ON /owners IS THE GENERATED BLOCKS WORD FOR WORD', async () => {
    resolveBoth();
    const { container } = renderRoute('/owners');
    const main = container.querySelector('main') as HTMLElement;
    await waitFor(() => expect(main.querySelectorAll('.own-shot-row').length).toBeGreaterThan(0));
    const clone = main.cloneNode(true) as HTMLElement;
    // Take out what is not the doc's copy: the drawing (its labels are the
    // drawing's), the live figures, the product panel, the step numerals,
    // the actions (the closing row repeats the catch line, which the doc
    // states once), the sibling links and the footer.
    for (const sel of [
      'svg',
      '.own-live',
      '.own-shot',
      '.own-step-n',
      '.own-hero-cta',
      '.own-close',
      '.pubws-aud-nav',
      'footer',
    ]) {
      for (const el of clone.querySelectorAll(sel)) el.remove();
    }
    // Element by element, so two neighbours never run into one word.
    const page = squash(
      [...clone.querySelectorAll('h1, h2, h3, p, dt, dd, li.own-keep')].map(el => el.textContent ?? '').join(' '),
    );

    const parts: string[] = [owners.h1];
    for (const b of blocks) {
      if (b.kind === 'p') parts.push(b.lead ? `${b.lead} ${b.text}` : b.text);
      if (b.kind === 'catch') parts.push(b.text);
      if (b.kind === 'h2') parts.push(b.text);
      if (b.kind === 'ol' || b.kind === 'ul') parts.push(...b.items);
      if (b.kind === 'table') for (let i = 0; i < b.head.length; i++) parts.push(b.head[i], b.rows[0][i]);
      if (b.kind === 'faq') for (const { q, a } of b.items) parts.push(q, a);
    }
    const want = squash(parts.join(' '));
    expect(page).toBe(want);
    // And every action the doc names is on the page.
    for (const c of owners.cta) expect(screen.getAllByText(c.label).length).toBeGreaterThan(0);
  });
});

describe('the other audience pages keep the document layout', () => {
  test('/forecast still renders the document layout, no board, and its drawings', () => {
    const { container } = renderRoute('/forecast');
    expect(container.querySelector('.own-board')).toBeNull();
    expect(container.querySelector('.own-hero')).toBeNull();
    expect(container.querySelector('.own-live')).toBeNull();
    expect(container.querySelector('.own-show')).toBeNull();
    expect(container.querySelector('.pubws-story')).toBeTruthy();
    expect(container.querySelector('.pubws-hero--left h1')).toBeTruthy();
    expect(container.querySelectorAll('svg.viz').length).toBeGreaterThanOrEqual(4);
    // No live request leaves a document page.
    expect(mocks.getStats).not.toHaveBeenCalled();
    expect(mocks.getMarketplaceWorkspace).not.toHaveBeenCalled();
  });

  test('/compare/futarchy-fi keeps its table', () => {
    const { container } = renderRoute('/compare/futarchy-fi');
    expect(container.querySelector('.own-board')).toBeNull();
    expect(container.querySelector('.pubws-aud-table')).toBeTruthy();
  });

  test('the two drawings /owners dropped are still drawings the renderer knows, and a document page still draws what its markdown names', () => {
    // Taken off /owners, not out of the renderer (docs/audience-pages.md,
    // "the drawings that argued in a third of the width ... are no longer
    // placed on this page").
    for (const name of ['per-metric-exposure', 'sealed-number']) {
      const { container, unmount } = render(<AudienceViz name={name} />);
      expect(container.querySelector('svg.viz')).toBeTruthy();
      unmount();
    }
    const agents = AUDIENCE_PAGES.find(p => p.route === '/for-agents');
    const names = agents?.blocks.filter(b => b.kind === 'viz').map(b => (b as { name: string }).name) ?? [];
    expect(names.length).toBeGreaterThan(0);
    const { container } = renderRoute('/for-agents');
    expect(container.querySelectorAll('svg.viz')).toHaveLength(names.length);
  });
});

test('agent builders can find the starter guide without an account or scrolling', () => {
  const { container } = renderRoute('/for-agents');
  expect(container.querySelector('.agent-builder')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Copy setup prompt' })).toBeNull();
  expect(screen.getAllByRole('link', { name: 'Build an agent' })[0]).toHaveAttribute('href', '/agents#agent-setup');
  expect(screen.getByRole('link', { name: 'Read the build guide' })).toBeInTheDocument();
});
