import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * THE INFO OPENS INLINE UNDER THE TITLE AND OVERLAPS NOTHING
 * (docs/ui-conventions.md, "The page ends: two lines and the door",
 * 2026-09-11). The (i) beside the company's name used to open a popup the
 * headline painted over (design critic, 2026-09-11, finding 1). Now it is a
 * disclosure in normal flow: closed by default, a press opens the sentence
 * as a block under the name and pushes the page down, nothing overlaps.
 */

const h = vi.hoisted(() => {
  const workspace = () => ({
    workspaceId: 'ws-1',
    name: 'LookPilot',
    slug: 'lookpilot',
    ownerId: null,
    ownerHandle: null,
    description: 'Webcam head tracker for sims.',
    charter: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    proposalStats: { total: 0, pending: 0, approved: 0, declined: 0 },
    markets: [
      {
        marketId: 'm-1',
        metricId: 'rev',
        metricName: 'LookPilot net revenue (USD)',
        metricOrder: 0,
        targetDate: '2026-09',
        resolvesOn: '2026-10-01T00:00:00Z',
        consensus: 7_100,
        probability: 0.5,
        liquidity: 200,
        pool: 3000,
        traderCount: 2,
        tradedVolume: 40,
        rangeMin: 0,
        rangeMax: 50_000,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-1',
    horizonHistories: [{ marketId: 'm-1', periodStart: '2026-09-01', points: [], description: 'Revenue.' }],
    proposals: [],
  });
  return { workspace };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: () => <div data-testid="chart" />,
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.workspace()),
    getPublicMarketHistory: vi.fn(async () => []),
    getLeaderboard: vi.fn(async () => ({ participants: [] })),
    getMarketActivity: vi.fn(async () => ({ consensus: null, positions: [], trades: [] })),
    getFloorComments: vi.fn(async () => []),
  };
  const api = new Proxy(explicit, {
    get(target, prop: string) {
      if (!(prop in target)) target[prop] = vi.fn(async () => []);
      return target[prop];
    },
  });
  return { api, setActiveWorkspace: vi.fn() };
});

const { TradePage } = await import('../TradePage');

const CSS = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');
/** The body of the first plain rule for a class. */
function rule(cls: string): string {
  const m = CSS.match(new RegExp(`(^|\\n)\\.${cls.replace(/[.-]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for .${cls}`);
  return m[2];
}

function renderFloor() {
  return render(
    <MemoryRouter initialEntries={['/lookpilot']}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const isShown = (el: Element | null) => !!el && !(el as HTMLElement).hidden;

beforeEach(() => {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
});
afterEach(() => vi.clearAllMocks());

describe('THE INFO OPENS INLINE UNDER THE TITLE AND OVERLAPS NOTHING', () => {
  test('closed by default: the sentence is not shown until asked', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-ws-info-btn')).toBeTruthy());
    expect(isShown(container.querySelector('.pubws-ws-what'))).toBe(false);
    const btn = screen.getByRole('button', { name: 'What LookPilot is' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  test('a press opens the block in normal flow under the name, and the headline stays', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-ws-info-btn')).toBeTruthy());
    const btn = screen.getByRole('button', { name: 'What LookPilot is' });
    fireEvent.click(btn);
    await waitFor(() => expect(isShown(container.querySelector('.pubws-ws-what'))).toBe(true));
    const what = container.querySelector('.pubws-ws-what') as HTMLElement;
    expect(what.textContent).toBe('Webcam head tracker for sims.');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-controls')).toBe(what.id);
    // In flow: a block child of the identity header AFTER the name's line,
    // not a child of the button's wrapper positioned over the page.
    const header = container.querySelector('.pubws-ident') as HTMLElement;
    expect(what.parentElement).toBe(header);
    const h1 = header.querySelector('h1') as HTMLElement;
    expect(h1.compareDocumentPosition(what) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(what.closest('.pubws-ws-info')).toBeNull();
    expect(what.getAttribute('role')).not.toBe('tooltip');
    // The headline under it is still on the page, unhidden.
    const ask = container.querySelector('.pubws-instrument-ask') as HTMLElement;
    expect(ask).toBeTruthy();
    expect(ask.hidden).toBe(false);
    expect(what.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('a second press closes it', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-ws-info-btn')).toBeTruthy());
    const btn = screen.getByRole('button', { name: 'What LookPilot is' });
    fireEvent.click(btn);
    await waitFor(() => expect(isShown(container.querySelector('.pubws-ws-what'))).toBe(true));
    fireEvent.click(btn);
    await waitFor(() => expect(isShown(container.querySelector('.pubws-ws-what'))).toBe(false));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  test('keyboard reachable: the (i) is a real button in the tab order', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-ws-info-btn')).toBeTruthy());
    const btn = screen.getByRole('button', { name: 'What LookPilot is' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.tabIndex).toBe(0);
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  test('the stylesheet keeps the block in flow, left-aligned, never absolute and never opened by hover', () => {
    const body = rule('pubws-ws-what');
    expect(body).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(body).not.toMatch(/visibility:\s*hidden/);
    expect(body).not.toMatch(/z-index/);
    expect(body).toMatch(/text-align:\s*left/);
    expect(CSS).not.toMatch(/\.pubws-ws-info:hover\s+\.pubws-ws-what/);
    expect(CSS).not.toMatch(/\.pubws-ws-info:focus-within\s+\.pubws-ws-what/);
  });
});
