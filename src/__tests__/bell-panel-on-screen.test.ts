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
 * (owner report 2026-09-13). jsdom has no layout, so this reads the
 * stylesheet: on a phone the panel must belong to the viewport, not the bell.
 */

const CSS = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'style.css'), 'utf8');

/** Every `.notif-panel { ... }` body inside a `@media (max-width: 640px)` block. */
function phonePanelRules(): string {
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
    for (const r of block.matchAll(/(^|[\s,}])\.notif-panel\s*\{([^}]*)\}/g)) out.push(r[2]);
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
  test('on a phone the panel is fixed to the viewport, not hung from the bell', () => {
    expect(phonePanelRules()).toMatch(/position:\s*fixed/);
  });

  test('on a phone the panel keeps 1rem from both screen edges', () => {
    const body = phonePanelRules();
    expect(body).toMatch(/left:\s*1rem/);
    expect(body).toMatch(/right:\s*1rem/);
    expect(body).toMatch(/width:\s*auto/);
  });

  test('on a phone the panel is no taller than the screen below the bar', () => {
    expect(phonePanelRules()).toMatch(/max-height:[^;]*(dvh|vh)/);
  });

  test('on a wide screen the panel still drops from the bell', () => {
    const body = rule('notif-panel');
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/right:\s*0/);
  });
});
