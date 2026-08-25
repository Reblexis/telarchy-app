import { describe, expect, it } from 'vitest';
import { indexBundleSrc } from '../bundle-version';

describe('indexBundleSrc (stale-tab guard, 2026-08-13)', () => {
  it('extracts the built entry bundle from a production index.html', () => {
    const html =
      '<script type="module" crossorigin src="/assets/index-D81RcpRC.js"></script>' +
      '<link rel="stylesheet" crossorigin href="/assets/index-B3fz7wD6.css">';
    expect(indexBundleSrc(html)).toBe('/assets/index-D81RcpRC.js');
  });

  it('is null on a dev-served page (no built bundle), keeping the guard inert', () => {
    const html = '<script type="module" src="/src/main.tsx"></script>';
    expect(indexBundleSrc(html)).toBeNull();
  });
});
