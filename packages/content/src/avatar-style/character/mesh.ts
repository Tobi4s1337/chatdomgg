import type { Rgb } from './colour';
import type { Slot, VoxelGrid } from './grid';

/*
 * Grid → renderable surface, independent of any engine. One quad per exposed cell face (a bust is a few
 * thousand faces), carrying what the reference look needs:
 * - per-corner ambient occlusion, so creases under the fringe, the chin and the hem shade softly;
 * - per-edge convexity flags and in-face coordinates, so a shader bevels only true outer edges. Coplanar
 *   neighbours never show a seam and colour changes stay flat paint, like the reference.
 */
export interface CitizenMesh {
  readonly positions: Float32Array; // cells
  readonly normals: Float32Array;
  readonly colours: Float32Array; // sRGB 0..1
  readonly occlusion: Float32Array; // 0..1, 1 is open
  readonly faceUv: Float32Array; // 0..1 across the face
  readonly edges: Float32Array; // convex flags: u-, u+, v-, v+
  readonly tangentU: Float32Array;
  readonly tangentV: Float32Array;
  readonly indices: Uint32Array;
  readonly faces: number;
}

type V3 = readonly [number, number, number];
const FACES: readonly { n: V3; u: V3; v: V3 }[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
/** Occlusion per corner by how many of its three neighbours in front of the face are solid. */
export const OCCLUSION_LEVELS = [.5, .68, .84, 1] as const;

export function meshCitizen(grid: VoxelGrid, colours: Record<Slot, Rgb>): CitizenMesh {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], occ: number[] = [], uv: number[] = [], edg: number[] = [], tu: number[] = [], tv: number[] = [], idx: number[] = [];
  const solid = (x: number, y: number, z: number) => grid.has(x, y, z);
  let faces = 0;
  for (const [[x, y, z], slot] of grid.entries()) {
    const c = colours[slot];
    for (const { n, u, v } of FACES) {
      const fx = x + n[0], fy = y + n[1], fz = z + n[2];
      if (solid(fx, fy, fz)) continue;
      const at = (du: number, dv: number, front: boolean): boolean => solid(
        (front ? fx : x) + u[0] * du + v[0] * dv, (front ? fy : y) + u[1] * du + v[1] * dv, (front ? fz : z) + u[2] * du + v[2] * dv);
      const convex = (du: number, dv: number) => !at(du, dv, false) && !at(du, dv, true) ? 1 : 0;
      const flags = [convex(-1, 0), convex(1, 0), convex(0, -1), convex(0, 1)];
      const centre = [x + .5 + n[0] * .5, y + .5 + n[1] * .5, z + .5 + n[2] * .5];
      const base = pos.length / 3;
      const ao: number[] = [];
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        pos.push(centre[0]! + (u[0] * su + v[0] * sv) / 2, centre[1]! + (u[1] * su + v[1] * sv) / 2, centre[2]! + (u[2] * su + v[2] * sv) / 2);
        nor.push(...n); col.push(...c); edg.push(...flags); tu.push(...u); tv.push(...v);
        uv.push((su + 1) / 2, (sv + 1) / 2);
        const s1 = at(su, 0, true), s2 = at(0, sv, true), k = at(su, sv, true);
        const level = s1 && s2 ? 0 : 3 - (+s1 + +s2 + +k);
        ao.push(level);
        occ.push(OCCLUSION_LEVELS[level]!);
      }
      // Split the quad along the diagonal that keeps occlusion gradients symmetric.
      if (ao[0]! + ao[2]! >= ao[1]! + ao[3]!) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      faces++;
    }
  }
  return {
    positions: new Float32Array(pos), normals: new Float32Array(nor), colours: new Float32Array(col), occlusion: new Float32Array(occ),
    faceUv: new Float32Array(uv), edges: new Float32Array(edg), tangentU: new Float32Array(tu), tangentV: new Float32Array(tv),
    indices: new Uint32Array(idx), faces,
  };
}
