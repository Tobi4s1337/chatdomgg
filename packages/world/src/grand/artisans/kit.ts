/** Grand dressing uses the terrain lattice, 0.5 metres per cell. Render/cache data only;
 * none of these boxes grant physical support, ownership or a citizen light. */
export type Point = readonly [number, number, number];
export interface KitBox { readonly min: Point; readonly size: Point; readonly colour: string }
export interface ArtisanKit {
  readonly id: string;
  readonly boxes: readonly KitBox[];
  readonly anchors: Readonly<Record<string, Point>>;
}
export const CLAY = {
  stone: '#b1a38e', stoneLight: '#d0c2a7', stoneDark: '#786e72', trim: '#e2cfaa',
  roof: '#4d597e', roofLight: '#697698', roofDark: '#353e60',
  timber: '#664939', timberLight: '#967052', plaster: '#e6d4b5',
  brass: '#c39c54', banner: '#bd675b', sail: '#e9d7b3',
  grass: '#82964f', earth: '#8c7054', sand: '#dbc49b',
  water: '#5a9da5', foam: '#bdd4c6',
} as const;
export class KitBuilder {
  readonly boxes: KitBox[] = [];
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, colour: string): void {
    if (![x, y, z, sx, sy, sz].every(Number.isFinite)) throw new RangeError('Kit coordinates must be finite');
    const min: Point = [Math.round(x), Math.round(y), Math.round(z)];
    const size: Point = [Math.round(sx), Math.round(sy), Math.round(sz)];
    if (size.some(v => v <= 0)) return;
    this.boxes.push({ min, size, colour });
  }
  /** Solid ellipsoid as horizontal runs, avoiding per-cell object overhead. */
  ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number, colour: string): void {
    for (let iy = Math.ceil(y - ry); iy <= y + ry; iy++) for (let iz = Math.ceil(z - rz); iz <= z + rz; iz++) {
      const q = 1 - ((iy - y) / ry) ** 2 - ((iz - z) / rz) ** 2;
      if (q < 0) continue;
      const r = rx * Math.sqrt(q), lo = Math.ceil(x - r), hi = Math.floor(x + r);
      this.box(lo, iy, iz, hi - lo + 1, 1, 1, colour);
    }
  }
  add(kit: ArtisanKit, at: Point = [0, 0, 0], turns = 0): void {
    for (const b of kit.boxes) {
      let [x, , z] = b.min; let [sx, , sz] = b.size;
      const y = b.min[1], sy = b.size[1];
      for (let t = 0; t < ((turns % 4) + 4) % 4; t++) { [x, z] = [-z - sz, x]; [sx, sz] = [sz, sx]; }
      this.box(x + at[0], y + at[1], z + at[2], sx, sy, sz, b.colour);
    }
  }
  finish(id: string, anchors: ArtisanKit['anchors'] = {}): ArtisanKit { return { id, boxes: this.boxes, anchors }; }
}
/** Independent feature streams retain full seed identity. */
export function random(seedKey: string): () => number {
  let n = 2166136261;
  for (const c of seedKey) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return () => { n += 0x6d2b79f5; let t = Math.imul(n ^ n >>> 15, 1 | n); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
