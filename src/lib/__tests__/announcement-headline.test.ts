import { describe, expect, test } from 'vitest';
import { announcementHeadline } from '../announcement-headline';

/**
 * The floor prints one line of an announcement and links to the rest, so this
 * function decides what a visitor sees. The cases that matter are the ones
 * where the owner did not write a tidy first line.
 */
describe('announcementHeadline', () => {
  test('a short first line is the headline, whole', () => {
    expect(announcementHeadline('Season 0 starts Friday 00:00 UTC.')).toBe('Season 0 starts Friday 00:00 UTC.');
  });

  test('a long opening paragraph is cut to its first sentence', () => {
    // The real one, published 2026-08-19.
    const body =
      'Season 0 starts Friday 00:00 UTC. It runs to 16 October, the pool is $1,000 of real money paid $500 / $250 / $125 / $75 / $50 to the top five.\n\nEntry is one click.';
    expect(announcementHeadline(body)).toBe('Season 0 starts Friday 00:00 UTC.');
  });

  test('markdown furniture never reaches the floor', () => {
    expect(announcementHeadline('## **Season 0** is [live](https://telarchy.com/season)')).toBe('Season 0 is live');
  });

  test('a first sentence with no end still gets cut on a word boundary', () => {
    const body =
      'We are moving the September market to a new range because the old one capped at a number the metric has already passed twice this month';
    const head = announcementHeadline(body);
    expect(head.length).toBeLessThanOrEqual(91);
    expect(head.endsWith('…')).toBe(true);
    expect(head).not.toContain('  ');
    // Cut between words, not through one.
    expect(body.startsWith(head.slice(0, -1))).toBe(true);
  });

  test('leading blank lines are skipped, not printed', () => {
    expect(announcementHeadline('\n\n   \nThe market is voided.')).toBe('The market is voided.');
  });

  test('an empty body gives an empty headline rather than throwing', () => {
    expect(announcementHeadline('')).toBe('');
  });
});
