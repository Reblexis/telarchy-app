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
