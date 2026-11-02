import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../materials';

type Cell = [number, number, number];
type Box = VoxelBlueprint['boxes'][number];

/**
 * The hand-made carriers of the Forge's house slots (kit revision 3): the frame, board, box or post that holds a
 * motif on a home. A carrier never carries a subject of its own; the motif sits where the carrier says. Every
 * carrier is authored with its back on the wall plane (z 0) and its face toward the street (+Z), bottom at y 0.
 *
 * Front pieces show the motif as a small relief: `MOTIF_RELIEF` cells, `reliefAt` its back-bottom-left corner. A
 * relief at z 0 is let into the carrier's own face and stands one cell proud of it; at z 1 it stands on the face.
 * Every carrier is at most 3 cells deep: the fronts of Hearth and Tide homes stand 3 cells behind the lot edge.
 */
export const MOTIF_RELIEF: Cell = [12, 8, 2];

export type FacadeSlot = 'gable-crest' | 'clock' | 'door-crown' | 'wall-sign' | 'shield' | 'wreath' | 'window-box' | 'frieze' | 'bench' | 'planter' | 'bell' | 'letterbox';
export interface SlotCarrier {
  readonly size: Cell;
  readonly boxes: Box[];
  /** Back-bottom-left corners of the motif reliefs (the frieze carries two). */
  readonly reliefAt: readonly Cell[];
  /** A placement anchor in front of the piece: where a reveal looks and a glint may sit. */
  readonly emitter: Cell;
}

/** Room each front place reserves, so every carrier it accepts fits. */
export const FACADE_CARRIER_SIZE: Readonly<Record<FacadeSlot, Cell>> = {
  'gable-crest': [16, 14, 3], clock: [16, 16, 3], shield: [14, 16, 3], wreath: [16, 16, 3],
  'wall-sign': [16, 15, 3], bell: [12, 15, 3], letterbox: [12, 12, 3],
  'door-crown': [20, 11, 3], 'window-box': [16, 9, 3], frieze: [26, 10, 3],
  bench: [18, 14, 3], planter: [14, 14, 3],
};

interface Tones { stone: number; trim: number; roof: number; wall: number; metal: number; light: number; dark: number; leaf: number; flower: number }
function tones(family: StyleKey): Tones {
  const s = STYLES[family];
  return {
    stone: s.stone, trim: s.trim, roof: s.roof, wall: s.wall,
    metal: family === 'grove' ? MAT.goldLeaf : MAT.brass,
    light: family === 'tide' ? MAT.cream : MAT.limestone,
    dark: family === 'grove' ? MAT.bark : MAT.darkStone,
    leaf: family === 'grove' ? MAT.moss : MAT.leaf,
    flower: family === 'tide' ? MAT.blueFlower : MAT.petal,
  };
}

class Frame {
  readonly boxes: Box[] = [];
  constructor(readonly id: string, readonly size: Cell) {}
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): this {
    const from: Cell = [x0, y0, z0], to: Cell = [x1, y1, z1];
    if (from.some((v, i) => v < 0 || v >= to[i]! || to[i]! > this.size[i]!)) throw new Error(`${this.id}: box ${from}..${to} leaves ${this.size}.`);
    this.boxes.push({ from, to, material });
    return this;
  }
  /** A filled disc in the wall plane, centred between cells (cx, cy) with radius r, one layer at [z0, z1). */
  disc(cx: number, cy: number, r: number, z0: number, z1: number, material: number, inner = -1): this {
    for (let y = Math.floor(cy - r); y < Math.ceil(cy + r); y++) {
      let x0 = Infinity, x1 = -Infinity;
      for (let x = Math.floor(cx - r); x < Math.ceil(cx + r); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r && d > inner) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); }
        else if (x0 !== Infinity && x1 > x0 && d <= inner) { this.box(x0, y, z0, x1, y + 1, z1, material); x0 = Infinity; x1 = -Infinity; }
      }
      if (x0 !== Infinity) this.box(x0, y, z0, x1, y + 1, z1, material);
    }
    return this;
  }
  done(reliefAt: Cell[], emitter: Cell): SlotCarrier { return { size: [...this.size], boxes: this.boxes, reliefAt, emitter }; }
}

/** One carrier per front or doorstep slot, in the family's own materials. Unknown input throws. */
export function createSlotCarrier(slot: FacadeSlot, family: StyleKey): SlotCarrier {
  if (!(slot in FACADE_CARRIER_SIZE)) throw new Error(`Unknown Forge slot ${String(slot)}.`);
  if (!(family in STYLES)) throw new Error(`Unknown kingdom style ${String(family)}.`);
  const t = tones(family), size = FACADE_CARRIER_SIZE[slot], f = new Frame(`forge-slot-${slot}-${family}`, size);
  switch (slot) {
    case 'gable-crest': {
      // A carved roundel: a stone disc on a corbel, a trim rim, the motif proud of its face.
      f.disc(8, 7.5, 7, 0, 1, t.stone).disc(8, 7.5, 7, 1, 2, t.trim, 5.6);
      f.box(6, 0, 1, 10, 1, 2, t.trim);
      return f.done([[2, 3, 1]], [8, 7, 3]);
    }
    case 'clock': {
      // A gable clock: pale dial in a trim ring, twelve-three-six-nine marks, the motif as its face.
      f.disc(8, 8, 8, 0, 1, t.trim).disc(8, 8, 7, 1, 2, t.light);
      f.box(7, 14, 1, 9, 15, 3, t.dark).box(7, 1, 1, 9, 2, 3, t.dark).box(1, 7, 1, 2, 9, 3, t.dark).box(14, 7, 1, 15, 9, 3, t.dark);
      return f.done([[2, 4, 1]], [8, 8, 3]);
    }
    case 'shield': {
      // A heater shield in the kingdom's roof colour, metal rim, the motif as its charge.
      for (let y = 0; y < 16; y++) {
        const inset = y < 6 ? Math.ceil((6 - y) * 0.9) : 0;
        f.box(inset, y, 0, 14 - inset, y + 1, 1, t.metal);
        if (y > 0 && y < 15 && 14 - 2 * Math.max(inset, 1) > 0) f.box(Math.max(inset, 1), y, 1, 14 - Math.max(inset, 1), y + 1, 2, t.roof);
      }
      return f.done([[1, 5, 1]], [7, 9, 3]);
    }
    case 'wreath': {
      // A ring of leaves with flowers set in it and a bow at the foot; the motif hangs in its heart.
      f.disc(8, 8, 8, 0, 2, t.leaf, 5.5);
      for (const [x, y] of [[2, 11], [12, 12], [1, 5], [13, 5], [7, 14]] as const) f.box(x, y, 2, x + 2, y + 1, 3, t.flower);
      f.box(5, 0, 2, 11, 2, 3, t.flower).box(7, 0, 0, 9, 3, 2, t.dark);
      // The motif hangs on the wall in the ring's heart, tied to the ring by a cord.
      f.box(7, 12, 0, 9, 14, 1, t.dark);
      return f.done([[2, 4, 0]], [8, 8, 3]);
    }
    case 'wall-sign': {
      // A signboard on an iron arm: the arm and two short chains, the board hung flat to the wall, carved with the motif.
      f.box(0, 13, 0, 16, 14, 2, t.dark).box(0, 14, 0, 2, 15, 3, t.dark).box(14, 14, 0, 16, 15, 3, t.dark);
      f.box(2, 12, 0, 3, 13, 1, t.metal).box(13, 12, 0, 14, 13, 1, t.metal);
      f.box(1, 1, 0, 15, 12, 1, t.trim).box(1, 0, 0, 15, 1, 2, t.dark).box(1, 11, 1, 15, 12, 2, t.dark);
      return f.done([[2, 2, 1]], [8, 7, 3]);
    }
    case 'bell': {
      // A door bell: a carved back plate with the motif, a bracket, and a metal bell hung below.
      f.box(0, 6, 0, 12, 15, 1, t.trim);
      f.box(5, 4, 0, 7, 6, 3, t.dark);
      f.box(4, 3, 0, 8, 4, 3, t.metal).box(3, 1, 0, 9, 3, 3, t.metal).box(5, 0, 1, 7, 1, 2, t.dark);
      return f.done([[0, 7, 1]], [6, 2, 3]);
    }
    case 'letterbox': {
      // A wall letterbox: a deep box with a lid and a dark slot, the motif let into its front.
      f.box(0, 0, 0, 12, 11, 2, t.trim).box(0, 11, 0, 12, 12, 3, t.metal);
      f.box(2, 9, 2, 10, 10, 3, t.dark).box(0, 0, 2, 12, 1, 3, t.dark);
      return f.done([[0, 1, 1]], [6, 6, 3]);
    }
    case 'door-crown': {
      // A carved pediment over the door: a moulded lintel, a stepped gable rim, the motif in its tympanum.
      f.box(0, 0, 0, 20, 2, 3, t.trim);
      for (let y = 2; y < 11; y++) {
        const half = 10 - Math.max(0, y - 7) * 2, x0 = 10 - half, x1 = 10 + half;
        f.box(x0, y, 0, x1, y + 1, 1, t.stone);
        f.box(x0, y, 1, x0 + 1, y + 1, 2, t.trim).box(x1 - 1, y, 1, x1, y + 1, 2, t.trim);
      }
      f.box(9, 10, 1, 11, 11, 2, t.metal);
      return f.done([[4, 2, 1]], [10, 6, 3]);
    }
    case 'window-box': {
      // A planter box under the sill: plank body, soil, a low row of flowers, the motif let into its front.
      f.box(0, 0, 0, 16, 8, 2, t.trim).box(1, 7, 0, 15, 8, 2, MAT.earth);
      for (let x = 1; x < 15; x += 3) f.box(x, 8, 0, Math.min(15, x + 2), 9, 2, x % 2 ? t.flower : t.leaf);
      f.box(0, 0, 2, 2, 8, 3, t.dark).box(14, 0, 2, 16, 8, 3, t.dark);
      return f.done([[2, 0, 1]], [8, 4, 3]);
    }
    case 'frieze': {
      // A carved beam across the front: the motif in its middle panel between two rosettes and moulded rails.
      f.box(0, 0, 0, 26, 10, 1, t.trim).box(0, 0, 1, 26, 1, 3, t.dark).box(0, 9, 1, 26, 10, 3, t.dark);
      for (const x of [1, 22]) f.box(x, 3, 1, x + 3, 7, 2, t.metal).box(x + 1, 4, 2, x + 2, 6, 3, t.metal);
      return f.done([[7, 1, 1]], [13, 5, 3]);
    }
    case 'bench': {
      // A doorstep bench: legs, a plank seat, and a high back board against the wall with the motif let into it.
      f.box(1, 0, 1, 3, 4, 3, t.dark).box(15, 0, 1, 17, 4, 3, t.dark);
      f.box(0, 4, 0, 18, 5, 3, t.trim);
      f.box(1, 5, 0, 17, 14, 1, t.trim).box(0, 13, 0, 18, 14, 2, t.trim);
      return f.done([[3, 5, 0]], [9, 9, 3]);
    }
    case 'planter': {
      // A tall doorstep pot of the kingdom's stone with a rim; the motif rises from it, trained flat on the wall.
      f.box(3, 0, 0, 11, 1, 3, t.dark).box(2, 1, 0, 12, 5, 3, t.stone).box(1, 5, 0, 13, 6, 3, t.trim);
      f.box(3, 6, 0, 11, 7, 2, MAT.earth);
      return f.done([[1, 6, 0]], [7, 10, 3]);
    }
  }
}

/** The roof slots' own parts: a finial's spike, a guardian's plinth and a banner's pole and flag. */
export interface RoofCarrierParts { stem: number; plinth: number; flag: number; trim: number; metal: number; stone: number }
export function roofCarrierTones(family: StyleKey): RoofCarrierParts {
  const t = tones(family);
  return { stem: t.metal, plinth: t.stone, flag: MAT.cloth, trim: t.trim, metal: t.metal, stone: t.stone };
}
