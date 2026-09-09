/**
 * The data room's shape (docs/data-room.md, "One page, three parts").
 *
 * Thirteen sections in the order they happened to be written is not a
 * document; a reader arrives with a question and the page has to be ordered
 * by those questions. A `part:` directive names which of the three a section
 * belongs to, exactly as `block:` names its figures, so the ordering lives in
 * the prose beside the prose rather than in the page's code.
 */

import { DATA_ROOM_MARKDOWN, KNOWN_PARTS } from '../content/data-room';
import { parseDataRoomContent } from '../services/data-room';

describe('a section says which part it is in', () => {
  test('the directive is stripped from the prose it ships, like block:', () => {
    const [section] = parseDataRoomContent('## Overview\n\npart:numbers\n\nA sentence.\n\nblock:pulse\n');
    expect(section.markdown).toBe('A sentence.');
    expect(section.part).toBe('numbers');
    expect(section.blocks).toEqual(['pulse']);
  });

  test('an unknown part is refused at load, never rendered as a stray section', () => {
    expect(() => parseDataRoomContent('## Bad\n\npart:nonesuch\n\nprose\n')).toThrow(/unknown part "nonesuch"/);
  });

  test('a section with no directive belongs to no part rather than guessing one', () => {
    const [section] = parseDataRoomContent('## Loose\n\nprose\n');
    expect(section.part).toBeNull();
  });
});

describe('the page the prose actually describes', () => {
  const sections = parseDataRoomContent(DATA_ROOM_MARKDOWN);

  test('every section is in a named part', () => {
    const ids: string[] = KNOWN_PARTS.map(p => p.id);
    for (const s of sections) expect(ids).toContain(s.part);
  });

  test('the parts run in one order down the page, never interleaved', () => {
    const order: string[] = KNOWN_PARTS.map(p => p.id);
    const seen = sections.map(s => order.indexOf(s.part ?? ''));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  test('the numbers a forecaster prices come before the company that runs them', () => {
    const ids = sections.map(s => s.id);
    expect(ids.indexOf('the-numbers')).toBeGreaterThan(-1);
    expect(ids.indexOf('the-numbers')).toBeLessThan(ids.indexOf('who-is-here'));
    expect(ids.indexOf('the-numbers')).toBeLessThan(ids.indexOf('traffic'));
  });

  test('every part has at least one section, so the index never shows an empty heading', () => {
    for (const p of KNOWN_PARTS) expect(sections.some(s => s.part === p.id)).toBe(true);
  });

  test('the readings are their own section rather than a footnote inside the window', () => {
    const numbers = sections.find(s => s.id === 'the-numbers');
    expect(numbers?.blocks).toContain('rates');
    expect(sections.find(s => s.id === 'the-window')?.blocks).not.toContain('rates');
  });
});
