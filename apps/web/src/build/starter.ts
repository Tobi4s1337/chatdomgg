import type { BuildDraftPolicy, VoxelBlueprint } from '@chatdom/shared';

/** A hollow, editable cottage when an older content asset exceeds this citizen's current allowance. */
export function createBuildStarter(policy: BuildDraftPolicy): VoxelBlueprint {
  const [lx, , lz] = policy.editableFrom, [hx, hy, hz] = policy.editableTo;
  const x0 = lx + 8, x1 = hx - 8, z1 = hz - 8, z0 = Math.max(lz + 6, z1 - 36);
  const top = Math.min(26, hy - 14), wall = policy.shaping.wall[0]!, roof = policy.shaping.roof[0]!;
  const boxes: VoxelBlueprint['boxes'] = [];
  const put = (from: [number, number, number], to: [number, number, number], material: number) => boxes.push({ from, to, material });
  put([x0 - 1, 0, z0 - 1], [x1 + 1, 2, z1 + 1], policy.shaping.stone);
  put([x0, 2, z0], [x1, top, z1], wall);
  put([x0 + 3, 2, z0 + 3], [x1 - 3, top, z1 - 3], 0);
  const doorX = Math.floor((x0 + x1) / 2) + 4;
  put([doorX, 2, z1 - 3], [doorX + 8, 19, z1], 0);
  put([x0 + 8, 9, z1 - 2], [x0 + 16, 18, z1 - 1], policy.shaping.glass);
  put([x0 + 8, 9, z1 - 1], [x0 + 16, 18, z1], 0);
  for (let y = 0; y < 12; y++) {
    put([x0 - 2 + y * 2, top + y, z0 - 2], [x1 + 2 - y * 2, top + y + 1, z1 + 2], roof);
  }
  return { version: 1, id: `starter:${policy.plotId}`, styleId: policy.styleId, kind: 'home', lattice: 'build', size: [...policy.size], boxes, windows: [] };
}
