"""Print the vertical metrics and glyph heights that fonts.css is tuned against.

Run from anywhere, passing the fonts as paths (nothing is imported from beside them):

    uv run --with fonttools --with brotli python -I packages/ui/src/fonts/metrics.py \
        packages/ui/src/fonts/alegreya-roman-latin.woff2 'Hxo' \
        packages/ui/src/fonts/world/jp/noto-serif-jp-0-400-normal.woff2 '永'

Each font path may be followed by one argument of sample characters. For every font it prints units per em,
the hhea, OS/2 typo and win ascent/descent/line gap (as % of the em, which is what the CSS overrides take),
whether USE_TYPO_METRICS is set, the x-height and cap height, and the ink top and bottom of each sample
character as a fraction of the em.
"""

import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont


def pct(value, upm):
    return f"{value / upm * 100:.2f}%"


def describe(path, samples):
    font = TTFont(path)
    upm = font["head"].unitsPerEm
    hhea = font["hhea"]
    os2 = font["OS/2"]
    use_typo = bool(os2.fsSelection & (1 << 7))
    print(path)
    print(f"  unitsPerEm {upm}  USE_TYPO_METRICS {use_typo}")
    print(f"  hhea  ascent {pct(hhea.ascent, upm)} descent {pct(-hhea.descent, upm)} lineGap {pct(hhea.lineGap, upm)}")
    print(
        f"  typo  ascent {pct(os2.sTypoAscender, upm)} descent {pct(-os2.sTypoDescender, upm)}"
        f" lineGap {pct(os2.sTypoLineGap, upm)}"
    )
    print(f"  win   ascent {pct(os2.usWinAscent, upm)} descent {pct(os2.usWinDescent, upm)}")
    x_height = getattr(os2, "sxHeight", 0)
    cap_height = getattr(os2, "sCapHeight", 0)
    print(f"  xHeight {x_height / upm:.3f}em  capHeight {cap_height / upm:.3f}em")
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    for char in samples:
        name = cmap.get(ord(char))
        if name is None:
            print(f"  U+{ord(char):04X} {char}  (not in this file)")
            continue
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        if pen.bounds is None:
            print(f"  U+{ord(char):04X} {char}  (no ink)")
            continue
        _, y_min, _, y_max = pen.bounds
        print(f"  U+{ord(char):04X} {char}  top {y_max / upm:.3f}em  bottom {y_min / upm:.3f}em  height {(y_max - y_min) / upm:.3f}em")


def main(argv):
    index = 0
    while index < len(argv):
        path = argv[index]
        samples = ""
        if index + 1 < len(argv) and not argv[index + 1].endswith((".woff2", ".woff", ".ttf", ".otf")):
            samples = argv[index + 1]
            index += 1
        describe(path, samples)
        index += 1


if __name__ == "__main__":
    main(sys.argv[1:])
