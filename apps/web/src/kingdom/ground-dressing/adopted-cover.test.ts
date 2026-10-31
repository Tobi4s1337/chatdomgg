import { expect, it } from 'vitest';
import { generateSettlementPlan, terrainHeight } from '@chatdom/world';
import { createCastleContent } from '../castle-content';
import { placeMarketContent, placeSettlementContent } from '../settlement-content';
import { sampleTerrainTriangles } from '../terrain-worker';
import { planAdoptedCover } from './adopted-cover';
import { footprintCorners, pieceRole } from './plan';

it('adds only passive flowers and tufts over the adopted hamlet without changing its land or homes', () => {
  const adopted = generateSettlementPlan({ seed: 'willowmere', tier: 'hamlet', firstYear: 2025, year: 2026 });
  expect(adopted.landform.version).toBe(1);
  const before = JSON.stringify(adopted);
  // Match the rendered metre triangles, caching their shared terrain vertices.
  const heights = new Map<string, number>();
  const corner = (x: number, z: number) => {
    const key = `${x},${z}`;
    let height = heights.get(key);
    if (height === undefined) { height = terrainHeight(adopted, x, z); heights.set(key, height); }
    return height;
  };
  let groundSamples = 0;
  const ground = (x: number, z: number) => { groundSamples++; return sampleTerrainTriangles(corner, x, z); };
  const { houses, props } = placeSettlementContent(adopted.homes, (x, z) => terrainHeight(adopted, x, z));
  const occupied = [...houses, ...props, ...placeMarketContent(adopted.market), ...createCastleContent(adopted.castle).buildings];
  const occupiedBefore = JSON.stringify(occupied.map(({ position, yaw }) => ({ position, yaw })));
  const occupiedBounds = occupied.map(piece => {
    const corners = footprintCorners(piece.blueprint, piece.position, piece.yaw);
    return { minX: Math.min(...corners.map(p => p[0])), maxX: Math.max(...corners.map(p => p[0])),
      minZ: Math.min(...corners.map(p => p[1])), maxZ: Math.max(...corners.map(p => p[1])) };
  });
  const keepClear = [{ x: 0, z: 8, radius: 7 }];
  const lake = adopted.lake;
  const waterKeepOut = (x: number, z: number, margin: number) =>
    Math.hypot((x - lake.x) / (lake.radiusX + margin), (z - lake.z) / (lake.radiusZ + margin)) < 1.19;

  const cover = planAdoptedCover(adopted, { ground, occupied, keepClear, waterKeepOut });
  const placements = [...cover.pieces.values()].flat();
  const forms = placements.map(piece => pieceRole(piece.blueprint).form);
  expect(forms).toContain('meadow-tufts');
  expect(forms.some(form => form.startsWith('wildflowers-'))).toBe(true);
  expect(placements.every(piece => {
    const role = pieceRole(piece.blueprint);
    return role.cover && !role.solid;
  })).toBe(true);
  expect(cover.blockers).toEqual([]);
  expect(cover.collisionPieces).toEqual([]);
  expect(cover.seatAnchors).toEqual([]);
  expect(groundSamples).toBeGreaterThan(0);

  // Check centres only: the full footprint clearance proof belongs to the planner's own suite.
  expect(placements.every(piece => {
    const w = piece.blueprint.size[0] / 16, d = piece.blueprint.size[2] / 16;
    const c = Math.cos(piece.yaw), s = Math.sin(piece.yaw);
    const x = piece.position[0] + c * w + s * d, z = piece.position[2] - s * w + c * d;
    return !waterKeepOut(x, z, 0.5)
      && keepClear.every(circle => Math.hypot(x - circle.x, z - circle.z) > circle.radius)
      && !occupiedBounds.some(rect => x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ);
  })).toBe(true);
  expect(cover.report.counts).toEqual(Object.fromEntries([...cover.pieces].map(([id, pieces]) => [id, pieces.length])));
  expect(JSON.stringify(adopted)).toBe(before);
  expect(JSON.stringify(occupied.map(({ position, yaw }) => ({ position, yaw })))).toBe(occupiedBefore);
}, 30_000);
