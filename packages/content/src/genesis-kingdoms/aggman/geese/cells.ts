import type { VoxelBlueprint } from '@chatdom/shared';

type Box = VoxelBlueprint['boxes'][number];
export type Cell = readonly [x: number, y: number, z: number];

/**
 * A sparse carving grid in build cells for creatures a few cells across. Coordinates may run negative while a
 * creature is drawn about its own centre line; `boxes` crops to the occupied bounds. Material zero carves.
 */
export class Cells {
  private readonly map = new Map<string, readonly [number, number, number, number]>();

  get(x: number, y: number, z: number): number {
    return this.map.get(`${x},${y},${z}`)?.[3] ?? 0;
  }

  set(x: number, y: number, z: number, material: number): this {
    if (material) this.map.set(`${x},${y},${z}`, [x, y, z, material]);
    else this.map.delete(`${x},${y},${z}`);
    return this;
  }

  /** Every occupied cell as `[x, y, z, material]`, in insertion order. */
  list(): (readonly [number, number, number, number])[] {
    return [...this.map.values()];
  }

  get size(): number {
    return this.map.size;
  }

  /**
   * Draws one side-profile slice at column `x`: `rows` run top to bottom, the last row at height `y0`, and each
   * character is a cell along +Z from `z0`. `key` maps a character to a material; '.' and ' ' leave the cell as is.
   */
  draw(x: number, rows: readonly string[], key: (mark: string) => number, z0 = 0, y0 = 0): this {
    rows.forEach((row, i) => {
      const y = y0 + rows.length - 1 - i;
      [...row].forEach((mark, z) => {
        if (mark === '.' || mark === ' ') return;
        const material = key(mark);
        if (material === undefined) throw new Error(`No material for mark "${mark}".`);
        this.set(x, y, z0 + z, material);
      });
    });
    return this;
  }

  /** Repaints every occupied cell through `paint`; returning zero carves it. */
  paint(paint: (x: number, y: number, z: number, material: number) => number): this {
    for (const [x, y, z, m] of this.list()) this.set(x, y, z, paint(x, y, z, m));
    return this;
  }

  /** Moves the cells `pick` selects by (dx, dy, dz); moved cells overwrite what they land on. */
  move(pick: (x: number, y: number, z: number, material: number) => boolean, dx: number, dy: number, dz: number): this {
    const moving = this.list().filter(([x, y, z, m]) => pick(x, y, z, m));
    for (const [x, y, z] of moving) this.set(x, y, z, 0);
    for (const [x, y, z, m] of moving) this.set(x + dx, y + dy, z + dz, m);
    return this;
  }

  /** A copy mirrored across the plane x = 0. */
  mirrored(): Cells {
    const out = new Cells();
    for (const [x, y, z, m] of this.list()) out.set(-x, y, z, m);
    return out;
  }

  /**
   * A copy turned by whole quarter turns about +Y, seen from above: one turn takes +Z (the way a creature faces)
   * to +X.
   */
  turned(quarter: 0 | 1 | 2 | 3): Cells {
    const out = new Cells();
    for (const [x, y, z, m] of this.list()) {
      const [tx, tz] = quarter === 0 ? [x, z] : quarter === 1 ? [z, -x] : quarter === 2 ? [-x, -z] : [-z, x];
      out.set(tx, y, tz, m);
    }
    return out;
  }

  /** Writes `other` into this grid offset by (dx, dy, dz). */
  stamp(other: Cells, dx: number, dy: number, dz: number): this {
    for (const [x, y, z, m] of other.list()) this.set(x + dx, y + dy, z + dz, m);
    return this;
  }

  /** Inclusive minimum and exclusive maximum of the occupied cells. */
  bounds(): { readonly min: Cell; readonly max: Cell } {
    if (!this.map.size) throw new Error('An empty grid has no bounds.');
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const cell of this.map.values()) for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d]!, cell[d]!);
      max[d] = Math.max(max[d]!, cell[d]! + 1);
    }
    return { min: min as unknown as Cell, max: max as unknown as Cell };
  }

  /**
   * Boxes cropped to the occupied bounds in x and z (y keeps its ground at zero): runs along X per course, merged
   * along Z while the run repeats. Returns the boxes and the cropped size.
   */
  boxes(): { readonly boxes: Box[]; readonly size: [number, number, number] } {
    const { min, max } = this.bounds();
    if (min[1] < 0) throw new Error(`Cells below the ground at y = ${min[1]}.`);
    const size: [number, number, number] = [max[0] - min[0], max[1], max[2] - min[2]];
    const at = (x: number, y: number, z: number) => this.get(x + min[0], y, z + min[2]);
    const boxes: Box[] = [];
    for (let y = 0; y < size[1]; y++) {
      let open: Box[] = [];
      for (let z = 0; z < size[2]; z++) {
        const runs: Box[] = [];
        for (let x = 0; x < size[0];) {
          const material = at(x, y, z);
          if (!material) { x++; continue; }
          let end = x + 1;
          while (end < size[0] && at(end, y, z) === material) end++;
          const above = open.find(b => b.from[0] === x && b.to[0] === end && b.material === material);
          if (above) { above.to[2] = z + 1; runs.push(above); }
          else { const box: Box = { from: [x, y, z], to: [end, y + 1, z + 1], material }; boxes.push(box); runs.push(box); }
          x = end;
        }
        open = runs;
      }
    }
    return { boxes, size };
  }
}

/** A small stable 32-bit hash of a string, for seeding. */
export function hashSeed(seed: string | number): number {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

/** Mulberry32: a tiny deterministic generator in [0, 1). */
export function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
