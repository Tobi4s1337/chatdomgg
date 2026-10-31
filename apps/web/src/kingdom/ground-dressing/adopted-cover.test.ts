import { expect, it } from 'vitest';
import { generateSettlementPlan, samplePublicGround, terrainHeight } from '@chatdom/world';
import { createCastleContent } from '../castle-content';
import { placeMarketContent, placeSettlementContent } from '../settlement-content';
import { sampleTerrainTriangles } from '../terrain-worker';
import { planAdoptedCover } from './adopted-cover';
import { footprintCorners, pieceRole, polygonDistance } from './plan';

it('adds only passive planting and flush stones over the adopted hamlet without changing its land or homes', () => {
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
    return (role.cover || role.form === 'stepping-stones') && !role.solid;
  })).toBe(true);
  expect(forms).toContain('cutting-bed');
  expect(forms).toContain('stepping-stones');
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

it('gardens behind the real market stall that backs onto the square, beside its wares, and nowhere it is absent', () => {
  const adopted = generateSettlementPlan({ seed: 'willowmere', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const ground = (x: number, z: number) => terrainHeight(adopted, x, z);
  const market = placeMarketContent(adopted.market);
  // The reviewed wares beside stall 0 as the founded scene mounts them: a cart before it, stores at its end.
  const stores = { ...market[1]!, blueprint: { ...market[1]!.blueprint, id: 'civic-hearth-market-stores', size: [24, 16, 16] as [number, number, number] }, position: [-8.5, 9, 0.5] as [number, number, number] };
  const occupied = [...placeSettlementContent(adopted.homes, ground).houses, ...market, stores];
  const input = { ground, occupied, keepClear: [{ x: 0, z: 8, radius: 7 }], waterKeepOut: () => false };
  const cover = planAdoptedCover(adopted, input);
  const garden = [...cover.pieces.values()].flat().filter(piece => piece.id.startsWith('market:stall:'));
  const forms = garden.map(piece => pieceRole(piece.blueprint).form);
  // Only stall 0 backs onto an edge; stall 1 stands deep in the square.
  expect(garden.every(piece => piece.id.startsWith('market:stall:0:garden:'))).toBe(true);
  expect(forms.filter(form => form === 'cutting-bed').length).toBeGreaterThanOrEqual(2);
  expect(forms.filter(form => form === 'stepping-stones')).toHaveLength(1);
  // Here the castle road's paving ends the run before the bed being planted, and the report says so.
  if (!forms.includes('seedling-bed')) expect(cover.report.omissions).toContain('market:stall:0:garden:seedlings: on paving');
  expect(forms.filter(form => form.startsWith('wildflowers-')).length).toBeGreaterThanOrEqual(5);
  const square = adopted.market.boundary;
  for (const piece of garden) {
    expect(pieceRole(piece.blueprint).solid).toBe(false);
    const corners = footprintCorners(piece.blueprint, piece.position, piece.yaw, 0.125);
    for (const [x, z] of corners) {
      // Wholly outside the square and off its paving, clear of the stall and its stores.
      expect(polygonDistance(square, x, z), piece.id).toBeGreaterThan(0.25);
      expect(samplePublicGround(adopted, x, z)?.pavingDistance ?? Infinity, piece.id).toBeGreaterThan(0.25);
    }
    for (const other of [market[1]!, stores]) {
      const box = footprintCorners(other.blueprint, other.position, other.yaw);
      const [minX, maxX] = [Math.min(...box.map(p => p[0])), Math.max(...box.map(p => p[0]))], [minZ, maxZ] = [Math.min(...box.map(p => p[1])), Math.max(...box.map(p => p[1]))];
      expect(corners.some(([x, z]) => x > minX && x < maxX && z > minZ && z < maxZ), piece.id).toBe(false);
    }
  }
  // The beds run along the edge from behind the stall's inner end toward the middle of the square.
  const beds = garden.filter(piece => pieceRole(piece.blueprint).form.endsWith('-bed')).map(piece => footprintCorners(piece.blueprint, piece.position, piece.yaw));
  for (const bed of beds) for (const [, z] of bed) expect(z).toBeGreaterThan(-4.5);
  expect(Math.min(...beds.flat().map(p => p[0]))).toBeLessThan(-9);
  expect(Math.max(...beds.flat().map(p => p[0]))).toBeGreaterThan(-3);

  // Without a stall there is no stall garden: nothing assumes where one would stand.
  const bare = planAdoptedCover(adopted, { ...input, occupied: occupied.filter(piece => !piece.blueprint.id.startsWith('market-stall')) });
  expect([...bare.pieces.values()].flat().some(piece => piece.id.startsWith('market:'))).toBe(false);
}, 60_000);
