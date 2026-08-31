import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * The Android shell wears Telarchy's mark (docs/mobile.md).
 *
 * `npx cap add android` scaffolds the project with Capacitor's own logo as the
 * launcher icon and its own splash screen. Shipping those to a store is the
 * single most visible way a shell betrays that it is a wrapper, and it is easy
 * to miss: the icon is correct everywhere else in the product, and nobody
 * looking at the site sees it.
 *
 * The failure this exists to catch is a REGENERATION. Re-running `cap add`, or
 * a Capacitor upgrade that refreshes the template, silently restores the stock
 * assets, so each one is pinned against the exact stock bytes rather than
 * merely checked for existence.
 */

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const IOS_ASSETS = join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets');

/** Capacitor's template assets, as scaffolded. Ours must never equal these. */
const STOCK_ASSETS: Record<string, string> = {
  'drawable-land-hdpi/splash.png': '08cc34ad7713fe7ed58bceaa37b2387b670c53cd60264b4bd6442db3098e75dc',
  'drawable-land-mdpi/splash.png': '5cf98b4451bd99b20df26f9e608a46946118be6b0ae90762f9ca1786a30c76ff',
  'drawable-land-xhdpi/splash.png': '22f87e1e3bc89aa01a7dbc39c9a4db058cd0bf4ad3fe9f55712bf69eb997f4bf',
  'drawable-land-xxhdpi/splash.png': '42aa26392546fcdee1b8d3ac6d4b41bfcceb41dc6a4f3a3c30c24a8a8f4db862',
  'drawable-land-xxxhdpi/splash.png': '60393ce8636fd263e4e1fea3fd4ab2de948c6295e898fda9b50ac4e5283be809',
  'drawable-port-hdpi/splash.png': 'c5015f4ba3628392b538386c5e210f0b94f352a3160adab934fd0311972137ca',
  'drawable-port-mdpi/splash.png': '07fa579e1c83e04ba7f9cbcbfcf41b68e15fe3638f2c44a04e58b809103e6b69',
  'drawable-port-xhdpi/splash.png': 'b73049cb37fe76d6c11b87a796766bf6af0c85483b31eb6a921657b0d764a4b9',
  'drawable-port-xxhdpi/splash.png': '0c7f1212f25b7b90e9a6e1d320013e4ff3d3e03e634cbb07b7b7981cac51627f',
  'drawable-port-xxxhdpi/splash.png': '3db071a03b2f8ffe0dfd4170fc59842d53cd15bba5e88af59401d58efabf7827',
  'drawable/splash.png': '5cf98b4451bd99b20df26f9e608a46946118be6b0ae90762f9ca1786a30c76ff',
  'mipmap-hdpi/ic_launcher_foreground.png': '32baa10d2632a4417454a579f992bd640e0a3cec79321423559b2c9940de58a9',
  'mipmap-hdpi/ic_launcher.png': '72b71c3581ca3b5a23b1c168d69b9d855b3f184fa079902a01f088eb4f0607d5',
  'mipmap-hdpi/ic_launcher_round.png': 'bfcc1b0fa931b14bb241372c76ab4f04374b67d02363c98d9cb12edfdacdf5f3',
  'mipmap-mdpi/ic_launcher_foreground.png': '58e78a618778926b1f6d9472a6468de878de8530970934e94aab5ba4ba08cc00',
  'mipmap-mdpi/ic_launcher.png': '27ed3603010ebc278f64f8645741ab132ff517abb5308eb9df6c8e42a48956b2',
  'mipmap-mdpi/ic_launcher_round.png': '0166fc333074c373fbd0ce6b5defd71552166165ac778121ca9c9dff6b83f0fc',
  'mipmap-xhdpi/ic_launcher_foreground.png': '6f88083b8166cc559102f7044688de7525287632ebe09ac45d001ac8bf4b3eae',
  'mipmap-xhdpi/ic_launcher.png': 'd35dbfff175b83c13ef59cf924abfc810f7b6a158595d7417c5498ea8c7c7ed1',
  'mipmap-xhdpi/ic_launcher_round.png': '40911a00922868686854a4804b93fd6e56b503664696de03f450bff690affb6d',
  'mipmap-xxhdpi/ic_launcher_foreground.png': '4a82bc1e9923576275869998925ce0ae021a79aa18b24a0dd87ad6b61ca85053',
  'mipmap-xxhdpi/ic_launcher.png': 'ed346eb1e3f0280f15709393705899b3ff55c20b88f4e0308006b3c33cf5fe14',
  'mipmap-xxhdpi/ic_launcher_round.png': '1ee4cd9ff371dcb2e3938097e434f6fb8731688ed7165e61fc63693ad5b2f455',
  'mipmap-xxxhdpi/ic_launcher_foreground.png': 'bd24fd383253bf8d43f0a81f11c071d76d1d555114376dd647cd9fb38fa0a9da',
  'mipmap-xxxhdpi/ic_launcher.png': '87cb2f2ffe992652bb4fa768c73719a37b5852ab17fbf8e170e888f7a42b0761',
  'mipmap-xxxhdpi/ic_launcher_round.png': 'ab93096331e7cd8ec379f73f1e9adcaaa9ee1115c9f4ff10411a811fb9700174',
};

/** What Android expects at each density (adaptive foregrounds are 2.25x). */
const LAUNCHER_SIZES: Record<string, { icon: number; foreground: number }> = {
  'mipmap-mdpi': { icon: 48, foreground: 108 },
  'mipmap-hdpi': { icon: 72, foreground: 162 },
  'mipmap-xhdpi': { icon: 96, foreground: 216 },
  'mipmap-xxhdpi': { icon: 144, foreground: 324 },
  'mipmap-xxxhdpi': { icon: 192, foreground: 432 },
};

function sha256(rel: string): string {
  return createHash('sha256')
    .update(readFileSync(join(RES, rel)))
    .digest('hex');
}

function pngSize(rel: string): { width: number; height: number } {
  const buf = readFileSync(join(RES, rel));
  expect(buf.subarray(1, 4).toString('ascii'), `${rel} is not a PNG`).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** PNG colour type 6 is RGBA: the adaptive foreground must have one. */
function hasAlpha(rel: string): boolean {
  const buf = readFileSync(join(RES, rel));
  return buf.readUInt8(25) === 6 || buf.readUInt8(25) === 4;
}

describe('no Capacitor template asset survives', () => {
  test.each(Object.keys(STOCK_ASSETS))('%s is ours, not the scaffold', rel => {
    expect(sha256(rel)).not.toBe(STOCK_ASSETS[rel]);
  });
});

describe('the launcher icon', () => {
  test.each(Object.entries(LAUNCHER_SIZES))('%s is the size Android asks for', (density, sizes) => {
    expect(pngSize(`${density}/ic_launcher.png`)).toEqual({ width: sizes.icon, height: sizes.icon });
    expect(pngSize(`${density}/ic_launcher_round.png`)).toEqual({ width: sizes.icon, height: sizes.icon });
    expect(pngSize(`${density}/ic_launcher_foreground.png`)).toEqual({
      width: sizes.foreground,
      height: sizes.foreground,
    });
  });

  test.each(Object.keys(LAUNCHER_SIZES))('%s adaptive foreground is cut out, not a filled square', density => {
    // A foreground with no alpha fills the whole 108dp canvas, and the
    // launcher's mask then crops the mark itself instead of the padding.
    expect(hasAlpha(`${density}/ic_launcher_foreground.png`)).toBe(true);
  });

  test('the adaptive background is the mark own ground, not the template white', () => {
    const xml = readFileSync(join(RES, 'values', 'ic_launcher_background.xml'), 'utf8');
    expect(xml).not.toMatch(/#FFFFFF/i);
    expect(xml).toMatch(/#010211/i);
  });

  test('the adaptive icon still points at the foreground and background we ship', () => {
    const xml = readFileSync(join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf8');
    expect(xml).toContain('@color/ic_launcher_background');
    expect(xml).toContain('@mipmap/ic_launcher_foreground');
  });
});

/** The iOS catalogue's template assets. */
const IOS_STOCK: Record<string, string> = {
  'AppIcon.appiconset/AppIcon-512@2x.png': '29e4777e319de3ee5a52c3a8004ec19d0568414004257e36d7c94a077d71c93b',
  'Splash.imageset/splash-2732x2732.png': '1b5002b74a5500e697298ced06ca2811ac33f2771f236f3c720ff23243890530',
  'Splash.imageset/splash-2732x2732-1.png': '1b5002b74a5500e697298ced06ca2811ac33f2771f236f3c720ff23243890530',
  'Splash.imageset/splash-2732x2732-2.png': '1b5002b74a5500e697298ced06ca2811ac33f2771f236f3c720ff23243890530',
};

describe('the iOS shell wears the mark too', () => {
  test.each(Object.keys(IOS_STOCK))('%s is ours, not the scaffold', rel => {
    const hash = createHash('sha256')
      .update(readFileSync(join(IOS_ASSETS, rel)))
      .digest('hex');
    expect(hash).not.toBe(IOS_STOCK[rel]);
  });

  test('the app icon is opaque, which the App Store requires', () => {
    // An icon with an alpha channel is rejected at upload, and the rejection
    // arrives after the build, the signing and the wait.
    const buf = readFileSync(join(IOS_ASSETS, 'AppIcon.appiconset', 'AppIcon-512@2x.png'));
    const colourType = buf.readUInt8(25);
    expect(colourType === 4 || colourType === 6, 'the app icon has an alpha channel').toBe(false);
    expect({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }).toEqual({ width: 1024, height: 1024 });
  });
});
