import { MAT } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';
import { blueprint, box, type BannerKit, type Box } from './banner';
import { DRAGON_FORMS, hash01, type DragonForm } from './spectacle';

/**
 * The earned dragon in build cells (0.125 m), authored by hand for this lane as a rig of rigid parts. Local frame
 * of every part: +z forward (the way the dragon faces), +y up, +x the dragon's left. Every blueprint's origin is
 * its minimum corner; the `*_CELLS` constants say where its pivot sits and where its children attach, so the view
 * can hang the parts on joints. The view scales the whole rig by the form's `scale`.
 *
 * - Torso: chest, waist and hips with a shoulder hump, dark back, lighter flanks and banded belly plates, dorsal
 *   spines peaking over the shoulders. Neck, tail, legs and wings attach to it.
 * - Neck: four tapering segments, each with crest spines, nested ball joints so it bends without gaps.
 * - Head: skull with a heavy V brow over the eye sockets, a long snout with nostrils and upper teeth, swept horns,
 *   cheek spikes; the frill and crown of horns for the bonus forms. The lower jaw is its own part.
 * - Tail: five tapering segments and a tip with an arrowhead spade.
 * - Legs: fore and hind, each an upper and a lower part with a clawed foot.
 * - Wings: an inner arm with its membrane and an outer hand of three finger bones with scalloped membrane between
 *   them, authored for the left side and mirrored for the right.
 */

export interface DragonLook {
  readonly scheme: 'slate' | 'ink' | 'gold';
  /** More and taller spines, longer horns and cheek spikes: every form from the elder up. */
  readonly dense: boolean;
  /** Ember crest along the back, neck and tail (bonus level 10 and up). */
  readonly crest: boolean;
  /** Fanned frills behind the jaw (bonus level 25 and up). */
  readonly frill: boolean;
  /** A crown of horns around the skull (bonus level 50 and up). */
  readonly crown: boolean;
  /** Bright ember membranes with brass bones (bonus level 100 and the record). */
  readonly bright: boolean;
  /** Gilded belly plates and brass claws (the record). */
  readonly gilded: boolean;
  /** Rig scale: one build cell becomes `scale` × 0.125 m. Wingspan is about 125 cells × scale. */
  readonly scale: number;
  /** Glow colours, not palette materials: the eyes, and the breath's embers from hottest to coolest. */
  readonly eye: number;
  readonly embers: readonly number[];
}

const FIRE = [0xfff1b8, 0xffc35a, 0xff7a2a, 0xc23a1c] as const;
const BASE = { dense: false, crest: false, frill: false, crown: false, bright: false, gilded: false } as const;
export const DRAGON_LOOKS: Readonly<Record<DragonForm, DragonLook>> = {
  young: { ...BASE, scheme: 'slate', scale: 1.7, eye: 0xffc44d, embers: FIRE },
  elder: { ...BASE, scheme: 'ink', dense: true, scale: 2, eye: 0xff8a3d, embers: FIRE },
  '10': { ...BASE, scheme: 'ink', dense: true, crest: true, scale: 2.1, eye: 0xff8a3d, embers: FIRE },
  '25': { ...BASE, scheme: 'ink', dense: true, crest: true, frill: true, scale: 2.2, eye: 0xff7a2a, embers: FIRE },
  '50': { ...BASE, scheme: 'ink', dense: true, crest: true, frill: true, crown: true, scale: 2.3, eye: 0xff7a2a, embers: FIRE },
  '100': { ...BASE, scheme: 'ink', dense: true, crest: true, frill: true, crown: true, bright: true, scale: 2.45, eye: 0xffb347, embers: FIRE },
  record: { scheme: 'ink', dense: true, crest: true, frill: true, crown: true, bright: true, gilded: true, scale: 2.8, eye: 0xffd36a, embers: FIRE },
  golden: { ...BASE, scheme: 'gold', dense: true, frill: true, crown: true, scale: 2.3, eye: 0xfff4c8, embers: [0xffffff, 0xffeaa0, 0xffc94a, 0xc98a2a] },
};

interface Swatch {
  back: number; side: number; belly: number; seam: number; spine: number; tip: number; horn: number; claw: number; mouth: number; tooth: number;
  membrane: number; outer: number; edge: number; vein: number; bone: number; frill: number; spoke: number; crown: number;
}
const SCHEMES: Record<DragonLook['scheme'], Swatch> = {
  slate: { back: MAT.slate, side: MAT.waterbed, belly: MAT.cream, seam: MAT.limestone, spine: MAT.darkStone, tip: MAT.limestone, horn: MAT.limestone, claw: MAT.hairSilver,
    mouth: MAT.fabricMutedRed, tooth: MAT.cream, membrane: MAT.waterbed, outer: MAT.skinFeyMoss, edge: MAT.slate, vein: MAT.slate, bone: MAT.slate,
    frill: MAT.skinFeyMoss, spoke: MAT.limestone, crown: MAT.limestone },
  ink: { back: MAT.hairBlack, side: MAT.slate, belly: MAT.limestone, seam: MAT.thatch, spine: MAT.hairBlack, tip: MAT.brass, horn: MAT.brass, claw: MAT.hairSilver,
    mouth: MAT.fabricMutedRed, tooth: MAT.cream, membrane: MAT.fabricMutedViolet, outer: MAT.fabricViolet, edge: MAT.hairBlack, vein: MAT.hairBlack, bone: MAT.hairBlack,
    frill: MAT.fabricRed, spoke: MAT.brass, crown: MAT.goldLeaf },
  gold: { back: MAT.goldLeaf, side: MAT.fabricGold, belly: MAT.cream, seam: MAT.hairGold, spine: MAT.brass, tip: MAT.cream, horn: MAT.cream, claw: MAT.cream,
    mouth: MAT.fabricMutedRed, tooth: MAT.cream, membrane: MAT.fabricGold, outer: MAT.hairGold, edge: MAT.brass, vein: MAT.brass, bone: MAT.brass,
    frill: MAT.hairGold, spoke: MAT.brass, crown: MAT.hairSilver },
};
function swatch(look: DragonLook): Swatch {
  const s = { ...SCHEMES[look.scheme] };
  if (look.crest) { s.spine = MAT.fabricRed; s.tip = MAT.fabricOrange; }
  if (look.bright) Object.assign(s, { membrane: MAT.fabricRed, outer: MAT.fabricOrange, edge: MAT.fabricMutedRed, vein: MAT.brass, bone: MAT.brass });
  if (look.gilded) Object.assign(s, { belly: MAT.goldLeaf, seam: MAT.brass, claw: MAT.brass });
  return s;
}

/** A part's id names only the look flags that change it, so identical parts are shared between forms. */
function partId(look: DragonLook, kit: BannerKit, part: string, uses: string): string {
  const flags = [...uses].filter(f => ({ d: look.dense, c: look.crest, f: look.frill, k: look.crown, b: look.bright, g: look.gilded })[f]).join('');
  return `moment-dragon-${kit}-${look.scheme}${flags ? `.${flags}` : ''}-${part}`;
}

type V3 = readonly [number, number, number];
/** Deterministic speckle for dithering a colour boundary, so bands of scales never read as stripes. */
const speck = (x: number, y: number, z: number) => hash01(x * 92821 + y * 68917 + z * 51713, 17);

/** A part authored as solids in a cell grid, then packed into as few boxes as the colours allow. */
class Grid {
  readonly cells: Uint8Array;
  constructor(readonly size: V3) { this.cells = new Uint8Array(size[0] * size[1] * size[2]); }
  private index(x: number, y: number, z: number) { return x + this.size[0] * (y + this.size[1] * z); }
  private inside(x: number, y: number, z: number) { return x >= 0 && y >= 0 && z >= 0 && x < this.size[0] && y < this.size[1] && z < this.size[2]; }
  get(x: number, y: number, z: number): number { return this.inside(x, y, z) ? this.cells[this.index(x, y, z)]! : 0; }
  set(x: number, y: number, z: number, m: number): void { if (this.inside(x, y, z)) this.cells[this.index(x, y, z)] = m; }
  /** Every cell in the bounds whose centre passes `test`. */
  fill(lo: V3, hi: V3, test: (x: number, y: number, z: number) => boolean, m: number): void {
    for (let z = Math.max(0, Math.floor(lo[2])); z < Math.min(this.size[2], Math.ceil(hi[2])); z++)
      for (let y = Math.max(0, Math.floor(lo[1])); y < Math.min(this.size[1], Math.ceil(hi[1])); y++)
        for (let x = Math.max(0, Math.floor(lo[0])); x < Math.min(this.size[0], Math.ceil(hi[0])); x++)
          if (test(x + 0.5, y + 0.5, z + 0.5)) this.set(x, y, z, m);
  }
  ellipsoid(c: V3, r: V3, m: number): void {
    this.fill([c[0] - r[0], c[1] - r[1], c[2] - r[2]], [c[0] + r[0], c[1] + r[1], c[2] + r[2]],
      (x, y, z) => ((x - c[0]) / r[0]) ** 2 + ((y - c[1]) / r[1]) ** 2 + ((z - c[2]) / r[2]) ** 2 <= 1, m);
  }
  /** A tapered capsule from a (radius ra) to b (radius rb). */
  capsule(a: V3, b: V3, ra: number, rb: number, m: number): void {
    const r = Math.max(ra, rb), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const, dd = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1;
    this.fill([Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r], [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r], (x, y, z) => {
      const t = Math.max(0, Math.min(1, ((x - a[0]) * d[0] + (y - a[1]) * d[1] + (z - a[2]) * d[2]) / dd));
      return (x - a[0] - d[0] * t) ** 2 + (y - a[1] - d[1] * t) ** 2 + (z - a[2] - d[2] * t) ** 2 <= (ra + (rb - ra) * t) ** 2;
    }, m);
  }
  /** Tapered capsules through a polyline: horns, fingers, spikes. */
  chain(points: readonly V3[], radii: readonly number[], m: number): void {
    for (let i = 1; i < points.length; i++) this.capsule(points[i - 1]!, points[i]!, radii[i - 1]!, radii[i]!, m);
  }
  /** Recolour every solid cell. */
  paint(fn: (x: number, y: number, z: number, m: number) => number): void {
    for (let z = 0; z < this.size[2]; z++) for (let y = 0; y < this.size[1]; y++) for (let x = 0; x < this.size[0]; x++) {
      const m = this.get(x, y, z);
      if (m) this.set(x, y, z, fn(x, y, z, m));
    }
  }
  /** The highest solid cell in a column, or -1. */
  top(x: number, z: number): number { for (let y = this.size[1] - 1; y >= 0; y--) if (this.get(x, y, z)) return y; return -1; }
  /** Greedy packing: runs along x, grown up y, then deep along z, per material. */
  boxes(): Box[] {
    const [sx, sy, sz] = this.size, used = new Uint8Array(this.cells.length), out: Box[] = [];
    const free = (x: number, y: number, z: number, m: number) => this.cells[this.index(x, y, z)] === m && !used[this.index(x, y, z)];
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
      const m = this.cells[this.index(x, y, z)]!;
      if (!m || used[this.index(x, y, z)]) continue;
      let x1 = x + 1, y1 = y + 1, z1 = z + 1;
      while (x1 < sx && free(x1, y, z, m)) x1++;
      const row = (yy: number, zz: number) => { for (let i = x; i < x1; i++) if (!free(i, yy, zz, m)) return false; return true; };
      while (y1 < sy && row(y1, z)) y1++;
      const slab = (zz: number) => { for (let j = y; j < y1; j++) if (!row(j, zz)) return false; return true; };
      while (z1 < sz && slab(z1)) z1++;
      for (let k = z; k < z1; k++) for (let j = y; j < y1; j++) for (let i = x; i < x1; i++) used[this.index(i, j, k)] = 1;
      out.push(box(x, y, z, x1, y1, z1, m));
    }
    return out;
  }
}

/** A dorsal spine two cells wide (x0, x0 + 1) standing on the column's top at z0, tapering and leaning back. */
function spine(g: Grid, x0: number, z0: number, height: number, base: number, tip: number): void {
  const top = Math.max(g.top(x0, z0), g.top(x0 + 1, z0));
  if (top < 0 || height < 1) return;
  for (let k = 0; k < height; k++) for (let z = z0; z < (k < height - 1 ? z0 + 2 : z0 + 1); z++) {
    g.set(x0, top + 1 + k, z, k === height - 1 ? tip : base);
    g.set(x0 + 1, top + 1 + k, z, k === height - 1 ? tip : base);
  }
}
const bump = (z: number, at: number, width: number) => Math.exp(-(((z - at) / width) ** 2));

// ---------------------------------------------------------------- torso

/** Torso: 16 × 20 × 30, back at z 0, chest at z 29. Pivot (8, 8, 15), near the centre of mass. */
export const TORSO_CELLS = {
  size: [16, 20, 30] as const, pivot: [8, 8, 15] as const,
  neck: [8, 10, 28] as const, tail: [8, 8.5, 1.5] as const,
  /** Wing roots, left (+x) then right; the inner membrane's root chord runs back along the flank from here. */
  shoulders: [[13, 12, 21], [3, 12, 21]] as const,
  fore: [[13, 6, 22], [3, 6, 22]] as const, hind: [[13, 6, 6], [3, 6, 6]] as const,
  /** Pivot height over the ground, standing on all fours and lying on the belly. */
  stand: 16, lie: 7,
} as const;

function torso(look: DragonLook, kit: BannerKit): VoxelBlueprint {
  const s = swatch(look), g = new Grid(TORSO_CELLS.size);
  g.ellipsoid([8, 8, 20.5], [7, 6.5, 8.5], s.side);
  g.ellipsoid([8, 8, 12], [5.6, 5.6, 7], s.side);
  g.ellipsoid([8, 8.5, 5], [6, 5.5, 5.5], s.side);
  g.ellipsoid([8, 11, 21], [5, 3.2, 5.5], s.side);
  g.ellipsoid([8, 10, 27.5], [4.8, 4.6, 3], s.side);
  g.paint((x, y, z) => {
    const dx = Math.abs(x + 0.5 - 8), h = y + 0.5;
    if (h < 4.4 && dx < 4.4) return z % 3 === 0 ? s.seam : s.belly;
    return h > 10.6 - speck(x, y, z) * 1.6 ? s.back : s.side;
  });
  // Spines along the ridge, tallest over the shoulders with a second rise over the hips.
  for (let z = 3; z < 28; z += look.dense ? 2 : 3) spine(g, 7, z, Math.round((look.dense ? 2.2 : 1.4) + 2.4 * bump(z, 21, 5) + 1.2 * bump(z, 7, 4)), s.spine, s.tip);
  return blueprint(partId(look, kit, 'torso', 'dcg'), kit, [...TORSO_CELLS.size], g.boxes());
}

// ---------------------------------------------------------------- neck

/** Neck segment i: 10 × 14 × 9, pivot (5, 5, 1.5), the next segment (or the head) at (5, 5, 7.5). */
export const NECK_CELLS = { size: [10, 14, 9] as const, pivot: [5, 5, 1.5] as const, next: [5, 5, 7.5] as const, radius: [4.6, 4.2, 3.8, 3.4, 3.1] as const, count: 4 } as const;

function neck(look: DragonLook, kit: BannerKit, i: number): VoxelBlueprint {
  const s = swatch(look), g = new Grid(NECK_CELLS.size), r = NECK_CELLS.radius[i]!;
  // The back ball nests inside the previous segment's front, so a bend never opens a gap or a seam.
  g.capsule([5, 5, 1.5], [5, 5, 7.5], r * 0.9, NECK_CELLS.radius[i + 1]!, s.side);
  g.paint((x, y, z) => {
    const dx = Math.abs(x + 0.5 - 5), h = y + 0.5;
    if (h < 5 - r * 0.45 && dx < r * 0.8) return z % 3 === 1 ? s.seam : s.belly;
    return h > 5 + r * 0.38 - speck(x + 40 * i, y, z) * 1.4 ? s.back : s.side;
  });
  const tall = [3, 3, 2, 2][i]! - (look.dense ? 0 : 1);
  for (const z of look.dense ? [1, 3, 5] : [2, 5]) spine(g, 4, z, z === 3 ? tall - 1 : tall, s.spine, s.tip);
  return blueprint(partId(look, kit, `neck-${i}`, 'dcg'), kit, [...NECK_CELLS.size], g.boxes());
}

// ---------------------------------------------------------------- head and jaw

/**
 * Head: 16 × 20 × 24, pivot (8, 6, 4) at the neck joint; snout tip at z 22. The jaw hangs from its hinge at
 * (8, 5, 8.5); the mouth line is y 5. Eyes, nostrils and mouth are view anchors in head cells.
 */
export const HEAD_CELLS = {
  size: [16, 20, 24] as const, pivot: [8, 6, 4] as const, jaw: [8, 5, 8.5] as const,
  /** Glow box centres, left then right: half a cell proud of the dark sockets under the brow. */
  eyes: [[11.75, 9.5, 11], [4.25, 9.5, 11]] as const,
  nostrils: [8, 9, 21.5] as const, mouth: [8, 4.5, 21.5] as const, centre: [8, 8, 12] as const,
  /** The glow inside the mouth, seen when the jaw opens: centre and size. */
  maw: { centre: [8, 4.6, 15] as const, size: [4, 0.8, 10] as const },
} as const;
const snoutWidth = (z: number) => 4 - 1.5 * Math.max(0, z - 9) / 14;

function head(look: DragonLook, kit: BannerKit): VoxelBlueprint {
  const s = swatch(look), g = new Grid(HEAD_CELLS.size);
  g.ellipsoid([8, 7.5, 7.5], [4.6, 4.4, 4.8], s.side);
  for (const x of [5.2, 10.8]) g.ellipsoid([x, 5.4, 9.5], [2.2, 2, 3.2], s.side);
  // The snout narrows and slopes to the nose; its top edges are rounded off.
  g.fill([0, 5, 9], [16, 12, 23], (x, y, z) => {
    const hw = snoutWidth(z), top = 11 - 2.6 * (z - 9) / 14 - (z > 22 ? 1 : 0), dx = Math.abs(x - 8);
    return dx < hw && y < top && !(y > top - 1 && dx > hw - 1);
  }, s.side);
  g.paint((x, y, z) => (y + 0.5 > 9.3 - speck(x, y, z) * 1.2 ? s.back : y + 0.5 < 5 && z < 9 ? s.belly : s.side));
  // The palate, seen only when the jaw drops.
  g.fill([0, 5, 10], [16, 6, 23], (x, _y, z) => Math.abs(x - 8) < snoutWidth(z) - 1, s.mouth);
  // A heavy brow: a ledge over both eyes, rising to a V at its outer ends.
  for (let x = 3; x < 13; x++) for (let z = 10; z < 14; z++) {
    g.set(x, 10, z, s.back);
    if (Math.abs(x + 0.5 - 8) > 1.5 && z < 13) g.set(x, 11, z, s.back);
  }
  for (const x of [4, 11]) for (const z of [10, 11]) g.set(x, 9, z, MAT.hairBlack);
  for (const x of [6, 9]) g.set(x, 8, 21, s.mouth);
  g.chain([[8, 8.5, 18.5], [8, 10.2, 18]], [0.8, 0.4], s.horn);
  // Upper teeth along the jaw line, and a fang each side near the front.
  for (const z of [12, 14, 16, 18, 20]) {
    const k = Math.ceil(snoutWidth(z + 0.5) - 0.5) - 1;
    for (const x of [8 + k, 7 - k]) { g.set(x, 4, z, s.tooth); if (z === 20) g.set(x, 3, z, s.tooth); }
  }
  // Swept horns, longer and heavier from the elder up; cheek spikes for the dense forms.
  for (const side of [1, -1]) {
    const hx = (d: number) => 8 + side * d;
    if (look.dense) {
      g.chain([[hx(3), 11, 6], [hx(4.4), 13.5, 3.5], [hx(5.2), 16, 1.5], [hx(5), 18.2, 0.5]], [1.6, 1.2, 0.8, 0.45], s.horn);
      g.chain([[hx(4), 6, 7], [hx(6), 6.5, 4], [hx(7), 7, 2]], [1, 0.7, 0.45], s.spine);
    } else g.chain([[hx(3), 11, 6], [hx(4.2), 13, 3.5], [hx(4.8), 14.5, 1]], [1.4, 1, 0.55], s.horn);
    if (look.frill) {
      // A fan behind the jaw: three spokes with scalloped membrane between them, flaring outward as it reaches back.
      const spokes = [-0.9, 0, 0.9];
      g.fill([0, 0, 0], [16, 14, 7], (x, y, z) => {
        const vz = 6 - z, vy = y - 7, r = Math.hypot(vz, vy), phi = Math.atan2(vy, vz);
        if (r < 1.5 || Math.abs(phi) > 0.95) return false;
        const k = Math.min(1, Math.floor((phi + 0.9) / 0.9)), u = (phi - spokes[k]!) / 0.9;
        return r <= 6.2 * (1 - 0.2 * Math.sin(Math.PI * Math.max(0, Math.min(1, u)))) && Math.abs(Math.abs(x - 8) - (4.2 + r * 0.5)) < 0.5 && Math.sign(x - 8) === side;
      }, s.frill);
      for (const phi of spokes) g.chain([[hx(4.4), 7, 6], [hx(4.4 + 3), 7 + Math.sin(phi) * 6, 6 - Math.cos(phi) * 6]], [0.6, 0.45], s.spoke);
    }
  }
  if (look.crown) for (let k = -2; k <= 2; k++) {
    const x = 8 + k * 1.7;
    g.chain([[x, 10.5, 6], [x + k * 0.4, 12.6 + (2 - Math.abs(k)) * 0.8, 3.4]], [0.8, 0.4], s.crown);
  }
  return blueprint(partId(look, kit, 'head', 'dcfkg'), kit, [...HEAD_CELLS.size], g.boxes());
}

/** Lower jaw: 10 × 5 × 14, pivot (5, 4, 0.5) on its hinge at the top back; rotates about x to open. */
export const JAW_CELLS = { size: [10, 5, 14] as const, pivot: [5, 4, 0.5] as const } as const;

function jaw(look: DragonLook, kit: BannerKit): VoxelBlueprint {
  const s = swatch(look), g = new Grid(JAW_CELLS.size);
  const hw = (z: number) => 3.3 - z / 14, bottom = (z: number) => (z < 2 ? 1.5 : z > 10 ? 1.5 : 0.5);
  g.fill([0, 0, 0], [10, 4, 14], (x, y, z) => {
    const dx = Math.abs(x - 5);
    return dx < hw(z) && y >= bottom(z) && !(y < bottom(z) + 1 && dx > hw(z) - 1);
  }, s.side);
  g.paint((x, y, z) => {
    const dx = Math.abs(x + 0.5 - 5);
    if (y === 3 && dx < hw(z + 0.5) - 1) return s.mouth;
    return y + 0.5 < bottom(z + 0.5) + 1 ? (z % 3 === 0 ? s.seam : s.belly) : s.side;
  });
  for (const z of [5, 7, 9, 11]) {
    const k = Math.ceil(hw(z + 0.5) - 0.5) - 1;
    for (const x of [5 + k, 4 - k]) g.set(x, 4, z, s.tooth);
  }
  return blueprint(partId(look, kit, 'jaw', 'g'), kit, [...JAW_CELLS.size], g.boxes());
}

// ---------------------------------------------------------------- tail

/**
 * Tail segment i (0..4): 8 × 10 × 8, pivot (4, 4, 6.5) at its front, the next segment at (4, 4, 0.5); the chain
 * runs back along -z. The tip (segment 5) is 15 × 10 × 19 with its pivot at (7.5, 4.5, 17.5): a short taper into
 * an arrowhead spade, flat in the xz plane with a keel along its bone.
 */
export const TAIL_CELLS = {
  size: [8, 10, 8] as const, pivot: [4, 4, 6.5] as const, next: [4, 4, 0.5] as const, radius: [3.6, 3.1, 2.6, 2.2, 1.8, 1.4, 0.8] as const, count: 6,
  tip: { size: [15, 10, 19] as const, pivot: [7.5, 4.5, 17.5] as const },
} as const;

function tail(look: DragonLook, kit: BannerKit, i: number): VoxelBlueprint {
  const s = swatch(look), r = TAIL_CELLS.radius[i]!;
  if (i === TAIL_CELLS.count - 1) {
    const g = new Grid(TAIL_CELLS.tip.size);
    g.capsule([7.5, 4.5, 17.5], [7.5, 4.5, 10], r * 0.9, TAIL_CELLS.radius[i + 1]!, s.side);
    g.paint((x, y, z) => (y + 0.5 > 5 - speck(x, y, z) * 0.8 ? s.back : s.side));
    // The spade: an arrowhead pointing back, with two barbs swept forward.
    for (let z = 0; z < 12; z++) for (let x = 0; x < 15; x++) {
      const d = z + 0.5, dx = Math.abs(x + 0.5 - 7.5);
      const outer = d <= 7.5 ? 6.5 * d / 7.5 : 6.5 - (d - 7.5) * 2.2, notch = d > 7.5 ? (d - 7.5) * 2.4 : 0;
      if (dx > outer || (dx < notch && dx > 0.6)) continue;
      g.set(x, 4, z, dx < 0.6 ? s.bone : outer - dx < 1.2 ? s.edge : s.outer);
    }
    for (let z = 2; z < 9; z++) for (let y = 5; y < 5 + (z < 4 ? 1 : z < 7 ? 2 : 1); y++) g.set(7, y, z, s.membrane);
    return blueprint(partId(look, kit, `tail-${i}`, 'b'), kit, [...TAIL_CELLS.tip.size], g.boxes());
  }
  const g = new Grid(TAIL_CELLS.size);
  g.capsule([4, 4, 6.5], [4, 4, 0.5], r * 0.9, TAIL_CELLS.radius[i + 1]!, s.side);
  g.paint((x, y, z) => {
    const dx = Math.abs(x + 0.5 - 4), h = y + 0.5;
    if (h < 4 - r * 0.45 && dx < r * 0.75) return z % 3 === 2 ? s.seam : s.belly;
    return h > 4 + r * 0.35 - speck(x + 60 * i, y, z) * 1.2 ? s.back : s.side;
  });
  for (const z of look.dense ? [1, 3, 5] : [2, 5]) spine(g, 3, z, Math.max(1, Math.round((look.dense ? 2.4 : 1.8) - i * 0.4)), s.spine, s.tip);
  return blueprint(partId(look, kit, `tail-${i}`, 'dcg'), kit, [...TAIL_CELLS.size], g.boxes());
}

// ---------------------------------------------------------------- legs

/**
 * Legs hang down -y from their pivots and are symmetric in x, so one part serves both sides. Upper parts carry
 * the knee where the lower part hangs; each lower part ends in a clawed foot whose sole is `length` cells below
 * its pivot. Fore and hind legs both reach 14 cells from hip to sole.
 */
export const LEG_CELLS = {
  fore: { upper: { size: [7, 9, 7] as const, pivot: [3.5, 7.5, 3.5] as const, knee: [3.5, 1.5, 3.5] as const }, lower: { size: [7, 9, 9] as const, pivot: [3.5, 8, 3], length: 8 } },
  hind: { upper: { size: [8, 11, 10] as const, pivot: [4, 8, 4.5] as const, knee: [4, 2, 5.5] as const }, lower: { size: [7, 9, 10] as const, pivot: [3.5, 8, 3.5], length: 8 } },
} as const;

function leg(look: DragonLook, kit: BannerKit, which: 'fore' | 'hind', part: 'upper' | 'lower'): VoxelBlueprint {
  const s = swatch(look), spec = LEG_CELLS[which][part], g = new Grid(spec.size), cx = spec.size[0] / 2;
  if (part === 'upper' && which === 'fore') {
    g.ellipsoid([cx, 6.5, 3.5], [3, 2.6, 3], s.side);
    g.capsule([cx, 6.5, 3.5], [cx, 1.5, 3.5], 2.4, 1.8, s.side);
  } else if (part === 'upper') {
    g.ellipsoid([cx, 6.5, 4.5], [3.4, 3.8, 4.2], s.side);
    g.capsule([cx, 6, 4.5], [cx, 2, 5.5], 2.6, 2, s.side);
  } else {
    if (which === 'fore') g.capsule([cx, 8, 3], [cx, 2, 3.5], 1.9, 1.5, s.side);
    else g.chain([[cx, 8, 3.5], [cx, 3.5, 1.5], [cx, 1.5, 3.5]], [1.9, 1.4, 1.2], s.side);
    const heel = which === 'fore' ? 4.2 : 5, toe = spec.size[2] - 1;
    g.ellipsoid([cx, 1.2, heel], [2.8, 1.3, 2.8], s.side);
    for (const x of [cx - 2, cx, cx + 2]) {
      g.capsule([x, 0.9, heel + 1], [x, 0.8, toe - 0.6], 0.8, 0.7, s.side);
      g.set(Math.floor(x), 0, toe, s.claw); g.set(Math.floor(x), 1, toe, s.claw);
    }
  }
  g.paint((x, y, z, m) => (m === s.claw ? m : y + 0.5 > spec.size[1] - 2.6 - speck(x, y, z + 20) * 1.5 ? s.back : s.side));
  return blueprint(partId(look, kit, `${which}-${part}`, 'g'), kit, [...spec.size], g.boxes());
}

// ---------------------------------------------------------------- wings

/**
 * Wings, authored for the left side (+x); the right side is the exact mirror in x. The membrane is one cell
 * thick on y 1; bones are up to three thick around it.
 *
 * - Inner: 22 × 3 × 24, pivot (0.5, 1.5, 22.5) at the shoulder. The arm bone runs out along the leading edge to
 *   the wrist at (21, 1.5, 21); the membrane's root chord runs back along the flank (x 0) to z 0, so lifting the
 *   wing about z hinges it cleanly on the body. The trailing edge scallops in between root and wrist.
 * - Outer: 37 × 3 × 30, pivot (0.5, 1.5, 27.5) at the wrist. Three finger bones fan out to the tips; the
 *   membrane between them scallops in, and its root edge meets the inner membrane at the wrist. A thumb claw
 *   hooks forward from the wrist.
 */
export const WING_CELLS = {
  inner: { size: [22, 3, 24] as const, pivot: [0.5, 1.5, 22.5] as const, wrist: [21, 1.5, 21] as const },
  outer: { size: [37, 3, 30] as const, pivot: [0.5, 1.5, 27.5] as const, fingers: [[36, 1.5, 25], [31, 1.5, 11], [19, 1.5, 2.5]] as const, root: [0.5, 1.5, 15] as const },
} as const;
/** A left-side cell or pivot mirrored for the right wing. */
export const mirrorCell = (c: V3, width: number): V3 => [width - c[0], c[1], c[2]];
const mirror = (boxes: Box[], width: number): Box[] => boxes.map(b => box(width - b.to[0], b.from[1], b.from[2], width - b.from[0], b.to[1], b.to[2], b.material));
/** Distance from p to the segment ab in the xz plane. */
function toSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

function wingInner(look: DragonLook): Grid {
  const s = swatch(look), spec = WING_CELLS.inner, g = new Grid(spec.size), [wx, , wz] = spec.wrist;
  const trailing = (x: number) => 0.5 + 8 * x / wx + 3.5 * Math.sin(Math.PI * Math.min(1, x / wx));
  for (let x = 0; x < spec.size[0]; x++) for (let z = 0; z < spec.size[2]; z++) {
    const cx = x + 0.5, cz = z + 0.5, lead = spec.pivot[2] + (wz - spec.pivot[2]) * Math.min(1, cx / wx), d = cz - trailing(cx);
    if (d < 0 || cz > lead) continue;
    g.set(x, 1, z, toSegment(cx, cz, wx, wz, 3, 5) < 0.6 ? s.vein : d < 1.2 ? s.edge : d < 4.5 ? s.outer : s.membrane);
  }
  g.capsule(spec.pivot, spec.wrist, 1.5, 1.1, s.bone);
  g.ellipsoid(spec.wrist, [1.4, 1.4, 1.4], s.bone);
  return g;
}

function wingOuter(look: DragonLook): Grid {
  const s = swatch(look), spec = WING_CELLS.outer, g = new Grid(spec.size), [ox, , oz] = spec.pivot;
  // Fan keys from the root edge round to the leading finger: angle about the wrist, reach, and the scallop's depth.
  const keys = [spec.root, spec.fingers[2], spec.fingers[1], spec.fingers[0]].map(([x, , z]) => ({ a: Math.atan2(z - oz, x - ox), r: Math.hypot(x - ox, z - oz) }));
  for (let x = 0; x < spec.size[0]; x++) for (let z = 0; z < spec.size[2]; z++) {
    const u = x + 0.5 - ox, v = z + 0.5 - oz, a = Math.atan2(v, u), r = Math.hypot(u, v);
    if (a < keys[0]!.a || a > keys[3]!.a) continue;
    let k = 0;
    while (k < 2 && a > keys[k + 1]!.a) k++;
    const lo = keys[k]!, hi = keys[k + 1]!, t = (a - lo.a) / (hi.a - lo.a), reach = (lo.r + (hi.r - lo.r) * t) * (1 - (k === 0 ? 0.1 : 0.22) * Math.sin(Math.PI * t));
    if (r > reach) continue;
    // Veins run out between the fingers, darker against the membrane.
    const vein = k > 0 && Math.abs(t - 0.5) * (hi.a - lo.a) * r < 0.5 && r > 3 && r < reach * 0.8;
    g.set(x, 1, z, vein ? s.vein : reach - r < 1.1 ? s.edge : r > reach * 0.62 ? s.outer : s.membrane);
  }
  spec.fingers.forEach((tip, i) => {
    const near: V3 = [ox + (tip[0] - ox) * 0.9, 1.5, oz + (tip[2] - oz) * 0.9];
    g.capsule(spec.pivot, near, i === 0 ? 1.3 : 1.1, i === 0 ? 0.8 : 0.65, s.bone);
    g.capsule(near, tip, i === 0 ? 0.8 : 0.65, 0.5, s.claw);
  });
  g.ellipsoid(spec.pivot, [1.6, 1.5, 1.6], s.bone);
  g.chain([[1.5, 1.5, 28.2], [3, 1.5, 29.3], [4.2, 1.5, 29.4]], [0.7, 0.55, 0.45], s.claw);
  return g;
}

function wing(look: DragonLook, kit: BannerKit, part: 'inner' | 'outer', side: 'left' | 'right'): VoxelBlueprint {
  const g = part === 'inner' ? wingInner(look) : wingOuter(look), boxes = g.boxes(), spec = WING_CELLS[part];
  return blueprint(partId(look, kit, `wing-${part}-${side}`, 'b'), kit, [...spec.size], side === 'left' ? boxes : mirror(boxes, spec.size[0]));
}

// ---------------------------------------------------------------- the rig's parts

export interface DragonParts {
  readonly look: DragonLook;
  readonly torso: VoxelBlueprint;
  readonly neck: readonly VoxelBlueprint[];
  readonly head: VoxelBlueprint;
  readonly jaw: VoxelBlueprint;
  /** Segments 0..4 and the spade tip. */
  readonly tail: readonly VoxelBlueprint[];
  readonly fore: { readonly upper: VoxelBlueprint; readonly lower: VoxelBlueprint };
  readonly hind: { readonly upper: VoxelBlueprint; readonly lower: VoxelBlueprint };
  readonly wings: { readonly [S in 'left' | 'right']: { readonly inner: VoxelBlueprint; readonly outer: VoxelBlueprint } };
}

const parts = new Map<string, DragonParts>();
export function dragonParts(form: DragonForm, kit: BannerKit): DragonParts {
  const key = `${kit}:${form}`, cached = parts.get(key);
  if (cached) return cached;
  const look = DRAGON_LOOKS[form];
  const made: DragonParts = {
    look, torso: torso(look, kit),
    neck: Array.from({ length: NECK_CELLS.count }, (_, i) => neck(look, kit, i)),
    head: head(look, kit), jaw: jaw(look, kit),
    tail: Array.from({ length: TAIL_CELLS.count }, (_, i) => tail(look, kit, i)),
    fore: { upper: leg(look, kit, 'fore', 'upper'), lower: leg(look, kit, 'fore', 'lower') },
    hind: { upper: leg(look, kit, 'hind', 'upper'), lower: leg(look, kit, 'hind', 'lower') },
    wings: {
      left: { inner: wing(look, kit, 'inner', 'left'), outer: wing(look, kit, 'outer', 'left') },
      right: { inner: wing(look, kit, 'inner', 'right'), outer: wing(look, kit, 'outer', 'right') },
    },
  };
  parts.set(key, made);
  return made;
}

const listParts = (p: DragonParts): VoxelBlueprint[] => [
  p.torso, ...p.neck, p.head, p.jaw, ...p.tail, p.fore.upper, p.fore.lower, p.hind.upper, p.hind.lower,
  p.wings.left.inner, p.wings.left.outer, p.wings.right.inner, p.wings.right.outer,
];
/** Every distinct part of every form, for meshing up front. Forms share parts their looks do not change. */
export function dragonBlueprints(kit: BannerKit): VoxelBlueprint[] {
  const seen = new Map<string, VoxelBlueprint>();
  for (const form of DRAGON_FORMS) for (const p of listParts(dragonParts(form, kit))) seen.set(p.id, p);
  return [...seen.values()];
}
