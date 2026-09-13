import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * The bell's panel is always wholly on screen (docs/ui-conventions.md,
 * "The bell").
 *
 * On a 390px phone the bell sits mid-bar with other controls to its right.
 * A panel hung from its right edge and sized to the viewport ran 185px off
 * the left of the screen, so notifications showed up clipped on mobile
 * (owner report 2026-09-13). A first fix pinned it to the viewport at a top
 * measured on open, and on the preview the page moved after the measurement
 * so the panel covered the bar. So on a phone the panel hangs from the bar
 * (the sticky, positioned ancestor) and needs no measuring. jsdom has no
 * layout, so this reads the stylesheet.
 */

const CSS = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'style.css'), 'utf8');

/** Every `.<cls> { ... }` body inside a `@media (max-width: 640px)` block. */
function phoneRules(cls: string): string {
  const out: string[] = [];
  const re = /@media \(max-width: 640px\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS))) {
    let depth = 1;
    let i = re.lastIndex;
    while (depth > 0 && i < CSS.length) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') depth--;
      i++;
    }
    const block = CSS.slice(re.lastIndex, i - 1);
    for (const r of block.matchAll(new RegExp(`(^|[\\s,}])\\.${cls}\\s*\\{([^}]*)\\}`, 'g'))) out.push(r[2]);
  }
  return out.join('\n');
}

/** The first plain rule for a class, outside any media block. */
function rule(cls: string): string {
  const m = CSS.match(new RegExp(`(^|\\n)\\.${cls}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for .${cls}`);
  return m[2];
}

describe('notifications show up whole on a phone, not clipped', () => {
  test('on a phone the bell stops being the panel\'s anchor, so the bar is', () => {
    expect(phoneRules('notif')).toMatch(/position:\s*static/);
  });

  test('the bar is a positioned box on a phone, so the panel can hang from it', () => {
    expect(phoneRules('pubws-topbar')).toMatch(/position:\s*sticky/);
  });

  test('on a phone the panel opens directly under the bar and never covers it', () => {
    const body = phoneRules('notif-panel');
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/top:\s*100%/);
    expect(body).not.toMatch(/position:\s*fixed/);
  });

  test('on a phone the panel keeps 1rem from both screen edges', () => {
    const body = phoneRules('notif-panel');
    expect(body).toMatch(/left:\s*1rem/);
    expect(body).toMatch(/right:\s*1rem/);
    expect(body).toMatch(/width:\s*auto/);
  });

  test('on a phone the panel leaves the screen below it', () => {
    expect(phoneRules('notif-panel')).toMatch(/max-height:[^;]*(dvh|vh)/);
  });

  test('on a wide screen the panel still drops from the bell', () => {
    const body = rule('notif-panel');
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/right:\s*0/);
  });
});
