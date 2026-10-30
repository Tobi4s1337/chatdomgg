import { CASTLE_BEACON_ANCHOR_METRES, createCastleModule, type StyleKey } from '@chatdom/content';
import type { WindowHouse } from '@chatdom/render';
import { transformCardinalPoint, type CastlePlan } from '@chatdom/world';
import type { Vec3 } from '@chatdom/shared';

/** One authoritative placement list for geometry, shadows and ordered-box occlusion. */
export function createCastleContent(plan: CastlePlan, style: StyleKey = 'tide'): {
  buildings: (WindowHouse & { id: string })[];
  beaconPosition: Vec3;
} {
  const ids = new Set<string>();
  const buildings = plan.modules.map(module => {
    if (ids.has(module.id)) throw new Error(`Duplicate castle module ${module.id}`);
    ids.add(module.id);
    if (module.position.some(value => !Number.isFinite(value))) throw new Error('Castle placement must be finite');
    const blueprint = createCastleModule(module.kind, module.size, style);
    if (blueprint.size.some((value, axis) => value * .125 !== module.size[axis])) throw new Error('Castle module dimensions disagree');
    return { id: module.id, slot: 65534, blueprint, position: module.position, yaw: module.rotation * Math.PI / 2 };
  });
  const beacon = plan.modules.find(module => module.id === plan.beaconModuleId);
  if (!beacon || beacon.kind !== 'keep') throw new Error('Castle beacon must resolve to its authored keep');
  return { buildings, beaconPosition: transformCardinalPoint(beacon.position, beacon.rotation, CASTLE_BEACON_ANCHOR_METRES) };
}
