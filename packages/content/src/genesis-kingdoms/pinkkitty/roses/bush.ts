import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../../../materials';
import { Grid, blob, bloom, blueprint, cane, hash, type Cell, type Size } from './shape';

export type RoseBushVariant = 0 | 1 | 2 | 3;

interface BushForm {
  readonly size: Size;
  /** The lowest canopy course; the stems show beneath it. */
  readonly skirt: number;
  /** The clipped body before its lumps. */
  readonly body: Cell;
  readonly lumps: number;
  readonly blooms: number;
  readonly palette: 'rose' | 'violet';
  readonly note: string;
}

/**
 * Four clipped garden roses, two in the channel's rose pink and two in its violets. Sizes in build cells include the
 * heads that stand proud of the foliage.
 */
export const ROSE_BUSH_FORMS: Readonly<Record<RoseBushVariant, BushForm>> = {
  0: { size: [10, 9, 10], skirt: 2, body: [3.7, 3, 3.6], lumps: 5, blooms: 12, palette: 'rose', note: 'a compact round rose, 1.1 m tall' },
  1: { size: [12, 11, 12], skirt: 2, body: [4.6, 4, 4.4], lumps: 6, blooms: 18, palette: 'rose', note: 'a broad full rose, 1.4 m tall' },
  2: { size: [10, 11, 10], skirt: 2, body: [3.6, 4, 3.5], lumps: 5, blooms: 15, palette: 'violet', note: 'an upright violet rose, 1.4 m tall' },
  3: { size: [12, 8, 12], skirt: 1, body: [4.7, 3, 4.6], lumps: 6, blooms: 16, palette: 'violet', note: 'a low spreading violet rose, 1 m tall' },
};

/** The head colours: mostly the variant's own, with a few deep red roses among them. */
function headColour(palette: BushForm['palette']) {
  return (u: number) => palette === 'rose'
    ? (u < 0.16 ? MAT.fabricRed : MAT.petal)
    : (u < 0.12 ? MAT.fabricRed : u < 0.58 ? MAT.fabricViolet : MAT.fabricMutedViolet);
}

/**
 * A clipped garden rose on a planted bed. Three canes rise from a low earth mound and root flare and fork into a
 * dense dark leaf body, lifted clear of the ground so the stems and the shadow under the skirt show. The body is
 * one clipped dome with a few lumps standing out of its outline, so it reads as a pruned shrub rather than a ball.
 * Its underside is the older olive growth, a few fresh shoots break the clipped line, and the heads sit on the
 * crown and sunny shoulders, flush, standing proud or paired.
 */
export function createRoseBush(variant: RoseBushVariant): VoxelBlueprint {
  const form = ROSE_BUSH_FORMS[variant];
  if (!form) throw new Error(`Rose bushes come in variants 0 to 3, not ${String(variant)}.`);
  const seed = 0x705e + variant * 7919, grid = new Grid(form.size), [w, h, d] = form.size;
  const cx = w / 2, cz = d / 2, [rx, ry, rz] = form.body, cy = form.skirt + ry;

  // The bed: a low earth mound, round in plan, the bush planted in its middle.
  const bed = Math.min(cx, cz) - 1.6;
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++)
    if ((x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2 <= bed * bed) grid.set(x, 0, z, MAT.earth);

  // Canes: a 2×2 trunk and two leaning side canes, each forking into the canopy, over a root flare.
  const ix = Math.floor(cx), iz = Math.floor(cz);
  grid.fill(ix - 1, 0, iz - 1, ix + 1, form.skirt + 2, iz + 1, MAT.bark);
  for (const [x, z] of [[ix - 2, iz - 1], [ix + 1, iz], [ix - 1, iz + 1], [ix, iz - 2]] as const) grid.set(x, 0, z, MAT.bark);
  const lean = hash(seed, 1) < 0.5 ? 1 : -1;
  cane(grid, [[ix - 2, 0, iz], [ix - 2, 1, iz], [ix - 3, form.skirt, iz + lean], [ix - 3, form.skirt + 1, iz + lean]], MAT.bark);
  cane(grid, [[ix + 1, 0, iz - 1], [ix + 1, 1, iz - 1], [ix + 2, form.skirt, iz - 1 - lean], [ix + 2, form.skirt + 1, iz - 1 - lean]], MAT.bark);

  // The canopy keeps a cell of room on every side and above for the heads that stand proud.
  const allow = (x: number, y: number, z: number) => x >= 1 && x < w - 1 && z >= 1 && z < d - 1 && y >= form.skirt && y < h - 1;
  blob(grid, [cx, cy, cz], [rx, ry, rz], MAT.leaf, { power: 2.4, allow });
  for (let i = 0; i < form.lumps; i++) {
    const a = (Math.PI * 2 * i) / form.lumps + (hash(seed, i, 2) - 0.5) * 0.9;
    const reach = 0.6 + hash(seed, i, 3) * 0.12, s = 0.46 + hash(seed, i, 4) * 0.12;
    const ly = cy + (hash(seed, i, 5) * 0.8 - 0.25) * ry;
    blob(grid, [cx + Math.cos(a) * rx * reach, ly, cz + Math.sin(a) * rz * reach], [rx * s, ry * (s + 0.1), rz * s], MAT.leaf, { power: 2.1, allow });
  }
  const tip = hash(seed, 9) * Math.PI * 2;
  blob(grid, [cx + Math.cos(tip) * 0.9, cy + ry * 0.45, cz + Math.sin(tip) * 0.9], [rx * 0.55, ry * 0.6, rz * 0.55], MAT.leaf, { power: 2.1, allow });

  // The older growth: every canopy cell open underneath, and the lowest canopy course, turns olive.
  for (let y = form.skirt; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++)
    if (grid.get(x, y, z) === MAT.leaf && (grid.get(x, y - 1, z) === MAT.air || (y === form.skirt && grid.open(x, y, z) > 1))) grid.set(x, y, z, MAT.moss);

  // Fresh shoots: a few single olive tips standing out of the clipped line, low and high.
  let shoots = 0;
  for (let i = 0; i < 400 && shoots < 3 + variant; i++) {
    const x = 1 + Math.floor(hash(seed, i, 21) * (w - 2)), z = 1 + Math.floor(hash(seed, i, 22) * (d - 2));
    const y = form.skirt + 1 + Math.floor(hash(seed, i, 23) * (h - form.skirt - 2));
    if (grid.get(x, y, z) !== MAT.leaf) continue;
    const out = ([[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]] as const).find(([dx, dy, dz]) => grid.get(x + dx, y + dy, z + dz) === MAT.air && grid.inside(x + dx, y + dy, z + dz));
    if (!out) continue;
    grid.set(x + out[0], y + out[1], z + out[2], MAT.moss);
    shoots++;
  }

  bloom(grid, { seed, count: form.blooms, spacing: 2.3, colour: headColour(form.palette), minY: form.skirt + 1, lift: 0.55, proud: 0.45 });

  // Two fallen petals on the bed, on the sunny side.
  let fallen = 0;
  for (let i = 0; i < 64 && fallen < 2; i++) {
    const x = Math.floor(hash(seed, i, 31) * w), z = Math.floor(hash(seed, i, 32) * d);
    if (grid.get(x, 0, z) === MAT.earth && grid.get(x, 1, z) === MAT.air && z >= cz) { grid.set(x, 0, z, form.palette === 'rose' ? MAT.petal : MAT.fabricViolet); fallen++; }
  }
  return blueprint(`genesis-pinkkitty-rose-bush-v${variant}`, 'flora', grid);
}
