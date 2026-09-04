/**
 * lazy-page.tsx: route-level code splitting and the deploy-rotated-chunk
 * failure mode.
 *
 * Every Publish renames the hashed chunks, so a tab left open across a
 * deploy asks for files that no longer exist on its first navigation. The
 * boundary turns that crash into one silent reload (fresh HTML names fresh
 * chunks); a second failure inside a minute must NOT reload again, or a
 * genuinely dead network becomes a reload loop.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// The shell wears the site's one top bar; its account controls need a
// session, which is not what this spec is about.
vi.mock('../../components/PageTopBar', () => ({ PageTopBar: () => <nav className="pubws-topbar" /> }));

import { lazyPage } from '../lazy-page';

const reload = vi.fn();

beforeEach(() => {
  reload.mockReset();
  sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload, href: 'https://telarchy.com/x' },
    writable: true,
  });
});

function Page({ label = 'loaded' }: { label?: string }) {
  return <div>{label}</div>;
}

describe('lazyPage', () => {
  test('while the chunk downloads it draws the page shell, never nothing', () => {
    // A lazily loaded page used to render null until its code arrived, so
    // /about was a blank document for the length of the download. The rule
    // (docs/ui-conventions.md, "While a page loads"): the top bar over a
    // ghost column, with the mark in the same place the page will put it.
    const Lazy = lazyPage<'Page', object>(() => new Promise(() => {}), 'Page');
    const { container } = render(<Lazy />);
    expect(container.querySelector('.pubws-topbar')).toBeTruthy();
    expect(container.querySelector('.pubws-ghost')).toBeTruthy();
    expect(container.querySelector('[role="status"]')).toHaveAttribute('aria-label', 'Loading');
    expect(container.querySelector('.pubws-loading-dot')).toBeNull();
  });

  test('renders the named export once the chunk arrives, props forwarded', async () => {
    const Lazy = lazyPage(async () => ({ Page }), 'Page');
    render(<Lazy label="hello from the chunk" />);
    expect(await screen.findByText('hello from the chunk')).toBeInTheDocument();
  });

  test('a dead chunk reloads the page once', async () => {
    const Lazy = lazyPage<'Page', object>(async () => {
      throw new Error('Failed to fetch dynamically imported module: /assets/Page-abc.js');
    }, 'Page');
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Lazy />);
    await screen.findByText(/failed to load/i);
    expect(reload).toHaveBeenCalledTimes(1);
    silence.mockRestore();
  });

  test('a second failure inside a minute shows the retry link instead of looping', async () => {
    sessionStorage.setItem('chunk-reload-at', String(Date.now()));
    const Lazy = lazyPage<'Page', object>(async () => {
      throw new Error('Importing a module script failed.');
    }, 'Page');
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Lazy />);
    const retry = await screen.findByRole('link', { name: /retry/i });
    expect(retry).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    silence.mockRestore();
  });

  test('a non-chunk error never reloads (it is a real bug, not a stale tab)', async () => {
    const Lazy = lazyPage<'Page', object>(async () => {
      throw new Error('TypeError: undefined is not a function');
    }, 'Page');
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Lazy />);
    await screen.findByText(/failed to load/i);
    expect(reload).not.toHaveBeenCalled();
    silence.mockRestore();
  });
});
