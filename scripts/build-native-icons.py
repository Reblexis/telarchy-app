#!/usr/bin/env python3
"""
Dress the store shells in Telarchy's mark (docs/mobile.md).

`npx cap add android` scaffolds the project with Capacitor's own logo and
splash. This regenerates every one of those assets from public/logo.png, the
same 1024 square the web app installs with, so the icon on a phone home screen
is the icon everywhere else.

Run after any `cap add` or Capacitor upgrade, which restore the template
assets:  /usr/bin/python3 scripts/build-native-icons.py
(src/__tests__/native-shell-icons.test.ts fails if you forget.)
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android/app/src/main/res"
IOS = ROOT / "ios/App/App/Assets.xcassets"
SOURCE = ROOT / "public/logo.png"

# The mark's own ground, sampled from the source square.
NAVY = (1, 2, 17)

# icon size, adaptive-foreground size
LAUNCHER = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

# Capacitor's splash densities, portrait and landscape, kept at the sizes the
# template shipped so no layout qualifier is left without an asset.
SPLASH = {
    "drawable": (480, 320),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
}

source = Image.open(SOURCE).convert("RGB")


def square(size: int) -> Image.Image:
    return source.resize((size, size), Image.LANCZOS)


def round_icon(size: int) -> Image.Image:
    """The legacy round icon is used as-is, so it is masked here."""
    icon = square(size).convert("RGBA")
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    icon.putalpha(mask.resize((size, size), Image.LANCZOS))
    return icon


def adaptive_foreground(size: int) -> Image.Image:
    """
    An adaptive icon is 108dp of which only the centre 72dp is guaranteed
    visible, so the mark occupies the middle and the rest is transparent. A
    filled square here would let the launcher's mask crop the mark itself.
    """
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * 0.52)
    mark = source.resize((inner, inner), Image.LANCZOS).convert("RGBA")
    # Drop the source's own ground; the adaptive background colour supplies it.
    pixels = mark.load()
    for x in range(inner):
        for y in range(inner):
            r, g, b, _ = pixels[x, y]
            if abs(r - NAVY[0]) < 12 and abs(g - NAVY[1]) < 12 and abs(b - NAVY[2]) < 12:
                pixels[x, y] = (r, g, b, 0)
    canvas.paste(mark, ((size - inner) // 2, (size - inner) // 2), mark)
    return canvas


def splash(width: int, height: int) -> Image.Image:
    canvas = Image.new("RGB", (width, height), NAVY)
    mark = int(min(width, height) * 0.34)
    inner = square(mark)
    canvas.paste(inner, ((width - mark) // 2, (height - mark) // 2))
    return canvas


written = 0
for density, (icon_size, fg_size) in LAUNCHER.items():
    out = RES / f"mipmap-{density}"
    square(icon_size).save(out / "ic_launcher.png", optimize=True)
    round_icon(icon_size).save(out / "ic_launcher_round.png", optimize=True)
    adaptive_foreground(fg_size).save(out / "ic_launcher_foreground.png", optimize=True)
    written += 3

for folder, (w, h) in SPLASH.items():
    splash(w, h).save(RES / folder / "splash.png", optimize=True)
    written += 1

# The adaptive icon's background is a flat colour behind the cut-out mark.
(RES / "values" / "ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<resources>\n"
    '    <color name="ic_launcher_background">#010211</color>\n'
    "</resources>\n"
)

# iOS keeps one 1024 app icon and one square splash, scaled by the OS. The
# icon must be OPAQUE: an alpha channel is rejected at upload, after the build
# and the signing and the wait.
if IOS.exists():
    square(1024).save(IOS / "AppIcon.appiconset/AppIcon-512@2x.png", optimize=True)
    written += 1
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        splash(2732, 2732).save(IOS / "Splash.imageset" / name, optimize=True)
        written += 1

print(f"wrote {written} native assets from {SOURCE.relative_to(ROOT)}")
