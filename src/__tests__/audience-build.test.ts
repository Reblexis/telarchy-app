import { describe, expect, test } from 'vitest';
// The build is a script, not a module of the app; the test reaches for it
// directly so the directive grammar it accepts is pinned here rather than
// only in the generated output.
import { parsePage } from '../../scripts/build-audience-pages.mjs';

/**
 * The three directives /owners uses beyond VIZ (docs/audience-pages.md,
 * "/owners is laid out as a board"): CATCH is the objection answered beside
 * the button, LIVE names a strip of live figures, SHOW names a product
 * moment rendered live. Like VIZ, a name the renderer does not know fails
 * the build rather than shipping a hole.
 */

const page = (body: string) =>
  parsePage(
    '## /x (test)',
    [
      'Title: A title long enough to count as one',
      'Description: A description long enough to satisfy the length rule the pages are held to, sixty plus.',
      '',
      '# The heading',
      '',
      body,
      '',
      '### FAQ',
      '',
      'Q: Why?',
      'A: Because.',
      '',
    ].join('\n'),
  );

describe('the audience build reads the board directives', () => {
  test('CATCH: <text> becomes a catch block carrying the text', () => {
    const p = page('CATCH: Free today, up to three workspaces.');
    expect(p.blocks).toContainEqual({ kind: 'catch', text: 'Free today, up to three workspaces.' });
    // And it is not also a paragraph.
    expect(p.blocks.filter(b => b.kind === 'p')).toHaveLength(0);
  });

  test('LIVE: marketplace-stats becomes a live block named marketplace-stats', () => {
    const p = page('LIVE: marketplace-stats');
    expect(p.blocks).toContainEqual({ kind: 'live', name: 'marketplace-stats' });
  });

  test('SHOW: proposals becomes a show block named proposals', () => {
    const p = page('SHOW: proposals');
    expect(p.blocks).toContainEqual({ kind: 'show', name: 'proposals' });
  });

  test('AN UNKNOWN LIVE NAME FAILS THE BUILD', () => {
    expect(() => page('LIVE: weather')).toThrow(/unknown LIVE "weather"/);
  });

  test('AN UNKNOWN SHOW NAME FAILS THE BUILD', () => {
    expect(() => page('SHOW: kittens')).toThrow(/unknown SHOW "kittens"/);
  });

  test('a directive line ends the paragraph before it, like VIZ does', () => {
    const p = page(['Some words.', 'CATCH: The catch.', 'LIVE: marketplace-stats', 'More words.'].join('\n'));
    expect(p.blocks.map(b => b.kind)).toEqual(['p', 'catch', 'live', 'p', 'h2', 'faq']);
    expect((p.blocks[0] as { text: string }).text).toBe('Some words.');
    expect((p.blocks[3] as { text: string }).text).toBe('More words.');
  });

  test('a bold lead in a table cell or a bullet is kept beside the plain text, so the board can set it in the display face', () => {
    const p = page(
      [
        '| The meeting | The floor |',
        '|---|---|',
        '| **Whoever argued best wins.** The number moves later. | **A number before the yes.** You read the gap. |',
        '',
        '- **The veto.** The market prices; you approve.',
        '- No lead here.',
      ].join('\n'),
    );
    const table = p.blocks.find(b => b.kind === 'table') as {
      head: string[];
      rows: string[][];
      leads?: (string | null)[][];
    };
    expect(table.head).toEqual(['The meeting', 'The floor']);
    expect(table.rows).toEqual([
      ['Whoever argued best wins. The number moves later.', 'A number before the yes. You read the gap.'],
    ]);
    expect(table.leads).toEqual([['Whoever argued best wins.', 'A number before the yes.']]);
    const ul = p.blocks.find(b => b.kind === 'ul') as { items: string[]; leads?: (string | null)[] };
    expect(ul.items).toEqual(['The veto. The market prices; you approve.', 'No lead here.']);
    expect(ul.leads).toEqual(['The veto.', null]);
  });

  test('a table or list without a bold lead carries no leads field, so the other pages are untouched', () => {
    const p = page(['| A | B |', '|---|---|', '| one | two |', '', '- plain', '- plainer'].join('\n'));
    expect(p.blocks.find(b => b.kind === 'table')).not.toHaveProperty('leads');
    expect(p.blocks.find(b => b.kind === 'ul')).not.toHaveProperty('leads');
  });
});
