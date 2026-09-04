import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import { AUDIENCE_PAGES } from '../../content/audiencePages.generated';
import { AudiencePage } from '../AudiencePage';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

/**
 * /owners is laid out as a board (docs/audience-pages.md, "/owners is laid
 * out as a board"): the hero, three cells with their drawings, the two
 * lists side by side, one closing row. The copy is the copy in the doc,
 * unchanged; only the shape differs, and every other audience page keeps
 * the document column.
 */

const renderRoute = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <AudiencePage route={route} />
    </MemoryRouter>,
  );

const owners = AUDIENCE_PAGES.find(p => p.route === '/owners');
if (!owners) throw new Error('/owners is not a generated page');

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('/owners as a board', () => {
  test('renders the hero, three cells with their drawings, the two lists, and the closing row, in that order', () => {
    const { container } = renderRoute('/owners');
    const main = container.querySelector('main');
    expect(main).toBeTruthy();

    const hero = main?.querySelector('.own-hero');
    const board = main?.querySelector('.own-board');
    const two = main?.querySelector('.own-two');
    const close = main?.querySelector('.own-close');
    expect(hero).toBeTruthy();
    expect(board).toBeTruthy();
    expect(two).toBeTruthy();
    expect(close).toBeTruthy();

    // The hero: the H1 in the display register with the glow behind it,
    // the lead, and ONE pill.
    expect(main?.querySelector('.mkt-glow')).toBeTruthy();
    const h1 = hero?.querySelector('h1');
    expect(h1).toHaveClass('mkt-thesis');
    expect(h1?.textContent).toBe(owners.h1);
    expect(hero?.querySelector('.mkt-lead')?.textContent).toBe((owners.blocks[0] as { text: string }).text);
    const pills = hero?.querySelectorAll('.mkt-season-cta') ?? [];
    expect(pills).toHaveLength(1);
    expect(pills[0]?.textContent).toBe('List your numbers');
    expect(pills[0]?.getAttribute('href')).toBe('/');

    // Three cells, each a label, a title sentence, a drawing and the rest.
    const cells = board?.querySelectorAll('.own-cell') ?? [];
    expect(cells).toHaveLength(3);
    const vizSections = owners.blocks
      .map((b, i) => (b.kind === 'viz' ? i : -1))
      .filter(i => i >= 0)
      .map(i => {
        const h2 = [...owners.blocks.slice(0, i)].reverse().find(b => b.kind === 'h2') as { text: string };
        const p = [...owners.blocks.slice(0, i)].reverse().find(b => b.kind === 'p') as { lead?: string; text: string };
        return { heading: h2.text, lead: p.lead, text: p.text, name: (owners.blocks[i] as { name: string }).name };
      });
    expect(vizSections).toHaveLength(3);
    cells.forEach((cell, i) => {
      const label = cell.querySelector('.own-cell-label');
      const title = cell.querySelector('.own-cell-title');
      const svg = cell.querySelector('svg.viz');
      const rest = cell.querySelector('.own-cell-rest');
      expect(label?.textContent).toBe(vizSections[i].heading);
      expect(title?.textContent).toBe(vizSections[i].lead);
      expect(svg).toBeTruthy();
      expect(rest?.textContent).toBe(vizSections[i].text);
      // Label, title, drawing, rest: in that order inside the cell.
      const order = [label, title, svg, rest].map(el => [...cell.children].indexOf(el as Element));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(order.every(n => n >= 0)).toBe(true);
    });

    // Setting up beside the FAQ: numbered hairline rows, questions in the
    // display face beside their answers.
    const steps = two?.querySelectorAll('.own-step') ?? [];
    const ol = owners.blocks.find(b => b.kind === 'ol') as { items: string[] };
    expect(steps).toHaveLength(ol.items.length);
    expect(steps[0]?.querySelector('.own-step-n')?.textContent).toBe('1');
    expect(steps[0]?.textContent).toContain(ol.items[0]);
    const faq = owners.blocks.find(b => b.kind === 'faq') as { items: { q: string; a: string }[] };
    const qas = two?.querySelectorAll('.own-qa') ?? [];
    expect(qas).toHaveLength(faq.items.length);
    expect(qas[0]?.querySelector('.own-q')?.textContent).toBe(faq.items[0].q);
    expect(qas[0]?.querySelector('.own-a')?.textContent).toBe(faq.items[0].a);
    expect(two?.querySelectorAll('.own-col')).toHaveLength(2);

    // The closing row: the first link a pill, the rest quiet accent links.
    const closeLinks = close?.querySelectorAll('a') ?? [];
    expect(closeLinks).toHaveLength(owners.cta.length);
    expect(closeLinks[0]).toHaveClass('own-pill');
    expect(closeLinks[0]?.textContent).toBe(owners.cta[0].label);
    expect(closeLinks[1]).toHaveClass('own-quiet');
    expect(closeLinks[1]?.textContent).toContain(owners.cta[1].label);
    expect(closeLinks[1]?.getAttribute('href')).toBe(owners.cta[1].href);

    // In that order down the page.
    const kids = [...(main?.children ?? [])];
    const at = (el: Element | null | undefined) => kids.findIndex(k => k === el || k.contains(el as Node));
    expect(at(hero)).toBeLessThan(at(board));
    expect(at(board)).toBeLessThan(at(two));
    expect(at(two)).toBeLessThan(at(close));
    expect(at(close)).toBeLessThan(at(main?.querySelector('.pubws-aud-nav')));
    expect(at(main?.querySelector('.pubws-aud-nav'))).toBeLessThan(at(main?.querySelector('footer')));

    // Nothing of the document layout survives on this route.
    expect(main?.querySelector('.pubws-story')).toBeNull();
    expect(main?.querySelector('.pubws-aud-lead-cta')).toBeNull();
  });

  test('the copy on /owners is unchanged word for word from the generated content', () => {
    const { container } = renderRoute('/owners');
    const main = container.querySelector('main') as HTMLElement;
    const clone = main.cloneNode(true) as HTMLElement;
    // Take out what is not the doc's copy: the drawings (their labels are
    // the drawing's, not the page's), the step numerals, the actions, the
    // sibling links and the footer.
    for (const sel of ['svg', '.own-step-n', '.own-hero-cta', '.own-close', '.pubws-aud-nav', 'footer']) {
      for (const el of clone.querySelectorAll(sel)) el.remove();
    }
    // Element by element, so two neighbours never run into one word.
    const page = squash([...clone.querySelectorAll('h1, h2, p, dt, dd')].map(el => el.textContent ?? '').join(' '));

    const parts: string[] = [owners.h1];
    for (const b of owners.blocks) {
      if (b.kind === 'p') parts.push(b.lead ? `${b.lead} ${b.text}` : b.text);
      if (b.kind === 'h2') parts.push(b.text);
      if (b.kind === 'ol' || b.kind === 'ul') parts.push(...b.items);
      if (b.kind === 'faq') for (const { q, a } of b.items) parts.push(q, a);
    }
    expect(page).toBe(squash(parts.join(' ')));
    // And every action the doc names is on the page.
    for (const c of owners.cta) expect(screen.getAllByText(c.label).length).toBeGreaterThan(0);
  });

  test('the board page takes the home page width and keeps the shared top bar', () => {
    const { container } = renderRoute('/owners');
    expect(container.querySelector('.pubws-topbar')).toBeTruthy();
    expect(container.querySelector('main')).toHaveClass('own');
  });
});

describe('the other audience pages keep the document layout', () => {
  test('/forecast still renders the document layout, no board', () => {
    const { container } = renderRoute('/forecast');
    expect(container.querySelector('.own-board')).toBeNull();
    expect(container.querySelector('.own-hero')).toBeNull();
    expect(container.querySelector('.pubws-story')).toBeTruthy();
    expect(container.querySelector('.pubws-hero--left h1')).toBeTruthy();
  });

  test('/compare/futarchy-fi keeps its table', () => {
    const { container } = renderRoute('/compare/futarchy-fi');
    expect(container.querySelector('.own-board')).toBeNull();
    expect(container.querySelector('.pubws-aud-table')).toBeTruthy();
  });
});
