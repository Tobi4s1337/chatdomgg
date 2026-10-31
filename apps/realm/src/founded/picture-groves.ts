import { plantGrove, TREE_SINK, type StyleFamily, type TreeSite } from '@chatdom/content/trees';
import { VOXEL_METRES } from '@chatdom/shared';
import { randomUnit, samplePublicGround, seedHash, transformCardinalPoint, type CardinalTurn, type SettlementPlan } from '@chatdom/world';
import type { NativeTown } from './native';

/** Replace only the pinned native tree fixtures, keeping their roots and all other native content intact. */
export function enrichNativePictureGroves(plan: SettlementPlan, native: NativeTown): NativeTown {
  if (native.revision !== plan.revision) return native;
  const entries = native.fixtures.filter(piece => /^tree:\d+$/.test(piece.id) && piece.blueprint.kind === 'flora');
  if (!entries.length) return native;
  const seed = plan.config.seed;
  const activeCourts = plan.courts.flatMap(court => {
    const home = plan.homes.find(candidate => candidate.courtId === court.id);
    const anchor = plan.nodes.find(node => node.id === court.nodeId);
    return home && anchor ? [{ court, anchor, style: home.style }] : [];
  });
  const sites: TreeSite[] = entries.map(piece => {
    const root = transformCardinalPoint(piece.position, piece.rotation,
      [piece.blueprint.size[0] * VOXEL_METRES.build / 2, 0, piece.blueprint.size[2] * VOXEL_METRES.build / 2]);
    const [x, y, z] = root;
    const nearest = activeCourts.reduce<typeof activeCourts[number] | undefined>((best, candidate) =>
      !best || Math.hypot(x - candidate.anchor.position[0], z - candidate.anchor.position[2])
        < Math.hypot(x - best.anchor.position[0], z - best.anchor.position[2]) ? candidate : best, undefined);
    const courtRadius = nearest ? Math.max(...nearest.court.boundary.map(([cx, cz]) =>
      Math.hypot(cx - nearest.anchor.position[0], cz - nearest.anchor.position[2]))) + 9 : 0;
    const lake = plan.lake, lakeDistance = Math.hypot((x-lake.x)/lake.radiusX, (z-lake.z)/lake.radiusZ);
    const zone = lakeDistance < 1.5 ? 'water' : nearest && Math.hypot(x-nearest.anchor.position[0], z-nearest.anchor.position[2]) <= courtRadius ? 'court' : 'grove';
    const style = (['hearth', 'tide', 'grove'].includes(piece.blueprint.styleId) ? piece.blueprint.styleId : nearest?.style ?? 'hearth') as StyleFamily;
    const distance = (b: { minX: number; maxX: number; minZ: number; maxZ: number }) => Math.hypot(Math.max(b.minX-x, 0, x-b.maxX), Math.max(b.minZ-z, 0, z-b.maxZ));
    const room = Math.min(distance(plan.castle.bounds), ...plan.reservations.map(r => distance(r.lot)), samplePublicGround(plan, x, z)?.reservedDistance ?? Infinity);
    const rotation = Math.floor(randomUnit(seedHash(`${seed}:${piece.id}:turn`)) * 4) as CardinalTurn;
    return { id: piece.id, zone, style, seed, position: [x, y + TREE_SINK, z], yaw: rotation * Math.PI / 2, room };
  });
  const trees = plantGrove(sites), replacements = new Map(entries.map((piece, i) => {
    const tree = trees[i]!, originalRoot = transformCardinalPoint(piece.position, piece.rotation,
      [piece.blueprint.size[0] * VOXEL_METRES.build / 2, 0, piece.blueprint.size[2] * VOXEL_METRES.build / 2]);
    const first = Math.round(tree.yaw / (Math.PI / 2));
    // Choose the first seeded quarter turn whose representable origin reconstructs the exact old root.
    for (let turn = 0; turn < 4; turn++) {
      const rotation = ((first + turn) % 4) as CardinalTurn;
      const offset = transformCardinalPoint([0, 0, 0], rotation, [tree.blueprint.size[0] * VOXEL_METRES.build / 2, 0, tree.blueprint.size[2] * VOXEL_METRES.build / 2]);
      const position: typeof piece.position = [originalRoot[0]-offset[0], originalRoot[1], originalRoot[2]-offset[2]];
      const reconstructed = transformCardinalPoint(position, rotation, [tree.blueprint.size[0] * VOXEL_METRES.build / 2, 0, tree.blueprint.size[2] * VOXEL_METRES.build / 2]);
      if (reconstructed.every((value, axis) => value === originalRoot[axis])) return [piece.id, { ...piece, blueprint: tree.blueprint, position, rotation }] as const;
    }
    return [piece.id, piece] as const;
  }));
  return { ...native, fixtures: native.fixtures.map(piece => replacements.get(piece.id) ?? piece) };
}
