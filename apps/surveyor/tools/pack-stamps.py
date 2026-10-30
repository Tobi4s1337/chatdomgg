"""Packs the Atlas stamp atlas from K. M. Alexander's #NoBadMaps PNG packs (CC0 1.0).

    uv run --with pillow python -I apps/surveyor/tools/pack-stamps.py <source-dir> [--out <dir>] [--preview <png>]

<source-dir> holds the unpacked PNG packs (one folder per pack, as distributed). Outputs go to --out (default
apps/web/src/atlas/assets): stamps.webp and stamps.json. --preview writes a contact sheet (keep it outside the repo).

Every stamp is packed as two frames of the same size:
  ink   RGB = sepia ink #3b2f25, alpha = the stamp's line alpha (lightly boldened for fine engravings so the line
        survives the downscale, and lifted for pale ones so the whole set shares one ink weight).
  fill  RGB = white, alpha = a solid silhouette of the stamp's body, eroded ~1 px and softened. A renderer tints it
        to the land colour and draws it under the ink so overlapping stamps occlude like a hand-inked map.
anchor is the stamp's ground point as a fraction of the frame: the bottom centre of a landform's base, the centre
of a settlement's footprint, the waterline of a ship or monster, the centre of a compass rose.

Frames are stored at about 2x their largest on-screen size (see TARGET), so 1 frame px ~ 0.5 CSS px at full size.
"""
import argparse
import json
import os
import re
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

INK_RGB = (0x3B, 0x2F, 0x25)
PAD = 2
MAX_W = 2048

# Longest side of each frame in atlas px, ~2x the largest CSS size the renderer draws it at.
# Settlement tiers form one size ladder (capital > city > town > village) at the same density.
TARGET = {
    'mountain-l': 128, 'mountain-m': 108, 'mountain-s': 84,
    'hill': 104, 'forest': 104, 'forest-tall': 92, 'marsh': 96,
    'capital': 128, 'city': 104, 'town': 84, 'village': 64,
    'monster': 360, 'ship': 120, 'compass': 360,
}

# Fill silhouettes. mode: 'ground' fills each column from the outline down to the ground line (profile drawings);
# 'closed' closes gaps and fills enclosed holes (ships, monsters, compass). opacity < 1 = a lighter fill.
FILL = {
    'mountain': ('ground', 1.0), 'hill': ('ground', 1.0), 'forest': ('ground', 0.7), 'marsh': ('closed', 0.55),
    'capital': ('closed', 1.0), 'city': ('closed', 1.0), 'town': ('closed', 1.0), 'village': ('closed', 1.0),
    'monster': ('closed', 1.0), 'ship': ('closed', 0.85), 'compass': ('closed', 1.0),
}
ANCHOR = {
    'mountain': 'base', 'hill': 'base', 'forest': 'base', 'marsh': 'base', 'monster': 'base', 'ship': 'base',
    'capital': 'footprint', 'city': 'footprint', 'town': 'footprint', 'village': 'footprint',
    'compass': 'rose',
}

LUM = 'lumbia-cartography-brushes-2.0-png-pack/Landforms'
MERC = 'mercator-settlement-png-pack-1.1'
MON = 'here-there-be-monsters-png-pack-1.1'


def files(folder, pattern, ids):
    return [f'{folder}/{pattern.format(i)}' for i in ids]


# (group, size key, [source paths relative to <source-dir>], options)
#   bold: dilate the line by 1 px at source resolution before the downscale (fine engravings)
#   gain: multiply line alpha (pale engravings)
SELECTION = [
    ('mountain', 'mountain-l', files(f'{LUM}/Large Mountains', 'Large Mountain {:03d}.png', [4, 8, 10, 13]), {}),
    ('mountain', 'mountain-m', files(f'{LUM}/Medium Mountains', 'Medium Mountain {:03d}.png', [1, 3, 7, 8, 16, 23, 28]), {}),
    ('mountain', 'mountain-s', files(f'{LUM}/Small Mountains', 'Small Mountain {:03d}.png', [5, 12, 13, 15]), {}),
    ('hill', 'hill', files(f'{LUM}/Hills', 'Hill {:03d}.png', [1, 5, 10, 15, 27, 38, 39, 46, 50, 63]), {}),
    ('forest', 'forest', files(f'{MERC}/Flora/Small Forest', 'Small Forest {:03d}.png', [1, 2, 4, 5, 6, 8, 10, 12]), {}),
    ('forest', 'forest-tall', files(f'{MERC}/Flora/Forests', 'Forest {:03d}.png', [1, 2, 3]), {}),
    ('marsh', 'marsh', files('de-fer-cartography-brushes-2.0-png-pack/Landforms/Swamps', 'Swamp {:03d}.png', [1, 2, 3, 6]), {}),
    ('capital', 'capital', files(f'{MERC}/Settlements/Cities', 'City {:03d}.png', [1]), {'bold': 1}),
    ('capital', 'capital', files('hogenburg-urban-cartography-png-pack/Buildings/Castles', 'Castles_{}.png', [7, 3]), {'bold': 1}),
    ('capital', 'capital', files('vischer-cartography-brushes-2.0-png-pack/Settlements/City', 'City {:03d}.png', [11, 25]), {'bold': 1}),
    ('city', 'city', files(f'{MERC}/Settlements/Large Towns', 'Large Town {:03d}.png', [2, 5, 6, 7, 10, 11, 13, 14]), {}),
    ('town', 'town', files(f'{MERC}/Settlements/Towns', 'Town {:03d}.png', [14, 21, 22, 29, 38, 39, 40, 54, 68, 69]), {}),
    ('village', 'village', files(f'{MERC}/Settlements/Small Towns', 'Small Town {:03d}.png', [1, 2, 3, 5, 6, 7, 8, 9, 11]), {}),
    ('monster', 'monster', [f"{MON}/Ortelius' Monsters (1570)/Grumpy Frog Beast.png",
                            f"{MON}/Vrients' Monsters (1583-1608)/Excited Sea Monster.png",
                            f"{MON}/Ortelius' Monsters (1570)/Spouting Frog Beast.png"], {}),
    ('ship', 'ship', ['janssonius-cartography-brushes-2.0-png-pack/Cartouches/Ships/Ship 005.png'], {}),
    ('ship', 'ship', files('zannonis-navy-png-pack/SingleShips', 'SingleShips_{}.png', [15, 36, 13]), {'bold': 1, 'gain': 1.5}),
    ('compass', 'compass', ['aubers-cartography-brushes-2.1-png-pack/Cartouches/Map Elements (2)/Compass Rose.png',
                            'homann-cartography-brushes-2.0-png-pack/Cartouches/Map Elements/Compass Rose.png'], {'bold': 1}),
]


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def stamp_name(group, rel):
    first = slug(rel.split('/')[0]).split('-')[0]
    pack = {'here': 'monsters', 'de': 'defer', 'van': 'vanderaa'}.get(first, first)
    return f'{group}-{pack}-{slug(os.path.splitext(os.path.basename(rel))[0])}'


def load_alpha(path, opts):
    """The stamp's line alpha (sources are black ink on transparency), cropped to its ink."""
    im = Image.open(path).convert('RGBA')
    r, g, b, a = im.split()
    # Darkness-weighted alpha, so a grey pixel counts for less ink than a black one.
    dark = Image.merge('RGB', (r, g, b)).convert('L').point(lambda v: 255 - v)
    a = ImageChops.multiply(a, dark)
    bbox = a.point(lambda v: 255 if v > 12 else 0).getbbox()
    if not bbox:
        raise ValueError(f'empty stamp: {path}')
    a = a.crop(bbox)
    if opts.get('bold'):
        a = ImageChops.lighter(a, a.filter(ImageFilter.MaxFilter(3)).point(lambda v: v * 0.8))
    if opts.get('gain'):
        k = opts['gain']
        a = a.point(lambda v: min(255, round(v * k)))
    return a


def scale_to(a, longest):
    w, h = a.size
    s = longest / max(w, h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    # Resample in two steps for strong reductions: box-average first keeps hatching even, Lanczos keeps it crisp.
    if s < 0.5:
        a = a.reduce(max(1, int(1 / s / 1.5)))
    a = a.resize((nw, nh), Image.LANCZOS)
    bbox = a.point(lambda v: 255 if v > 6 else 0).getbbox()
    return a.crop(bbox) if bbox else a


def rows_cols(a):
    w, h = a.size
    px = a.load()
    rows = [0] * h
    cols = [0] * w
    for y in range(h):
        s = 0
        for x in range(w):
            v = px[x, y]
            s += v
            cols[x] += v
        rows[y] = s
    return rows, cols


def cum_row(rows, frac):
    total = sum(rows) or 1
    acc = 0
    for y, v in enumerate(rows):
        acc += v
        if acc >= total * frac:
            return y
    return len(rows) - 1


def ground_row(a):
    rows, _ = rows_cols(a)
    return cum_row(rows, 0.985)


def band_center_x(a, y0, y1):
    """Mid point of the ink extent (5th..95th mass percentile) in rows y0..y1."""
    w, _ = a.size
    px = a.load()
    cols = [sum(px[x, y] for y in range(max(0, y0), y1 + 1)) for x in range(w)]
    total = sum(cols) or 1
    acc, lo, hi = 0, None, None
    for x, v in enumerate(cols):
        acc += v
        if lo is None and acc >= total * 0.05:
            lo = x
        if hi is None and acc >= total * 0.95:
            hi = x
    return ((lo or 0) + (hi if hi is not None else w - 1) + 1) / 2


def anchor_for(kind, a):
    w, h = a.size
    if kind == 'rose':
        # The rose's centre: the row where the ink spans widest (the east-west points), centred on that span.
        px = a.load()
        best, by, bx = -1, h // 2, w / 2
        for y in range(h):
            xs = [x for x in range(w) if px[x, y] > 100]
            if xs and xs[-1] - xs[0] > best:
                best, by, bx = xs[-1] - xs[0], y, (xs[0] + xs[-1] + 1) / 2
        return bx / w, (by + 0.5) / h
    g = ground_row(a)
    if kind == 'footprint':
        rows, _ = rows_cols(a)
        y = cum_row(rows, 0.80)
        x = band_center_x(a, int(y - 0.25 * h), g)
        return x / w, (y + 0.5) / h
    x = band_center_x(a, int(g - 0.2 * h), g)
    return x / w, (g + 1) / h


def mask(a, t):
    return a.point(lambda v: 255 if v > t else 0)


def close(m, r):
    k = 2 * r + 1
    return m.filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k))


def fill_holes(m):
    w, h = m.size
    big = Image.new('L', (w + 2, h + 2), 0)
    big.paste(m, (1, 1))
    ImageDraw.floodfill(big, (0, 0), 128)
    outside = big.point(lambda v: 255 if v == 128 else 0).crop((1, 1, w + 1, h + 1))
    return ImageChops.invert(outside)


def blob(a, r, threshold=52):
    """Ink blurred into a blob: dense line work merges, sparse hatching and stray ground strokes fall below the
    threshold. Enclosed holes are filled. Returns the blob and the erosion that shrinks it back onto the ink."""
    pad = int(round(3 * r)) + 2
    w, h = a.size
    big = Image.new('L', (w + 2 * pad, h + 2 * pad), 0)
    big.paste(a, (pad, pad))
    b = fill_holes(big.filter(ImageFilter.GaussianBlur(r)).point(lambda v: 255 if v > threshold else 0))
    shrink = b.filter(ImageFilter.MinFilter(2 * max(1, round(r * 0.8)) + 1))
    return b.crop((pad, pad, pad + w, pad + h)), shrink.crop((pad, pad, pad + w, pad + h))


def fill_frame(group, a):
    mode, opacity = FILL[group]
    w, h = a.size
    r = max(1.5, max(w, h) / 48)  # blob radius scales with the frame
    if mode == 'ground':
        # Profile drawings stand on the ground: under the inked outline, down to the ground line, is solid.
        # A column only counts when its topmost ink belongs to the drawing's body, so loose ground hatching and
        # specks never start a fill.
        loose, tight = blob(a, r)
        ink = close(mask(a, 60), max(1, round(r / 2)))
        g = ground_row(a)
        ipx, lpx = ink.load(), loose.load()
        out = tight.copy()
        op = out.load()
        for x in range(w):
            top = next((y for y in range(h) if ipx[x, y] and lpx[x, y]), None)
            if top is None or top > g:
                continue
            for y in range(top, g + 1):
                op[x, y] = 255
        out = close(out, max(1, round(r / 2)))  # heal 1-2 px vertical gaps between hatch strokes
    else:
        # Free-standing pictures (monsters, ships, compass): close the line work into one shape (bridging the
        # gaps between strokes and across sails and fins), fill what it encloses, then pull the edge back.
        k = max(1, round(r * 0.9))
        m = mask(a, 40).filter(ImageFilter.MaxFilter(2 * k + 1))
        m = fill_holes(m)
        m = m.filter(ImageFilter.GaussianBlur(k * 0.7)).point(lambda v: 255 if v > 127 else 0)  # round the corners
        out = m.filter(ImageFilter.MinFilter(2 * k + 1))
    out = out.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    if opacity < 1:
        out = out.point(lambda v: round(v * opacity))
    if not out.getbbox():
        return None
    return out


def shelf_pack(items, width):
    """items: [(key, w, h)] -> {key: (x, y)}, height. Tallest first, left to right."""
    order = sorted(items, key=lambda t: (-t[2], -t[1]))
    x = y = row_h = 0
    pos = {}
    for key, w, h in order:
        if x + w > width:
            x, y, row_h = 0, y + row_h + PAD, 0
        pos[key] = (x, y)
        x += w + PAD
        row_h = max(row_h, h)
    return pos, y + row_h


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.abspath(os.path.join(here, '..', '..', '..'))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source', help='folder holding the #NoBadMaps PNG packs')
    ap.add_argument('--out', default=os.path.join(repo, 'apps', 'web', 'src', 'atlas', 'assets'))
    ap.add_argument('--preview', help='write a contact sheet PNG here (outside the repo)')
    ap.add_argument('--quality', type=int, default=82)
    args = ap.parse_args()

    stamps = []
    for group, size_key, rels, opts in SELECTION:
        for rel in rels:
            path = os.path.join(args.source, rel)
            if not os.path.isfile(path):
                sys.exit(f'missing source file: {rel}')
            a = scale_to(load_alpha(path, opts), TARGET[size_key])
            fill = fill_frame(group, a)
            ax, ay = anchor_for(ANCHOR[group], a)
            stamps.append({'group': group, 'name': stamp_name(group, rel), 'source': rel, 'alpha': a,
                           'fill_img': fill, 'anchor': {'x': round(ax, 4), 'y': round(ay, 4)}})
    names = [s['name'] for s in stamps]
    dup = {n for n in names if names.count(n) > 1}
    if dup:
        sys.exit(f'duplicate stamp names: {sorted(dup)}')

    items = []
    for i, s in enumerate(stamps):
        w, h = s['alpha'].size
        items.append(((i, 'ink'), w, h))
        if s['fill_img'] is not None:
            items.append(((i, 'fill'), w, h))
    best = None
    for width in range(768, MAX_W + 1, 128):
        if any(w > width for _, w, _ in items):
            continue
        pos, height = shelf_pack(items, width)
        # Prefer a squarish atlas (GPU-friendly), then the smallest area.
        cost = (max(width, height), width * height)
        if best is None or cost < best[0]:
            best = (cost, width, height, pos)
    _, W, H, pos = best

    alpha = Image.new('L', (W, H), 0)
    white = Image.new('L', (W, H), 0)  # 255 where a fill frame lives -> RGB white there, sepia elsewhere
    for i, s in enumerate(stamps):
        w, h = s['alpha'].size
        x, y = pos[(i, 'ink')]
        alpha.paste(s['alpha'], (x, y))
        s['ink'] = {'x': x, 'y': y, 'w': w, 'h': h}
        if s['fill_img'] is not None:
            fx, fy = pos[(i, 'fill')]
            alpha.paste(s['fill_img'], (fx, fy))
            white.paste(255, (fx, fy, fx + w, fy + h))
            s['fill'] = {'x': fx, 'y': fy, 'w': w, 'h': h}
        else:
            s['fill'] = None
    rgb = Image.composite(Image.new('RGB', (W, H), (255, 255, 255)), Image.new('RGB', (W, H), INK_RGB), white)
    atlas = rgb.copy()
    atlas.putalpha(alpha)

    os.makedirs(args.out, exist_ok=True)
    webp = os.path.join(args.out, 'stamps.webp')
    atlas.save(webp, 'WEBP', quality=args.quality, alpha_quality=100, method=6, exact=True)
    meta = {
        'version': 1, 'width': W, 'height': H,
        'stamps': [{k: s[k] for k in ('group', 'name', 'source')} | {'w': s['ink']['w'], 'h': s['ink']['h'],
                   'ink': s['ink'], 'fill': s['fill'], 'anchor': s['anchor']} for s in stamps],
    }
    with open(os.path.join(args.out, 'stamps.json'), 'w') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')

    counts = {}
    for s in stamps:
        counts[s['group']] = counts.get(s['group'], 0) + 1
    print(f'atlas {W}x{H}, {len(stamps)} stamps, {os.path.getsize(webp)} bytes  {counts}')
    if args.preview:
        preview(atlas, meta, args.preview)


def preview(atlas, meta, out):
    """Contact sheet: the settlement ladder and each group drawn as a renderer would (fill tinted, ink on top)."""
    paper, land, sea = (238, 227, 200), (226, 214, 176), (196, 210, 200)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
    except OSError:
        font = ImageFont.load_default()
    sheet = Image.new('RGB', (1800, 2400), paper)
    d = ImageDraw.Draw(sheet)

    def frame(rect):
        return atlas.crop((rect['x'], rect['y'], rect['x'] + rect['w'], rect['y'] + rect['h']))

    def draw(s, cx, cy, scale, tint=land, dot=False):
        w, h = round(s['w'] * scale), round(s['h'] * scale)
        x0, y0 = round(cx - s['anchor']['x'] * w), round(cy - s['anchor']['y'] * h)
        if s['fill']:
            fa = frame(s['fill']).getchannel('A').resize((w, h), Image.LANCZOS)
            sheet.paste(Image.new('RGB', (w, h), tint), (x0, y0), fa)
        ia = frame(s['ink']).getchannel('A').resize((w, h), Image.LANCZOS)
        sheet.paste(Image.new('RGB', (w, h), INK_RGB), (x0, y0), ia)
        if dot:
            d.ellipse((cx - 2, cy - 2, cx + 2, cy + 2), fill=(200, 30, 30))
        return w, h

    by = {}
    for s in meta['stamps']:
        by.setdefault(s['group'], []).append(s)
    y = 10
    # 1. every stamp at full frame size (= 2x CSS) with its anchor
    d.text((10, y), 'frames at atlas resolution (2x CSS), red dot = anchor', fill=(150, 30, 30), font=font)
    y += 24
    x, row_h = 10, 0
    for g in ('mountain', 'hill', 'forest', 'marsh', 'capital', 'city', 'town', 'village', 'ship', 'monster', 'compass'):
        for s in by.get(g, []):
            sc = 0.5 if g in ('monster', 'compass') else 1.0
            w, h = round(s['w'] * sc), round(s['h'] * sc)
            if x + w > 1790:
                x, y, row_h = 10, y + row_h + 14, 0
            d.rectangle((x, y, x + w, y + h), fill=sea if g in ('ship', 'monster') else land)
            draw(s, x + s['anchor']['x'] * w, y + s['anchor']['y'] * h, sc, tint=(232, 160, 140), dot=True)
            x += w + 12
            row_h = max(row_h, h)
    y += row_h + 30
    # 2. settlement ladder at 1x CSS max size
    d.text((10, y), 'settlement ladder at max CSS size (1x): capital / city / town / village', fill=(150, 30, 30), font=font)
    y += 30
    for g in ('capital', 'city', 'town', 'village'):
        x = 30
        for s in by.get(g, []):
            draw(s, x + 40, y + 50, 0.5)
            x += 90
        y += 75
    # 3. occlusion test: a crowded range, forest and towns drawn back to front at 1x CSS
    d.text((10, y), 'occlusion test, 1x CSS (land tint fill under ink, back-to-front)', fill=(150, 30, 30), font=font)
    y += 20
    d.rectangle((10, y, 1790, y + 330), fill=land)
    import random
    rnd = random.Random(7)
    placed = []
    for g, n, sc in (('mountain', 34, 0.5), ('hill', 18, 0.45), ('forest', 22, 0.4), ('marsh', 4, 0.4),
                     ('village', 8, 0.45), ('town', 6, 0.45), ('city', 3, 0.5), ('capital', 1, 0.5)):
        for _ in range(n):
            placed.append((rnd.uniform(y + 40, y + 320), rnd.uniform(40, 1760), rnd.choice(by[g]), sc))
    for py, px, s, sc in sorted(placed, key=lambda t: t[0]):
        draw(s, px, py, sc)
    y += 350
    # 4. the same at 2x (retina), smaller patch
    d.text((10, y), 'occlusion test, 2x (retina) crop', fill=(150, 30, 30), font=font)
    y += 20
    d.rectangle((10, y, 1790, y + 420), fill=land)
    placed = []
    for g, n in (('mountain', 16), ('hill', 8), ('forest', 10), ('village', 4), ('town', 3), ('city', 2), ('capital', 1)):
        for _ in range(n):
            placed.append((rnd.uniform(y + 90, y + 410), rnd.uniform(60, 1740), rnd.choice(by[g])))
    for py, px, s in sorted(placed, key=lambda t: t[0]):
        draw(s, px, py, 1.0)
    y += 440
    # 5. sea furniture at use size
    d.rectangle((10, y, 1790, y + 240), fill=sea)
    x = 120
    for s in by.get('monster', []) + by.get('ship', []):
        sc = 0.5 if s['group'] == 'monster' else 0.4
        draw(s, x, y + 200, sc, tint=sea)
        x += 200 if s['group'] == 'monster' else 110
    for s in by.get('compass', []):
        draw(s, x + 60, y + 120, 0.5, tint=paper)
        x += 220
    sheet = sheet.crop((0, 0, 1800, y + 250))
    sheet.save(out)
    print('preview', out, sheet.size)


if __name__ == '__main__':
    main()
