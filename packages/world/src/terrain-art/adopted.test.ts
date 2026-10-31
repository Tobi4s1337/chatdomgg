import { expect, it } from 'vitest';
import { foundedGroundAt, FOUNDED_TERRAIN_VERSION, sampleFoundedTerrain } from '../founded-world/collision';
import { terrainHeight } from '../layout';
import { generateSettlementPlan } from '../settlement/generator';
import { samplePublicGround, settlementTerrainHeight } from '../settlement/terrain';
import { ADOPTED_TERRAIN_BOUNDS, adoptedTerrainArt } from './adopted';
import { createTerrainArtCandidate } from './producer';
import { TERRAIN_ART_PRODUCER } from './types';

it('adopts one picture-land surface for display, light contact, routes and founded collision without moving the accepted plan', () => {
  const plan = generateSettlementPlan({ seed: 'simulated-founded-town', tier: 'town', firstYear: 2022, year: 2026 });
  const before = JSON.stringify(plan), candidate = adoptedTerrainArt(plan);
  const independent = createTerrainArtCandidate({ plan, bounds: ADOPTED_TERRAIN_BOUNDS,
    ground: (x, z) => settlementTerrainHeight(plan, x, z), publicGround: (x, z) => samplePublicGround(plan, x, z) });
  expect(plan.revision).toBe('settlement:2:23b3c1b5');
  expect(adoptedTerrainArt(plan)).toBe(candidate);
  expect(FOUNDED_TERRAIN_VERSION).toContain(TERRAIN_ART_PRODUCER);

  let lifted = 0;
  // Includes arbitrary positions in both triangle halves, beyond the town and near the horizon edge.
  for (const [x, z] of [[-240.2, -260.7], [100.75, -300.25], [-1100, -1100], [1099.7, 1099.2], [0.8, 0.3]]) {
    expect(terrainHeight(plan, x!, z!)).toBe(independent.height(x!, z!));
    if (terrainHeight(plan, x!, z!) - settlementTerrainHeight(plan, x!, z!) > 6) lifted++;
  }
  expect(lifted).toBeGreaterThan(0);
  // The inhabited pads and the installed road graph remain exactly where they were adopted.
  for (const home of plan.homes) expect(terrainHeight(plan, home.position[0], home.position[2]))
    .toBe(settlementTerrainHeight(plan, home.position[0], home.position[2]));
  for (const road of plan.streets) for (const [x, , z] of road.points)
    expect(terrainHeight(plan, x, z)).toBe(settlementTerrainHeight(plan, x, z));
  expect(terrainHeight(plan, 1101.25, 0.75)).toBe(settlementTerrainHeight(plan, 1101.25, 0.75));

  const physical = sampleFoundedTerrain(plan), [originX, , originZ] = physical.origin;
  let changedContacts = 0;
  for (let i = 0; i < physical.heights.length; i += 997) {
    const x = originX + ((i % physical.columns) + .5) * .5;
    const z = originZ + (Math.floor(i / physical.columns) + .5) * .5;
    const expected = Math.round(independent.height(x, z) / .5) * .5;
    expect(physical.heights[i]).toBe(expected);
    expect(foundedGroundAt(plan, x, z)).toEqual([x, expected, z]);
    if (expected !== Math.round(settlementTerrainHeight(plan, x, z) / .5) * .5) changedContacts++;
  }
  expect(changedContacts).toBeGreaterThan(0);
  expect(JSON.stringify(plan)).toBe(before);
}, 60_000);
