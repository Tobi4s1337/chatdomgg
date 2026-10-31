import type { Vec3 } from '@chatdom/shared';
import { randomUnit, seedHash } from '../layout';
import type { KingdomLandform, LandHill, LandStream } from '../kingdom-land/types';
import type { CardinalTurn, XZ } from '../settlement/types';
import type { GenesisLandscape } from './contracts';

/** Independent semantic draws: adding a crest/emote/name never consumes a terrain random stream. */
export function draw(seedKey: string, slot: string): number {
  // Slot goes first: a collision in one hashed identity prefix must not couple every later feature.
  return randomUnit(seedHash(`${slot}/${seedKey}`));
}
const half = (value: number): number => Math.round(value * 2) / 2;

export function compileLandscape(seedKey: string, rank: 0 | 1 | 2): GenesisLandscape {
  const key = `${seedKey}/landscape/${rank}`;
  const turn = Math.floor(draw(key, 'orientation') * 4) as CardinalTurn;
  const point = (x: number, z: number): XZ => {
    const a = half(x), b = half(z);
    if (turn === 0) return [a, b];
    if (turn === 1) return [b, -a];
    if (turn === 2) return [-a, -b];
    return [-b, a];
  };
  const jitter = (slot: string, extent: number) => (draw(key, slot) * 2 - 1) * extent;
  const character = (['coastal-harbour', 'river-valley', 'mountain-pass'] as const)[
    (Math.floor(draw(seedKey, 'landscape-order') * 3) + rank) % 3
  ]!;
  const coastZ = character === 'coastal-harbour' ? 170 : character === 'river-valley' ? 290 : 390;
  const mountainHeight = character === 'mountain-pass' ? 68 : 28;
  const ridgeLeft = point(-68 + jitter('ridge-left', 18), -215);
  const ridgeRight = point(100 + jitter('ridge-right', 18), -220);
  const hills: LandHill[] = [
    { id: 'ridge-west', centre: ridgeLeft, height: mountainHeight + half(jitter('west-height', 6)), radius: 95, plateau: 12 },
    { id: 'ridge-east', centre: ridgeRight, height: mountainHeight + half(jitter('east-height', 6)), radius: 105, plateau: 16 },
    { id: 'castle-rise', centre: point(-55, -65), height: 16, radius: 78, plateau: 30 },
    { id: 'town-meadow', centre: point(-35, 25), height: 7, radius: 110, plateau: 50 },
  ];
  const riverX = 105 + jitter('river-side', 20);
  const river: LandStream = {
    id: 'river', kind: 'stream', bank: 14,
    points: Array.from({ length: 9 }, (_, i) => {
      const t = i / 8;
      return {
        position: point(riverX + jitter(`river-bend-${i}`, i === 8 ? 0 : 20), -180 + t * (coastZ + 204)),
        level: half(12 * (1 - t)), bed: half(12 * (1 - t)) - 2,
        width: half(5 + t * 7 + draw(key, `river-width-${i}`) * 2),
      };
    }),
  };
  const lagoon = point(riverX, coastZ + 24);
  const terrainCore: KingdomLandform = {
    version: 2, seed: seedHash(key),
    ridge: { origin: point(0, -160), bearing: turn * Math.PI / 2, length: 280, width: 210, height: 5 },
    castleRise: { centre: hills[2]!.centre, radius: hills[2]!.radius, height: hills[2]!.height },
    lake: { x: lagoon[0], z: lagoon[1], radiusX: 42, radiusZ: 42, level: 0 },
    hills,
    waters: [{ id: 'river-mouth', x: lagoon[0], z: lagoon[1], radiusX: 42, radiusZ: 42, level: 0, depth: 3 }],
    streams: [river],
  };
  const shoreline = Array.from({ length: 9 }, (_, i) => point(-480 + i * 120, coastZ + jitter(`coast-${i}`, 16)));
  const islandCount = character === 'coastal-harbour' ? 2 + Math.floor(draw(key, 'island-count') * 2) : 1;
  const islands = Array.from({ length: islandCount }, (_, i) => ({
    id: `offshore-${i}`, centre: point(-300 + i * 175 + jitter(`island-${i}-x`, 20), coastZ + 115 + jitter(`island-${i}-z`, 15)),
    radiusX: half(22 + draw(key, `island-${i}-width`) * 14), radiusZ: half(18 + draw(key, `island-${i}-depth`) * 12),
    height: half(8 + draw(key, `island-${i}-height`) * 8),
  }));
  const reserveCorners = [point(-105, -25), point(25, 90)];
  const saddle = point(14, -215);
  const innNames = ['The Copper Kettle', 'The Fox and Fir', 'The Wren and Willow', 'The Lantern and Oar'];
  const places: GenesisLandscape['places'] = [
    { id: 'castle', name: 'Crown Hill', purpose: 'castle', anchor: hills[2]!.centre },
    { id: 'plaza', name: 'Bell Court', purpose: 'plaza', anchor: point(-30, 20) },
    { id: 'tavern', name: innNames[Math.floor(draw(seedKey, 'tavern-name') * innNames.length)]!, purpose: 'tavern', anchor: point(-72, 30) },
    { id: 'forge', name: 'Ember Yard', purpose: 'forge', anchor: point(0, 15) },
    { id: 'campfire', name: 'Wren Clearing', purpose: 'campfire', anchor: point(-170, 25) },
    { id: 'gate', name: 'Wayfarer Gate', purpose: 'gate', anchor: point(-35, 110) },
    { id: 'old-row', name: 'Old Row', purpose: 'old-row', anchor: point(-65, -15) },
  ];
  return {
    id: key, rank, character, terrainCore, surfaceCompiler: 'genesis-coast-1',
    coast: { shoreline, oceanToward: turn, level: 0 }, islands,
    forest: { id: 'west-wood', boundary: [point(-290, -80), point(-135, -70), point(-125, 110), point(-280, 120)], clearing: point(-170, 25) },
    mountainPass: { saddle: [saddle[0], 7, saddle[1]] as Vec3, betweenHillIds: ['ridge-west', 'ridge-east'], width: 18 },
    settlementReserve: {
      minX: Math.min(...reserveCorners.map(p => p[0])), maxX: Math.max(...reserveCorners.map(p => p[0])),
      minZ: Math.min(...reserveCorners.map(p => p[1])), maxZ: Math.max(...reserveCorners.map(p => p[1])),
    },
    places,
  };
}
