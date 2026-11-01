import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '../founded-world/types';
import { transformCardinalPoint } from '../settlement/geometry';
import { interactionTargetId } from './ids';
import { standingClear } from './geometry';
import { foundedInstalledHomes, homeThreshold } from './homes';
import { createInteractionRegistry, homeZone, type InteractionPlacement, type InteractionRegistry } from './registry';

/** The hero anvil mounted by the kingdom's Forge, in the market's metre frame. */
export const foundedAnvilPosition = (scene: RealmFoundedScene): Vec3 => [0, scene.plan.market.elevation, 8];

function standingNear(world: CollisionWorld, point: Vec3): Vec3 | null {
  const heights = new Set([point[1]]);
  for (const box of world.query({ min: [point[0] - .28, point[1] - .75, point[2] - .28],
    max: [point[0] + .28, point[1] + .5, point[2] + .28] })) {
    if (box.max[1] >= point[1] - .75 && box.max[1] <= point[1] + .5) heights.add(box.max[1]);
  }
  for (const y of [...heights].sort((a, b) => Math.abs(a - point[1]) - Math.abs(b - point[1]))) {
    const feet: Vec3 = [point[0], y, point[2]];
    if (standingClear(world, feet)) return feet;
  }
  return null;
}

/**
 * Hints and authority share the exact installed scene/collision. Native doors are retained low, body-height
 * façade carves, never guessed centres of house bounds. Both thresholds must be supported and clear.
 * Place-producer seats join this registry when installed; an absent place supplies no imaginary target.
 */
export function createFoundedInteractionRegistry(scene: RealmFoundedScene, world: CollisionWorld,
  /** Private authority only. Empty revisions explicitly withhold a door until its committed geometry is installed. */
  ownedHomeRevisions?: ReadonlyMap<string, string>): InteractionRegistry {
  if (scene.collisionRevision !== world.revision) throw new Error('Interaction anchors need the installed collision revision.');
  const placements: InteractionPlacement[] = [], anvil = foundedAnvilPosition(scene);
  const approach = standingNear(world, [anvil[0], anvil[1], anvil[2] + 1.7]);
  if (approach) placements.push({ source: 'forge:market-anvil', origin: [0, 0, 0], turn: 0, cell: 1,
    anchors: [{ id: interactionTargetId.anvil('market'), kind: 'anvil', zone: 'street',
      position: [anvil[0], anvil[1] + 1.25, anvil[2]], approach, reach: 3 }] });
  const assets = new Map(scene.assets.map(a => [a.assetHash, a.blueprint]));
  for (const placement of scene.placements) {
    const blueprint = assets.get(placement.assetHash), plot = placement.plotId;
    if (blueprint?.kind === 'civic' && blueprint.lattice === 'build' && blueprint.seats?.length) {
      placements.push({ source: placement.id, origin: placement.position, turn: placement.rotation, cell: VOXEL_METRES.build,
        anchors: blueprint.seats.map(seat => ({ id: interactionTargetId.benchSeat(placement.id, seat.id), kind: 'bench-seat',
          zone: 'street', position: seat.position, approach: seat.approach, rest: seat.rest,
          facing: seat.facing * Math.PI / 2, reach: 3 })) });
    }
    // Authority's owned plots get the exact revision-bound threshold below, including an honest blocked door.
    // Two-argument public hints keep their existing native doorway metadata without private revisions.
    if (!plot || blueprint?.kind !== 'home' || ownedHomeRevisions?.has(plot)) continue;
    const at = (local: Vec3) => transformCardinalPoint(placement.position, placement.rotation,
      [local[0] * VOXEL_METRES.build, local[1] * VOXEL_METRES.build, local[2] * VOXEL_METRES.build]);
    const portals = blueprint.boxes.filter(b => b.material === 0 && b.from[1] <= 4
      && b.to[1] - b.from[1] >= 15 && b.to[0] - b.from[0] >= 6 && b.to[0] - b.from[0] <= 18
      && b.to[2] - b.from[2] <= 8 && b.to[2] > blueprint.size[2] * .5)
      .sort((a, b) => b.to[2] - a.to[2]);
    for (const portal of portals) {
      const x = (portal.from[0] + portal.to[0]) / 2, y = portal.from[1];
      const rest = standingNear(world, at([x, y, portal.from[2] - 5]));
      let outside: Vec3 | null = null;
      for (const extra of [5, 8, 11]) {
        outside = standingNear(world, at([x, y, portal.to[2] + extra]));
        if (outside) break;
      }
      if (!outside || !rest) continue;
      const point = at([x, y + 9, portal.to[2]]);
      placements.push({ source: placement.id, origin: [0, 0, 0], turn: 0, cell: 1, anchors: [
        { id: interactionTargetId.homeDoor(plot), kind: 'home-door', zone: 'street', plotId: plot,
          position: point, approach: outside, rest, reach: 3 },
        { id: interactionTargetId.homeExit(plot), kind: 'home-exit', zone: homeZone(plot), plotId: plot,
          position: point, approach: rest, rest: outside, reach: 3 },
      ] });
      break;
    }
  }
  const homes = ownedHomeRevisions ? foundedInstalledHomes(scene, ownedHomeRevisions).homes.map(home => homeThreshold(home, world)) : [];
  return createInteractionRegistry({ layoutRevision: scene.layoutRevision, world, placements, homes });
}
