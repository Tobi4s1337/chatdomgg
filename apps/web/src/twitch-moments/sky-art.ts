import { MAT } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';
import { blueprint, box, field, type BannerKit, type Box } from './banner';
import { hash01 } from './spectacle';

/**
 * Sky pieces in build cells (0.125 m), authored for this lane. Every blueprint's origin is its minimum corner; the
 * `*_CELLS` constants say where each pivot sits so the view can place and animate it.
 *
 * - The Hearthbeast: the kingdom's great beast, a winged hearth-lion with a plush mane, feathered wings and a long
 *   tufted tail, soft and round everywhere (the dragon is the sharp one). Facing +x, +y up, +z its right side. It
 *   is meshed in build cells and flown at `BEAST_SCALE`, so one of its voxels is 0.25 m and its wingspan 16 m.
 *   Body, mane, head, two-segment wings, three tail segments and four tucked legs are separate rigid parts. The
 *   eyes and the ember heart are glow pieces the view adds at `HEAD_CELLS.eyes` and `BODY_CELLS.ember`.
 * - Kites: a diamond sail in the kingdom's cloth with cream panels and a gold edge on timber spars; the cheerer's
 *   leading kite has a double gold edge and a brass boss. Bow ties hang from the tail line in cloth, cream or gold.
 * - The float's basket: a small wicker gondola with a brass rim, a cloth band and a pennant, hung under a giant
 *   emote by its ropes.
 * - Threads: one-cell motes the view stretches into string, tail line and rope.
 */

/** The beast's voxels are this many build cells: 0.25 m. */
export const BEAST_SCALE = 2;

/** Fill a grid by sampling every cell centre; runs of one material along x become one box. */
function sculpt(id: string, kit: BannerKit, size: [number, number, number], fill: (x: number, y: number, z: number) => number): VoxelBlueprint {
  const boxes: Box[] = [];
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) {
    let start = 0, run = fill(0.5, y + 0.5, z + 0.5);
    for (let x = 1; x <= size[0]; x++) {
      const next = x < size[0] ? fill(x + 0.5, y + 0.5, z + 0.5) : -1;
      if (next === run) continue;
      if (run !== MAT.air) boxes.push(box(start, y, z, x, y + 1, z + 1, run));
      start = x; run = next;
    }
  }
  return blueprint(id, kit, size, boxes);
}

/** Squared normalised distance to an ellipsoid's centre: below 1 inside. */
const ell = (x: number, y: number, z: number, c: readonly [number, number, number], r: readonly [number, number, number]) =>
  ((x - c[0]) / r[0]) ** 2 + ((y - c[1]) / r[1]) ** 2 + ((z - c[2]) / r[2]) ** 2;
/** A fixed per-cell grain, so fur flecks never shimmer between builds. */
const grain = (x: number, y: number, z: number, salt: number) => hash01(Math.floor(x) * 73_856_093 ^ Math.floor(y) * 19_349_663 ^ Math.floor(z) * 83_492_791, salt);
const mirror = (side: 1 | -1, z: number, depth: number) => (side === 1 ? z : depth - z);

// ---------------------------------------------------------------- the Hearthbeast

/** Coat, belly and the gold mantle between the shoulders. */
const COAT = MAT.plaster, BELLY = MAT.cream, MANTLE = MAT.hairGold;

/**
 * Body: 28 × 17 × 17, a soft deep-chested egg from haunch (x 0) to chest (x 28) with a cream belly and a gold
 * mantle between the shoulders. Pivot: its centre (14, 8.5, 8.5). A warm ring of fur round a pocket low on the
 * chest holds the ember.
 */
export const BODY_CELLS = {
  size: [28, 17, 17] as const, pivot: [14, 8.5, 8.5] as const,
  /** The ember heart's centre, in the pocket low on the chest. */
  ember: [25.6, 5.2, 8.5] as const,
  /** Wing shoulders, right (+z) then left. */
  shoulders: [[16.5, 14.5, 14], [16.5, 14.5, 3]] as const,
  /** Where the mane's pivot and the head's neck joint sit. */
  neck: [25.5, 11.5, 8.5] as const, mane: [23.5, 13, 8.5] as const,
  tail: [1.5, 10.5, 8.5] as const,
  /** Leg hips: fore right, fore left, hind right, hind left. */
  legs: [[21.5, 5, 12], [21.5, 5, 5], [6.5, 5.5, 12], [6.5, 5.5, 5]] as const,
} as const;

export function beastBody(kit: BannerKit): VoxelBlueprint {
  const { ember } = BODY_CELLS;
  return sculpt(`moment-beast-${kit}-body`, kit, [28, 17, 17], (x, y, z) => {
    const inside = ell(x, y, z, [19.5, 8.8, 8.5], [8, 7.6, 7.8]) < 1 || ell(x, y, z, [13, 8.5, 8.5], [9.5, 6.9, 7.3]) < 1
      || ell(x, y, z, [6.5, 8.9, 8.5], [6.4, 6.9, 7.2]) < 1 || ell(x, y, z, [24.5, 11.2, 8.5], [3.4, 4.4, 4.8]) < 1;
    if (!inside) return MAT.air;
    const heart = Math.hypot(x - ember[0], y - ember[1], z - ember[2]);
    if (heart < 1.5) return MAT.air;
    if (heart < 3.1) return heart < 2.3 ? MAT.fabricOrange : MAT.fabricGold;
    // The belly is a shade lighter and runs up the chest; the mantle is a soft gold saddle under the wings.
    if (y < 6.6 + Math.max(0, x - 18) * 0.4) return grain(x, y, z, 1) < 0.1 ? MAT.skin1 : BELLY;
    if (y > 13.4 && x > 9 && x < 23) return grain(x, y, z, 2) < 0.18 ? MAT.fabricGold : MANTLE;
    return grain(x, y, z, 3) < 0.07 ? MAT.cream : COAT;
  });
}

/**
 * Mane: a plush domed ruff around the neck, 13 × 24 × 24. Each radius is a rounded lens of fur, thickest at the
 * core and swept back toward the lumpy rim, shorter underneath so it never hangs through the chest; gold at the
 * heart warming to orange, with terracotta only on the outermost tufts. The face pushes out of its front.
 * Pivot: the ruff's centre (6.5, 12, 12); it sits at `BODY_CELLS.mane`.
 */
export const MANE_CELLS = { size: [13, 24, 24] as const, pivot: [6.5, 12, 12] as const } as const;

export function beastMane(kit: BannerKit): VoxelBlueprint {
  return sculpt(`moment-beast-${kit}-mane`, kit, [13, 24, 24], (x, y, z) => {
    const dy = y - 12, dz = z - 12, rho = Math.hypot(dy, dz), theta = Math.atan2(dy, dz);
    const under = Math.max(0, -Math.sin(theta));
    const outer = 9.6 + 1.3 * Math.cos(7 * theta + 0.5) + 0.5 * Math.cos(13 * theta + 1.1) - 2.6 * under * under;
    const k = rho / outer;
    if (k > 1) return MAT.air;
    const centre = 6.8 - 0.32 * rho, half = 0.9 + 5.3 * Math.sqrt(Math.max(0, 1 - k * k));
    if (Math.abs(x - centre) > half) return MAT.air;
    // Locks: a fixed streak per angle so the fur reads as strands rather than noise.
    const lock = hash01(Math.floor((theta + Math.PI) * 9), 9) - 0.5;
    const tone = k * 0.9 + lock * 0.18 + (grain(x, y, z, 4) - 0.5) * 0.12;
    return tone > 0.95 ? MAT.terracotta : tone > 0.72 ? MAT.fabricOrange : tone > 0.42 ? MAT.fabricGold : MAT.hairGold;
  });
}

/**
 * Head: 15 × 14 × 12, facing +x. A big round skull with cheek ruffs and a crown tuft, a cream muzzle with a dark
 * button nose and a small smile, rounded ears with rose insides and two eye pockets for the glow. Pivot: the neck
 * joint (2, 4, 6).
 */
export const HEAD_CELLS = {
  size: [15, 14, 12] as const, pivot: [2, 4, 6] as const,
  /** Eye glow centres (right, left) and their size in cells. */
  eyes: [[11.4, 7.5, 8.5], [11.4, 7.5, 3.5]] as const, eyeSize: [1.3, 1.7, 1.15] as const,
} as const;

export function beastHead(kit: BannerKit): VoxelBlueprint {
  return sculpt(`moment-beast-${kit}-head`, kit, [15, 14, 12], (x, y, z) => {
    const side = Math.abs(z - 6);
    // Eye pockets: the glow sits a hair proud of the face.
    if (x > 10.9 && y > 6.4 && y < 8.4 && Math.abs(side - 2.5) < 0.6) return MAT.air;
    const skull = ell(x, y, z, [6.8, 7, 6], [5.4, 5.3, 5.4]);
    const muzzle = ell(x, y, z, [11.6, 4.9, 6], [3, 2.6, 3.2]);
    const nose = ell(x, y, z, [14, 5.7, 6], [1, 0.9, 1.4]);
    const cheek = Math.min(ell(x, y, z, [7.4, 4.8, 1.6], [3.3, 3, 2]), ell(x, y, z, [7.4, 4.8, 10.4], [3.3, 3, 2]));
    const crown = ell(x, y, z, [5.2, 12, 6], [3.2, 1.9, 3]);
    const ear = Math.min(ell(x, y, z, [4.4, 12, 2.3], [1.7, 2.2, 1.3]), ell(x, y, z, [4.4, 12, 9.7], [1.7, 2.2, 1.3]));
    if (nose < 1) return MAT.bark;
    if (ear < 1) return ear < 0.45 && x > 4.4 ? MAT.petal : COAT;
    if (muzzle < 1) return x > 13 && y > 3 && y < 4 && side < 1.6 && side > 0.4 ? MAT.hairBrown : MAT.cream;  // a small smile
    if (skull < 1) {
      if (x > 10.2 && y > 8.4 && y < 9.4 && Math.abs(side - 2.5) < 1.2) return MANTLE;  // soft brows
      return x > 9.5 && y < 6.2 ? BELLY : grain(x, y, z, 5) < 0.06 ? MAT.cream : COAT;
    }
    if (cheek < 1) return grain(x, y, z, 6) < 0.5 ? MAT.hairGold : MAT.fabricGold;
    if (crown < 1) return grain(x, y, z, 7) < 0.6 ? MAT.hairGold : MAT.fabricGold;
    return MAT.air;
  });
}

/**
 * Inner wing: chord along x (leading edge at x 14 toward the front), span along z from the shoulder (z 0) to the
 * wrist (z 12), 3 cells thick at the leading edge thinning to one layer of broad secondaries with terracotta tips.
 * Right wing grows toward +z; the left is its mirror. Pivot: the shoulder (14, 1.5, 0), or (14, 1.5, 13) mirrored.
 */
export const WING_INNER_CELLS = { size: [16, 3, 13] as const, pivot: [14, 1.5, 0] as const, wrist: [13.4, 1.5, 12] as const } as const;
/** Outer wing: wrist (z 0) to the splayed primaries (z 16). Pivot: the wrist (14, 1, 0), or (14, 1, 16) mirrored. */
export const WING_OUTER_CELLS = { size: [15, 2, 16] as const, pivot: [14, 1, 0] as const } as const;

export function beastWingInner(kit: BannerKit, side: 1 | -1): VoxelBlueprint {
  const depth = WING_INNER_CELLS.size[2];
  return sculpt(`moment-beast-${kit}-wing-inner-${side === 1 ? 'r' : 'l'}`, kit, [16, 3, 13], (x, y, zz) => {
    const z = mirror(side, zz, depth);
    const lead = 14.6 - 0.1 * z, chord = 13.4 - 0.2 * z;
    // Secondaries: two-cell feathers, every other one a cell shorter, so the trailing edge scallops.
    const feather = Math.floor(z / 2), notch = feather % 2 === 1 ? 0.9 : 0;
    const rel = lead - x, tail = chord - notch;
    if (rel < 0 || rel > tail) return MAT.air;
    if (y > 2 && rel > 5.2) return MAT.air;
    if (y < 1 && rel > 2.4) return MAT.air;
    if (rel < 2.4) return COAT;
    if (rel < 5.4) return y > 2 && (Math.floor(z) + Math.floor(x / 2)) % 3 === 0 ? MANTLE : MAT.cream;
    if (rel < 8) return feather % 2 === 0 ? MAT.hairGold : MAT.fabricGold;
    if (rel > tail - 1.5) return MAT.terracotta;
    if (rel > tail - 2.8) return MAT.fabricOrange;
    return MAT.cream;
  });
}

export function beastWingOuter(kit: BannerKit, side: 1 | -1): VoxelBlueprint {
  const depth = WING_OUTER_CELLS.size[2];
  return sculpt(`moment-beast-${kit}-wing-outer-${side === 1 ? 'r' : 'l'}`, kit, [15, 2, 16], (x, y, zz) => {
    const z = mirror(side, zz, depth);
    const lead = 14.6 - 0.32 * z, rel = lead - x;
    if (rel < 0) return MAT.air;
    // Past the coverts the primaries part into long fingers, each a little shorter than the one before it.
    const finger = Math.floor(rel / 2.9), inFinger = rel - finger * 2.9 < 2.1;
    const reach = 16 - finger * 1.3, chord = 11.6 - 0.2 * z;
    if (z > 8.5 ? !inFinger || z > reach || rel > 12 - 0.1 * z : rel > chord) return MAT.air;
    if (y < 1 && (rel > 2 || z > 8)) return MAT.air;
    if (rel < 1.8 && z < 9) return COAT;
    const tip = z > 8.5 ? reach - z : chord - rel;
    if (tip < 1.6) return MAT.terracotta;
    if (tip < 3) return MAT.fabricOrange;
    if (z > 8.5 || rel > 4.5) return finger % 2 === 0 ? MAT.fabricGold : MAT.hairGold;
    return MAT.cream;
  });
}

/** Tail segments run toward −x from a pivot at their front centre; the tuft ends in a plush mane-coloured brush. */
export const TAIL_CELLS = {
  base: { size: [8, 6, 6] as const, pivot: [8, 3, 3] as const, next: [0.5, 3, 3] as const },
  mid: { size: [8, 5, 5] as const, pivot: [8, 2.5, 2.5] as const, next: [0.5, 2.5, 2.5] as const },
  tuft: { size: [10, 8, 8] as const, pivot: [10, 4, 4] as const },
} as const;

export function beastTail(kit: BannerKit, segment: 'base' | 'mid' | 'tuft'): VoxelBlueprint {
  const { size } = TAIL_CELLS[segment], c = size[1] / 2;
  return sculpt(`moment-beast-${kit}-tail-${segment}`, kit, [size[0], size[1], size[2]], (x, y, z) => {
    const r = Math.hypot(y - c, z - c);
    if (segment === 'tuft') {
      const brush = ell(x, y, z, [4, 4, 4], [4, 3.7, 3.7]);
      if (brush < 1) {
        const tone = (1 - x / 8) * 0.85 + (grain(x, y, z, 8) - 0.5) * 0.25;
        return tone > 0.8 ? MAT.terracotta : tone > 0.55 ? MAT.fabricOrange : tone > 0.25 ? MAT.fabricGold : MAT.hairGold;
      }
      return x > 7 && r < 1.6 ? COAT : MAT.air;
    }
    const radius = segment === 'base' ? 2.05 + x * 0.06 : 1.6 + x * 0.05;
    return r < radius ? (y < c - 0.8 ? MAT.cream : grain(x, y, z, 9) < 0.08 ? MAT.cream : COAT) : MAT.air;
  });
}

/**
 * Legs, tucked in flight: a soft foreleg (4 × 8 × 3) and a heavier hind leg (5 × 9 × 4), each with a cream paw
 * and copper pads. Pivot: the hip at the top centre; they hang toward −y and fold back by rotating about z.
 */
export const LEG_CELLS = {
  fore: { size: [4, 8, 3] as const, pivot: [2, 8, 1.5] as const },
  hind: { size: [5, 9, 4] as const, pivot: [2.5, 9, 2] as const },
} as const;

export function beastLeg(kit: BannerKit, leg: 'fore' | 'hind'): VoxelBlueprint {
  const { size } = LEG_CELLS[leg], cz = size[2] / 2;
  return sculpt(`moment-beast-${kit}-leg-${leg}`, kit, [size[0], size[1], size[2]], (x, y, z) => {
    const top = size[1], width = leg === 'fore' ? 1.4 + (y / top) * 0.6 : 1.5 + (y / top) * 1.1;
    const paw = y < 2.2;
    const inside = Math.abs(x - size[0] / 2) < (paw ? size[0] / 2 : width) && Math.abs(z - cz) < (paw ? cz : Math.min(cz, width * 0.8));
    if (!inside) return MAT.air;
    if (paw) return y < 1 && x < size[0] / 2 + 0.6 ? MAT.forgeCopper : MAT.cream;
    return COAT;
  });
}

export function beastParts(kit: BannerKit) {
  return {
    body: beastBody(kit), mane: beastMane(kit), head: beastHead(kit),
    wingInner: [beastWingInner(kit, 1), beastWingInner(kit, -1)] as const,
    wingOuter: [beastWingOuter(kit, 1), beastWingOuter(kit, -1)] as const,
    tail: [beastTail(kit, 'base'), beastTail(kit, 'mid'), beastTail(kit, 'tuft')] as const,
    fore: beastLeg(kit, 'fore'), hind: beastLeg(kit, 'hind'),
  };
}

// ---------------------------------------------------------------- kites

/**
 * Kite: a 13 × 17 diamond sail (widest at row 11) one cell thick at z 1, timber spine and spar behind it (z 0) and
 * a brass boss on the front (z 2). Quarters alternate the kingdom's cloth and cream under a gold edge; the leader's
 * edge is doubled in gold leaf. +z faces the flyer. Pivot: the bridle at the boss, (6.5, 11.5, 2.5).
 */
export const KITE_CELLS = { size: [13, 17, 3] as const, bridle: [6.5, 11.5, 2.5] as const, tail: [6.5, 0, 1.5] as const } as const;

export function kiteBlueprint(kit: BannerKit, lead: boolean): VoxelBlueprint {
  const cloth = field(kit), boxes: Box[] = [];
  const [w, h] = KITE_CELLS.size, cx = 6.5, cy = 11;
  for (let y = 0; y < h; y++) {
    let start = -1, run: number = MAT.air;
    for (let x = 0; x <= w; x++) {
      const px = x + 0.5, py = y + 0.5;
      const reach = py >= cy ? 1 - (py - cy) / (h - cy) : 1 - (cy - py) / cy;
      const d = Math.abs(px - cx) / 6.5;
      let m: number = MAT.air;
      if (x < w && d <= reach + 0.02) {
        const edge = reach - d;
        m = edge < 0.16 ? MAT.fabricGold : lead && edge < 0.32 ? MAT.goldLeaf : (px < cx) === (py >= cy) ? cloth : MAT.cream;
      }
      if (m === run) continue;
      if (run !== MAT.air) boxes.push(box(start, y, 1, x, y + 1, 2, run));
      start = x; run = m;
    }
  }
  boxes.push(box(6, 0, 0, 7, h, 1, MAT.timber), box(0, 11, 0, w, 12, 1, MAT.timber));
  boxes.push(box(6, 11, 2, 7, 12, 3, MAT.brass));
  if (lead) boxes.push(box(5, 11, 2, 8, 12, 3, MAT.brass), box(6, 10, 2, 7, 13, 3, MAT.brass));
  return blueprint(`moment-kite-${kit}-${lead ? 'lead' : 'flock'}`, kit, [w, h, 3], boxes);
}

/** A bow tie on the tail line, 5 × 3 × 1 with a cream knot (brass on gold). Pivot: the knot (2.5, 1.5, 0.5). */
export const BOW_CELLS = { size: [5, 3, 1] as const, pivot: [2.5, 1.5, 0.5] as const } as const;
export type BowColour = 'cloth' | 'cream' | 'gold';

export function bowBlueprint(kit: BannerKit, colour: BowColour): VoxelBlueprint {
  const wing = colour === 'cloth' ? field(kit) : colour === 'cream' ? MAT.cream : MAT.fabricGold;
  const knot = colour === 'gold' ? MAT.brass : colour === 'cream' ? MAT.fabricGold : MAT.cream;
  return blueprint(`moment-kite-${kit}-bow-${colour}`, kit, [5, 3, 1], [
    box(0, 0, 0, 2, 3, 1, wing), box(3, 0, 0, 5, 3, 1, wing), box(2, 1, 0, 3, 2, 1, knot),
  ]);
}

// ---------------------------------------------------------------- the float's basket and the threads

/**
 * Basket: a 10 × 8 × 10 wicker gondola. Woven thatch walls (y 0..5) with a timber floor, a cloth band (y 3) and a
 * brass rim (y 5); a pennant pole rises at one corner with a swallow-tailed cloth flag. Pivot: the rim's centre
 * (5, 5.5, 5), where the ropes gather.
 */
export const BASKET_CELLS = { size: [10, 12, 10] as const, pivot: [5, 5.5, 5] as const, corners: [[0.5, 5.5, 0.5], [9.5, 5.5, 0.5], [0.5, 5.5, 9.5], [9.5, 5.5, 9.5]] as const } as const;

export function basketBlueprint(kit: BannerKit): VoxelBlueprint {
  const cloth = field(kit), boxes: Box[] = [box(1, 0, 1, 9, 1, 9, MAT.timber)];
  for (let y = 1; y < 5; y++) {
    // The weave: alternate thatch and bark by course so the wicker reads at a distance.
    const weave = y === 3 ? cloth : y % 2 === 0 ? MAT.bark : MAT.thatch;
    boxes.push(box(0, y, 0, 10, y + 1, 1, weave), box(0, y, 9, 10, y + 1, 10, weave), box(0, y, 1, 1, y + 1, 9, weave), box(9, y, 1, 10, y + 1, 9, weave));
  }
  boxes.push(box(0, 5, 0, 10, 6, 1, MAT.brass), box(0, 5, 9, 10, 6, 10, MAT.brass), box(0, 5, 1, 1, 6, 9, MAT.brass), box(9, 5, 1, 10, 6, 9, MAT.brass));
  boxes.push(box(8, 6, 8, 9, 12, 9, MAT.timber), box(8, 11, 8, 9, 12, 9, MAT.goldLeaf));
  boxes.push(box(5, 9, 8, 8, 11, 9, cloth), box(4, 10, 8, 5, 11, 9, cloth));
  return blueprint(`moment-float-${kit}-basket`, kit, [10, 12, 10], boxes);
}

export type ThreadColour = 'cream' | 'gold' | 'rope';
/** A single cell the view stretches into a stick along a string. Pivot: its centre (0.5, 0.5, 0.5). */
export function threadBlueprint(kit: BannerKit, colour: ThreadColour): VoxelBlueprint {
  const m = colour === 'cream' ? MAT.cream : colour === 'gold' ? MAT.goldLeaf : MAT.thatch;
  return blueprint(`moment-sky-${kit}-thread-${colour}`, kit, [1, 1, 1], [box(0, 0, 0, 1, 1, 1, m)]);
}

export function skyParts(kit: BannerKit): VoxelBlueprint[] {
  const beast = beastParts(kit);
  return [
    beast.body, beast.mane, beast.head, ...beast.wingInner, ...beast.wingOuter, ...beast.tail, beast.fore, beast.hind,
    kiteBlueprint(kit, false), kiteBlueprint(kit, true), bowBlueprint(kit, 'cloth'), bowBlueprint(kit, 'cream'), bowBlueprint(kit, 'gold'),
    basketBlueprint(kit), threadBlueprint(kit, 'cream'), threadBlueprint(kit, 'gold'), threadBlueprint(kit, 'rope'),
  ];
}
