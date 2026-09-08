import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Stage 1 of the 2026-09-08 floor redesign (docs/ui-conventions.md,
 * "Trading floor", "The top bar and the account menu", "The floor head,
 * the owner row and the run-a-floor row", "Books on this floor"): the
 * frame. Width tiers, the one-column order, the bar's three states, the
 * floor head with its facts, the owner row, the run-a-floor row and its
 * live preview, and the books list in its two places.
 */

const fx = vi.hoisted(() => {
  // The fixture module is imported by the mock factories below; the state
  // object is created here so both the factories and the tests share it.
  return { ref: null as null | import('./floor-fixture').Fx };
});

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

const CSS = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');

beforeEach(() => {
  resetFx(state());
  installObservers();
  freezeClock();
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

async function floor(entries?: string[]) {
  const r = renderFloor(TradePage, entries);
  await screen.findByText('What will be', { exact: false });
  return r;
}

describe('the top bar: signed out, participant, owner', () => {
  test('signed out the right side is "Log in" and "Sign up" only: no Earn credits, no icons on the bar', async () => {
    await floor();
    const bar = document.querySelector('.pubws-topbar')!;
    expect(within(bar as HTMLElement).getByText('Log in')).toBeTruthy();
    expect(within(bar as HTMLElement).getByText('Sign up')).toBeTruthy();
    expect(bar.querySelector('.earndoor')).toBeNull();
    expect(bar.querySelector('.pubws-otto-link')).toBeNull();
    expect(bar.querySelector('.pubws-discord')).toBeNull();
    expect(bar.querySelector('.pubws-report')).toBeNull();
    expect(bar.querySelector('.pubws-theme')).toBeNull();
    expect(bar.querySelector('.notif')).toBeNull();
  });

  test('a signed-in participant reads Earn credits with the total, the bell, Otto, the credits pill and the avatar', async () => {
    signIn(state(), 'trader');
    await floor();
    const bar = document.querySelector('.pubws-topbar') as HTMLElement;
    await waitFor(() => expect(bar.querySelector('.earndoor')).not.toBeNull());
    expect(bar.querySelector('.earndoor')!.textContent).toMatch(/Earn credits\s*\+10,025/);
    expect(bar.querySelector('.notif')).not.toBeNull();
    expect(within(bar).getByRole('button', { name: 'Otto' })).toBeTruthy();
    await waitFor(() => expect(bar.querySelector('.acctmenu-credits')?.textContent).toMatch(/946k cr/));
    expect(bar.querySelector('.acctmenu-avatar')).not.toBeNull();
    expect(within(bar).queryByText('Log in')).toBeNull();
    expect(within(bar).queryByText('Sign up')).toBeNull();
  });

  test('the workspace owner does not see Earn credits on the bar of their own floor', async () => {
    signIn(state(), 'owner');
    await floor();
    const bar = document.querySelector('.pubws-topbar') as HTMLElement;
    await waitFor(() => expect(within(bar).getByRole('button', { name: 'Otto' })).toBeTruthy());
    await waitFor(() => expect(bar.querySelector('.acctmenu-credits')).not.toBeNull());
    expect(bar.querySelector('.earndoor')).toBeNull();
  });

  test("the corner dock is not rendered; the bar's Otto link opens the one panel", async () => {
    signIn(state(), 'trader');
    await floor();
    expect(document.querySelector('.ottodock')).toBeNull();
    expect(document.querySelector('.otto')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Otto' }));
    expect(document.querySelector('section.otto')).not.toBeNull();
  });

  test('Discord, report a bug and the theme toggle live in the account popover, not on the bar', async () => {
    signIn(state(), 'trader');
    await floor();
    const bar = document.querySelector('.pubws-topbar') as HTMLElement;
    await waitFor(() => expect(bar.querySelector('.acctmenu-avatar')).not.toBeNull());
    fireEvent.click(bar.querySelector('.acctmenu-avatar') as HTMLElement);
    const panel = document.querySelector('.acctmenu-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('.pubws-discord')).not.toBeNull();
    expect(panel.querySelector('.pubws-report')).not.toBeNull();
    expect(panel.querySelector('.pubws-theme')).not.toBeNull();
    expect(within(panel).getByText('Account settings')).toBeTruthy();
    expect(within(panel).getByText('Log out')).toBeTruthy();
  });

  test('the bar is sticky on a phone and the mark stands in for the lockup under 768px (stylesheet)', () => {
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/\.pubws-topbar\s*\{[^}]*position:\s*sticky/);
    expect(CSS).toMatch(/@media \(max-width: 767px\)\s*\{\s*\.pubws-logo-wide\s*\{\s*display:\s*none/);
  });
});

describe('the floor head: label, facts, name, one-liner', () => {
  test("line 1 is the FLOOR label and the floor's facts as an icon row: traders, credits in pools, books", async () => {
    await floor();
    const head = document.querySelector('.pubws-head') as HTMLElement;
    expect(head).not.toBeNull();
    expect(within(head).getByText('Floor')).toBeTruthy();
    const facts = head.querySelector('.pubws-head-facts') as HTMLElement;
    const cells = Array.from(facts.querySelectorAll(':scope > span')).map(s => s.textContent?.trim());
    // The floor's counts, never one book's: 22 distinct traders, the pools
    // of every open book (4k + 12k + 38k + 9k = 63k), four open books.
    expect(cells).toEqual(['22 traders', '63k cr in pools', '4 books']);
    // Facts are an icon row: a glyph before each fact, the pool glyph a
    // droplet, never a sentence.
    expect(facts.querySelectorAll('svg').length).toBe(3);
    expect(facts.querySelector('.pubws-glyph--pool path')?.getAttribute('d')).toMatch(/^M12 3s6 6.5/);
  });

  test('line 2 is the name in the display face and the one-liner under it; no one-liner, the name alone', async () => {
    await floor();
    const head = document.querySelector('.pubws-head') as HTMLElement;
    expect(head.querySelector('.pubws-head-name')?.textContent).toBe('Telarchy');
    expect(head.querySelector('.pubws-head-line')?.textContent).toContain('This platform, running on itself.');
  });

  test('a workspace with no one-liner prints the name alone', async () => {
    state().overrides = { description: null };
    await floor();
    const head = document.querySelector('.pubws-head') as HTMLElement;
    expect(head.querySelector('.pubws-head-name')?.textContent).toBe('Telarchy');
    expect(head.querySelector('.pubws-head-line')).toBeNull();
  });

  test('for the owner an Edit control follows the one-liner and opens the identity dialog (name, one-liner)', async () => {
    signIn(state(), 'owner');
    await floor();
    const head = document.querySelector('.pubws-head') as HTMLElement;
    const edit = await within(head).findByRole('button', { name: 'Edit' });
    fireEvent.click(edit);
    const dlg = document.querySelector('[role="dialog"][aria-label="Floor identity"]') as HTMLElement;
    expect(dlg).not.toBeNull();
    const name = within(dlg).getByLabelText('Floor name') as HTMLInputElement;
    const line = within(dlg).getByLabelText('One-liner') as HTMLInputElement;
    expect(name.value).toBe('Telarchy');
    expect(line.value).toBe('This platform, running on itself.');
    fireEvent.change(line, { target: { value: 'A market on our own numbers.' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state().calls.updateWorkspaceSettings).toHaveBeenCalledWith('ws-1', {
        name: 'Telarchy',
        description: 'A market on our own numbers.',
      }),
    );
  });

  test('a visitor sees no Edit on the head', async () => {
    signIn(state(), 'trader');
    await floor();
    const head = document.querySelector('.pubws-head') as HTMLElement;
    expect(within(head).queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});

describe("the owner row: the owner's three jobs, each a direct route", () => {
  test('"Report a number" opens the Report dialog on the book on screen', async () => {
    signIn(state(), 'owner');
    await floor();
    const row = (await waitFor(() => {
      const el = document.querySelector('.pubws-owner-row');
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;
    // The floor opens on Active traders, a synced metric; step to Signups,
    // which the owner reports.
    fireEvent.click(screen.getByRole('button', { name: /Metric: Active traders/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Signups' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Report a number' }));
    expect(document.querySelector('[role="dialog"][aria-label="Report the number"]')).not.toBeNull();
  });

  test('on a floor whose every metric the platform syncs the first item reads "Readings synced hourly" and is not a control', async () => {
    signIn(state(), 'owner');
    const ws = state().ws();
    state().overrides = {
      horizonHistories: (ws.horizonHistories as Array<Record<string, unknown>>).map(h => ({
        ...h,
        platformSynced: true,
      })),
    };
    await floor();
    const row = (await waitFor(() => {
      const el = document.querySelector('.pubws-owner-row');
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Report a number' })).toBeNull();
    const quiet = within(row).getByText('Readings synced hourly');
    expect(quiet.tagName).not.toBe('BUTTON');
    expect(quiet.className).toContain('pubws-owner-row-quiet');
  });

  test('"1 proposal needs your decision" counts pending, paid, by someone else, and selects the oldest', async () => {
    signIn(state(), 'owner');
    await floor();
    const row = (await waitFor(() => {
      const el = document.querySelector('.pubws-owner-row');
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;
    // job-paid ($200, by telarchy-agents) counts; job-free ($0, the owner's
    // own) and job-done (decided) do not.
    const go = within(row).getByRole('button', { name: '1 proposal needs your decision' });
    fireEvent.click(go);
    expect(await screen.findByText('← Back to the market')).toBeTruthy();
    expect(screen.getByText('Ship an open-source reference trading agent with a tutorial')).toBeTruthy();
  });

  test('with none it reads "No proposal needs your decision" in the tertiary register, not a control', async () => {
    signIn(state(), 'owner');
    const ws = state().ws();
    state().overrides = {
      proposals: (ws.proposals as Array<Record<string, unknown>>).filter(p => p.id !== 'job-paid'),
    };
    await floor();
    const row = (await waitFor(() => {
      const el = document.querySelector('.pubws-owner-row');
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;
    const quiet = within(row).getByText('No proposal needs your decision');
    expect(quiet.tagName).not.toBe('BUTTON');
    expect(quiet.className).toContain('pubws-owner-row-quiet');
  });

  test('"Manage books" opens the metric sheet', async () => {
    signIn(state(), 'owner');
    await floor();
    const row = (await waitFor(() => {
      const el = document.querySelector('.pubws-owner-row');
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Manage books' }));
    expect(document.querySelector('[role="dialog"][aria-label="Metrics"]')).not.toBeNull();
  });

  test('the owner row is directly under the identity, and nobody else gets one', async () => {
    signIn(state(), 'owner');
    await floor();
    await waitFor(() => expect(document.querySelector('.pubws-owner-row')).not.toBeNull());
    const head = document.querySelector('.pubws-head')!;
    expect(head.nextElementSibling?.classList.contains('pubws-owner-row')).toBe(true);
    expect(document.querySelector('.pubws-run-row')).toBeNull();
  });
});

describe('the run-a-floor row: one door to running a floor, for everyone who is not the owner', () => {
  test('signed out: the link and the three cost words on one ruled row, under the identity', async () => {
    await floor();
    const row = document.querySelector('.pubws-run-row') as HTMLElement;
    expect(row).not.toBeNull();
    expect(document.querySelector('.pubws-head')!.nextElementSibling).toBe(row);
    expect(within(row).getByRole('button', { name: /Run a floor for your company/ })).toBeTruthy();
    expect(row.querySelector('.pubws-run-terms')?.textContent).toBe(
      'free · you fund books in credits · prizes paid by Telarchy',
    );
    expect(document.querySelector('.pubws-owner-row')).toBeNull();
    // The old doors are gone: no "What is Telarchy?" block, no rail door.
    expect(screen.queryByText(/What is Telarchy\?/)).toBeNull();
    expect(document.querySelector('.pubws-rail-door')).toBeNull();
  });

  test('a signed-in participant gets the same row', async () => {
    signIn(state(), 'trader');
    await floor();
    expect(document.querySelector('.pubws-run-row')).not.toBeNull();
  });

  test('pressing it opens a panel in place: three prefilled fields and a live floor head built from them', async () => {
    await floor();
    fireEvent.click(screen.getByRole('button', { name: /Run a floor for your company/ }));
    const panel = document.querySelector('.pubws-run-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const company = within(panel).getByLabelText('Company name') as HTMLInputElement;
    const metric = within(panel).getByLabelText('A number you run on') as HTMLInputElement;
    const value = within(panel).getByLabelText('Its value now') as HTMLInputElement;
    expect([company.value, metric.value, value.value]).toEqual(['Acme', 'Signups', '41']);
    const preview = panel.querySelector('.pubws-run-preview') as HTMLElement;
    expect(within(preview).getByText('Floor')).toBeTruthy();
    expect(preview.querySelector('.pubws-head-name')?.textContent).toBe('Acme');
    expect(within(preview).getByText("What will be Acme's Signups this month?")).toBeTruthy();
    // NOW 41 with the Report control in the cell: the previewed floor is
    // owner-reported by construction.
    const now = preview.querySelector('.pubws-stat--now') as HTMLElement;
    expect(now.textContent).toContain('41');
    expect(within(now).getByText('Report')).toBeTruthy();
    const call = preview.querySelector('.pubws-stat--call') as HTMLElement;
    expect(call.textContent).toMatch(/Market's call/i);
    expect(call.textContent).toContain('opens at 41');
    // The three cost facts as an icon row.
    const facts = Array.from(panel.querySelectorAll('.pubws-run-facts > span')).map(s => s.textContent?.trim());
    expect(facts).toEqual([
      'Floor · free',
      'Books · funded in credits by you',
      'Proposals · paid in dollars only when you approve',
    ]);
    // Typing re-renders the preview as typed.
    fireEvent.change(company, { target: { value: 'Globex' } });
    fireEvent.change(metric, { target: { value: 'Orders' } });
    fireEvent.change(value, { target: { value: '7' } });
    expect(within(preview).getByText("What will be Globex's Orders this month?")).toBeTruthy();
    expect(preview.querySelector('.pubws-stat--now')?.textContent).toContain('7');
    expect(preview.querySelector('.pubws-stat--call')?.textContent).toContain('opens at 7');
    // The two controls that close the panel.
    expect(within(panel).getByRole('button', { name: 'Create this floor' })).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'How Telarchy works' }).getAttribute('href')).toBe('/guides');
  });

  test('signed out, "Create this floor" opens sign-up and keeps the three fields for after it', async () => {
    await floor();
    fireEvent.click(screen.getByRole('button', { name: /Run a floor for your company/ }));
    const panel = document.querySelector('.pubws-run-panel') as HTMLElement;
    fireEvent.change(within(panel).getByLabelText('Company name'), { target: { value: 'Globex' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Create this floor' }));
    expect(await screen.findByTestId('signup-door')).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem('telarchy-run-floor') ?? '{}')).toEqual({
      company: 'Globex',
      metric: 'Signups',
      value: '41',
    });
  });

  test('signed in, "Create this floor" opens the setup door with the three fields prefilled', async () => {
    signIn(state(), 'trader');
    await floor();
    fireEvent.click(screen.getByRole('button', { name: /Run a floor for your company/ }));
    const panel = document.querySelector('.pubws-run-panel') as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: 'Create this floor' }));
    expect(await screen.findByTestId('setup-door')).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem('telarchy-run-floor') ?? '{}')).toEqual({
      company: 'Acme',
      metric: 'Signups',
      value: '41',
    });
  });
});

describe('books on this floor: one component, two places', () => {
  test('the left rail lists every open baseline book with its call and pool, metric order then soonest date first', async () => {
    await floor();
    const rail = document.querySelector('.pubws-rail--left') as HTMLElement;
    const books = rail.querySelector('.pubws-books') as HTMLElement;
    expect(books).not.toBeNull();
    expect(within(books).getByText('Books on this floor')).toBeTruthy();
    const rows = Array.from(books.querySelectorAll('.pubws-book'));
    expect(rows.map(r => r.querySelector('.pubws-book-name')?.textContent)).toEqual([
      'Active traders',
      'Active traders',
      'Active traders',
      'Signups',
    ]);
    expect(rows.map(r => r.querySelector('.pubws-book-clock')?.textContent)).toEqual([
      'today · 8 Sep',
      'this week · 13 Sep',
      'this month · 30 Sep',
      'this month · 30 Sep',
    ]);
    expect(rows.map(r => r.querySelector('.pubws-book-call')?.textContent)).toEqual(['9.4', '11.2', '19.8', '41']);
    expect(rows.map(r => r.querySelector('.pubws-book-pool')?.textContent)).toEqual([
      '4,000 cr',
      '12k cr',
      '38k cr',
      '9,000 cr',
    ]);
    // The book on screen (the floor opens on the furthest-resolving, the
    // primary metric's month) carries the ink rule.
    expect(rows.map(r => r.classList.contains('is-selected'))).toEqual([false, false, true, false]);
  });

  test('pressing a row selects that book: the question follows', async () => {
    await floor();
    const books = document.querySelector('.pubws-books') as HTMLElement;
    const rows = books.querySelectorAll('.pubws-book');
    fireEvent.click(rows[3]);
    expect(await screen.findByText(/Signups/, { selector: '.pubws-ask-word' })).toBeTruthy();
    expect(books.querySelectorAll('.pubws-book')[3].classList.contains('is-selected')).toBe(true);
  });

  test('for the owner "Manage metrics and dates" sits under the list and opens the metric sheet', async () => {
    signIn(state(), 'owner');
    await floor();
    const books = document.querySelector('.pubws-books') as HTMLElement;
    const manage = await within(books).findByRole('button', { name: 'Manage metrics and dates' });
    fireEvent.click(manage);
    expect(document.querySelector('[role="dialog"][aria-label="Metrics"]')).not.toBeNull();
  });

  test('a visitor sees no manage control under the list', async () => {
    await floor();
    const books = document.querySelector('.pubws-books') as HTMLElement;
    expect(within(books).queryByRole('button', { name: 'Manage metrics and dates' })).toBeNull();
  });

  test('the row under the question reads the count and the soonest settle day, and opens the same list as a listbox', async () => {
    await floor();
    const row = document.querySelector('.pubws-books-row') as HTMLElement;
    expect(row).not.toBeNull();
    const go = within(row).getByRole('button', { name: /Books on this floor/ });
    expect(go.getAttribute('aria-expanded')).toBe('false');
    expect(row.querySelector('.pubws-books-row-meta')?.textContent).toBe('4 books · next settles 8 Sep');
    fireEvent.click(go);
    expect(go.getAttribute('aria-expanded')).toBe('true');
    const list = row.querySelector('[role="listbox"]') as HTMLElement;
    const options = within(list).getAllByRole('option');
    expect(options.length).toBe(4);
    expect(options[2].getAttribute('aria-selected')).toBe('true');
    expect(options[2].textContent).toContain('this month · 30 Sep');
    expect(options[2].textContent).toContain('19.8');
    // A pick selects and closes.
    fireEvent.click(options[3]);
    expect(row.querySelector('[role="listbox"]')).toBeNull();
    expect(await screen.findByText(/Signups/, { selector: '.pubws-ask-word' })).toBeTruthy();
  });

  test('the panel closes on Escape and on a click outside', async () => {
    await floor();
    const row = document.querySelector('.pubws-books-row') as HTMLElement;
    const go = within(row).getByRole('button', { name: /Books on this floor/ });
    fireEvent.click(go);
    expect(row.querySelector('[role="listbox"]')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(row.querySelector('[role="listbox"]')).toBeNull();
    fireEvent.click(go);
    expect(row.querySelector('[role="listbox"]')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(row.querySelector('[role="listbox"]')).toBeNull();
  });

  test('the row carries a second item, the proposals count and largest impact, which jumps to the board', async () => {
    await floor();
    const row = document.querySelector('.pubws-books-row') as HTMLElement;
    const props = within(row).getByRole('button', { name: '2 proposals · largest impact +3.7' });
    fireEvent.click(props);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  test('the row lives under the question; the chips above the question are not rendered any more', async () => {
    await floor();
    expect(document.querySelector('.pubws-chip')).toBeNull();
    expect(document.querySelector('.pubws-instrument-label')).toBeNull();
    const ask = document.querySelector('.pubws-instrument-ask')!;
    expect(ask.nextElementSibling?.classList.contains('pubws-books-row')).toBe(true);
  });

  test('the owner\'s "Manage metrics and dates" is in the row\'s panel too', async () => {
    signIn(state(), 'owner');
    await floor();
    const row = document.querySelector('.pubws-books-row') as HTMLElement;
    await waitFor(() => expect(document.querySelector('.pubws-owner-row')).not.toBeNull());
    fireEvent.click(within(row).getByRole('button', { name: /Books on this floor/ }));
    expect(within(row).getByRole('button', { name: 'Manage metrics and dates' })).toBeTruthy();
  });
});

describe('widths: three columns from 1400, two from 1120, one under (stylesheet)', () => {
  const at1400 = CSS.slice(CSS.indexOf('@media (min-width: 1400px)'));
  const at1120 = CSS.slice(CSS.indexOf('@media (min-width: 1120px)'));

  test('from 1400px the floor is 220 / 700 / 300 with 40px gutters, the page at most 1440 wide with 48px side padding', () => {
    expect(at1400).toMatch(/grid-template-columns:\s*220px\s+700px\s+300px/);
    expect(at1400).toMatch(/gap:\s*0\s+40px/);
    expect(at1400).toMatch(/max-width:\s*1440px/);
    expect(at1400).toMatch(/padding(-left|-right)?:[^;]*48px/);
  });

  test('from 1120px to 1399px the centre is 680 beside the 300 proposals rail', () => {
    expect(at1120).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*680px\)\s+300px|grid-template-columns:\s*680px\s+300px/,
    );
  });

  test('the rails are separated from the centre by a vertical hairline', () => {
    expect(at1120).toMatch(/\.pubws-rail--right\s*\{[^}]*border-left:\s*1px solid var\(--border-color\)/);
    expect(at1400).toMatch(/\.pubws-rail--left\s*\{[^}]*border-right:\s*1px solid var\(--border-color\)/);
  });

  test('the books list is the rail from 1400 and the row under the question below it, never both', () => {
    expect(at1400).toMatch(/\.pubws-books-row\s*\{[^}]*display:\s*none/);
    const under1400 = CSS.slice(CSS.indexOf('@media (max-width: 1399.98px)'));
    expect(under1400).toMatch(/\.pubws-books\s*\{[^}]*display:\s*none/);
  });

  test('the proposals item in the books row shows only under 1120', () => {
    expect(at1120).toMatch(/\.pubws-books-row-props\s*\{[^}]*display:\s*none/);
  });

  test('under 480px the column runs at 16px padding', () => {
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 479.98px)'));
    expect(phone).toMatch(/\.pubws-main--floor\s*\{[^}]*padding(-left|-right)?:[^;]*16px/);
  });

  test("no count strip, no corner dock clearance, no second chart, no know block in the stylesheet's floor grid", () => {
    expect(CSS).not.toMatch(/--ottodock-clearance/);
    expect(CSS).not.toMatch(/\.pubws-callhist/);
    expect(CSS).not.toMatch(/\.pubws-know-col/);
    expect(CSS).not.toMatch(/\.pubws-season--line/);
  });
});

describe('the one-column order is the DOM order', () => {
  test('top bar, head, run row, question, books row, numbers, verbs, chart, activity, Otto row, proposals, season, announcements, standings, footer', async () => {
    await floor();
    const order = [
      '.pubws-topbar',
      '.pubws-head',
      '.pubws-run-row',
      '.pubws-instrument-ask',
      '.pubws-books-row',
      '.pubws-numbers',
      '.pubws-verbs',
      '.pubws-numchart',
      '.pubws-activity',
      '.pubws-otto-row',
      '.pubws-ballot',
      '.pubws-season',
      '.pubws-announcements',
      '.pubws-standings',
      '.pubws-end',
    ];
    const found = order.map(sel => document.querySelector(sel));
    for (const [i, el] of found.entries()) expect(el, order[i]).not.toBeNull();
    for (let i = 1; i < found.length; i++) {
      const before = found[i - 1]!.compareDocumentPosition(found[i]!) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(before, `${order[i - 1]} before ${order[i]}`).toBeTruthy();
    }
  });

  test('the left rail exists only in the plain market view', async () => {
    await floor();
    expect(document.querySelector('.pubws-rail--left')).not.toBeNull();
    fireEvent.click(screen.getByText('Ship an open-source reference trading agent with a tutorial'));
    await screen.findByText('← Back to the market');
    expect(document.querySelector('.pubws-rail--left')).toBeNull();
    expect(document.querySelector('.pubws-season')).toBeNull();
    expect(document.querySelector('.pubws-announcements')).toBeNull();
    expect(document.querySelector('.pubws-ballot')).not.toBeNull();
  });

  test('the loading ghosts draw the same three columns', async () => {
    state().calls.getMarketplaceWorkspace.mockImplementationOnce(() => new Promise(() => {}));
    renderFloor(TradePage);
    const main = document.querySelector('.pubws-main--ghost') as HTMLElement;
    expect(main).not.toBeNull();
    expect(main.querySelector('.pubws-rail--left')).not.toBeNull();
    expect(main.querySelector('.pubws-center')).not.toBeNull();
    expect(main.querySelector('.pubws-rail--right')).not.toBeNull();
  });
});
