// SIMULATED lake place for the water-place bench: the surface bench's fixture lake and town, with a pier, boathouse
// and fishing rock sited on its south bank in the planner's own `PierPlan`/`BoathousePlan` shapes, foundation grids
// sampled from the fixture ground. Every site, height and presence here is a bench fixture, never a land decision;
// production code never imports this module.
import type { Vec3 } from '@chatdom/shared';
import type { XZ } from '@chatdom/world';
import { CELL, rectangleToWorld, toWorld, type BoathousePlan, type CardinalFrame, type FoundationGrid, type PierPlan } from '../../../../../../packages/world/src/places/water/index';
import { groundAt, type WaterGround } from '../surface/index';
import { lakeFixture, type LakeFixture, type LakeView } from '../surface-bench/lake';

export const SIMULATED_PLACE = 'SIMULATED · WATER PLACE BENCH · fixture lake, town and sites, simulated presence';

export type PlaceView = 'lake-postcard' | 'pier-deck';
export interface PlaceFixture {
  readonly label: string;
  readonly lake: LakeFixture;
  readonly ground: WaterGround;
  readonly pier: PierPlan;
  readonly boathouse: BoathousePlan;
  /** Static shore pieces the lake fixture placed that the sites leave standing. */
  readonly keep: (id: string) => boolean;
  /** Where the upturned boat rests on the bank (blueprint corner) and its cardinal turn. */
  readonly upturned: CardinalFrame;
  readonly views: Readonly<Record<PlaceView, { readonly wide: LakeView; readonly tall: LakeView }>>;
}

const FOUNDATION_STEP = 0.5;
const PIER_DECK = 0.7;

function grid(ground: WaterGround, frame: CardinalFrame, min: XZ, max: XZ): FoundationGrid {
  const columns = Math.floor((max[0] - min[0]) / FOUNDATION_STEP) + 1, rows = Math.floor((max[1] - min[1]) / FOUNDATION_STEP) + 1;
  const heights: number[] = [];
  for (let k = 0; k < rows; k++) for (let i = 0; i < columns; i++) {
    const p = toWorld(frame, [min[0] + i * FOUNDATION_STEP, 0, min[1] + k * FOUNDATION_STEP]);
    heights.push(groundAt(ground, p[0], p[2]));
  }
  return { frame, min, step: FOUNDATION_STEP, columns, rows, heights };
}

/** First local z along a line where the ground drops under the water's level. */
function shoreAlong(ground: WaterGround, frame: CardinalFrame, x: number, z0: number, z1: number, level: number): number {
  for (let z = z0; z <= z1; z += 0.25) { const p = toWorld(frame, [x, 0, z]); if (groundAt(ground, p[0], p[2]) < level) return z; }
  return z1;
}

export function placeFixture(): PlaceFixture {
  const lake = lakeFixture();
  const ground: WaterGround = { data: lake.ground.data, width: lake.ground.width, height: lake.ground.depth, origin: lake.ground.origin, step: lake.ground.step };
  const level = lake.body.level, at = (x: number, z: number) => groundAt(ground, x, z);

  // The pier runs north from the south bank (turn 2: local +Z faces −Z), its root where the bank stands a quarter
  // metre under the deck, so one short ramp meets the landing.
  const pierX = 4.5;
  let rootZ = 30;
  while (rootZ > 15 && at(pierX - 1.25, rootZ) > level + PIER_DECK - 0.25) rootZ -= 0.125;
  const pierFrame: CardinalFrame = { origin: [pierX, level, rootZ], turn: 2 };
  const footprint = ([[0, 0], [2.5, 0], [2.5, 24], [5.25, 24], [5.25, 28], [-2.75, 28], [-2.75, 24], [0, 24]] as const)
    .map(([x, z]) => { const p = toWorld(pierFrame, [x, 0, z]); return [p[0], p[2]] as XZ; });
  const headCentre = toWorld(pierFrame, [1.25, 0, 26]), rootAt = toWorld(pierFrame, [1.25, 0, 0]);
  const pier: PierPlan = {
    site: { id: 'lake:pier', turn: 2, footprint }, frame: pierFrame, deck: level + PIER_DECK, deckAboveWater: PIER_DECK,
    walk: { x: [0, 2.5], length: 24 }, head: { x: [-2.75, 5.25], z: [24, 28] },
    shore: shoreAlong(ground, pierFrame, 1.25, 0, 28, level), headDepth: level - at(headCentre[0], headCentre[2]),
    rootGround: at(rootAt[0], rootAt[2]), foundation: grid(ground, pierFrame, [-2.75, 0], [5.25, 28]),
  };

  // The boathouse stands west of the pier's root, its back on the bank and its bay open to the lake.
  const boatFrame: CardinalFrame = { origin: [-13.5, level, 20.75], turn: 2 };
  const boatMid = toWorld(boatFrame, [4, 0, 10.5]);
  const boathouse: BoathousePlan = {
    site: { id: 'lake:boathouse', turn: 2, footprint: rectangleToWorld(boatFrame, [0, 0], [8, 11]) }, frame: boatFrame,
    shore: shoreAlong(ground, boatFrame, 4, 0, 11, level), bayDepth: level - at(boatMid[0], boatMid[2]),
    foundation: grid(ground, boatFrame, [0, 0], [8, 11]),
  };

  // The upturned boat rests on its trestles on the grass between the boathouse and the pier.
  const upturnedAt: Vec3 = [-8.5, 0, 24.5];
  const upturned: CardinalFrame = { origin: [upturnedAt[0], at(upturnedAt[0] + 0.7, upturnedAt[2] + 1.75) - CELL, upturnedAt[2]], turn: 1 };

  // Shore pieces of the lake fixture that would stand in a site are left out.
  const sites = [footprint, boathouse.site.footprint];
  const inside = (x: number, z: number, margin: number) => sites.some(poly => {
    const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
    return x > Math.min(...xs) - margin && x < Math.max(...xs) + margin && z > Math.min(...zs) - margin && z < Math.max(...zs) + margin;
  });
  const placements = new Map(lake.placements.map(p => [p.id, p]));
  const keep = (id: string) => {
    const p = placements.get(id);
    if (!p || p.slot !== undefined || id === 'keep') return true;
    const cx = p.origin[0] + (p.blueprint.size[0] * CELL) / 2, cz = p.origin[2] + (p.blueprint.size[2] * CELL) / 2;
    return !inside(cx, cz, 1.5);
  };

  const deckEye = (x: number, z: number): Vec3 => { const p = toWorld(pierFrame, [x, 0, z]); return [p[0], level + PIER_DECK + 1.6, p[2]]; };
  return {
    label: SIMULATED_PLACE, lake, ground, pier, boathouse, keep, upturned,
    views: {
      // From the back of the pier head: the seat edge and bell post in front, water, the roofs, the keep and beacon.
      'lake-postcard': {
        wide: { eye: deckEye(0.4, 24.6), target: [-1, 6.5, -42], fov: 52 },
        tall: { eye: deckEye(0.8, 24.4), target: [-2, 9, -42], fov: 66 },
      },
      // On the walk near the root, looking out along the deck to the head with the boathouse on the left shore.
      'pier-deck': {
        wide: { eye: deckEye(1.0, 3.5), target: toWorld(pierFrame, [0.6, 1.4, 22]), fov: 55 },
        tall: { eye: deckEye(1.1, 2.5), target: toWorld(pierFrame, [0.8, 2.2, 22]), fov: 68 },
      },
    },
  };
}
