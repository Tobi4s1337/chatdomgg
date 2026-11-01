import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { STYLES } from '../../../materials';
import { clothArms } from '../../../genesis-heraldry/arms';
import type { HeraldicColours } from '../../../genesis-heraldry/kit';
import { AGGMAN_LIVERY, type AggmanPiece, type Livery } from '../piece';

export type Box = VoxelBlueprint['boxes'][number];

/**
 * A dense cell canvas in build cells. Cloth is authored cell by cell (every column has its own ripple), so the
 * pieces paint here and the canvas folds the cells back into the fewest disjoint boxes it can find. Writing
 * outside the canvas throws: a ripple that escapes its bounds is a bug, never something to clip silently.
 */
export class Cells {
  readonly data: Uint8Array;
  constructor(readonly sx: number, readonly sy: number, readonly sz: number) {
    this.data = new Uint8Array(sx * sy * sz);
  }

  private index(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) {
      throw new Error(`Cell ${x},${y},${z} lies outside ${this.sx}×${this.sy}×${this.sz}.`);
    }
    return x + this.sx * (y + this.sy * z);
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return 0;
    return this.data[x + this.sx * (y + this.sy * z)]!;
  }

  set(x: number, y: number, z: number, material: number): void {
    this.data[this.index(x, y, z)] = material;
  }

  /** Half-open box fill; an empty box writes nothing. */
  fill(x: number, y: number, z: number, X: number, Y: number, Z: number, material: number): void {
    for (let k = z; k < Z; k++) for (let j = y; j < Y; j++) for (let i = x; i < X; i++) this.set(i, j, k, material);
  }

  /** A block whose vertical edges are stepped back `cut` cells, so a square footing reads as an octagon. */
  chamfer(x: number, y: number, z: number, X: number, Y: number, Z: number, cut: number, material: number): void {
    for (let i = 0; i <= cut; i++) this.fill(x + i, y, z + cut - i, X - i, Y, Z - cut + i, material);
  }

  /** The canvas mirrored across x, so a piece built streaming one way can stream the other. */
  mirrorX(): Cells {
    const out = new Cells(this.sx, this.sy, this.sz);
    for (let z = 0; z < this.sz; z++) for (let y = 0; y < this.sy; y++) for (let x = 0; x < this.sx; x++) {
      out.data[this.sx - 1 - x + this.sx * (y + this.sy * z)] = this.data[x + this.sx * (y + this.sy * z)]!;
    }
    return out;
  }

  /**
   * Greedy box cover: from each first unclaimed cell, grow a run along x, then whole rows along y, then whole
   * slabs along z, all of one material. The boxes are disjoint, so their order never matters.
   */
  boxes(offset: Vec3 = [0, 0, 0]): Box[] {
    const { sx, sy, sz, data } = this;
    const claimed = new Uint8Array(data.length), out: Box[] = [];
    const free = (i: number, m: number) => data[i] === m && !claimed[i];
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
      const i = x + sx * (y + sy * z), m = data[i]!;
      if (!m || claimed[i]) continue;
      let X = x + 1;
      while (X < sx && free(i + X - x, m)) X++;
      const row = (j: number, k: number) => {
        for (let a = x; a < X; a++) if (!free(a + sx * (j + sy * k), m)) return false;
        return true;
      };
      let Y = y + 1;
      while (Y < sy && row(Y, z)) Y++;
      let Z = z + 1;
      outer: while (Z < sz) {
        for (let j = y; j < Y; j++) if (!row(j, Z)) break outer;
        Z++;
      }
      for (let k = z; k < Z; k++) for (let j = y; j < Y; j++) for (let a = x; a < X; a++) claimed[a + sx * (j + sy * k)] = 1;
      out.push({ from: [x + offset[0], y + offset[1], z + offset[2]], to: [X + offset[0], Y + offset[1], Z + offset[2]], material: m });
    }
    return out;
  }
}

const CANONICAL_ARMS = clothArms('forked', 'wave').join('/');

/**
 * Blueprint ids name the form; a livery or arms other than The_AGGman's own adds a short, stable fingerprint,
 * so two different cloths can never share a cached mesh under one id.
 */
export function pieceId(form: string, livery: Livery, arms?: readonly string[], colours?: HeraldicColours): string {
  const ownLivery = (Object.keys(AGGMAN_LIVERY) as (keyof Livery)[]).every(key => livery[key] === AGGMAN_LIVERY[key]);
  const ownArms = !arms || arms.join('/') === CANONICAL_ARMS;
  const ownColours = !colours || (colours.field === livery.red && colours.charge === livery.cream && colours.border === livery.brass);
  if (ownLivery && ownArms && ownColours) return `genesis-aggman-${form}`;
  let hash = 0x811c9dc5;
  const tinctures = colours ? `${colours.field}.${colours.charge}.${colours.border}` : '';
  const text = `${livery.red}.${livery.gold}.${livery.cream}.${livery.blue}.${livery.brass}|${tinctures}|${arms?.join('/') ?? ''}`;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `genesis-aggman-${form}-x${hash.toString(36)}`;
}

export function toPiece(
  id: string, kind: 'prop' | 'civic', cells: Cells, lanterns: readonly Vec3[],
  footprint: { readonly from: readonly [number, number]; readonly to: readonly [number, number] },
): AggmanPiece {
  return {
    blueprint: { version: 1, id, styleId: STYLES.tide.id, kind, lattice: 'build', size: [cells.sx, cells.sy, cells.sz], boxes: cells.boxes(), windows: [] },
    lanterns, footprint,
  };
}

/**
 * A small keeper's lantern two cells square: a brass foot plate, a glass core three cells tall, a brass cap and
 * a hook cell above the cap at (x, y + 5, z). Returns the cell at the heart of the glass.
 */
export function smallLantern(c: Cells, x: number, y: number, z: number, brass: number, glass: number): Vec3 {
  c.fill(x, y, z, x + 2, y + 1, z + 2, brass);
  c.fill(x, y + 1, z, x + 2, y + 4, z + 2, glass);
  c.fill(x, y + 4, z, x + 2, y + 5, z + 2, brass);
  c.set(x, y + 5, z, brass);
  return [x, y + 2, z];
}
