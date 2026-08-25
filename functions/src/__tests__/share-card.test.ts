/**
 * The server-drawn share card (lib/share-card.ts): the og:image is the
 * floor compressed into one picture. Pin what matters: a real PNG comes
 * out, the live number and the step line are in the SVG, and the
 * degenerate states (no history, unpriced) still render a card instead
 * of throwing at a link scraper.
 */

import { renderShareCardPng, renderShareCardSvg } from '../lib/share-card';

const DATA = {
  name: 'LookPilot',
  metricLabel: '2026 profit',
  unit: '$',
  consensus: 73600,
  resolvesOn: '31 December 2026',
  history: [65000, 68000, 320000, 73600],
};

describe('the share card', () => {
  test('the SVG leads with the live number and draws the step line', () => {
    const svg = renderShareCardSvg(DATA);
    expect(svg).toContain('$73,600');
    expect(svg).toContain('2026 profit');
    expect(svg).toContain('resolves 31 December 2026');
    expect(svg).toContain('<path d="M');
    // A malicious workspace name cannot become markup.
    const svg2 = renderShareCardSvg({ ...DATA, name: '<script>"x"</script>' });
    expect(svg2).not.toContain('<script>');
  });

  test('renders a real 1200x630 PNG', () => {
    const png = renderShareCardPng(DATA);
    // PNG magic bytes, then IHDR width 1200 (0x4B0) and height 630 (0x276).
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(png.length).toBeGreaterThan(5000);
  });

  test('an untraded, unpriced market still renders a card', () => {
    const svg = renderShareCardSvg({ ...DATA, consensus: null, history: [], resolvesOn: null });
    expect(svg).toContain('unpriced');
    expect(svg).toContain('stroke-dasharray');
    expect(renderShareCardPng({ ...DATA, consensus: null, history: [] }).length).toBeGreaterThan(1000);
  });
});
