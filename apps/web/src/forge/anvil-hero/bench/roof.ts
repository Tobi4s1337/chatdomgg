import type { StyleKey } from '@chatdom/content/materials';
import { assembleForge, findForgeSockets, forgeStyleKit, type AssembledForge } from '@chatdom/forge';
import type { ForgeHouseSocket, VoxelBlueprint } from '@chatdom/shared';
import { rasterizeBlueprint } from '@chatdom/voxel';

type Cell = [number, number, number];
const add = (a: readonly number[], b: readonly number[]) => a.map((n, i) => n + b[i]!) as Cell;

export interface MountedDragon {
  blueprint: VoxelBlueprint;
  /** Build cells in the host's frame, exactly as the kingdom computes its landed smoke. */
  emitter: Cell;
  socket: ForgeHouseSocket;
}

/** The actual registered sleeping-dragon assembly, exactly as it lands in the kingdom. */
export function mountSleepingDragon(home: VoxelBlueprint, style: StyleKey): MountedDragon {
  const socket = findForgeSockets(home).find(s => s.kind === 'chimney');
  if (!socket) throw new Error(`${home.id} offers no chimney socket for the dragon.`);
  const assembled: AssembledForge = assembleForge({ version: 1, kind: 'chimney', motif: 'sleeping-dragon' }, forgeStyleKit(style), socket);
  return { blueprint: assembled.blueprint, emitter: add(assembled.emitter, socket.origin), socket };
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
