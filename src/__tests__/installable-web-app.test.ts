import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * The installable web app, per docs/mobile.md.
 *
 * The manifest is not decoration. It is the whole of what turns telarchy.com
 * into an app on a home screen, and on iOS it is the precondition for push
 * existing at all: Safari delivers Web Push only to a site the visitor
 * installed, and installs only a site declaring display: standalone. A
 * manifest that is missing, unlinked, or naming an icon file that is not
 * there is a broken install prompt, which is invisible from a desktop tab and
 * so has to be caught here.
 *
 * These read the shipped files rather than a render, because the failure mode
 * is an asset that was renamed or never generated, and no render test covers
 * a file nobody wrote.
 */

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PUBLIC = join(ROOT, 'public');
const MANIFEST_PATH = join(PUBLIC, 'manifest.webmanifest');

/** The site's default surface (`--bg-primary`, bone), per docs/mobile.md. */
const BONE = '#fbf9f4';

function manifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

/**
 * A PNG's true pixel size, read from the IHDR chunk: bytes 16-19 are the
 * width and 20-23 the height, both big-endian. Declared sizes that disagree
 * with the file are the defect this catches, so the file has to be measured
 * rather than trusted.
 */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString('ascii'), `${path} is not a PNG`).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('the web app manifest', () => {
  test('is served from public/ and parses as JSON', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    expect(() => manifest()).not.toThrow();
  });

  test('index.html links it, or no browser ever reads it', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toMatch(/<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/);
  });

  test('declares standalone display, without which iOS will not install it', () => {
    expect(manifest().display).toBe('standalone');
  });

  test('opens where the site opens', () => {
    expect(manifest().start_url).toBe('/');
  });

  test('is named Telarchy under the icon', () => {
    expect(manifest().name).toBe('Telarchy');
    expect(manifest().short_name).toBe('Telarchy');
  });

  test('carries the page colour into the system chrome and launch screen', () => {
    expect(manifest().theme_color).toBe(BONE);
    expect(manifest().background_color).toBe(BONE);
  });
});

describe('the manifest icons', () => {
  interface Icon {
    src: string;
    sizes: string;
    type?: string;
    purpose?: string;
  }
  const icons = (): Icon[] => manifest().icons as Icon[];

  test('offers both sizes the platforms ask for', () => {
    expect(
      icons()
        .map(i => i.sizes)
        .sort(),
    ).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  test('offers a maskable 512 so Android may crop to the launcher shape', () => {
    const maskable = icons().filter(i => (i.purpose ?? '').split(/\s+/).includes('maskable'));
    expect(maskable.length).toBeGreaterThan(0);
    expect(maskable.some(i => i.sizes === '512x512')).toBe(true);
  });

  test('keeps a plain any-purpose icon as well as the maskable one', () => {
    // A maskable icon used as the only icon is drawn with its safe-area
    // padding on platforms that do not crop, which reads as a shrunken mark.
    const any = icons().filter(i => !(i.purpose ?? 'any').split(/\s+/).includes('maskable'));
    expect(any.length).toBeGreaterThan(0);
  });

  test('every file it names exists', () => {
    const missing = icons()
      .map(i => i.src)
      .filter(src => !existsSync(join(PUBLIC, src.replace(/^\//, ''))));
    expect(missing).toEqual([]);
  });

  test('every file is really the size it is declared to be', () => {
    const wrong: string[] = [];
    for (const icon of icons()) {
      const path = join(PUBLIC, icon.src.replace(/^\//, ''));
      if (!existsSync(path)) continue;
      const [w, h] = icon.sizes.split('x').map(Number);
      const actual = pngSize(path);
      if (actual.width !== w || actual.height !== h) {
        wrong.push(`${icon.src}: declared ${icon.sizes}, is ${actual.width}x${actual.height}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test('every icon is square, since every platform crops to a square or a circle', () => {
    const oblong = icons()
      .map(i => i.sizes)
      .filter(s => {
        const [w, h] = s.split('x').map(Number);
        return w !== h;
      });
    expect(oblong).toEqual([]);
  });
});

describe('the iOS home screen icon', () => {
  /**
   * iOS ignores the manifest icons for the home screen and reads
   * apple-touch-icon. Pointing it at the full-size logo works but ships a
   * 1024 square to every visitor for a 180 slot, so the tag names a real
   * 180 asset and this checks the asset is the size the slot wants.
   */
  test('index.html points apple-touch-icon at a real 180 square', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const match = html.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/);
    expect(match, 'no apple-touch-icon link').not.toBeNull();
    const path = join(PUBLIC, (match as RegExpMatchArray)[1].replace(/^\//, ''));
    expect(existsSync(path)).toBe(true);
    expect(pngSize(path)).toEqual({ width: 180, height: 180 });
  });
});

describe('the installed app can receive push', () => {
  test('the service worker sits at the root, so its scope covers start_url', () => {
    // A worker served from a subdirectory controls only that subdirectory;
    // an installed app opening at / would then have no push receiver.
    expect(existsSync(join(PUBLIC, 'sw.js'))).toBe(true);
  });
});
