import { proposeGenesisLandmarks, WATCHTOWER_AXIS } from '@chatdom/content/genesis-landmarks';
import type { WindowHouse } from '@chatdom/render';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { terrainHeight, transformCardinalPoint, type SettlementPlan } from '@chatdom/world';
import { sampleGenesisSurface, type ChannelKingdomRecipe, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import type { Dressing } from '../kingdom/settlement-content';
import type { RoyalBrazier } from '../kingdom/royal-life';

export type GenesisSeatContent = {
  buildings: (WindowHouse & { id: string })[];
  props: Dressing[];
  braziers: RoyalBrazier[];
  beaconPosition: Vec3;
};

/** Mount only on the already accepted castle parcel, after testing the actual footing against displayed terrain. */
export function createGenesisSeatContent(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>, plan: SettlementPlan): GenesisSeatContent | undefined {
  const proposal = proposeGenesisLandmarks(recipe, landscape).find(item => item.showcase === 'harbour-watchtower');
  if (!proposal) return undefined;
  const keep = plan.castle.modules.find(module => module.id === plan.castle.beaconModuleId);
  if (!keep) return undefined;
  const turn = keep.rotation, cell = VOXEL_METRES.build;
  const axis = transformCardinalPoint([0, 0, 0], turn, [WATCHTOWER_AXIS.x * cell, 0, WATCHTOWER_AXIS.z * cell]);
  const origin: Vec3 = [plan.castle.centre[0] - axis[0], keep.position[1], plan.castle.centre[2] - axis[2]];
  const world = (point: Vec3): Vec3 => transformCardinalPoint(origin, turn, [point[0] * cell, point[1] * cell, point[2] * cell]);
  const bounds = plan.castle.bounds;
  for (const footing of proposal.piece.footings) {
    // Sample every cell corner, including edges, so narrow changes cannot hide beneath a footing.
    for (let x = footing.box.from[0]; x <= footing.box.to[0]; x++) for (let z = footing.box.from[2]; z <= footing.box.to[2]; z++) {
      const p = world([x, 0, z]);
      if (p[0] < bounds.minX || p[0] > bounds.maxX || p[2] < bounds.minZ || p[2] > bounds.maxZ) return undefined;
      const ground = terrainHeight(plan, p[0], p[2]);
      const surface = sampleGenesisSurface(landscape, p[0], p[2]);
      if ((surface.waterLevel !== null && ground <= surface.waterLevel) || ground < origin[1] - cell - 1e-6 || ground > origin[1] + (footing.embed + 1) * cell + 1e-6) return undefined;
    }
  }
  const beacon = proposal.piece.emitters.find(emitter => emitter.kind === 'beacon');
  if (!beacon) return undefined;
  const yaw = turn * Math.PI / 2;
  return {
    buildings: [{ id: plan.castle.beaconModuleId, slot: 65534, blueprint: proposal.piece.blueprint, position: origin, yaw }],
    props: proposal.piece.parts.map(part => ({ blueprint: part.blueprint, position: world(part.offset), yaw })),
    braziers: proposal.piece.emitters.filter(emitter => emitter.kind === 'lantern').map(emitter => ({ position: world(emitter.position), normal: [0, 1, 0] })),
    beaconPosition: world(beacon.position),
  };
}
