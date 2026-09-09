import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Stage 5 of the 2026-09-08 floor redesign (docs/ui-conventions.md, "The
 * rails: books, season, announcements, standings" and "The page ends: three
 * cells and the door"): the season block advertised as an icon row, the
 * announcements as ledger rows, the standings under the Otto row with one
 * key line, and the three end cells.
 */

const fx = vi.hoisted(() => ({ ref: null as null | import('./floor-fixture').Fx }));

vi.mock('../../hooks/useAuth', async () => {
  const { makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  const state = fx.ref;
  return { useAuth: () => ({ user: state.auth.user, loading: state.auth.loading, logout: async () => {} }) };
});
vi.mock('../../hooks/useEarnAvailable', async () => {
  const { makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  const state = fx.ref;
  return { useEarnAvailable: (signedIn: boolean) => (signedIn ? state.earn : null), clearEarnAvailableCache: () => {} };
});
vi.mock('../../lib/api', async () => {
  const { apiMock, makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  return apiMock(fx.ref);
});

const { TradePage } = await import('../TradePage');
const { renderFloor, resetFx, signIn, installObservers, freezeClock } = await import('./floor-fixture');
const state = () => fx.ref!;

beforeEach(() => {
  resetFx(state());
  installObservers();
  freezeClock();
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

async function floor() {
  const r = renderFloor(TradePage);
  await screen.findByText('What will be', { exact: false });
  await waitFor(() => expect(document.querySelector('.pubws-standings')).toBeTruthy());
  return r;
}

const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the season block: advertised, not narrated', () => {
  test('the label, one icon row in mono, the button and one line', async () => {
    await floor();
    const s = document.querySelector('.pubws-season') as HTMLElement;
    expect(s.querySelector('.pubws-h2')?.textContent).toBe('Season 0');
    const facts = s.querySelector('.pubws-season-facts') as HTMLElement;
    // Two facts, not the doc's three: "22 in" would need an entrant count,
    // and /api/seasons ships none (see the report of 2026-09-08).
    expect(facts.textContent?.replace(/\s+/g, ' ').trim()).toBe('$1,000 prizes 22 days left');
    const go = within(s).getByRole('link', { name: 'Enter the season' });
    expect(go.getAttribute('href')).toBe('/season');
    expect(s.querySelector('.pubws-season-terms')?.textContent).toBe('Free to enter. Prizes paid by Telarchy.');
    expect(follows(facts, go)).toBe(true);
    // The three-line advert of the old layout is gone: no hero line, no
    // running sentence about when the season ends.
    expect(s.querySelector('.pubws-season-hero')).toBeNull();
    expect(s.textContent).not.toMatch(/ends in/);
  });

  test('the facts are an icon row, never a sentence', async () => {
    await floor();
    const facts = document.querySelector('.pubws-season-facts') as HTMLElement;
    expect(facts.querySelector('.pubws-glyph--dollar')).toBeTruthy();
    expect(facts.querySelector('.pubws-glyph--clock')).toBeTruthy();
  });

  test('an entrant reads "You are in"', async () => {
    signIn(state(), 'trader');
    state().calls.getMySeason.mockResolvedValue({ optedIn: true } as never);
    await floor();
    await waitFor(() => expect(document.querySelector('.pubws-season-go')?.textContent).toBe('You are in'));
  });

  test('for the owner one more line says what the floor costs them', async () => {
    signIn(state(), 'owner');
    await floor();
    const who = document.querySelector('.pubws-season-who') as HTMLElement;
    expect(who.textContent).toBe(
      'This floor costs you nothing. You fund books in credits when you open them. Approved proposals cost their ask, in dollars.',
    );
  });

  test('a visitor never reads what the floor costs the owner', async () => {
    await floor();
    expect(document.querySelector('.pubws-season-who')).toBeNull();
  });

  test('the one-line season advert of the old layout is not rendered', async () => {
    const { container } = await floor();
    expect(container.querySelector('.pubws-season--line')).toBeNull();
    expect(container.querySelectorAll('a[href="/season"]')).toHaveLength(1);
  });
});

describe("announcements: the owner's disclosure surface, in the left rail", () => {
  test('the label with the corner control "All 5", and the entries as ledger rows', async () => {
    await floor();
    const ann = document.querySelector('[aria-label="Announcements"]') as HTMLElement;
    expect(ann.querySelector('.pubws-lb-head .pubws-h2')?.textContent).toBe('Announcements');
    const all = within(ann).getByRole('link', { name: 'All 5' });
    expect(all.getAttribute('href')).toBe('/telarchy/announcements');
    const rows = ann.querySelectorAll('.pubws-annline');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].querySelector('.pubws-annline-head')?.textContent).toBeTruthy();
    expect(rows[0].querySelector('.pubws-annline-when')?.textContent).toContain('25 Aug');
  });

  test('a record holding one entry carries no count, because "All 1" is furniture', async () => {
    state().overrides = { announcementCount: 1 };
    await floor();
    const ann = document.querySelector('[aria-label="Announcements"]') as HTMLElement;
    expect(within(ann).queryByRole('link', { name: /^All / })).toBeNull();
  });

  test('never published and nothing the visitor could do: no block at all', async () => {
    state().overrides = { announcementCount: 0, latestAnnouncement: null };
    await floor();
    expect(document.querySelector('[aria-label="Announcements"]')).toBeNull();
  });
});

describe('the standings sit under the Otto row', () => {
  test('two blocks side by side, three rows each, the shared head anatomy', async () => {
    await floor();
    const otto = document.querySelector('.pubws-otto-row') as HTMLElement;
    const standings = document.querySelector('.pubws-standings') as HTMLElement;
    expect(follows(otto, standings)).toBe(true);
    const blocks = [...standings.querySelectorAll('.pubws-lb-block')];
    expect(blocks.map(b => b.querySelector('.pubws-h2')?.textContent)).toEqual(['Top traders', 'Top contractors']);
    expect(blocks.map(b => b.querySelector('.pubws-lb-meta')?.textContent)).toEqual(['this market', 'impact']);
  });

  test('one foot under the pair: the key and "Full leaderboard", never a board opened in place', async () => {
    await floor();
    const standings = document.querySelector('.pubws-standings') as HTMLElement;
    const key = standings.querySelector('.pubws-standings-key') as HTMLElement;
    expect(key.textContent).toBe('IN = in the season · $ = prizes claimed · Full leaderboard');
    const more = within(key).getByRole('link', { name: 'Full leaderboard' });
    expect(more.getAttribute('href')).toBe('/leaderboard');
    // One foot, not a key line and a separate link under it.
    expect(standings.querySelectorAll('a[href="/leaderboard"]')).toHaveLength(1);
  });
});

describe('the Otto row is one row, not a dock', () => {
  test('the mark, the link, "connect your own AI" and one tertiary line', async () => {
    await floor();
    const row = document.querySelector('.pubws-otto-row') as HTMLElement;
    expect(row.querySelector('.pubws-otto-row-mark')?.textContent).toBe('O');
    expect(within(row).getByRole('button', { name: /Otto runs this market with you/ })).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'connect your own AI' })).toBeTruthy();
    expect(row.querySelector('.pubws-otto-row-line')).toBeTruthy();
    // The corner dock is not rendered (removed 2026-09-08).
    expect(document.querySelector('.pubws-otto-dock')).toBeNull();
  });

  test('for the owner the row says he runs the floor and what he can ask him to do', async () => {
    signIn(state(), 'owner');
    await floor();
    const row = document.querySelector('.pubws-otto-row') as HTMLElement;
    expect(within(row).getByRole('button', { name: /Otto runs this floor with you/ })).toBeTruthy();
    expect(row.querySelector('.pubws-otto-row-line')?.textContent).toBe(
      'Reports numbers, funds books, decides proposals, all by chat.',
    );
  });
});

describe('the page ends: three cells and the door', () => {
  test('three cells, each a label, one sentence and one control', async () => {
    await floor();
    const end = screen.getByLabelText('Next steps');
    const cells = [...end.querySelectorAll('.pubws-end-cell')];
    expect(cells.map(c => c.querySelector('.pubws-end-label')?.textContent)).toEqual([
      'New here?',
      'Do the work',
      'Your own numbers',
    ]);
    expect(cells[0].querySelector('.pubws-end-line')?.textContent).toBe(
      'Telarchy prices what a decision does to a number before anyone commits.',
    );
    expect(
      within(cells[0] as HTMLElement)
        .getByRole('link', { name: /How it works/ })
        .getAttribute('href'),
    ).toBe('/guides');
    expect(cells[1].querySelector('.pubws-end-line')?.textContent).toBe(
      'Offer to do it and name your price. The owner pays in real money if approved.',
    );
    expect(within(cells[1] as HTMLElement).getByRole('button', { name: /Offer a proposal/ })).toBeTruthy();
    expect(cells[2].querySelector('.pubws-end-line')?.textContent).toBe(
      'List the numbers your company runs on and let people price them.',
    );
    expect(cells[2].querySelector('.pubws-end-sub')?.textContent).toBe(
      'Free. You fund the books in credits; prizes come from Telarchy.',
    );
    expect(cells[2].querySelector('input[type="email"]')).toBeTruthy();
    expect(within(cells[2] as HTMLElement).getByRole('button', { name: 'Get set up' })).toBeTruthy();
  });
});
