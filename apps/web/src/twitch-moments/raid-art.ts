import { MAT } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';
import { chargeShape } from '../atlas/heraldry/charges';
import { COLOURS, isMetal, shieldDesign, type Colour, type ShieldDesign, type Tincture } from '../atlas/heraldry/design';
import { BORDURE_WIDTH, SHIELD_ASPECT, chargeSpots, secondRegion } from '../atlas/heraldry/geometry';
import type { PathCommand, PathPiece } from '../atlas/heraldry/path';
import { blueprint, box, type BannerKit, type Box } from './banner';
import { ponyBlueprint } from './gift-art';
import type { WagonKind } from './raid-beat';

/**
 * The raid's pieces in build cells (0.125 m), authored for this lane.
 *
 * The raider's colours are its arms on the Atlas (`shieldDesign`, seeded from the channel ID only), woven into
 * cloth: every tincture is one of the kingdom's fabric dyes, and a banner is the shield's own partition and charges
 * sampled onto the cloth's cells. A channel without a kingdom here bears the same arms the Atlas already gives it.
 *
 * - Dye: one cell of a tincture's fabric. Banners are built from runs of it, scaled along a row, so a cloth can
 *   unroll and sway row by row in any arms without a part per design.
 * - Raid wagon: the gift cart's frame (bed, sideboards, axles, shafts) in plain timber and brass, its sideboard
 *   panels in the raider's colour; a pole at the front with a crossbar for the banner (tall on the lead wagon) and
 *   a lantern on an arm. The covered wagon carries a cream canvas tilt banded in the raider's colour.
 * - Festival fittings: lantern racks, rolled cloth and bundled banners on the open wagons.
 * - The gate: a brazier on a stone plinth, and a tall standard pole on a footing with a crossbar and a gilt finial.
 */

/** Each tincture woven in the kingdom's own dye (Or, Argent, then the five colours). */
export const TINCTURE_MAT: Readonly<Record<Tincture, number>> = {
  or: MAT.fabricGold, argent: MAT.cream, azure: MAT.fabricBlue, vert: MAT.fabricGreen, purpure: MAT.fabricViolet, sable: MAT.hairBlack, gules: MAT.fabricRed,
};
export const TINCTURE_LIST = Object.keys(TINCTURE_MAT) as Tincture[];

export interface RaiderArms {
  readonly design: ShieldDesign;
  /** The colour (never a metal) of the two tinctures: the wagons' panels, the canvas bands and the saddle cloths. */
  readonly colour: Colour;
  readonly metal: Tincture;
}

/** The raider's arms, exactly as the Atlas draws them. Null for anything that is not a channel ID: no arms are invented. */
export function raiderArms(kingdomId: string): RaiderArms | null {
  let design: ShieldDesign;
  try { design = shieldDesign(kingdomId); } catch { return null; }
  const colour = ([design.field, design.second] as Tincture[]).find((t): t is Colour => !isMetal(t)) ?? 'sable';
  const metal = ([design.field, design.second] as Tincture[]).find(t => isMetal(t)) ?? 'argent';
  return { design, colour, metal };
}

// ---------------------------------------------------------------- the banner, cell by cell

export interface Run { readonly x0: number; readonly x1: number; readonly tincture: Tincture }

type Ring = [number, number][];
const TAU = Math.PI * 2;

/** Path commands as closed polylines (arcs and curves flattened finely enough for a cloth of a few dozen cells). */
function flatten(d: readonly PathCommand[]): Ring[] {
  const rings: Ring[] = [];
  let ring: Ring | null = null, cx = 0, cy = 0, sx = 0, sy = 0;
  const to = (x: number, y: number) => {
    if (!ring) { ring = [[cx, cy]]; rings.push(ring); sx = cx; sy = cy; }
    ring.push([x, y]); cx = x; cy = y;
  };
  for (const c of d) {
    switch (c[0]) {
      case 'M': ring = [[c[1], c[2]]]; rings.push(ring); cx = sx = c[1]; cy = sy = c[2]; break;
      case 'L': to(c[1], c[2]); break;
      case 'Q': {
        const [x0, y0] = [cx, cy];
        for (let i = 1; i <= 10; i++) { const t = i / 10, u = 1 - t; to(u * u * x0 + 2 * u * t * c[1] + t * t * c[3], u * u * y0 + 2 * u * t * c[2] + t * t * c[4]); }
        break;
      }
      case 'C': {
        const [x0, y0] = [cx, cy];
        for (let i = 1; i <= 14; i++) {
          const t = i / 14, u = 1 - t;
          to(u * u * u * x0 + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5], u * u * u * y0 + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]);
        }
        break;
      }
      case 'A': {
        // Canvas semantics: a line to the arc's start, then the sweep in the stated direction.
        const [, ax, ay, r, a0, a1, anticlockwise] = c;
        let sweep = a1 - a0;
        if (!anticlockwise) sweep = sweep >= TAU ? TAU : ((sweep % TAU) + TAU) % TAU;
        else sweep = -sweep >= TAU ? -TAU : -((((-sweep) % TAU) + TAU) % TAU);
        const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
        for (let i = 0; i <= steps; i++) { const a = a0 + sweep * i / steps; to(ax + Math.cos(a) * r, ay + Math.sin(a) * r); }
        break;
      }
      case 'Z': cx = sx; cy = sy; ring = null; break;
    }
  }
  return rings;
}

/** Whether a point is inside a piece: even-odd where the piece says so, otherwise non-zero winding (as a canvas fills it). */
function inside(rings: readonly Ring[], evenOdd: boolean, x: number, y: number): boolean {
  let winding = 0, crossings = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i]!, [bx, by] = ring[(i + 1) % ring.length]!;
      if ((ay <= y) === (by <= y)) continue;
      // The edge straddles the ray to the right of the point: count it for even-odd, and by direction for winding.
      const side = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
      if (x < ax + (y - ay) * (bx - ax) / (by - ay)) crossings++;
      if (ay <= y && side > 0) winding++;
      else if (ay > y && side < 0) winding--;
    }
  }
  return evenOdd ? crossings % 2 === 1 : winding !== 0;
}

const flattenedPieces = (pieces: readonly PathPiece[]) => pieces.map(p => ({ rings: flatten(p.d), evenOdd: p.evenOdd === true }));
const covers = (pieces: readonly { rings: Ring[]; evenOdd: boolean }[], x: number, y: number) => pieces.some(p => inside(p.rings, p.evenOdd, x, y));

export interface ClothSpec {
  /** Cells across and rows down. */
  readonly width: number;
  readonly rows: number;
  /** Rows at the hem cut into a swallowtail (0 for a square hem). */
  readonly tail: number;
  /** Draw the arms' charges (only cloths wide enough to hold them). */
  readonly charges: boolean;
}

/**
 * The arms on a cloth, row by row: the shield's own second region and charges sampled at each cell (3 × 3 per cell,
 * a cell takes the tincture most of it shows), merged into runs, with the swallowtail cut out. The partition is
 * stretched to the cloth; the charges keep their proportions. A bordure runs round the cloth's edge.
 */
export function bannerRuns(design: ShieldDesign, spec: ClothSpec): Run[][] {
  const { width, rows } = spec;
  const region = design.pattern === 'bordure' ? null : secondRegion(design.pattern, design.line);
  const regionPieces = region ? flattenedPieces([region]) : [];
  const charge = spec.charges ? design.charge : undefined;
  const spots = charge ? chargeSpots(design) : [];
  const shape = charge ? flattenedPieces(chargeShape(charge.kind).pieces) : [];
  const border = Math.max(1, Math.round(width * BORDURE_WIDTH));
  const out: Run[][] = [];
  for (let row = 0; row < rows; row++) {
    const cells: (Tincture | null)[] = [];
    const fromHem = rows - 1 - row, centre = (width - 1) / 2;
    for (let col = 0; col < width; col++) {
      if (fromHem < spec.tail && Math.abs(col - centre) <= spec.tail - 1 - fromHem + (width % 2 === 0 ? 0.5 : 0)) { cells.push(null); continue; }
      let second = 0, charged = 0, chargedOnSecond = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const u = (col + (sx + 0.5) / 3) / width, v = (row + (sy + 0.5) / 3) / rows;
        const inSecond = design.pattern === 'bordure'
          ? col < border || col >= width - border || row < border || row >= rows - spec.tail - border
          : covers(regionPieces, u, v * SHIELD_ASPECT);
        if (inSecond) second++;
        // Charges keep their own proportions: a shield unit across is `width` cells, and the same many cells down.
        for (const s of spots) {
          const half = s.size / 2, cy = s.y / SHIELD_ASPECT * rows;
          const dx = (u - s.x) / half, dy = (row + (sy + 0.5) / 3 - cy) / width / half;
          if (covers(shape, dx, dy)) { charged++; if (inSecond) chargedOnSecond++; break; }
        }
      }
      const onSecond = second >= 5;
      let tincture: Tincture = onSecond ? design.second : design.field;
      if (charge && charged >= 5) {
        tincture = charge.tincture === 'counterchanged' ? (chargedOnSecond >= charged / 2 ? design.field : design.second) : charge.tincture;
      }
      cells.push(tincture);
    }
    const runs: Run[] = [];
    let start = 0;
    for (let col = 1; col <= width; col++) {
      if (col < width && cells[col] === cells[start]) continue;
      const t = cells[start];
      if (t) runs.push({ x0: start, x1: col, tincture: t });
      start = col;
    }
    out.push(runs);
  }
  return out;
}

// ---------------------------------------------------------------- parts

/** One cell of a tincture's fabric. Pivot: its minimum corner. */
export const dyeBlueprint = (kit: BannerKit, tincture: Tincture): VoxelBlueprint =>
  blueprint(`moment-raid-dye-${kit}-${tincture}`, kit, [1, 1, 1], [box(0, 0, 0, 1, 1, 1, TINCTURE_MAT[tincture])]);

/** The tilt over a covered wagon: highest along the middle, each column's top in cells (z 0..11). */
const TILT = Array.from({ length: 12 }, (_, z) => 8 + Math.round(10 * Math.sqrt(Math.max(0, 1 - ((z + 0.5 - 6) / 6.6) ** 2))));

/**
 * A raid wagon, front +x, in the gift cart's frame (pivot (9, 0, 6), wheels and pony as CART_CELLS). The pole rises
 * from the front board (x 17, z 5..7); the banner hangs in front of it (x 18), facing forward.
 */
export const RAID_WAGON_CELLS = {
  pivot: [9, 0, 6] as const,
  /** Where each banner hangs: its first row's top (y), the near edge across (z), the cloth's plane (x) and size. */
  standard: { x: 18, top: 41, z: 0.5, width: 11, rows: 16, tail: 3 },
  pennant: { x: 18, top: 28, z: 2.5, width: 7, rows: 10, tail: 2 },
  /** The lantern's flame, inside its cage on the arm. */
  lantern: [19.5, 12.6, 6.5] as const,
} as const;

export function raidWagonBlueprint(kit: BannerKit, kind: WagonKind, colour: Colour): VoxelBlueprint {
  const wood = MAT.timber, dark = MAT.bark, iron = MAT.darkStone, dye = TINCTURE_MAT[colour], boxes: Box[] = [];
  boxes.push(box(0, 4, 0, 18, 5, 12, wood));
  // Long rim and short exposed plank seams give the bed a built, rather than slab-like, edge.
  for (const z of [0, 11]) boxes.push(box(0, 4, z, 18, 5, z + 1, dark));
  for (const x of [4, 9, 14]) boxes.push(box(x, 4, 1, x + 1, 5, 11, MAT.bark));
  // Sideboards and end boards: a plain rail over a panel in the raider's colour, broken by dark posts.
  for (const z of [0, 11]) {
    boxes.push(box(0, 5, z, 18, 8, z + 1, wood), box(0, 6, z, 18, 8, z + 1, dye));
    boxes.push(box(1, 8, z, 17, 9, z + 1, wood));
    for (const x of [0, 6, 12, 17]) {
      boxes.push(box(x, 5, z, x + 1, 9, z + 1, dark));
      boxes.push(box(x, 7, z, x + 1, 8, z + 1, MAT.brass));
    }
  }
  for (const x of [0, 17]) boxes.push(box(x, 5, 1, x + 1, 8, 11, wood), box(x, 6, 1, x + 1, 8, 11, dye));
  if (kind !== 'covered') for (const x of [0, 17]) for (const z of [0, 11]) boxes.push(box(x, 9, z, x + 1, 10, z + 1, MAT.brass));
  for (const x of [3, 14]) boxes.push(box(x, 3, 0, x + 1, 4, 12, iron));
  for (const z of [2, 9]) boxes.push(box(18, 5, z, 25, 6, z + 1, wood), box(24, 5, z, 26, 6, z + 1, MAT.brass));
  boxes.push(box(18, 4, 2, 19, 5, 10, dark));
  if (kind === 'covered') {
    // A thin canvas shell follows the curved hoops; the ends stay open into the wagon.
    // Coloured seams wrap over the crown, and the timber ribs remain visible at each opening.
    for (let z = 0; z < 12; z++) {
      const top = TILT[z]!;
      const underside = Math.min(top, TILT[Math.max(0, z - 1)]!, TILT[Math.min(11, z + 1)]!) - 1;
      boxes.push(box(1, underside, z, 17, top, z + 1, MAT.cream));
      for (const x of [4, 9, 14]) boxes.push(box(x, underside, z, x + 1, top, z + 1, dye));
      for (const x of [1, 16]) boxes.push(box(x, top - 2, z, x + 1, top, z + 1, wood));
    }
    for (const x of [1, 16]) for (const z of [0, 11]) {
      boxes.push(box(x, 8, z, x + 1, TILT[z]! - 1, z + 1, wood));
      boxes.push(box(x, 8, z, x + 1, 9, z + 1, MAT.brass));
    }
    // Canvas skirts hang at the sides, leaving a walk-through opening at both ends.
    for (const z of [0, 11]) {
      boxes.push(box(2, 8, z, 16, TILT[z]! - 1, z + 1, MAT.cream));
      for (const x of [4, 9, 14]) boxes.push(box(x, 8, z, x + 1, TILT[z]! - 1, z + 1, dye));
    }
  }
  // The banner pole, its crossbar and finial: tall for the lead's standard, shorter for a pennant.
  const tall = kind === 'lead', top = tall ? 44 : 31, bar = tall ? 41 : 28, [z0, z1] = tall ? [-1, 13] : [2, 10];
  boxes.push(box(17, 8, 5, 18, top, 7, dark), box(17, bar, z0, 18, bar + 1, z1, wood));
  boxes.push(box(17, bar - 1, z0, 18, bar + 2, z0 + 1, MAT.brass), box(17, bar - 1, z1 - 1, 18, bar + 2, z1, MAT.brass));
  boxes.push(box(17, top, 5, 18, top + 2, 7, MAT.brass), box(17, top + 2, 5, 18, top + 3, 7, MAT.goldLeaf));
  // The lantern on its arm over the shafts: an iron cage, open at the sides, a brass cap.
  boxes.push(box(18, 15, 5, 21, 16, 7, dark));
  boxes.push(box(18, 11, 5, 21, 12, 8, iron), box(18, 14, 5, 21, 15, 8, MAT.brass));
  for (const [x, z] of [[18, 5], [20, 5], [18, 7], [20, 7]] as const) boxes.push(box(x, 12, z, x + 1, 14, z + 1, iron));
  return shifted(`moment-raid-wagon-${kind}-${kit}-${colour}`, kit, boxes);
}

/** Boxes may start below zero (the lead's crossbar overhangs the bed): shift them into a blueprint and keep the pivot honest. */
function shifted(id: string, kit: BannerKit, boxes: Box[]): VoxelBlueprint {
  const min = [0, 1, 2].map(a => Math.min(0, ...boxes.map(b => b.from[a]!)));
  const moved = boxes.map(b => ({ ...b, from: b.from.map((v, a) => v - min[a]!) as Box['from'], to: b.to.map((v, a) => v - min[a]!) as Box['to'] }));
  const size = [0, 1, 2].map(a => Math.max(...moved.map(b => b.to[a]!))) as [number, number, number];
  return blueprint(id, kit, size, moved);
}
/** Where a raid wagon's cell (0, 0, 0) landed in its blueprint, so the view can place the pivot. */
export const RAID_WAGON_ORIGIN: Readonly<Record<WagonKind, readonly [number, number, number]>> = { lead: [0, 0, 1], covered: [0, 0, 0], lantern: [0, 0, 0] };

/** A pony in the raider's colour: the gift pony with the saddle cloth dyed. */
export const raidPonyBlueprint = (kit: BannerKit, colour: Colour) => ponyBlueprint(kit, { material: TINCTURE_MAT[colour], tag: `raid-${colour}` });

export type AdornmentKind = 'lantern-rack' | 'banner-bundle' | 'cloth-roll';
/** Fittings pivot at their bottom centre, in build cells. */
export const ADORNMENT_CELLS: Readonly<Record<AdornmentKind, readonly [number, number, number]>> = {
  'lantern-rack': [7, 11, 5], 'banner-bundle': [5, 10, 5], 'cloth-roll': [6, 3, 4],
};

export function adornmentBlueprint(kit: BannerKit, kind: AdornmentKind): VoxelBlueprint {
  const boxes: Box[] = [];
  if (kind === 'lantern-rack') {
    // A small timber trestle carrying two framed, warm-coloured lanterns.
    boxes.push(box(0, 0, 0, 7, 1, 5, MAT.bark), box(1, 1, 2, 2, 10, 3, MAT.timber), box(5, 1, 2, 6, 10, 3, MAT.timber));
    boxes.push(box(0, 9, 2, 7, 10, 3, MAT.timber), box(0, 10, 2, 7, 11, 3, MAT.brass));
    for (const x of [1, 4]) {
      boxes.push(box(x, 3, 1, x + 2, 4, 4, MAT.darkStone), box(x, 7, 1, x + 2, 8, 4, MAT.brass));
      boxes.push(box(x, 4, 2, x + 2, 7, 3, MAT.fabricGold));
      for (const z of [1, 3]) boxes.push(box(x, 4, z, x + 1, 7, z + 1, MAT.darkStone));
    }
  } else if (kind === 'banner-bundle') {
    // Furled flags with visible poles and three restrained festival dyes.
    boxes.push(box(0, 0, 0, 5, 1, 5, MAT.bark));
    for (const [x, z, dye, height] of [[1, 1, MAT.fabricRed, 8], [3, 1, MAT.fabricBlue, 10], [2, 3, MAT.fabricGold, 9]] as const) {
      boxes.push(box(x, 1, z, x + 1, height, z + 1, MAT.timber));
      boxes.push(box(x, 3, z, x + 1, height - 1, z + 1, dye));
      boxes.push(box(x, 2, z, x + 1, 3, z + 1, MAT.brass), box(x, height - 1, z, x + 1, height, z + 1, MAT.brass));
    }
  } else {
    // One canvas roll with tucked ends and two binding bands.
    boxes.push(box(0, 0, 1, 6, 3, 3, MAT.cream), box(0, 1, 0, 6, 2, 4, MAT.cream));
    for (const x of [1, 4]) boxes.push(box(x, 0, 1, x + 1, 3, 3, MAT.fabricRed), box(x, 1, 0, x + 1, 2, 4, MAT.fabricRed));
    boxes.push(box(0, 1, 1, 1, 2, 3, MAT.fabricGold), box(5, 1, 1, 6, 2, 3, MAT.fabricGold));
  }
  return blueprint(`moment-raid-${kind}-${kit}`, kit, [...ADORNMENT_CELLS[kind]] as [number, number, number], boxes);
}

export interface AdornmentSeat { readonly kind: AdornmentKind; readonly at: readonly [number, number, number]; readonly turn: boolean }
const hashOf = (seed: number, salt: number) => { let h = Math.imul(seed ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b) >>> 0; h ^= h >>> 13; return Math.imul(h, 0xc2b2ae35) >>> 0; };

/** The lead bears its festival lamps; the following open wagon varies its cloth and standards deterministically. */
export function adornmentsOf(kind: WagonKind, seed: number, index: number): AdornmentSeat[] {
  if (kind === 'covered') return [];
  const turn = (hashOf(seed, index) & 1) === 0;
  if (kind === 'lead') return [
    { kind: 'lantern-rack', at: [6, 5, 6], turn: false },
    { kind: 'banner-bundle', at: [12, 5, 8], turn },
    { kind: 'cloth-roll', at: [12, 5, 3], turn: false },
  ];
  return [
    { kind: 'lantern-rack', at: [5, 5, 6], turn: false },
    { kind: 'lantern-rack', at: [13, 5, 6], turn: false },
  ];
}

/** A brazier on a stone plinth, 1.25 m high; the fire burns on its coals. Pivot: bottom centre. */
export const BRAZIER_CELLS = { size: [8, 10, 8] as const, pivot: [4, 0, 4] as const, fire: [4, 9.2, 4] as const } as const;

export function brazierBlueprint(kit: BannerKit): VoxelBlueprint {
  const iron = MAT.darkStone, boxes: Box[] = [];
  boxes.push(box(1, 0, 1, 7, 1, 7, iron), box(2, 1, 2, 6, 6, 6, MAT.limestone), box(1, 6, 1, 7, 7, 7, iron), box(1, 7, 1, 7, 8, 7, iron));
  boxes.push(box(0, 8, 0, 8, 10, 1, iron), box(0, 8, 7, 8, 10, 8, iron), box(0, 8, 1, 1, 10, 7, iron), box(7, 8, 1, 8, 10, 7, iron));
  for (let x = 1; x < 7; x++) for (let z = 1; z < 7; z++) boxes.push(box(x, 8, z, x + 1, 9, z + 1, (x * 3 + z * 5) % 4 === 0 ? MAT.terracotta : MAT.hairCopper));
  for (const [x, z] of [[0, 0], [7, 0], [0, 7], [7, 7]] as const) boxes.push(box(x, 10, z, x + 1, 11, z + 1, MAT.brass));
  return blueprint(`moment-raid-brazier-${kit}`, kit, [8, 11, 8], boxes);
}

/**
 * A torch post the town plants along its street for a raid: a 2.1 m timber post on a stone foot, a brass collar and
 * an iron cage holding the fire. It fits the chat lamp's .65 m footprint. Pivot: bottom centre; the fire sits in the cage.
 */
export const TORCH_CELLS = { size: [5, 18, 5] as const, pivot: [2.5, 0, 2.5] as const, fire: [2.5, 16.6, 2.5] as const } as const;

export function torchPostBlueprint(kit: BannerKit): VoxelBlueprint {
  const iron = MAT.darkStone, boxes: Box[] = [];
  boxes.push(box(0, 0, 0, 5, 1, 5, MAT.limestone), box(1, 1, 1, 4, 2, 4, MAT.limestone));
  boxes.push(box(2, 2, 2, 3, 15, 3, MAT.timber), box(1, 9, 1, 4, 10, 4, MAT.brass));
  boxes.push(box(1, 14, 1, 4, 15, 4, iron), box(2, 15, 2, 3, 16, 3, MAT.hairCopper));
  for (const [x, z] of [[1, 1], [3, 1], [1, 3], [3, 3]] as const) boxes.push(box(x, 15, z, x + 1, 18, z + 1, iron));
  return blueprint(`moment-raid-torch-${kit}`, kit, [5, 18, 5], boxes);
}

/**
 * Torch pairs the town lights along its street, by the size of the column: one pair for a single treasured wagon,
 * then wider avenues up to six pairs. The smallest raid stays intimate; the largest reads as a whole street turned out.
 */
export const torchPairs = (units: number): number => Math.max(1, Math.min(6, Math.round(1 + (Math.max(1, units) - 1) * 5 / 11)));

/** Sky lanterns released over the column for the biggest raids only ("Lanterns fill the road"), per visible wagon. */
export const skyLanternsPerWagon = (viewers: number): number => viewers >= 50_000 ? 9 : viewers >= 10_000 ? 6 : 0;

/**
 * The gate's standard: a 7.5 m pole on a stone footing with brass collars, a crossbar at 7 m and a gilt finial. The
 * cloth hangs in front of the pole (z 4) from under the crossbar. Local x runs across the road, z into the town.
 */
export const GATE_CELLS = {
  size: [16, 64, 6] as const, pivot: [8, 0, 3] as const,
  cloth: { x: 1.5, top: 56, z: 4, width: 13, rows: 22, tail: 3 },
  /** Where the furled standard waits before it is hoisted (its lowest y), and the caption's anchor over the crossbar. */
  rollFrom: 12, caption: [8, 58.5, 3] as const,
} as const;

export function gatePoleBlueprint(kit: BannerKit): VoxelBlueprint {
  const boxes: Box[] = [];
  boxes.push(box(4, 0, 0, 12, 2, 6, MAT.limestone), box(5, 2, 1, 11, 3, 5, MAT.darkStone));
  boxes.push(box(7, 3, 2, 9, 60, 4, MAT.timber));
  for (const y of [22, 40]) boxes.push(box(6, y, 1, 10, y + 1, 5, MAT.brass));
  boxes.push(box(0, 56, 2, 16, 57, 4, MAT.timber), box(0, 55, 1, 1, 58, 5, MAT.brass), box(15, 55, 1, 16, 58, 5, MAT.brass));
  boxes.push(box(7, 60, 2, 9, 62, 4, MAT.brass), box(6, 62, 1, 10, 63, 5, MAT.goldLeaf), box(7, 63, 2, 9, 64, 4, MAT.goldLeaf));
  return blueprint(`moment-raid-gate-pole-${kit}`, kit, [16, 64, 6], boxes);
}

/** Every raid part, meshed up front: dyes, wagons and ponies in each colour, festival fittings, the brazier, the torch post and the pole. */
export function raidParts(kit: BannerKit): VoxelBlueprint[] {
  return [
    ...TINCTURE_LIST.map(t => dyeBlueprint(kit, t)),
    ...COLOURS.flatMap(c => [...(['lead', 'covered', 'lantern'] as const).map(k => raidWagonBlueprint(kit, k, c)), raidPonyBlueprint(kit, c)]),
    ...(['lantern-rack', 'banner-bundle', 'cloth-roll'] as const).map(k => adornmentBlueprint(kit, k)),
    brazierBlueprint(kit), torchPostBlueprint(kit), gatePoleBlueprint(kit),
  ];
}
