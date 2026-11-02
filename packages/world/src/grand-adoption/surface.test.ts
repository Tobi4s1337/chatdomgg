import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileFoundedScene, foundedGroundAt } from '../founded-world/collision';
import type { RealmFoundedScene } from '../founded-world/types';
import { frameSettlement, settlementGround } from '../grand/kingdom/frame';
import { gradeSettlement } from '../grand/kingdom/grade';
import { grandGroundSource } from '../grand/kingdom/ground';
import { seatSettlement } from '../grand/kingdom/seat';
import { KINGDOM_COVER, LAND_CELL, TREE_STRIDE, type GrandField, type GrandFieldSites } from '../grand/kingdom/types';
import { createKingdomLandInterface } from '../land-interface';
import { grandFloorSurface } from './surface';

const scene = JSON.parse(readFileSync(new URL('../../../../apps/realm/src/founded/artifacts/simulated-town.scene.json', import.meta.url), 'utf8')) as RealmFoundedScene;

/** A plain island with sea all round, large enough to seat the town (the grader's own test land, smaller). */
function island(size = 1536): { field: GrandField; sites: GrandFieldSites } {
  const n = size * size, ground = new Uint16Array(n), water = new Uint16Array(n), cover = new Uint8Array(n), coast = new Int8Array(n);
  const sea = 48, c = size / 2;
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const i = x + z * size, r = Math.hypot(x - c, (z - c) * 1.2) / (size * 0.42);
    ground[i] = Math.max(2, Math.round(sea - 30 + 52 * (1 - r) + 3 * Math.sin(x * 0.05) * Math.cos(z * 0.04)));
    if (ground[i]! <= sea) { water[i] = sea; cover[i] = KINGDOM_COVER.sea; } else cover[i] = KINGDOM_COVER.grass;
    coast[i] = Math.max(-127, Math.min(127, Math.round((1 - r) * 200)));
  }
  const field: GrandField = { size, height: 384, seaLevel: sea, ground, water, cover, coast, trees: new Float32Array(TREE_STRIDE * 0), treeCount: 0 };
  const sites: GrandFieldSites = {
    castle: { x: c, z: c - 120, radius: 100, top: 110 }, town: { x: c, z: c, rx: 200, rz: 150, angle: 0, level: 56 },
    harbour: { x: c, z: c + 500, facing: Math.PI / 2 }, headland: { x: c + 300, z: c + 500, y: 50 }, fields: { x: c + 400, z: c, radius: 120 },
  };
  return { field, sites };
}

describe('the grand floor surface', () => {
  const frame = frameSettlement(scene.plan), { field, sites } = island();
  const seat = seatSettlement(field, sites, frame);
  const grade = gradeSettlement(field, seat, settlementGround(scene.plan), frame.castle.bounds);
  const [ox, oy, oz] = seat.offset, sea = field.seaLevel * LAND_CELL - oy;
  const surfaceAt = grandFloorSurface(scene.plan, { seaLevel: sea });

  it('reads every installed column exactly as the grader painted it', { timeout: 120_000 }, () => {
    const { x0, z0, x1, z1 } = seat.columns;
    const counts = { sand: 0, cobble: 0, rock: 0, grass: 0, wet: 0 }, wrong: string[] = [];
    for (let cz = z0; cz < z1; cz++) for (let cx = x0; cx < x1; cx++) {
      const i = cx + cz * field.size, x = (cx + .5) * LAND_CELL - ox, z = (cz + .5) * LAND_CELL - oz;
      const sample = surfaceAt(x + .2, z - .2);
      if (!sample) { wrong.push(`${cx},${cz} unknown`); continue; }
      if (Math.abs(sample.drawnY - (field.ground[i]! * LAND_CELL - oy)) > 1e-9) wrong.push(`${cx},${cz} height`);
      // The floor floods up to the larger of the column's own water and the sea (restoreInstalledFloor).
      const level = Math.max(field.water[i]!, field.seaLevel), wet = level > field.ground[i]!;
      if (Math.abs(sample.waterDepth - (wet ? (level - field.ground[i]!) * LAND_CELL : 0)) > 1e-9) wrong.push(`${cx},${cz} water`);
      if (wet) { counts.wet++; continue; }
      const cover = field.cover[i]!;
      const expected = cover === KINGDOM_COVER.paved ? 'cobble' : cover === KINGDOM_COVER.sand ? 'sand' : cover === KINGDOM_COVER.rock ? 'rock' : 'grass';
      // A bank on the region's edge is measured against the band, which this query does not read.
      const edge = cx === x0 || cz === z0 || cx === x1 - 1 || cz === z1 - 1;
      if (sample.surface !== expected && !edge) wrong.push(`${cx},${cz} ${sample.surface}≠${expected}`);
      if (sample.surface === expected) counts[expected]++;
    }
    expect(wrong.slice(0, 8)).toEqual([]);
    expect(counts.cobble).toBeGreaterThan(grade.paved * .99);
    expect(counts.grass).toBeGreaterThan(1000);
    expect(counts.cobble).toBeGreaterThan(1000);
    expect(counts.wet).toBeGreaterThan(0);
  });

  it('matches the walked floor and stays silent outside the installed region', () => {
    for (const [x, z] of [[0, 8], [12.3, -20.7], [-31.1, 14.9]] as const) {
      expect(surfaceAt(x, z)!.drawnY).toBe(foundedGroundAt(scene.plan, x, z)[1]);
    }
    expect(surfaceAt(frame.region.maxX + 1, 0)).toBeNull();
    expect(surfaceAt(Number.NaN, 0)).toBeNull();
  });

  it('is offered on the land seam and refuses malformed producer samples', () => {
    const collision = compileFoundedScene(scene), ground = grandGroundSource(scene);
    const land = createKingdomLandInterface({ scene, ground, collision, surface: surfaceAt });
    expect(land.surfaceAt!(0, 8)).toEqual(surfaceAt(0, 8));
    const bad = createKingdomLandInterface({ scene, ground, collision, surface: () => ({ drawnY: 1, surface: 'lava' as never, waterDepth: 0 }) });
    expect(bad.surfaceAt!(0, 8)).toBeNull();
    expect(createKingdomLandInterface({ scene, ground, collision }).surfaceAt).toBeUndefined();
  });
});
