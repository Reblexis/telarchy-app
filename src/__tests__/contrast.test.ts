import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * Text tokens stay readable in both themes.
 *
 * A design audit of the live site (2026-08-30) found the tertiary token, which
 * carries every small caps eyebrow and table label, below WCAG AA for normal
 * text: 3.2:1 on the light bone and 4.1:1 on the dark surface. Pale small text
 * is the easiest regression to reintroduce and the hardest to notice, so the
 * floor is a test rather than a habit. Hairline borders are deliberately not
 * covered: they are structure, and docs/ui-conventions.md says why.
 */

const CSS = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'style.css'), 'utf8');

function block(header: string): Record<string, string> {
  const start = CSS.indexOf(header);
  if (start === -1) throw new Error(`no such block: ${header}`);
  const body = CSS.slice(start, CSS.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) tokens[name] = value;
  return tokens;
}

function luminance(hex: string): number {
  const parts = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = parts.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

describe('text contrast', () => {
  const light = block(':root {');
  const dark = block('[data-theme="dark"] {');
  const auto = block(':root:not([data-theme="light"]) {');

  test.each([
    ['light', light],
    ['dark (explicit)', dark],
    ['dark (system)', auto],
  ])('%s: every text token clears AA on every background token', (_name, tokens) => {
    const texts = ['--text-primary', '--text-secondary', '--text-tertiary'];
    const grounds = ['--bg-primary', '--bg-secondary'];
    for (const t of texts) {
      expect(tokens[t]).toMatch(/^#[0-9a-fA-F]{6}$/);
      for (const g of grounds) {
        expect(ratio(tokens[t], tokens[g])).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  test('the two dark blocks agree, so the toggle and the OS render the same page', () => {
    for (const token of ['--text-primary', '--text-secondary', '--text-tertiary', '--bg-primary']) {
      expect(dark[token]).toBe(auto[token]);
    }
  });
});
