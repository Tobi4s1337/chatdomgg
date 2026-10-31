import { createForgeHearth, createForgeWorkshop, createGateBrazier, FORGE_HEARTH_PIVOT, FORGE_HEARTH_FLAME, FORGE_HEARTH_CHIMNEY_NOSE, FORGE_WORKSHOP_HEARTH_PIVOT, GATE_BRAZIER_MOUNT, GATE_BRAZIER_FLAME } from '@chatdom/content';
import { transformCardinalPoint } from '@chatdom/world';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { Dressing } from './settlement-content';

/** Local SIMULATED art staging uses the same authored civic fixtures as the room. No dwellings or deeds. */
export function createForgeSquareContent(elevation: number) {
  const props: Dressing[] = [], fires: { position: Vec3; normal: Vec3 }[] = [], noses: Vec3[] = [];
  function place(blueprint: VoxelBlueprint, pivot: readonly number[], x: number, z: number, rotation: 0 | 3) {
    const offset = transformCardinalPoint([0, 0, 0], rotation, [pivot[0]! / 8, 0, pivot[2]! / 8]);
    const position: Vec3 = [x - offset[0], elevation, z - offset[2]];
    props.push({ blueprint, position, yaw: rotation * Math.PI / 2 });
    return (point: readonly number[]) => transformCardinalPoint(position, rotation, [point[0]! / 8, point[1]! / 8, point[2]! / 8]);
  }
  const hearth = place(createForgeHearth('hearth'), FORGE_HEARTH_PIVOT, 5.5, 5, 3);
  place(createForgeWorkshop('hearth'), FORGE_WORKSHOP_HEARTH_PIVOT, 5.5, 5, 3);
  fires.push({ position: hearth(FORGE_HEARTH_FLAME), normal: [-1, 0, 0] });
  noses.push(hearth(FORGE_HEARTH_CHIMNEY_NOSE));
  for (const z of [4.25, 6.75]) {
    const brazier = place(createGateBrazier('hearth'), GATE_BRAZIER_MOUNT, 8.5, z, 0);
    fires.push({ position: brazier(GATE_BRAZIER_FLAME), normal: [0, 1, 0] });
  }
  return { props, fires, noses };
}
