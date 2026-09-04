/**
 * inline-data.ts: the server puts a page's first payload into the HTML it
 * serves (docs/ui-conventions.md, "While a page loads"), as
 * <script id="..." type="application/json">. The client reads it once on
 * mount and drops it, so a client-side return to the page fetches instead
 * of painting a stale copy.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { dropInline, readInline } from '../inline-data';

// Inserted as markup, the way the server plants it: jsdom would try to RUN a
// script element created through the DOM, JSON or not.
function plant(id: string, body: string, type = 'application/json') {
  document.head.insertAdjacentHTML(
    'beforeend',
    `<script id="${id}" type="${type}">${body.replace(/<\//g, '<\\/')}</script>`,
  );
  return document.getElementById(id) as HTMLScriptElement;
}

afterEach(() => {
  document.head.innerHTML = '';
});

describe('readInline', () => {
  test('parses the JSON the server planted', () => {
    plant('telarchy-home', JSON.stringify({ at: new Date().toISOString(), listings: [{ name: 'LookPilot' }] }));
    expect(readInline<{ listings: { name: string }[] }>('telarchy-home')?.listings[0].name).toBe('LookPilot');
  });

  test('is null when nothing was planted', () => {
    expect(readInline('telarchy-home')).toBeNull();
  });

  test('is null, never a throw, on a broken body', () => {
    plant('telarchy-home', '{not json');
    expect(readInline('telarchy-home')).toBeNull();
  });

  test('ignores an element of the same id that is not a JSON script', () => {
    plant('telarchy-home', '{"a":1}', 'text/javascript');
    expect(readInline('telarchy-home')).toBeNull();
  });

  test('unescapes what the server escaped so the payload could not close the element', () => {
    plant('telarchy-home', '{"desc":"<\\/script><script>alert(1)<\\/script>"}');
    expect(readInline<{ desc: string }>('telarchy-home')?.desc).toBe('</script><script>alert(1)</script>');
  });

  test('a payload older than five minutes is stale (a tab restored from the cache) and reads as null', () => {
    plant('telarchy-home', JSON.stringify({ at: new Date(Date.now() - 6 * 60_000).toISOString(), listings: [] }));
    expect(readInline('telarchy-home')).toBeNull();
  });
});

describe('dropInline', () => {
  test('removes the element so a later mount fetches instead', () => {
    plant('telarchy-home', '{"listings":[]}');
    dropInline('telarchy-home');
    expect(document.getElementById('telarchy-home')).toBeNull();
    expect(readInline('telarchy-home')).toBeNull();
  });

  test('is a no-op when there is nothing to drop', () => {
    expect(() => dropInline('telarchy-home')).not.toThrow();
  });
});
