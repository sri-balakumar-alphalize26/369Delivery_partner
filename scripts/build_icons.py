# -*- coding: utf-8 -*-
"""
Generates the 369 Delivery Partner app icon set from the supplied brand artwork.

Run:  py scripts/build_icons.py

Why this exists
---------------
The source artwork is a full illustration (wordmark + tagline + rider + skyline).
At 48dp that is an unreadable smudge, and Android's adaptive-icon mask only
guarantees the centre ~66% survives. So the icon is built from the "369" + swoosh
region ONLY, auto-trimmed and re-centred inside the safe zone.
"""

import os
import shutil

from PIL import Image

SRC = r"C:\Users\sriba\Downloads\369 Delivery Partner.png"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "images")

# The app icon uses the FULL brand illustration (user's decision).
# Set to "mark" to fall back to just the "369" + swoosh, which is far more
# legible at 48dp — see the note in README.md.
ICON_SOURCE = "full"

# region of the source holding the "369" wordmark + orange swoosh (no tagline, no rider)
MARK_BOX = (185, 60, 1075, 545)

WHITE = (255, 255, 255)


def trim(im, bg=WHITE, tol=18):
    """Crop away near-uniform background so the mark is measured, not the padding."""
    px = im.convert("RGB").load()
    w, h = im.size
    x0, y0, x1, y1 = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if abs(r - bg[0]) > tol or abs(g - bg[1]) > tol or abs(b - bg[2]) > tol:
                if x < x0: x0 = x
                if y < y0: y0 = y
                if x > x1: x1 = x
                if y > y1: y1 = y
    if x1 <= x0 or y1 <= y0:
        return im
    return im.crop((x0, y0, x1 + 1, y1 + 1))


def safe_coverage(mark, mask_fraction=0.666, margin=0.94):
    """
    Largest coverage a mark of this aspect ratio can use and still fit entirely
    inside Android's circular adaptive-icon mask.

    The visible mask is a circle of diameter `mask_fraction` of the canvas. The
    biggest w:h rectangle inscribed in a circle of diameter D has
    width = D * a / sqrt(1 + a^2) where a = w/h. `margin` keeps a little air.
    """
    w, h = mark.size
    a = max(w, h) / min(w, h)
    return mask_fraction * (a / (1 + a ** 2) ** 0.5) * margin


def preview_mask(path, out_path):
    """Render what the circular mask actually shows, so clipping is visible."""
    from PIL import ImageDraw
    im = Image.open(path).convert("RGB")
    size = im.size[0]
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    inset = size * (1 - 0.666) / 2
    d.ellipse([inset, inset, size - inset, size - inset], fill=255)
    out = Image.new("RGB", (size, size), (228, 228, 234))
    out.paste(im, (0, 0), mask)
    out.save(out_path)


def flatten_white(im, tol=12):
    """Snap near-white pixels to pure white so the crop leaves no visible seam."""
    im = im.convert("RGB")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r >= 255 - tol and g >= 255 - tol and b >= 255 - tol:
                px[x, y] = (255, 255, 255)
    return im


def canvas(mark, size=1024, coverage=0.78, bg=WHITE):
    """Scale `mark` to `coverage` of `size` (longest edge) and centre it on a square."""
    target = int(size * coverage)
    w, h = mark.size
    scale = target / max(w, h)
    new = mark.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

    out = Image.new("RGBA", (size, size), bg + (255,))
    out.paste(new, ((size - new.size[0]) // 2, (size - new.size[1]) // 2),
              new if new.mode == "RGBA" else None)
    return out


def main():
    if not os.path.exists(SRC):
        raise SystemExit(f"source artwork not found: {SRC}")
    os.makedirs(OUT, exist_ok=True)

    src = Image.open(SRC).convert("RGBA")
    print(f"source        {src.size[0]}x{src.size[1]}")

    source = src if ICON_SOURCE == "full" else src.crop(MARK_BOX)
    mark = flatten_white(trim(source))
    print(f"icon source   {ICON_SOURCE}  ->  {mark.size[0]}x{mark.size[1]}")

    # iOS / general icon — rounded-rect mask only, so the art can nearly fill it
    canvas(mark, 1024, 0.96).convert("RGB").save(os.path.join(OUT, "icon.png"))

    # Android adaptive foreground. The mask is a CIRCLE, so the art is scaled to
    # the largest rectangle of this aspect that fits inside it — the whole
    # illustration survives instead of having its edges cropped away.
    cov = safe_coverage(mark)
    print(f"adaptive cov  {cov:.3f} of canvas (circle-safe for this aspect)")
    canvas(mark, 1024, cov).convert("RGB").save(
        os.path.join(OUT, "android-icon-foreground.png"))

    # splash — the full illustration, room to breathe
    canvas(mark, 1024, 0.88).convert("RGB").save(os.path.join(OUT, "splash-icon.png"))

    # full artwork, untouched, for the login screen
    shutil.copyfile(SRC, os.path.join(OUT, "brand-full.png"))

    # web favicon
    canvas(mark, 96, 0.94).convert("RGB").save(os.path.join(OUT, "favicon.png"))

    dbg = os.environ.get("ICON_PREVIEW_DIR")
    if dbg:
        preview_mask(os.path.join(OUT, "android-icon-foreground.png"),
                     os.path.join(dbg, "mask_preview.png"))

    for f in ("icon.png", "android-icon-foreground.png", "splash-icon.png",
              "brand-full.png", "favicon.png"):
        p = os.path.join(OUT, f)
        print(f"  wrote {f:32s} {os.path.getsize(p):>9,} bytes")


if __name__ == "__main__":
    main()
