import type { VoxelBlueprint } from '@chatdom/shared';

type Box = VoxelBlueprint['boxes'][number];

/** Ordered half-open boxes in build cells. Later boxes win; material 0 carves. Empty boxes are skipped. */
export class Shape {
  readonly list: Box[] = [];
  box(x: number, y: number, z: number, X: number, Y: number, Z: number, material: number): this {
    if (x < X && y < Y && z < Z) this.list.push({ from: [x, y, z], to: [X, Y, Z], material });
    return this;
  }
  /**
   * A level disc (or ring when `inner` > 0) around the cell-corner centre (cx, cz), one box per row. The
   * radius is measured to cell centres, so a ring of whole cells reads round from any side.
   */
  disc(cx: number, cz: number, radius: number, y: number, Y: number, material: number, inner = 0): this {
    for (let z = Math.floor(cz - radius); z < Math.ceil(cz + radius); z++) {
      const dz = z + .5 - cz, half = Math.sqrt(Math.max(0, radius * radius - dz * dz));
      const outer = Math.round(half);
      if (outer <= 0) continue;
      if (inner > 0 && Math.abs(dz) < inner) {
        const hole = Math.round(Math.sqrt(inner * inner - dz * dz));
        if (hole > 0 && hole < outer) {
          this.box(Math.round(cx - outer), y, z, Math.round(cx - hole), Y, z + 1, material);
          this.box(Math.round(cx + hole), y, z, Math.round(cx + outer), Y, z + 1, material);
          continue;
        }
        if (hole >= outer) continue;
      }
      this.box(Math.round(cx - outer), y, z, Math.round(cx + outer), Y, z + 1, material);
    }
    return this;
  }
}

/** A small deterministic generator (mulberry32) seeded from a string; no clock or global randomness. */
export function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
