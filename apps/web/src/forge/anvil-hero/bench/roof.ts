import { createForgeMotif } from '@chatdom/content/forge-motifs';
import type { StyleKey } from '@chatdom/content/materials';
import { assembleForge, findForgeSockets, forgeStyleKit, type AssembledForge } from '@chatdom/forge';
import type { ForgeHouseSocket, VoxelBlueprint } from '@chatdom/shared';
import { rasterizeBlueprint } from '@chatdom/voxel';
// Until main selects it, the bench reaches the replacement by its source path (spec 25).
import { createAnvilHeroDragon } from '../../../../../../packages/content/src/anvil-hero';

type Cell = [number, number, number];
const add = (a: readonly number[], b: readonly number[]) => a.map((n, i) => n + b[i]!) as Cell;

export interface MountedDragon {
  blueprint: VoxelBlueprint;
  /** Build cells in the host's frame, exactly as the kingdom computes its landed smoke. */
  emitter: Cell;
  socket: ForgeHouseSocket;
}

/**
 * The real chimney assembly on a real home, with the sleeping dragon motif swapped for this lane's
 * replacement: the seam main will select. Both motifs share size, mount and emitter, so the
 * assembler's offset, plinth and supports are untouched. Any drift in the assembler fails loudly.
 */
export function mountSleepingDragon(home: VoxelBlueprint, style: StyleKey): MountedDragon {
  const socket = findForgeSockets(home).find(s => s.kind === 'chimney');
  if (!socket) throw new Error(`${home.id} offers no chimney socket for the dragon.`);
  const assembled: AssembledForge = assembleForge({ version: 1, kind: 'chimney', motif: 'sleeping-dragon' }, forgeStyleKit(style), socket);
  const old = createForgeMotif('sleeping-dragon', style), dragon = createAnvilHeroDragon(style);
  if (JSON.stringify([old.size, old.mount, old.emitter]) !== JSON.stringify([dragon.size, dragon.mount, dragon.emitter])) throw new Error('The replacement dragon no longer shares the motif envelope.');
  const offset = add(assembled.emitter, old.emitter.map(n => -n));
  const keep = assembled.blueprint.boxes.length - old.boxes.length;
  const tail = assembled.blueprint.boxes.slice(keep);
  const matches = tail.length === old.boxes.length && tail.every((b, i) => {
    const o = old.boxes[i]!;
    return b.material === o.material && JSON.stringify(b.from) === JSON.stringify(add(o.from, offset)) && JSON.stringify(b.to) === JSON.stringify(add(o.to, offset));
  });
  if (!matches) throw new Error('The chimney assembler changed its motif layout; the dragon seam needs main.');
  const boxes = [...assembled.blueprint.boxes.slice(0, keep), ...dragon.boxes.map(b => ({ material: b.material, from: add(b.from, offset), to: add(b.to, offset) }))];
  const size: Cell = [0, 1, 2].map(i => Math.max(32, ...boxes.map(b => b.to[i]!))) as Cell;
  return { blueprint: { ...assembled.blueprint, size, boxes }, emitter: add(add(dragon.emitter, offset), socket.origin), socket };
}

/**
 * The same fit rules the kingdom's Forge check applies to an assembled part: nothing inside the
 * host, within the home, one connected piece, a quiet palette and bounded boxes.
 */
export function checkMountedDragon(mounted: MountedDragon, home: VoxelBlueprint): { solidCells: number; palette: number[] } {
  const asset = rasterizeBlueprint(mounted.blueprint), host = rasterizeBlueprint(home), [sx, sy, sz] = asset.size, [hx, hy, hz] = host.size;
  const hostAt = (x: number, y: number, z: number) => x < 0 || y < 0 || z < 0 || x >= hx || y >= hy || z >= hz ? 0 : host.voxels[x + hx * (y + hy * z)]!;
  const origin = mounted.socket.origin, palette = new Set<number>();
  let solidCells = 0, first = -1;
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const i = x + sx * (y + sy * z), material = asset.voxels[i]!;
    if (!material) continue;
    if (first < 0) first = i;
    solidCells++; palette.add(material);
    const X = x + origin[0], Y = y + origin[1], Z = z + origin[2];
    if (hostAt(X, Y, Z)) throw new Error(`The dragon would cover ${home.id} at ${X},${Y},${Z}.`);
    if (X < 0 || X >= 64 || Y < 0 || Y >= 160 || Z < 0 || Z >= home.size[2]) throw new Error('The dragon reaches beyond its home.');
  }
  if (solidCells < 80 || solidCells > 15000 || palette.size > 9 || mounted.blueprint.boxes.length > 600) throw new Error(`The mounted dragon breaks the Forge budget: ${solidCells} cells, ${palette.size} materials, ${mounted.blueprint.boxes.length} boxes.`);
  const seen = new Uint8Array(asset.voxels.length), queue = [first];
  seen[first] = 1;
  for (let q = 0; q < queue.length; q++) {
    const n = queue[q]!, x = n % sx, y = Math.floor(n / sx) % sy, z = Math.floor(n / (sx * sy));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= sx || Y >= sy || Z >= sz) continue;
      const j = X + sx * (Y + sy * Z);
      if (asset.voxels[j] && !seen[j]) { seen[j] = 1; queue.push(j); }
    }
  }
  if (queue.length !== solidCells) throw new Error('A detail of the mounted dragon is floating.');
  return { solidCells, palette: [...palette] };
}
