import type { Vec3 } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, type StyleKey } from '../../../materials';
import { NO_METADATA, type WaterPiece } from '../place-piece';
import { cells, checkStyle, checkVariant, discRow, hash, shoreBlueprint, type Disc } from './shape';

type Axis = 'x' | 'z';

/**
 * A fan of reed blades from one root crown. Blades splay along `axis`, most of them towards `out` (away from the
 * clump's middle), so each fan reads as one tuft and the clump as three to five of them.
 */
interface Fan { readonly x: number; readonly z: number; readonly axis: Axis; readonly out: 1 | -1; readonly height: number; readonly blades: 4 | 5 }
/** A bulrush: root cell, height to the spike tip, and a slight lean along an axis. */
interface Rush { readonly x: number; readonly z: number; readonly height: number; readonly axis: Axis; readonly lean: number }
/** An iris: root cell, the course its flower opens on, and the axis its two falls spread along. */
interface Iris { readonly x: number; readonly z: number; readonly bloom: number; readonly axis: Axis }
interface ReedLayout { readonly size: Vec3; readonly fans: readonly Fan[]; readonly rushes: readonly Rush[]; readonly irises: readonly Iris[] }

/**
 * Three authored clumps. 0 is a broad four-fan clump with two bulrushes; 1 is a tall, narrow stand where the
 * bulrushes lead; 2 is a lower five-fan drift that the irises lead. Every blade, head and flower stays inside
 * the blueprint and below 1.6 m.
 */
const REED_LAYOUTS: readonly ReedLayout[] = [
  {
    size: [16, 13, 16],
    fans: [
      { x: 5, z: 7, axis: 'x', out: -1, height: 12, blades: 5 }, { x: 8, z: 5, axis: 'z', out: -1, height: 10, blades: 5 },
      { x: 9, z: 8, axis: 'x', out: 1, height: 11, blades: 5 }, { x: 6, z: 9, axis: 'z', out: 1, height: 9, blades: 4 },
    ],
    rushes: [{ x: 7, z: 7, height: 12, axis: 'x', lean: 0 }, { x: 10, z: 6, height: 11, axis: 'z', lean: -1.2 }],
    irises: [{ x: 11, z: 11, bloom: 7, axis: 'x' }, { x: 3, z: 10, bloom: 6, axis: 'z' }],
  },
  {
    size: [14, 13, 14],
    fans: [
      { x: 5, z: 6, axis: 'x', out: -1, height: 12, blades: 5 }, { x: 7, z: 5, axis: 'z', out: -1, height: 11, blades: 5 },
      { x: 7, z: 7, axis: 'x', out: 1, height: 10, blades: 4 },
    ],
    rushes: [
      { x: 6, z: 8, height: 12, axis: 'x', lean: 0 }, { x: 8, z: 9, height: 11, axis: 'z', lean: 1.2 },
      { x: 4, z: 9, height: 10, axis: 'x', lean: -1.2 },
    ],
    irises: [{ x: 10, z: 10, bloom: 6, axis: 'z' }],
  },
  {
    size: [16, 13, 16],
    fans: [
      { x: 5, z: 6, axis: 'x', out: -1, height: 10, blades: 5 }, { x: 7, z: 5, axis: 'z', out: -1, height: 9, blades: 4 },
      { x: 9, z: 6, axis: 'x', out: 1, height: 10, blades: 5 }, { x: 6, z: 9, axis: 'z', out: 1, height: 8, blades: 4 },
      { x: 9, z: 9, axis: 'x', out: 1, height: 9, blades: 4 },
    ],
    rushes: [{ x: 8, z: 8, height: 11, axis: 'z', lean: 0 }],
    irises: [{ x: 3, z: 10, bloom: 6, axis: 'z' }, { x: 12, z: 12, bloom: 7, axis: 'x' }, { x: 12, z: 3, bloom: 5, axis: 'z' }],
  },
];

/** Outward leans (cells at the tip) and how much shorter than the fan each blade stands; the last blade folds. */
const FAN_BLADES: Readonly<Record<4 | 5, readonly (readonly [lean: number, drop: number])[]>> = {
  4: [[-1, 1], [0.5, 0], [1.8, 1], [3, 2]],
  5: [[-1, 1], [0, 0], [1, 1], [2, 2], [3, 3]],
};

/** How many blades carry straw-dry tips: warm, sunburnt Hearth most, lush Grove least. */
const DRYNESS: Readonly<Record<StyleKey, number>> = { hearth: 0.55, tide: 0.4, grove: 0.25 };

/**
 * One blade, one cell thick, curving out as it rises: its lean grows with the square of height, so it stands
 * upright at the root and bends near the tip. Where the bend moves a cell, that course bridges old and new
 * positions so the blade stays face-connected. `paint` chooses each course's material.
 */
function blade(b: Boxes, x: number, z: number, axis: Axis, lean: number, height: number, paint: (y: number) => number): number {
  const at = (a0: number, a1: number, y0: number, y1: number, m: number) =>
    axis === 'x' ? b.add(x + a0, y0, z, x + a1, y1, z + 1, m) : b.add(x, y0, z + a0, x + 1, y1, z + a1, m);
  let previous = 0, run: { a0: number; a1: number; y0: number; m: number } | undefined, y = 0;
  const flush = () => { if (run) at(run.a0, run.a1, run.y0, y, run.m); };
  for (; y < height; y++) {
    const o = Math.round(lean * ((y + 0.5) / height) ** 2);
    const a0 = Math.min(previous, o), a1 = Math.max(previous, o) + 1, m = paint(y);
    if (!run || run.a0 !== a0 || run.a1 !== a1 || run.m !== m) { flush(); run = { a0, a1, y0: y, m }; }
    previous = o;
  }
  flush();
  return previous;
}

/**
 * A reed clump rooted on y = 0, where the host sets it on the bed or bank at the waterline: three to five fans
 * of green blades, some with straw tips, the outermost of each fan folding over; bark-brown bulrush heads on
 * straight stems; and a few blue irises with a gold heart. 0.9–1.6 m tall and up to 2 m across.
 */
export function createReeds(style: StyleKey, variant: number): WaterPiece {
  checkStyle('reeds', style);
  checkVariant('reeds', variant);
  const layout = REED_LAYOUTS[variant]!, size = layout.size, b = new Boxes();
  const collar = style === 'grove' ? MAT.moss : MAT.earth;
  // Low muddy collars with cut corners go down first, so a neighbour's collar never buries another fan's crown.
  for (const fan of layout.fans) {
    b.add(fan.x - 1, 0, fan.z, fan.x + 3, 1, fan.z + 2, collar);
    b.add(fan.x, 0, fan.z - 1, fan.x + 2, 1, fan.z + 3, collar);
  }
  layout.fans.forEach((fan, f) => {
    // The sheathed crown the blades rise from.
    b.add(fan.x, 0, fan.z, fan.x + 2, 2, fan.z + 2, MAT.leaf);
    FAN_BLADES[fan.blades].forEach(([lean, drop], i) => {
      const seed = [variant, f, i] as const;
      const outward = lean * fan.out;
      const height = fan.height - drop - (hash(...seed, 1) < 0.3 && drop ? 1 : 0);
      const along = outward < 0 ? 0 : 1, across = i % 2;
      const [x, z] = fan.axis === 'x' ? [fan.x + along, fan.z + across] : [fan.x + across, fan.z + along];
      // The second fan's inward blade is last year's stem, straw from its green sheath to the tip.
      const dead = f === 1 && i === 0;
      const tip = hash(...seed, 2) < DRYNESS[style] ? height - 2 - (hash(...seed, 3) < 0.5 ? 1 : 0) : height;
      const end = blade(b, x, z, fan.axis, outward, height, y => (dead && y >= 2) || y >= tip ? MAT.thatch : MAT.leaf);
      if (i === fan.blades - 1) {
        // The outermost blade folds over: two cells further out along the top course, then two cells down.
        const s = fan.out, top = height - 1;
        const [a0, a1] = s > 0 ? [end + 1, end + 3] : [end - 2, end];
        const fold = (A0: number, A1: number, y0: number, y1: number) => fan.axis === 'x'
          ? b.add(x + A0, y0, z, x + A1, y1, z + 1, MAT.thatch) : b.add(x, y0, z + A0, x + 1, y1, z + A1, MAT.thatch);
        fold(a0, a1, top, top + 1);
        fold(end + 2 * s, end + 2 * s + 1, top - 2, top);
      }
    });
  });
  for (const rush of layout.rushes) {
    // A green stem, a three-cell bark head and a short straw spike above it.
    blade(b, rush.x, rush.z, rush.axis, rush.lean, rush.height,
      y => y >= rush.height - 1 ? MAT.thatch : y >= rush.height - 4 ? MAT.bark : MAT.leaf);
  }
  layout.irises.forEach((iris, n) => {
    blade(b, iris.x, iris.z, iris.axis, 0, iris.bloom, () => MAT.leaf);
    // Two sword leaves beside the stem, leaning apart across the flower's axis.
    const other: Axis = iris.axis === 'x' ? 'z' : 'x';
    const [sx, sz] = other === 'x' ? [iris.x + 1, iris.z] : [iris.x, iris.z + 1];
    blade(b, sx, sz, other, 1.4, iris.bloom - 1 - n % 2, () => MAT.leaf);
    const [tx, tz] = other === 'x' ? [iris.x - 1, iris.z] : [iris.x, iris.z - 1];
    blade(b, tx, tz, other, -1, iris.bloom - 2, () => MAT.leaf);
    // The flower: two blue falls either side of a gold heart, and the blue standard above it.
    const y = iris.bloom;
    if (iris.axis === 'x') b.add(iris.x - 1, y, iris.z, iris.x + 2, y + 1, iris.z + 1, MAT.blueFlower);
    else b.add(iris.x, y, iris.z - 1, iris.x + 1, y + 1, iris.z + 2, MAT.blueFlower);
    b.add(iris.x, y, iris.z, iris.x + 1, y + 1, iris.z + 1, MAT.goldLeaf);
    b.add(iris.x, y + 1, iris.z, iris.x + 1, y + 2, iris.z + 1, MAT.blueFlower);
  });
  inside(b, size, 'reeds');
  const blueprint = shoreBlueprint(`water-${style}-reeds-${variant}`, style, 'flora', size, b);
  const read = cells(blueprint.boxes, size);
  let height = 0;
  for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) height = Math.max(height, read.top(x, z));
  const crowns = layout.fans.map((fan, f) => ({ id: `crown-${f}`, box: { from: [fan.x, 0, fan.z] as Vec3, to: [fan.x + 2, 1, fan.z + 2] as Vec3 } }));
  const centre = mean(layout.fans);
  return {
    ...NO_METADATA, blueprint, footings: crowns,
    sounds: [{ id: 'reeds', kind: 'reeds', position: [centre.x + 1, Math.round(height / 2), centre.z + 1] }],
  };
}

const mean = (fans: readonly Fan[]) => ({
  x: Math.round(fans.reduce((s, f) => s + f.x, 0) / fans.length), z: Math.round(fans.reduce((s, f) => s + f.z, 0) / fans.length),
});

/** An authored layout that strays outside its blueprint is a bug, not something to clip quietly. */
function inside(b: Boxes, size: Vec3, form: string): void {
  for (const box of b.list) for (let a = 0; a < 3; a++) {
    if (box.from[a]! < 0 || box.to[a]! > size[a]!) throw new Error(`${form}: box ${JSON.stringify(box)} leaves ${size.join('×')}.`);
  }
}

interface LilyLayout { readonly size: Vec3; readonly pads: number; readonly radius: readonly [number, number]; readonly blooms: number; readonly buds: number }

/** 0 is a round raft with two blooms and a bud; 1 a few big pads; 2 a long drift of small ones. */
const LILY_LAYOUTS: readonly LilyLayout[] = [
  { size: [22, 3, 20], pads: 7, radius: [2.2, 3.6], blooms: 2, buds: 1 },
  { size: [18, 3, 18], pads: 5, radius: [2.6, 3.8], blooms: 1, buds: 1 },
  { size: [24, 3, 14], pads: 8, radius: [1.9, 3.4], blooms: 2, buds: 0 },
];

/** Hearth's lilies are pink, Tide's and Grove's white; a second bloom in a raft takes the other colour. */
const LILY_BLOOM: Readonly<Record<StyleKey, number>> = { hearth: MAT.petal, tide: MAT.cream, grove: MAT.cream };

const DIRECTIONS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

interface Pad { readonly disc: Disc; readonly ix: number; readonly iz: number; readonly notch: readonly [number, number]; readonly cells: Set<number> }

/**
 * A raft of four to eight lily pads lying on y = 0, which the host sets on the water surface. Each pad is one
 * cell thick and round, with its notch cut from the stalk to the rim; pads touch but never overlap, so each
 * one's outline reads. A couple of flowers (pink or white, gold hearts) stand at most two cells proud.
 * Pads float rather than bear on a foundation, so the piece declares no footings.
 */
export function createLilies(style: StyleKey, variant: number): WaterPiece {
  checkStyle('lilies', style);
  checkVariant('lilies', variant);
  const layout = LILY_LAYOUTS[variant]!, size = layout.size, b = new Boxes();
  const [W, , D] = size, key = (x: number, z: number) => x + W * z;
  const owner = new Map<number, number>(), pads: Pad[] = [];
  const centre = [W / 2, D / 2] as const, squash = D / W;
  for (let attempt = 0; pads.length < layout.pads && attempt < layout.pads * 24; attempt++) {
    const [r0, r1] = layout.radius;
    const r = pads.length === 0 ? r1 : r0 + (r1 - r0) * hash(variant, attempt, 1);
    const angle = attempt * 2.39996 + hash(variant, attempt, 2) * 0.9;
    const reach = pads.length === 0 ? 0 : (1.4 + 2.4 * Math.sqrt(pads.length + attempt * 0.15)) * (0.85 + 0.3 * hash(variant, attempt, 3));
    const ix = Math.floor(centre[0] + Math.cos(angle) * reach), iz = Math.floor(centre[1] + Math.sin(angle) * reach * squash);
    const disc: Disc = { cx: ix + 0.5, cz: iz + 0.5, rx: r, rz: r * (0.9 + 0.15 * hash(variant, attempt, 4)) };
    const mine = new Set<number>();
    let fits = true;
    for (let z = Math.floor(disc.cz - disc.rz); z < Math.ceil(disc.cz + disc.rz) && fits; z++) {
      const row = discRow(disc, z);
      if (!row) continue;
      if (z < 0 || z >= D || row[0] < 0 || row[1] > W) fits = false;
      else for (let x = row[0]; x < row[1]; x++) { if (owner.has(key(x, z))) fits = false; mine.add(key(x, z)); }
    }
    if (!fits || !mine.has(key(ix, iz))) continue;
    // The notch opens away from the raft's middle, give or take a quarter turn.
    const away = Math.atan2(iz + 0.5 - centre[1], ix + 0.5 - centre[0]) + (hash(variant, attempt, 5) - 0.5) * 1.6;
    const notch = pads.length === 0 ? DIRECTIONS[variant + 1]! : DIRECTIONS[(Math.round(away / (Math.PI / 2)) + 4) % 4]!;
    for (const c of mine) owner.set(c, pads.length);
    pads.push({ disc, ix, iz, notch, cells: mine });
  }
  if (pads.length < 4) throw new Error(`lilies ${variant}: only ${pads.length} pads fit.`);
  pads.forEach((pad, p) => {
    const old = p > 0 && hash(variant, p, 6) < 0.25;
    for (let z = Math.floor(pad.disc.cz - pad.disc.rz); z < Math.ceil(pad.disc.cz + pad.disc.rz); z++) {
      const row = discRow(pad.disc, z);
      if (row) b.add(row[0], 0, z, row[1], 1, z + 1, old ? MAT.moss : MAT.leaf);
    }
    // The notch: a slit from the stalk to the rim, widening by a cell either side at the rim of a big pad.
    const [dx, dz] = pad.notch;
    let t = 0;
    while (pad.cells.has(key(pad.ix + dx * (t + 1), pad.iz + dz * (t + 1)))) t++;
    const cut = (x: number, z: number) => { if (pad.cells.has(key(x, z))) { pad.cells.delete(key(x, z)); b.add(x, 0, z, x + 1, 1, z + 1, MAT.air); } };
    for (let s = 0; s <= t; s++) cut(pad.ix + dx * s, pad.iz + dz * s);
    if (pad.disc.rx >= 3) for (const side of [-1, 1]) cut(pad.ix + dx * t + dz * side, pad.iz + dz * t + dx * side);
  });
  // Blooms stand on the biggest pads, a cell or two back from the notch, wherever all nine cells are leaf.
  const bloom = LILY_BLOOM[style], second = bloom === MAT.petal ? MAT.cream : MAT.petal;
  const bySize = pads.map((pad, p) => p).sort((a, c) => pads[c]!.disc.rx - pads[a]!.disc.rx || a - c);
  let blooms = 0, buds = 0;
  for (const p of bySize) {
    const pad = pads[p]!, [dx, dz] = pad.notch;
    if (blooms < layout.blooms) {
      for (const back of [1, 2]) {
        const x = pad.ix - dx * back, z = pad.iz - dz * back;
        let ok = true;
        for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) if (!pad.cells.has(key(x + u, z + v))) ok = false;
        if (!ok) continue;
        const colour = blooms === 1 && variant === 0 ? second : bloom;
        // A cup of nine on the pad with its gold heart, and four outer petals rising at the corners.
        b.add(x - 1, 1, z - 1, x + 2, 2, z + 2, colour);
        b.add(x, 1, z, x + 1, 2, z + 1, MAT.goldLeaf);
        for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) b.add(x + u, 2, z + v, x + u + 1, 3, z + v + 1, colour);
        blooms++;
        break;
      }
    } else if (buds < layout.buds && pad.cells.has(key(pad.ix - dx, pad.iz - dz))) {
      // A closed bud on a short green stalk.
      const x = pad.ix - dx, z = pad.iz - dz;
      b.add(x, 1, z, x + 1, 2, z + 1, MAT.leaf);
      b.add(x, 2, z, x + 1, 3, z + 1, bloom);
      buds++;
    }
  }
  if (blooms < layout.blooms) throw new Error(`lilies ${variant}: no room for ${layout.blooms} blooms.`);
  inside(b, size, 'lilies');
  return { ...NO_METADATA, blueprint: shoreBlueprint(`water-${style}-lilies-${variant}`, style, 'flora', size, b) };
}
