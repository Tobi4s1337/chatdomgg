// SIMULATED test habitat: the millrace bench fixture's land, read through the lane's real water query and the
// placed pieces' own walks. Test-only; production code never imports this module.
import type { Vec3 } from '@chatdom/shared';
import type { KingdomLandform } from '@chatdom/world';
import { placePieceAnchors } from '../../../../../../packages/world/src/places/water/anchors';
import { cellToWorld } from '../../../../../../packages/world/src/places/water/frame';
import { deriveWaterReaches } from '../../../../../../packages/world/src/places/water/reaches';
import { reviewExtras } from '../millrace-bench/extras';
import { millraceFixture } from '../millrace-bench/fixture';
import { waterAt, type WaterGround } from '../surface/coverage';
import type { WaterContact } from '../surface/surface';
import type { Habitat } from './habitat';

export function millHabitat() {
  const mill = millraceFixture(reviewExtras());
  const landform: KingdomLandform = {
    version: 2, seed: 7, ridge: { origin: [0, -200], bearing: 0, length: 1, width: 1, height: 0 }, castleRise: { centre: [0, -300], radius: 1, height: 0 },
    lake: { x: 0, z: -400, radiusX: 1, radiusZ: 1, level: -50 }, hills: [], waters: mill.land.bodies.map(b => ({ ...b })), streams: mill.land.streams.map(s => ({ ...s })),
  };
  const reaches = deriveWaterReaches(landform);
  const ground: WaterGround = { data: mill.ground.data, width: mill.ground.width, height: mill.ground.depth, origin: mill.ground.origin, step: mill.ground.step };
  const obstacles: WaterContact[] = mill.land.contacts.map(c => ({ a: c.a, ...(c.b ? { b: c.b } : {}), radius: c.radius, strength: c.strength }));
  const statics = mill.placements.filter(p => !p.mounted);
  const anchors = new Map(statics.map(p => [p.id, placePieceAnchors({ origin: p.origin, turn: p.turn }, p.piece)]));
  const walks = [...anchors.values()].flatMap(a => a.walks);
  const reeds: Vec3[] = statics.filter(p => p.id.startsWith('reeds')).map(p => cellToWorld({ origin: p.origin, turn: p.turn }, [p.piece.blueprint.size[0] / 2, 0, p.piece.blueprint.size[2] / 2]));
  const habitat: Habitat = { waterAt: (x, z) => waterAt(mill.land.bodies, reaches, ground, x, z), bodies: mill.land.bodies, reaches, obstacles, walks };
  return { mill, habitat, reeds, anchors, reaches };
}
