import { expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type FishSpecies } from '@chatdom/shared';
import { generateSettlementPlan, terrainHeight } from '@chatdom/world';
import { foundedGroundAt } from '@chatdom/world/founded-collision';
import { createFishingCasts } from './cast';
import { findPierSite, pierLocalToWorld, pierWaterAt } from './site';
import { createFishingSpecies } from './species';

it('uses trusted meadow for a restricted fish on a real founded site with unknown raw biome', () => {
  const plan = generateSettlementPlan({ seed: 'founded-scene-test', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const site = findPierSite(plan);
  expect(site).not.toBeNull(); expect(site!.biome).toBe('unknown');
  const fish: FishSpecies = { id: 'fish:meadow', name: 'Meadow fish', lore: 'Lives in a meadow lake.', riddle: 'A glint.', rarity: 'common', weight: 1,
    waters: ['lake'], biomes: ['meadow'], hours: ['dawn', 'day', 'dusk', 'night'], moods: ['clear', 'breeze', 'mist', 'rain'], minDepthM: 1,
    lengthMm: [100, 200], weightG: [100, 500], fight: 'steady' };
  const person = PersonIdSchema.parse('100');
  let now = 1_000_000;
  const position = pierLocalToWorld(site!, [10, 0, (site!.walk + 3.4) / .125]);
  const installation = { site: site!, biome: 'meadow', revision: 7, sample: (x: number, z: number) => ({ waterY: pierWaterAt(plan, x, z), groundY: Math.max(terrainHeight(plan, x, z), foundedGroundAt(plan, x, z)[1]) }) };
  const casts = createFishingCasts({ kingdomId: KingdomIdSchema.parse('200'), clock: () => now, species: createFishingSpecies([fish]),
    seat: () => ({ token: 'seat', ownsRod: true, pose: { position, yaw: site!.turn * 64, grounded: true, collisionRevision: 7 } }),
    installation: () => installation, makeId: () => '123e4567-e89b-42d3-a456-426614174000', seed: () => 1 });
  const draw = casts.act(person, { type: 'pier.draw', id: 'draw' });
  expect(draw.ok).toBe(true);
  now += 200;
  expect(casts.act(person, { type: 'pier.release', id: 'release', castId: draw.cast!.id, seq: 1 })).toMatchObject({ ok: true, cast: { phase: 'flying' } });
  now += 650;
  expect(casts.tick().map(beat => beat.kind)).toContain('float');
  expect(casts.views()[0]).toMatchObject({ phase: 'waiting', environment: { biome: 'meadow' } });
}, 120_000);
