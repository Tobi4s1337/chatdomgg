import { readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';
import { executeVoxelJob } from '@chatdom/voxel';
import { generateSettlementPlan, samplePublicGround, terrainHeight, type SettlementPlan, type XZ } from '@chatdom/world';
import { foundedGroundAt, sampleFoundedTerrain } from '@chatdom/world/founded-collision';
import { frameSettlement, settlementWater } from '../../../../../../packages/world/src/grand/kingdom/frame';
import { planTownWalls } from '../../../../../../packages/world/src/grand/kingdom/walls';
import { createCastleContent } from '../../castle-content';
import { polygonDistance, type GroundPiece } from '../../ground-dressing/plan';
import { placeMarketContent, placeSettlementContent } from '../../settlement-content';
import { TOWN_FORMS, TOWN_FORM_ROLES, townBlueprint, type TownForm } from './forms';
import { planTownGround, primeTownFloor, townKeepOut, townRowAngle, TOWN_USE, TOWN_USE_LOOK, type TownGroundInput, type TownGroundPlan } from './plan';

const CELL = 0.125;
const SLOW = 600_000;
const all = (result: TownGroundPlan) => [...result.pieces.values()].flat();
const FORM_BY_ID = new Map(TOWN_FORMS.map(form => [townBlueprint(form).id, form]));
const formOf = (piece: GroundPiece): TownForm => FORM_BY_ID.get(piece.blueprint.id)!;

/** World point of local (a, b) on a piece, as the mount's instance matrix places it. */
function local(piece: Pick<GroundPiece, 'position' | 'yaw'>, a: number, b: number): XZ {
  const c = Math.cos(piece.yaw), s = Math.sin(piece.yaw);
  return [piece.position[0] + c * a + s * b, piece.position[2] - s * a + c * b];
}
/** Points over a piece's footprint every `step` metres, `inset` in from its box edge. */
function footprintPoints(piece: GroundPiece, step = 0.25, inset = 0.0625): XZ[] {
  const w = piece.blueprint.size[0] * CELL, d = piece.blueprint.size[2] * CELL, points: XZ[] = [];
  for (let a = inset; a <= w - inset + 1e-9; a += Math.min(step, w - 2 * inset)) for (let b = inset; b <= d - inset + 1e-9; b += Math.min(step, d - 2 * inset)) points.push(local(piece, a, b));
  return points;
}
const centreOf = (piece: GroundPiece): XZ => local(piece, piece.blueprint.size[0] * CELL / 2, piece.blueprint.size[2] * CELL / 2);

function occupiedFor(plan: SettlementPlan): TownGroundInput['occupied'] {
  const { houses, props } = placeSettlementContent(plan.homes, (x, z) => terrainHeight(plan, x, z));
  return [...houses, ...props, ...placeMarketContent(plan.market), ...createCastleContent(plan.castle).buildings];
}

/** Rendered triangles of a blueprint at a detail level, through the same job the worker pool runs. */
const triangleCache = new Map<string, number>();
function triangles(blueprint: VoxelBlueprint, level: 1 | 2 | 4): number {
  const key = `${blueprint.id}:${level}`, known = triangleCache.get(key);
  if (known !== undefined) return known;
  const result = executeVoxelJob({ id: 1, kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision,
    ...(level === 1 ? {} : { lodFactor: level }) } as Parameters<typeof executeVoxelJob>[0]);
  if (result.kind !== 'asset') throw new Error(`Could not mesh ${blueprint.id}`);
  const count = result.chunks.reduce((n, chunk) => n + chunk.mesh.indices.length / 3, 0);
  triangleCache.set(key, count);
  return count;
}

/** The densest disc of full detail (≤35 m) plus the coarse ring to 70 m, as the mount bands crop cover. */
function densest(result: TownGroundPlan): { at: XZ; pieces: number; near: number; ring: number; triangles: number } {
  const centres: { x: number; z: number; near: number; ring: number }[] = [];
  for (const piece of all(result)) {
    const [x, z] = centreOf(piece);
    centres.push({ x, z, near: triangles(piece.blueprint, 1), ring: triangles(piece.blueprint, 2) });
  }
  const buckets = new Map<string, typeof centres>();
  for (const c of centres) { const key = `${Math.floor(c.x / 10)},${Math.floor(c.z / 10)}`; const list = buckets.get(key); if (list) list.push(c); else buckets.set(key, [c]); }
  let best = { at: [0, 0] as XZ, pieces: 0, near: 0, ring: 0, triangles: 0 };
  const { mask } = result;
  for (let z = mask.origin[1]; z <= mask.origin[1] + mask.depth; z += 5) for (let x = mask.origin[0]; x <= mask.origin[0] + mask.width; x += 5) {
    let near = 0, ring = 0, pieces = 0;
    for (let bz = Math.floor((z - 70) / 10); bz <= Math.floor((z + 70) / 10); bz++) for (let bx = Math.floor((x - 70) / 10); bx <= Math.floor((x + 70) / 10); bx++)
      for (const c of buckets.get(`${bx},${bz}`) ?? []) {
        const d = Math.hypot(c.x - x, c.z - z);
        if (d <= 35) { near += c.near; pieces++; } else if (d <= 70) ring += c.ring;
      }
    if (near + ring > best.triangles) best = { at: [x, z], pieces, near, ring, triangles: near + ring };
  }
  return best;
}

/**
 * Every rule of the brief, checked against the world's own samplers rather than the planner's: public ground,
 * lots, the castle, squares, the lake, placements, the region, the founded floor, and the mask under each piece.
 */
function checkPlan(plan: SettlementPlan, input: TownGroundInput, result: TownGroundPlan): void {
  const { mask } = result, region = frameSettlement(plan).region;
  expect(mask.origin).toEqual([region.minX, region.minZ]);
  expect(mask.width).toBe(region.maxX - region.minX); expect(mask.depth).toBe(region.maxZ - region.minZ);
  expect(mask.data.length).toBe(mask.width * mask.depth); expect(mask.rows.length).toBe(mask.data.length);
  const codeAt = (x: number, z: number) => mask.data[Math.floor(x - mask.origin[0]) + Math.floor(z - mask.origin[1]) * mask.width]!;
  const rowAt = (x: number, z: number) => mask.rows[Math.floor(x - mask.origin[0]) + Math.floor(z - mask.origin[1]) * mask.width]!;
  const fieldCodes = new Set<number>([TOWN_USE.wheat, TOWN_USE.barley, TOWN_USE.lavender, TOWN_USE.cabbage, TOWN_USE.beans, TOWN_USE.ploughed]);

  // Violations are gathered and asserted once: a plan has tens of thousands of points to check.
  const faults: string[] = [];
  const fault = (broken: boolean, what: () => string) => { if (broken && faults.length < 40) faults.push(what()); };

  // The mask: planted only where the keep-out allows, rows only on fields, nothing past the public verge.
  const { keep } = townKeepOut(plan, input);
  const castle = plan.castle.bounds, squares = [plan.market.boundary, plan.castle.court.boundary, ...plan.courts.map(c => c.boundary)];
  const lake = plan.lake;
  for (let k = 0; k < mask.data.length; k++) {
    const use = mask.data[k]!;
    fault(!fieldCodes.has(use) && mask.rows[k] !== 0, () => `cell ${k}: rows off a field`);
    if (!use) continue;
    fault(keep[k] !== 0, () => `cell ${k}: planted on keep-out ${keep[k]}`);
    const x = mask.origin[0] + (k % mask.width) + 0.5, z = mask.origin[1] + Math.floor(k / mask.width) + 0.5;
    // Distances are 1-Lipschitz: a centre 1.5 m + half a diagonal clear vouches for the whole cell.
    const sample = samplePublicGround(plan, x, z);
    fault(!!sample && sample.reservedDistance < 1.5 + Math.SQRT1_2 - 1e-6, () => `cell ${x},${z}: ${sample!.reservedDistance.toFixed(2)} m from ${sample!.id}`);
  }

  // Lots and placements' real solid outlines, 1 m out, in 8 m buckets.
  const rects: { piece: Pick<GroundPiece, 'position' | 'yaw'>; a0: number; a1: number; b0: number; b1: number; what: string }[] = [];
  for (const plot of [...plan.reservations, ...plan.homes])
    rects.push({ piece: { position: [0, 0, 0], yaw: 0 }, a0: plot.lot.minX - 1, a1: plot.lot.maxX + 1, b0: plot.lot.minZ - 1, b1: plot.lot.maxZ + 1, what: `lot ${plot.id}` });
  for (const piece of input.occupied) for (const box of piece.blueprint.boxes) if (box.material !== 0)
    rects.push({ piece, a0: box.from[0] * CELL - 1, a1: box.to[0] * CELL + 1, b0: box.from[2] * CELL - 1, b1: box.to[2] * CELL + 1, what: `placement ${piece.blueprint.id}` });
  const buckets = new Map<string, typeof rects>();
  for (const rect of rects) {
    const corners = [local(rect.piece, rect.a0, rect.b0), local(rect.piece, rect.a1, rect.b0), local(rect.piece, rect.a1, rect.b1), local(rect.piece, rect.a0, rect.b1)];
    const xs = corners.map(p => p[0]), zs = corners.map(p => p[1]);
    for (let bx = Math.floor(Math.min(...xs) / 8); bx <= Math.floor(Math.max(...xs) / 8); bx++) for (let bz = Math.floor(Math.min(...zs) / 8); bz <= Math.floor(Math.max(...zs) / 8); bz++) {
      const list = buckets.get(`${bx},${bz}`); if (list) list.push(rect); else buckets.set(`${bx},${bz}`, [rect]);
    }
  }
  const standingOn = (x: number, z: number) => (buckets.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`) ?? []).find(rect => {
    const dx = x - rect.piece.position[0], dz = z - rect.piece.position[2], c = Math.cos(rect.piece.yaw), s = Math.sin(rect.piece.yaw);
    const a = c * dx - s * dz, b = s * dx + c * dz;
    return a > rect.a0 + 1e-6 && a < rect.a1 - 1e-6 && b > rect.b0 + 1e-6 && b < rect.b1 - 1e-6;
  });

  const floor = new Map<string, number>();
  const floorAt = (x: number, z: number) => {
    const key = `${Math.floor(x * 2)},${Math.floor(z * 2)}`;
    let h = floor.get(key);
    if (h === undefined) { h = foundedGroundAt(plan, x, z)[1]; floor.set(key, h); }
    return h;
  };
  const ids = new Set<string>();
  for (const piece of all(result)) {
    fault(ids.has(piece.id), () => `${piece.id}: duplicate id`); ids.add(piece.id);
    const form = formOf(piece);
    fault(piece.blueprint !== townBlueprint(form) || TOWN_FORM_ROLES[form].solid, () => `${piece.id}: not the shared passive blueprint`);
    const points = footprintPoints(piece);
    for (const [x, z] of points) {
      fault(x < region.minX + 1 - 1e-6 || x > region.maxX - 1 + 1e-6 || z < region.minZ + 1 - 1e-6 || z > region.maxZ - 1 + 1e-6, () => `${piece.id}: in the region's outer metre`);
      const on = standingOn(x, z);
      fault(!!on, () => `${piece.id}: on ${on!.what}`);
      fault(x > castle.minX - 1 && x < castle.maxX + 1 && z > castle.minZ - 1 && z < castle.maxZ + 1, () => `${piece.id}: in the castle`);
      fault(squares.some(square => polygonDistance(square, x, z) < 1 - 1e-6), () => `${piece.id}: on a square or court`);
      fault(Math.hypot((x - lake.x) / (lake.radiusX * 1.25), (z - lake.z) / (lake.radiusZ * 1.25)) <= 1, () => `${piece.id}: by the lake`);
      fault(codeAt(x, z) === TOWN_USE.lawn, () => `${piece.id}: over untouched lawn`);
    }
    for (const [x, z] of [points[0]!, points.at(-1)!, centreOf(piece)]) {
      const sample = samplePublicGround(plan, x, z);
      fault(!!sample && sample.reservedDistance < 1.5 - 1e-6, () => `${piece.id}: on a verge`);
    }
    // The mask agrees with what stands on it.
    const [cx, cz] = centreOf(piece), here = codeAt(cx, cz);
    if (TOWN_FORM_ROLES[form].family === 'crop') {
      fault(here !== TOWN_USE[form.slice(5) as 'wheat'], () => `${piece.id}: ${form} on use ${here}`);
      // The drills run along the cell's row direction: local +X is (cos θ, sin θ) with yaw = −θ.
      const angle = townRowAngle(rowAt(cx, cz)), turned = ((-piece.yaw) % Math.PI + Math.PI) % Math.PI;
      fault(Math.abs(angle - turned) > 1e-9, () => `${piece.id}: rows ${angle} under drills ${turned}`);
    } else if (form === 'border-warm' || form === 'border-cool') fault(here !== TOWN_USE.border, () => `${piece.id}: border on use ${here}`);
    else if (form.startsWith('wildflowers-')) fault(here !== TOWN_USE[`flowers-${form.slice(12)}` as 'flowers-gold'], () => `${piece.id}: flowers on use ${here}`);
    else fault(!([TOWN_USE.meadow, TOWN_USE.heath, TOWN_USE.bracken] as number[]).includes(here), () => `${piece.id}: cover on use ${here}`);
    // Exact floor: level forms on one height under their whole footprint; loose cover on the lowest it straddles.
    const heights = points.map(([x, z]) => floorAt(x, z)), low = Math.min(...heights), high = Math.max(...heights);
    if (TOWN_FORM_ROLES[form].level) fault(high !== low || Math.abs(piece.position[1] - (low - 0.01)) > 1e-6 || piece.slope !== undefined, () => `${piece.id}: not level on the floor`);
    else fault(high - low > 0.5 || piece.position[1] > low - 0.03 + 1e-6 || high - piece.position[1] > 0.53 + 1e-6, () => `${piece.id}: cover off the floor`);
  }
  expect(faults).toEqual([]);
}

describe('planTownGround', () => {
  let plan: SettlementPlan, input: TownGroundInput, result: TownGroundPlan;
  beforeAll(() => {
    plan = generateSettlementPlan({ seed: 'willowmere', tier: 'hamlet', firstYear: 2025, year: 2026 });
    input = { occupied: occupiedFor(plan) };
    result = planTownGround(plan, input);
  }, SLOW);

  it('names its uses with lawn as 0 and a look for every one', () => {
    expect(TOWN_USE.lawn).toBe(0);
    expect(new Set(Object.values(TOWN_USE)).size).toBe(Object.keys(TOWN_USE).length);
    for (const name of Object.keys(TOWN_USE) as (keyof typeof TOWN_USE)[]) {
      expect(TOWN_USE_LOOK[name].tint).toMatch(/^#[0-9a-f]{6}$/);
      expect(TOWN_USE_LOOK[name].rows).toBeGreaterThanOrEqual(0); expect(TOWN_USE_LOOK[name].rows).toBeLessThanOrEqual(1);
    }
    expect(TOWN_USE_LOOK.meadow.rows).toBe(0); expect(TOWN_USE_LOOK.wheat.rows).toBeGreaterThan(0);
  });

  it('is deterministic: same plan and placements, same bytes and pieces', () => {
    const again = planTownGround(structuredClone(plan), { occupied: [...input.occupied] });
    expect(Buffer.from(again.mask.data).equals(Buffer.from(result.mask.data))).toBe(true);
    expect(Buffer.from(again.mask.rows).equals(Buffer.from(result.mask.rows))).toBe(true);
    const flat = (r: TownGroundPlan) => all(r).map(p => `${p.id}|${p.blueprint.id}|${p.position.join(',')}|${p.yaw}`);
    expect(flat(again)).toEqual(flat(result));
    expect(again.report).toEqual(result.report);
  }, SLOW);

  it('lays a patchwork, rough ground and planting on the open land', () => {
    const { cells, counts, parcels } = result.report;
    expect(parcels).toBeGreaterThan(3);
    expect((cells.wheat ?? 0) + (cells.barley ?? 0) + (cells.lavender ?? 0) + (cells.cabbage ?? 0) + (cells.beans ?? 0)).toBeGreaterThan(500);
    expect(cells.meadow ?? 0).toBeGreaterThan(200);
    for (const family of ['crop', 'cover', 'flowers'] as const)
      expect(TOWN_FORMS.filter(form => TOWN_FORM_ROLES[form].family === family).reduce((n, form) => n + (counts[form] ?? 0), 0)).toBeGreaterThan(0);
    expect(Object.values(counts).reduce((n, c) => n + c, 0)).toBe(all(result).length);
  });

  it('plants nothing on paving, verges, lots, the castle, squares, the lake or placements, all on the exact floor', () => {
    checkPlan(plan, input, result);
  }, SLOW);

  it('takes the floor the ground workers sampled and refuses one that does not fit', () => {
    const floor = Float32Array.from(sampleFoundedTerrain(plan).heights as ArrayLike<number>), installed = plan.version === 2 && plan.landform.version === 1;
    expect(primeTownFloor(plan, floor)).toBe(installed);
    expect(primeTownFloor(plan, floor.subarray(1))).toBe(false);
    expect(primeTownFloor(plan, null)).toBe(false);
    expect(planTownGround(plan, input).mask.data).toEqual(result.mask.data);
  }, SLOW);
  it('keeps clear of an existing dressing plan by half a metre', () => {
    const crop = all(result).find(p => formOf(p) === 'crop-wheat' || formOf(p) === 'crop-barley' || formOf(p) === 'crop-lavender')!;
    const blocker: GroundPiece = { id: 'existing', blueprint: townBlueprint('tall-grass'), position: [Math.floor(crop.position[0]) - 1, 0, Math.floor(crop.position[2]) - 1], yaw: 0 };
    const existing = { pieces: new Map([['x', [blocker]]]), blockers: [], collisionPieces: [], seatAnchors: [], report: { counts: {}, homesWithVignette: 0, omissions: [] } };
    const near = planTownGround(plan, { ...input, existing });
    for (const piece of all(near)) for (const [x, z] of footprintPoints(piece))
      expect(x > blocker.position[0] - 0.5 && x < blocker.position[0] + 2.5 && z > blocker.position[2] - 0.5 && z < blocker.position[2] + 2.5).toBe(false);
    expect(all(near).some(p => p.id === crop.id)).toBe(false);
  }, SLOW);

  it('measures every form’s triangles at each detail level', () => {
    const table = Object.fromEntries(TOWN_FORMS.map(form => [form, [1, 2, 4].map(level => triangles(townBlueprint(form), level as 1 | 2 | 4))]));
    for (const [form, [full, half, quarter]] of Object.entries(table)) {
      expect(full, form).toBeGreaterThan(0);
      expect(half!, form).toBeLessThanOrEqual(full!); expect(quarter!, form).toBeLessThanOrEqual(half!);
    }
    console.log('town form triangles [full, half, quarter]', JSON.stringify(table));
  }, SLOW);
});

describe.runIf(process.env.GRAND_FOUNDED_SCENE)('planTownGround on the founded scene', () => {
  it('plans the real town within the rules and reports it', () => {
    const scene = JSON.parse(readFileSync(process.env.GRAND_FOUNDED_SCENE!, 'utf8')) as {
      kingdomId: string; plan: SettlementPlan;
      assets: { assetHash: string; blueprint: VoxelBlueprint }[];
      placements: { assetHash: string; position: [number, number, number]; rotation: 0 | 1 | 2 | 3 }[];
    };
    const plan = scene.plan, assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
    const occupied: TownGroundInput['occupied'][number][] = scene.placements.map(p => ({ blueprint: assets.get(p.assetHash)!, position: p.position, yaw: p.rotation * Math.PI / 2 }));
    // The town walls the client raises round the town are placements too.
    const walls = planTownWalls(plan, { seedKey: `${scene.kingdomId}:walls`, style: 'tide', region: frameSettlement(plan).region,
      ground: (x, z) => terrainHeight(plan, x, z), water: settlementWater(plan) });
    for (const piece of walls.pieces) occupied.push({ blueprint: piece.blueprint, position: piece.position, yaw: piece.rotation * Math.PI / 2 });
    const input = { occupied };
    let started = performance.now();
    const result = planTownGround(plan, input);
    const cold = performance.now() - started;
    started = performance.now();
    planTownGround(plan, input);
    const warm = performance.now() - started;
    checkPlan(plan, input, result);
    const forms = Object.fromEntries(TOWN_FORMS.map(form => [form, { full: triangles(townBlueprint(form), 1), half: triangles(townBlueprint(form), 2), quarter: triangles(townBlueprint(form), 4) }]));
    const total = Object.values(result.report.counts).reduce((n, c) => n + c, 0);
    const triangleTotal = all(result).reduce((n, piece) => n + triangles(piece.blueprint, 1), 0);
    const report = { meaning: 'Town land use and walk-through planting planned from the founded scene; CPU only, no GPU evidence',
      millis: { cold: Math.round(cold), warm: Math.round(warm) }, region: frameSettlement(plan).region, mask: { width: result.mask.width, depth: result.mask.depth },
      ...result.report, pieces: total, fullDetailTriangles: triangleTotal, triangles: forms, densest: densest(result), walls: walls.pieces.length };
    console.log(JSON.stringify(report));
    if (process.env.GRAND_TOWN_REPORT) writeFileSync(process.env.GRAND_TOWN_REPORT, `${JSON.stringify(report, null, 1)}\n`);
    expect(total).toBeGreaterThan(1000);
  }, SLOW);
});
