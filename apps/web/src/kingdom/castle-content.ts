import { CASTLE_BEACON_ANCHOR_METRES, createCastleModule, createGateBrazier, GATE_BRAZIER_MOUNT, GATE_BRAZIER_FLAME, type StyleKey } from '@chatdom/content';
import type { WindowHouse } from '@chatdom/render';
import { transformCardinalPoint, type CastlePlan } from '@chatdom/world';
import type { Vec3 } from '@chatdom/shared';
import type { Dressing } from './settlement-content';
import type { RoyalBrazier } from './royal-life';

/** The preview court uses the same authored gate fixtures and mount points as a founded kingdom. */
export function createCastleCourtContent(plan: CastlePlan, style: StyleKey = 'tide'): { props: Dressing[]; braziers: RoyalBrazier[] } {
  const props: Dressing[] = [], braziers: RoyalBrazier[] = [];
  const gate = plan.modules.find(module => module.kind === 'gatehouse');
  if (!gate) return { props, braziers };
  const blueprint = createGateBrazier(style);
  for (const x of [-2, gate.size[0] + 2]) {
    const position = transformCardinalPoint(gate.position, gate.rotation,
      [x - GATE_BRAZIER_MOUNT[0] / 8, 0, gate.size[2] + 1.5 - GATE_BRAZIER_MOUNT[2] / 8]);
    props.push({ blueprint, position, yaw: gate.rotation * Math.PI / 2 });
    braziers.push({ position: transformCardinalPoint(position, gate.rotation,
      [GATE_BRAZIER_FLAME[0] / 8, GATE_BRAZIER_FLAME[1] / 8, GATE_BRAZIER_FLAME[2] / 8]), normal: [0, 1, 0] });
  }
  return { props, braziers };
}

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
