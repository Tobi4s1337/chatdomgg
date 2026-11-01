import { CLAY, KitBuilder, random, type ArtisanKit } from '../kit';

/** All coordinates are half-metre terrain cells. Plot bounds are half-open. */
export type Crop = 'wheat' | 'lavender' | 'cabbage';
export interface FieldPlot {
  readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number;
  readonly crop: Crop; readonly rows: 'x' | 'z';
}
export interface FieldLayout { readonly plots: readonly FieldPlot[]; readonly laneWidth: number }

/** A compact, walkable patchwork to fit on a graded field zone, not a terrain height solver. */
export function fieldLayout(seedKey: string): FieldLayout {
  const r = random(`${seedKey}:fields-layout`);
  const cutX = 45 + Math.floor(r() * 13), cutZ = 43 + Math.floor(r() * 14);
  const laneWidth = 5;
  const crops: Crop[] = ['wheat', 'lavender', 'cabbage', 'wheat'];
  const rotate = Math.floor(r() * crops.length);
  const rects = [
    [0, 0, cutX, cutZ], [cutX + laneWidth, 0, 108, cutZ],
    [0, cutZ + laneWidth, cutX, 108], [cutX + laneWidth, cutZ + laneWidth, 108, 108],
  ];
  return {
    laneWidth,
    plots: rects.map((p, i) => ({ x0: p[0]!, z0: p[1]!, x1: p[2]!, z1: p[3]!, crop: crops[(i + rotate) % crops.length]!, rows: (i + rotate) % 2 === 0 ? 'x' : 'z' })),
  };
}

const CROP = {
  wheat: { bed: '#a08354', stem: '#bf9a49', head: '#dfbf68' },
  lavender: { bed: '#75694e', stem: '#75834c', head: '#9c81b1' },
  cabbage: { bed: '#85694e', stem: '#638150', head: '#8aa46a' },
} as const;

function hedgeHorizontal(b: KitBuilder, x0: number, x1: number, z: number): void {
  const middle = Math.floor((x0 + x1) / 2);
  b.box(x0, 1, z, middle - x0 - 2, 2, 2, '#526c42');
  b.box(middle + 2, 1, z, x1 - middle - 2, 2, 2, '#526c42');
  b.box(x0 + 1, 3, z, middle - x0 - 3, 1, 2, '#718450');
  b.box(middle + 2, 3, z, x1 - middle - 3, 1, 2, '#718450');
  // Two gate posts leave a two-metre opening onto the lane.
  b.box(middle - 3, 1, z, 1, 3, 2, CLAY.timber);
  b.box(middle + 2, 1, z, 1, 3, 2, CLAY.timber);
}

function plantPlot(b: KitBuilder, p: FieldPlot, seedKey: string): void {
  const r = random(`${seedKey}:crop:${p.x0}:${p.z0}:${p.crop}`);
  const c = CROP[p.crop];
  b.box(p.x0, 0, p.z0, p.x1 - p.x0, 1, p.z1 - p.z0, c.bed);
  // Low hedge and gaps bound each plot. Lanes are placed before these plots.
  hedgeHorizontal(b, p.x0, p.x1, p.z0);
  const x0 = p.x0 + 3, x1 = p.x1 - 2, z0 = p.z0 + 4, z1 = p.z1 - 2;
  const runStart = p.rows === 'x' ? x0 : z0, runEnd = p.rows === 'x' ? x1 : z1;
  const acrossStart = p.rows === 'x' ? z0 : x0, acrossEnd = p.rows === 'x' ? z1 : x1;
  const boxRow = (along: number, across: number, length: number, y: number, colour: string) => {
    if (p.rows === 'x') b.box(along, y, across, length, 1, 1, colour);
    else b.box(across, y, along, 1, 1, length, colour);
  };
  for (let across = acrossStart; across < acrossEnd; across += 3) {
    if (p.crop === 'cabbage') {
      // Broad green leaves form a small cross around a lighter, smaller head.
      // Regular rows remain visible from the air; no plant escapes the plot.
      for (let along = runStart + 1; along < runEnd - 1; along += 4) {
        boxRow(along - 1, across, 3, 1, c.stem);
        if (across + 1 < acrossEnd) boxRow(along, across + 1, 1, 1, '#718f59');
        if (across > acrossStart) boxRow(along, across - 1, 1, 1, '#718f59');
        boxRow(along, across, 1, 2, c.head);
      }
    } else {
      // Deliberate, seeded clusters follow a row but leave earth between them.
      // Width and height vary in small, coherent patches, never single-cell noise.
      for (let along = runStart; along < runEnd;) {
        const length = Math.min(2 + Math.floor(r() * 3), runEnd - along);
        boxRow(along, across, length, 1, c.stem);
        if (p.crop === 'lavender' && across + 1 < acrossEnd) {
          boxRow(along, across + 1, length, 1, c.stem);
        }
        boxRow(along, across, length, 2, c.head);
        if (p.crop === 'wheat' && length >= 3 && r() > 0.55) {
          boxRow(along + 1, across, length - 2, 3, c.head);
        }
        along += length + (r() > 0.82 ? 2 : 1);
      }
    }
  }
}

/** Stamp a single, locally supplied dry plot without flattening its surrounding land. */
export function createFieldPlot(plot: FieldPlot, seedKey = 'field'): ArtisanKit {
  const { x0, z0, x1, z1 } = plot;
  if (![x0, z0, x1, z1].every(Number.isSafeInteger) || x1 - x0 < 12 || z1 - z0 < 12 || x1 - x0 > 256 || z1 - z0 > 256) {
    throw new RangeError('A field plot needs integer half-metre bounds and 12–256 cells on each side');
  }
  if (!Object.hasOwn(CROP, plot.crop) || (plot.rows !== 'x' && plot.rows !== 'z')) {
    throw new RangeError('Unknown crop or row direction');
  }
  const b = new KitBuilder();
  plantPlot(b, plot, seedKey);
  return b.finish(`field-${plot.crop}`, { centre: [Math.floor((x0 + x1) / 2), 1, Math.floor((z0 + z1) / 2)] });
}

/** Four cultivated parcels, hedged with gate gaps and crossed by a clear, grounded lane. */
export function createFields(seedKey: string): ArtisanKit {
  const b = new KitBuilder(), layout = fieldLayout(seedKey);
  b.box(0, -1, 0, 108, 1, 108, CLAY.grass);
  b.box(0, 0, 0, 108, 1, 108, '#ae9874');
  for (const p of layout.plots) plantPlot(b, p, seedKey);
  return b.finish('patchwork-fields', {
    centre: [54, 1, 54],
    lane: [layout.plots[0]!.x1 + 2, 1, layout.plots[0]!.z1 + 2],
  });
}

export interface WindmillParts { readonly body: ArtisanKit; readonly sails: ArtisanKit }

/** The returned groups share local coordinates. Sails rotate around their shared sailHub. */
export function createWindmillParts(seedKey: string): WindmillParts {
  const b = new KitBuilder(), sails = new KitBuilder(), r = random(`${seedKey}:windmill`);
  const warmRoof = r() >= 0.5;
  const roof = warmRoof ? '#8d665b' : CLAY.roof;
  const roofEave = warmRoof ? '#694a45' : CLAY.roofDark;
  // Footing and staggered plaster body: concentric bands form a gentle taper.
  b.box(-10, 0, -9, 20, 3, 18, CLAY.stoneDark);
  b.box(-9, 3, -8, 18, 2, 16, CLAY.stone);
  b.box(-4, 0, 8, 8, 5, 4, CLAY.stone);
  // Hollow ground floor with a true entrance on +Z. All wall boxes leave the
  // centre of the facade and the room free, rather than painting a false door.
  b.box(-8, 5, -7, 2, 9, 14, CLAY.plaster);
  b.box(6, 5, -7, 2, 9, 14, CLAY.plaster);
  b.box(-6, 5, -7, 12, 9, 2, CLAY.plaster);
  b.box(-6, 5, 5, 3, 9, 2, CLAY.plaster);
  b.box(3, 5, 5, 3, 9, 2, CLAY.plaster);
  b.box(-3, 12, 5, 6, 2, 2, CLAY.plaster);
  b.box(-7, 14, -6, 14, 9, 12, CLAY.plaster);
  b.box(-6, 23, -5, 12, 5, 10, CLAY.plaster);
  // Timber courses, corner posts, an open doorway and a carved lintel.
  for (const y of [13, 22, 27]) b.box(-8, y, 7, 16, 1, 1, CLAY.timber);
  b.box(-8, 5, 7, 5, 1, 1, CLAY.timber);
  b.box(3, 5, 7, 5, 1, 1, CLAY.timber);
  for (const x of [-8, 7]) b.box(x, 5, 7, 1, 9, 1, CLAY.timber);
  b.box(-3, 5, 7, 1, 7, 2, CLAY.timber);
  b.box(2, 5, 7, 1, 7, 2, CLAY.timber);
  b.box(-3, 12, 7, 6, 1, 2, CLAY.trim);
  b.box(5, 16, 6, 2, 4, 1, CLAY.stoneDark);
  b.box(-7, 17, 6, 2, 3, 1, CLAY.stoneDark);
  // Storybook cap: layered hipped roof with a generous eave.
  for (let y = 0; y < 7; y++) {
    const inset = Math.floor(y * 0.75);
    b.box(-8 + inset, 28 + y, -7 + inset, 16 - inset * 2, 1, 14 - inset * 2, y < 2 ? roofEave : roof);
  }
  b.box(-1, 35, -1, 2, 2, 2, CLAY.brass);
  // Four long, narrow cloth panels, offset to one side of their spar: they
  // read as a working mill rather than four radial paddles. Exposed spar near
  // the hub leaves a gap; end rails and a single mid rail hold each sail.
  // The farthest corner stays less than 19 cells from the hub, so the whole
  // rotating group clears the 5-cell-high stone stoop through a full turn.
  const hubY = 24, hubZ = 10;
  const sailCells = new Map<string, { x: number; y: number; edge: boolean }>();
  for (let blade = 0; blade < 4; blade++) {
    const angle = Math.PI / 4 + blade * Math.PI / 2;
    const ux = Math.cos(angle), uy = Math.sin(angle), vx = -uy, vy = ux;
    for (let d = 2; d <= 17; d++) {
      const last = d >= 5 ? 4 : 0;
      for (let w = 0; w <= last; w++) {
        const x = Math.round(ux * d + vx * w), y = Math.round(hubY + uy * d + vy * w);
        const edge = w === 0 || w === 4 || d === 5 || d === 11 || d === 17;
        const key = `${x},${y}`, previous = sailCells.get(key);
        sailCells.set(key, { x, y, edge: edge || (previous?.edge ?? false) });
      }
    }
  }
  for (const cell of sailCells.values()) sails.box(cell.x, cell.y, hubZ, 1, 1, 1, cell.edge ? CLAY.timber : CLAY.sail);
  sails.box(-2, hubY - 2, hubZ + 1, 4, 4, 2, CLAY.timber);
  sails.box(-1, hubY - 1, hubZ + 3, 2, 2, 1, CLAY.brass);
  const anchors = { base: [0, 0, 0], door: [0, 5, 10], sailHub: [0, hubY, hubZ] } as const;
  return { body: b.finish('windmill-body', anchors), sails: sails.finish('windmill-sails', anchors) };
}

/** The complete static pose is useful for meshing and still review. */
export function createWindmill(seedKey: string): ArtisanKit {
  const parts = createWindmillParts(seedKey), b = new KitBuilder();
  b.add(parts.body); b.add(parts.sails);
  return b.finish('windmill', parts.body.anchors);
}
