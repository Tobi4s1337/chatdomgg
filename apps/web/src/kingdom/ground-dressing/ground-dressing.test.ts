import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial } from '@chatdom/render';
import { executeVoxelJob, type VoxelJobInput, type VoxelWorkerPool } from '@chatdom/voxel';
import { currentFootprint, homeFrame, samplePublicGround, terrainHeight, transformCardinalPoint, type KingdomLand, type SettlementHome, type SettlementPlan } from '@chatdom/world';
import { createCastleContent } from '../castle-content';
import { placeMarketContent, placeSettlementContent } from '../settlement-content';
import { sampleTerrainTriangles } from '../terrain-worker';
import { simulatedLand, simulatedWaterKeepOut } from './fixture';
import { DRESSING_VERTEX_ANCHOR, dressingVertexShader } from './material';
import { createGroundDressing, pieceMatrix } from './mount';
import { arrivalHome, footprintCorners, occupiedCorners, patchArea, pieceRole, planGroundDressing, polygonDistance, type GroundBlocker, type GroundDressingInput, type GroundDressingPlan, type GroundPiece } from './plan';

const all = (plan: GroundDressingPlan) => [...plan.pieces.values()].flat();
const CELL = 0.125;

/** The rendered metre triangles over a cached corner grid, as the host's horizon sampler grounds props. */
function groundFor(plan: SettlementPlan) {
  const corners = new Map<number, number>();
  const corner = (x: number, z: number) => {
    const key = (x + 4096) * 8192 + z + 4096;
    let h = corners.get(key);
    if (h === undefined) { h = terrainHeight(plan, x, z); corners.set(key, h); }
    return h;
  };
  return (x: number, z: number) => sampleTerrainTriangles(corner, x, z);
}

function inputFor(land: KingdomLand, extra: Partial<GroundDressingInput> = {}): GroundDressingInput {
  const plan = land.plan, ground = groundFor(plan);
  const { houses, props } = placeSettlementContent(plan.homes, (x, z) => terrainHeight(plan, x, z));
  const occupied = [...houses, ...props, ...placeMarketContent(plan.market), ...createCastleContent(plan.castle).buildings];
  return { land, seed: 'willowmere', tier: 'town', ground, waterKeepOut: simulatedWaterKeepOut(land), occupied, keepClear: [{ x: 0, z: 8, radius: 7 }], ...extra };
}

/** Every 0.25 m point of a piece's box, in world metres. */
function footprintPoints(piece: GroundPiece, step = 0.25): [number, number][] {
  const c = Math.cos(piece.yaw), s = Math.sin(piece.yaw), w = piece.blueprint.size[0] * CELL, d = piece.blueprint.size[2] * CELL, points: [number, number][] = [];
  for (let a = CELL; a <= w - CELL + 1e-9; a += step) for (let b = CELL; b <= d - CELL + 1e-9; b += step)
    points.push([piece.position[0] + c * a + s * b, piece.position[2] - s * a + c * b]);
  return points;
}
const centreOf = (piece: GroundPiece): [number, number] => {
  const [a, b] = [piece.blueprint.size[0] * CELL / 2, piece.blueprint.size[2] * CELL / 2], c = Math.cos(piece.yaw), s = Math.sin(piece.yaw);
  return [piece.position[0] + c * a + s * b, piece.position[2] - s * a + c * b];
};

/** A coarse bucket index, so each check visits only what stands near one piece. */
function bucketed<T>(items: readonly T[], box: (item: T) => { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const buckets = new Map<string, T[]>(), size = 8;
  for (const item of items) {
    const b = box(item);
    for (let x = Math.floor(b.minX / size); x <= Math.floor(b.maxX / size); x++) for (let z = Math.floor(b.minZ / size); z <= Math.floor(b.maxZ / size); z++) {
      const list = buckets.get(`${x},${z}`); if (list) list.push(item); else buckets.set(`${x},${z}`, [item]);
    }
  }
  return (x: number, z: number, reach: number): T[] => {
    const found = new Set<T>();
    for (let bx = Math.floor((x - reach) / size); bx <= Math.floor((x + reach) / size); bx++) for (let bz = Math.floor((z - reach) / size); bz <= Math.floor((z + reach) / size); bz++)
      for (const item of buckets.get(`${bx},${bz}`) ?? []) found.add(item);
    return [...found];
  };
}
const boxOf = (corners: readonly (readonly [number, number])[], margin = 0) => ({
  minX: Math.min(...corners.map(c => c[0])) - margin, maxX: Math.max(...corners.map(c => c[0])) + margin,
  minZ: Math.min(...corners.map(c => c[1])) - margin, maxZ: Math.max(...corners.map(c => c[1])) + margin,
});

let land: KingdomLand, input: GroundDressingInput, plan: GroundDressingPlan;
// A keep-out and keep-clear placed over open ground the meadow would otherwise dress.
const keepOutSquare = [[-120, 120], [-100, 120], [-100, 140], [-120, 140]] as const;
beforeAll(() => {
  land = simulatedLand({ seed: 'willowmere', tier: 'town' });
  input = inputFor(land, { keepOut: [keepOutSquare.map(p => [...p] as [number, number])] });
  plan = planGroundDressing(input);
}, 120_000);

describe('planGroundDressing', () => {
  it('is deterministic, with unique semantic IDs', () => {
    const again = planGroundDressing(inputFor(land, { keepOut: input.keepOut! }));
    expect(JSON.stringify([...again.pieces])).toBe(JSON.stringify([...plan.pieces]));
    const ids = all(plan).map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter(id => !/^(meadow|lot:[^:]+|forecourt:\d+:-?1|doorstep:\d+:-?1|drift:-?\d+:-?\d+|market:stall:\d+:garden|garden:\d+:(left|right|back)|field:-?\d+:-?\d+)(:[^:]+)*$/.test(id))).toEqual([]);
    expect(all(plan).length).toBeGreaterThan(4000);
    expect(all(plan).length).toBeLessThanOrEqual(40_000);
  }, 120_000);

  it('keeps every clearance of R3', () => {
    const p = land.plan;
    const homes = bucketed(p.homes.map(home => ({ home, rect: currentFootprint(home), frame: homeFrame(home) })), h => h.rect);
    // Real occupied footprints, each owned by the home whose lot holds it.
    const occupied = bucketed(input.occupied.map(o => {
      const box = boxOf(occupiedCorners(o)), cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
      return { id: o.blueprint.id, box, home: p.homes.find(h => cx > h.lot.minX && cx < h.lot.maxX && cz > h.lot.minZ && cz < h.lot.maxZ) };
    }), o => o.box);
    const lots = bucketed(p.homes.map(home => ({ home, lot: home.lot })), l => l.lot);
    const polygons = [p.market.boundary, ...p.courts.map(c => c.boundary), p.castle.court.boundary, keepOutSquare];
    const castle = p.castle.bounds, violations: string[] = [];
    for (const piece of all(plan)) {
      const role = pieceRole(piece.blueprint), height = piece.blueprint.size[1] * CELL, [cx, cz] = centreOf(piece);
      const near = homes(cx, cz, 14), radius = Math.hypot(piece.blueprint.size[0], piece.blueprint.size[2]) * CELL / 2;
      // A home's back fence and garden vignette belong to that home's assembly.
      const fence = /^lot:.+:back-fence$/.test(piece.id), owner = fence ? p.homes.find(h => piece.id === `lot:${h.id}:back-fence`)
        : piece.id.startsWith('garden:') ? p.homes.find(h => h.slot === Number(piece.id.split(':')[1])) : undefined;
      // Paving and verge distances are true distances: one sample at the centre vouches for the whole box when it
      // clears the radius; otherwise every 0.25 m point is sampled.
      const centre = samplePublicGround(p, cx, cz);
      const vouched = (centre?.pavingDistance ?? Infinity) - 0.25 > radius && (!role.solid || (centre?.reservedDistance ?? Infinity) - 0.6 > radius);
      for (const [x, z] of footprintPoints(piece)) {
        if (!vouched) {
          const sample = samplePublicGround(p, x, z);
          if ((sample?.pavingDistance ?? Infinity) <= 0.25) violations.push(`${piece.id} on paving`);
          if (role.solid && (sample?.reservedDistance ?? Infinity) < 0.6) violations.push(`${piece.id} in a verge`);
        }
        for (const { rect, frame } of near) {
          if (x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ) violations.push(`${piece.id} on a home`);
          const dx = x - frame.front[0], dz = z - frame.front[2];
          const out = dx * frame.outward[0] + dz * frame.outward[2], side = dx * frame.right[0] + dz * frame.right[2];
          if (out > 0 && out < 3.5 && Math.abs(side) < 4) {
            if (Math.abs(side + 0.25) < 1.75) violations.push(`${piece.id} in an entrance band`);
            if (height > 0.6) violations.push(`${piece.id} tall in a forecourt`);
          }
        }
        if (x > castle.minX && x < castle.maxX && z > castle.minZ && z < castle.maxZ) violations.push(`${piece.id} in the castle`);
        if (polygons.some(polygon => polygonDistance(polygon, x, z) <= 0)) violations.push(`${piece.id} in a square or keep-out`);
        if (Math.hypot(x, z - 8) <= 7) violations.push(`${piece.id} in the Forge plaza`);
        if (input.waterKeepOut(x, z, 0.5)) violations.push(`${piece.id} in water`);
      }
      // Occupied placements: never overlapped; solids keep 1.5 m, except a garden assembly against its own home
      // (0.15 m, the back fence 0.5 m), and the fence keeps 0.5 m from its neighbours.
      const box = boxOf(footprintCorners(piece.blueprint, piece.position, piece.yaw, CELL));
      const margin = (home: unknown) => !role.solid ? 0.2 : owner && home === owner ? (fence ? 0.45 : 0.1) : fence ? 0.45 : 1.45;
      for (const { id, box: ob, home } of occupied(cx, cz, 5)) {
        const m = margin(home);
        if (box.minX < ob.maxX + m && box.maxX > ob.minX - m && box.minZ < ob.maxZ + m && box.maxZ > ob.minZ - m) violations.push(`${piece.id} on ${id}`);
      }
      // Solids outside the lots keep 1.5 m from every other home's whole lot, so no neighbour's growth unseats them.
      if (role.solid && piece.lotSlot === undefined) for (const { home, lot } of lots(cx, cz, 6)) {
        if (home === owner) { if (box.minX < lot.maxX && box.maxX > lot.minX && box.minZ < lot.maxZ && box.maxZ > lot.minZ) violations.push(`${piece.id} in its lot`); continue; }
        if (box.minX < lot.maxX + 1.45 && box.maxX > lot.minX - 1.45 && box.minZ < lot.maxZ + 1.45 && box.maxZ > lot.minZ - 1.45) violations.push(`${piece.id} by lot ${home.id}`);
      }
    }
    expect([...new Set(violations)]).toEqual([]);
  }, 120_000);

  it('lists only solids as blockers, each with an exact cardinal turn', () => {
    expect(plan.blockers.length).toBeGreaterThan(0);
    expect(plan.collisionPieces).toEqual(plan.blockers);
    for (const blocker of plan.blockers) {
      expect(pieceRole(blocker.blueprint).solid).toBe(true);
      expect(blocker.yaw).toBe(blocker.turn * Math.PI / 2);
      expect(blocker.slope).toBeUndefined();
    }
    const solids = all(plan).filter(p => pieceRole(p.blueprint).solid).map(p => p.id).sort();
    expect(plan.blockers.map(b => b.id).sort()).toEqual(solids);
  });

  it('lays passive pieces on their slope and sets solids level', () => {
    for (const piece of all(plan)) {
      const role = pieceRole(piece.blueprint), [gx, gz] = piece.slope ?? [0, 0];
      const heights = footprintPoints(piece, 0.5).map(([x, z]) => {
        const plane = piece.position[1] + gx * (x - piece.position[0]) + gz * (z - piece.position[2]);
        return { plane, ground: input.ground(x, z) };
      });
      if (!role.solid) {
        expect(Math.hypot(gx, gz)).toBeLessThanOrEqual(Math.tan(35 * Math.PI / 180) + 1e-9);
        // Never floating, never more than a few cells buried; flush stones keep a worn lip above the turf.
        for (const { plane, ground } of heights) { expect(plane - ground, piece.id).toBeLessThan(0.06); if (role.form !== 'stepping-stones') expect(ground - plane, piece.id).toBeLessThan(0.3); }
        // Flush stones are bedded deep, so they may lie lower than cover, but their worn lip always shows.
        if (role.form === 'stepping-stones') for (const { plane, ground } of heights) expect(plane + piece.blueprint.size[1] * CELL - ground, piece.id).toBeGreaterThan(0);
      } else {
        expect(piece.slope).toBeUndefined();
        const low = Math.min(...heights.map(h => h.ground)), high = Math.max(...heights.map(h => h.ground));
        expect(high - low).toBeLessThanOrEqual(0.13);
        expect(piece.position[1]).toBeLessThanOrEqual(low + 1e-6);
      }
    }
  });

  it('thins with distance and gathers into drifts with calm meadow between', () => {
    const p = land.plan, cover = all(plan).filter(piece => pieceRole(piece.blueprint).cover);
    const lots = bucketed(p.reservations.map(r => r.lot), lot => lot);
    const lotDistance = (x: number, z: number) => Math.min(Infinity, ...lots(x, z, 40).map(lot => {
      const dx = Math.max(lot.minX - x, 0, x - lot.maxX), dz = Math.max(lot.minZ - z, 0, z - lot.maxZ); return Math.hypot(dx, dz);
    }));
    const edge = (x: number, z: number) => Math.min(Math.max(0, samplePublicGround(p, x, z)?.pavingDistance ?? Infinity), lotDistance(x, z));
    // Eligible open ground per band, on a 4 m lattice off paving, lots, castle and water.
    const area = { near: 0, far: 0 }, count = { near: 0, far: 0 };
    const eligible: [number, number][] = [];
    for (let x = p.bounds.minX + 4; x < p.bounds.maxX - 4; x += 4) for (let z = p.bounds.minZ + 4; z < p.bounds.maxZ - 4; z += 4) {
      const sample = samplePublicGround(p, x, z);
      if ((sample?.pavingDistance ?? Infinity) < 1 || lotDistance(x, z) <= 0 || input.waterKeepOut(x, z, 1)) continue;
      const castle = p.castle.bounds;
      if (x > castle.minX - 2 && x < castle.maxX + 2 && z > castle.minZ - 2 && z < castle.maxZ + 2) continue;
      const d = edge(x, z);
      if (d < 6) area.near += 16; else if (d >= 30 && d < 40) area.far += 16;
      if (d > 12) eligible.push([x, z]);
    }
    for (const piece of cover) {
      const [x, z] = centreOf(piece), d = edge(x, z);
      if (piece.lotSlot !== undefined) continue;
      if (d < 6) count.near++; else if (d >= 30 && d < 40) count.far++;
    }
    expect(count.near / area.near).toBeGreaterThanOrEqual(3 * (count.far / area.far));
    expect(patchArea(3)).toBe(4); expect(patchArea(30)).toBe(16); expect(patchArea(45)).toBe(40);
    // At least 40% of open meadow keeps no cover within 2 m.
    const centres = bucketed(cover.map(centreOf), ([x, z]) => ({ minX: x, maxX: x, minZ: z, maxZ: z }));
    const open = eligible.filter(([x, z]) => !centres(x, z, 2).some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 2)).length;
    expect(open / eligible.length).toBeGreaterThanOrEqual(0.4);
    // Drifts: 5–15 patches of one flower colour, 3–6 m across (plus the patch itself). A doorstep's planted
    // border is a close row of at least two.
    const drifts = new Map<string, GroundPiece[]>();
    for (const piece of cover.filter(piece => pieceRole(piece.blueprint).form.startsWith('wildflowers-'))) {
      const key = piece.id.split(':').slice(0, -1).join(':'), list = drifts.get(key);
      if (list) list.push(piece); else drifts.set(key, [piece]);
    }
    expect(drifts.size).toBeGreaterThan(40);
    for (const [key, patches] of drifts) {
      const border = key.endsWith(':border');
      expect(patches.length, key).toBeGreaterThanOrEqual(border ? 2 : 5); expect(patches.length, key).toBeLessThanOrEqual(15);
      expect(new Set(patches.map(p => p.blueprint.id)).size, key).toBe(1);
      const cs = patches.map(centreOf), span = Math.max(...cs.flatMap(a => cs.map(b => Math.hypot(a[0] - b[0], a[1] - b[1]))));
      expect(span, key).toBeLessThanOrEqual(6.5);
    }
    // Forecourt drifts lead to doors in the older quarters too, not only out in the meadow.
    expect([...drifts.keys()].filter(key => key.startsWith('forecourt:')).length).toBeGreaterThan(20);
  });

  it('tends doorsteps: stones up the gap, a bed beside them, flowers along them, and the arrival home always', () => {
    const doorsteps = new Map<string, GroundPiece[]>();
    for (const piece of all(plan).filter(p => p.id.startsWith('doorstep:'))) {
      const key = piece.id.split(':').slice(0, 3).join(':'), list = doorsteps.get(key);
      if (list) list.push(piece); else doorsteps.set(key, [piece]);
    }
    expect(doorsteps.size).toBeGreaterThanOrEqual(8);
    const arrival = arrivalHome(land.plan), arrivalFrame = homeFrame(arrival);
    const touchesArrival = [...doorsteps.keys()].filter(key => {
      const [, slot, side] = key.split(':').map(Number);
      if (slot === arrival.slot) return true;
      const home = land.plan.homes.find(h => h.slot === slot)!, f = homeFrame(home);
      // The strip toward the arrival home from its neighbour.
      return Math.abs((arrivalFrame.front[0] - f.front[0]) * f.right[0] * side! + (arrivalFrame.front[2] - f.front[2]) * f.right[2] * side! - 9.5) < 2.5;
    });
    expect(touchesArrival.length).toBeGreaterThanOrEqual(1);
    const cover = all(plan).filter(p => pieceRole(p.blueprint).cover && pieceRole(p.blueprint).form !== 'seedling-bed');
    const covers = bucketed(cover, p => boxOf(footprintCorners(p.blueprint, p.position, p.yaw)));
    for (const [key, pieces] of doorsteps) {
      const forms = pieces.map(p => pieceRole(p.blueprint).form);
      expect(forms.filter(f => f === 'stepping-stones'), key).toHaveLength(1);
      expect(forms.filter(f => f === 'seedling-bed'), key).toHaveLength(1);
      const stones = pieces.find(p => pieceRole(p.blueprint).form === 'stepping-stones')!, bed = pieces.find(p => pieceRole(p.blueprint).form === 'seedling-bed')!;
      // Neither is a blocker: both lie flush and are walked past.
      expect(plan.blockers.some(b => b.id === stones.id || b.id === bed.id)).toBe(false);
      const stoneBox = boxOf(footprintCorners(stones.blueprint, stones.position, stones.yaw, CELL)), bedBox = boxOf(footprintCorners(bed.blueprint, bed.position, bed.yaw, CELL));
      expect(stoneBox.minX < bedBox.maxX && stoneBox.maxX > bedBox.minX && stoneBox.minZ < bedBox.maxZ && stoneBox.maxZ > bedBox.minZ, key).toBe(false);
      // No tuft or bloom grows through the bed or the stones, and the turf beside the stones is short clover.
      for (const target of [stoneBox, bedBox]) {
        const [x, z] = [(target.minX + target.maxX) / 2, (target.minZ + target.maxZ) / 2];
        for (const patch of covers(x, z, 4)) {
          const inner = boxOf(footprintCorners(patch.blueprint, patch.position, patch.yaw, 0.25));
          expect(inner.minX < target.maxX && inner.maxX > target.minX && inner.minZ < target.maxZ && inner.maxZ > target.minZ, `${patch.id} through ${key}`).toBe(false);
        }
      }
      for (const patch of covers((stoneBox.minX + stoneBox.maxX) / 2, (stoneBox.minZ + stoneBox.maxZ) / 2, 4)) {
        const [x, z] = centreOf(patch), dx = Math.max(stoneBox.minX - x, 0, x - stoneBox.maxX), dz = Math.max(stoneBox.minZ - z, 0, z - stoneBox.maxZ);
        if (!patch.id.startsWith('doorstep:') && Math.hypot(dx, dz) < 0.9) expect(pieceRole(patch.blueprint).form, patch.id).not.toBe('meadow-tufts');
      }
    }
    // At least one tended doorstep at the arrival home carries its neighbour's flowers along the stones.
    expect(touchesArrival.some(key => doorsteps.get(key)!.some(p => pieceRole(p.blueprint).form.startsWith('wildflowers-')))).toBe(true);
  });

  /** Depth behind the facade and offset along the right of a home's frame. */
  const frameOf = (home: SettlementHome) => {
    const f = homeFrame(home);
    return { depth: ([x, z]: readonly [number, number]) => -((x - f.front[0]) * f.outward[0] + (z - f.front[2]) * f.outward[2]),
      side: ([x, z]: readonly [number, number]) => (x - f.front[0]) * f.right[0] + (z - f.front[2]) * f.right[2] };
  };
  /** The real rear of what a home has built: its lot's occupied placements, by their solid boxes. */
  const builtRear = (home: SettlementHome) => Math.max(...input.occupied.flatMap(o => {
    const corners = occupiedCorners(o), b = boxOf(corners), cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    return cx > home.lot.minX && cx < home.lot.maxX && cz > home.lot.minZ && cz < home.lot.maxZ ? corners.map(frameOf(home).depth) : [];
  }));

  it('stands each back fence behind its open depth and clear of what is really built, across its lot', () => {
    const fences = new Map(all(plan).filter(piece => piece.id.endsWith(':back-fence')).map(piece => [piece.id, piece as GroundBlocker]));
    for (const home of land.plan.homes) {
      const id = `lot:${home.id}:back-fence`, fence = fences.get(id), at = Math.max(home.allowedDepth, builtRear(home) + 0.5);
      if (!fence) { expect(plan.report.omissions.some(line => line.startsWith(`${id}:`)), id).toBe(true); continue; }
      const corners = footprintCorners(fence.blueprint, fence.position, fence.yaw), frame = frameOf(home);
      // Its house-side face stands exactly there, in the home's own frame, spanning the lot's 8 m.
      expect(Math.min(...corners.map(frame.depth)), id).toBeCloseTo(at, 6);
      expect(Math.max(...corners.map(frame.depth)), id).toBeLessThanOrEqual(home.lot.depth + 1e-6);
      expect([Math.min(...corners.map(frame.side)), Math.max(...corners.map(frame.side))]).toEqual([expect.closeTo(-4, 6), expect.closeTo(4, 6)]);
      expect([fence.turn, fence.yaw, fence.lotSlot]).toEqual([home.rotation, home.rotation * Math.PI / 2, home.slot]);
      expect(plan.blockers).toContain(fence); expect(plan.collisionPieces).toContain(fence);
    }
    expect(fences.size).toBeGreaterThan(land.plan.homes.length * 0.9);
  });

  it('changes only the grown lot when a home grows deeper, moving its back fence, and omits a fence a full home leaves no room for', () => {
    const home = land.plan.homes.find(h => h.allowedDepth <= 10 && builtRear(h) + 0.5 <= h.allowedDepth && all(plan).some(p => p.lotSlot === h.slot))!;
    const full = land.plan.homes.find(h => h !== home && h.allowedDepth < 16 && all(plan).some(p => p.id === `lot:${h.id}:back-fence`))!;
    const grownTo = (h: SettlementHome) => h === home ? { ...h, allowedDepth: h.allowedDepth + 4 } : h === full ? { ...h, tier: 'hall' as const, allowedDepth: 16 } : h;
    const grown: KingdomLand = { ...land, plan: { ...land.plan, homes: land.plan.homes.map(grownTo) } };
    const after = planGroundDressing({ ...input, land: grown });
    const slots = new Set([home.slot, full.slot]);
    const outside = (p: GroundDressingPlan) => JSON.stringify(all(p).filter(piece => !slots.has(piece.lotSlot!)).sort((a, b) => (a.id < b.id ? -1 : 1)));
    expect(outside(after)).toBe(outside(plan));
    const inside = (p: GroundDressingPlan) => all(p).filter(piece => piece.lotSlot === home.slot).map(piece => JSON.stringify(piece));
    expect(inside(after)).not.toEqual(inside(plan));
    const rect = currentFootprint(grownTo(home));
    for (const piece of all(after).filter(piece => piece.lotSlot === home.slot))
      for (const [x, z] of footprintPoints(piece)) expect(x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ).toBe(false);
    // The fence follows the growth by exactly its 4 m, in the home's own frame.
    const fenceDepth = (p: GroundDressingPlan) => {
      const fence = all(p).find(piece => piece.id === `lot:${home.id}:back-fence`)!;
      return Math.min(...footprintCorners(fence.blueprint, fence.position, fence.yaw).map(frameOf(home).depth));
    };
    expect(fenceDepth(after) - fenceDepth(plan)).toBeCloseTo(4, 6);
    expect(all(after).some(piece => piece.id === `lot:${full.id}:back-fence`)).toBe(false);
    expect(after.report.omissions).toContain(`lot:${full.id}:back-fence: the home fills its lot, leaving no rear strip that holds the fence 0.5 m clear`);
  }, 120_000);

  it('lays garden vignettes against open lot sides and backs, facing away from their home, fuller in Old Row', () => {
    const p = land.plan, pieces = all(plan).filter(piece => piece.id.startsWith('garden:')) as GroundBlocker[];
    const slots = new Set(pieces.map(piece => Number(piece.id.split(':')[1])));
    expect(plan.report.homesWithVignette).toBe(slots.size);
    expect(slots.size).toBeGreaterThanOrEqual(30);
    for (const piece of pieces) {
      const home = p.homes.find(h => h.slot === Number(piece.id.split(':')[1]))!, frame = frameOf(home), [cx, cz] = centreOf(piece);
      expect(pieceRole(piece.blueprint).solid).toBe(true);
      expect(plan.blockers).toContain(piece);
      expect([piece.yaw, piece.lotSlot]).toEqual([piece.turn * Math.PI / 2, undefined]);
      // It faces away from its home: local +Z points out of the lot side or back it stands against.
      const [fx, , fz] = transformCardinalPoint([0, 0, 0], piece.turn, [0, 0, 1]), site = piece.id.split(':')[2];
      const moved = (axis: (p: readonly [number, number]) => number) => axis([home.position[0] + fx, home.position[2] + fz]) - axis([home.position[0], home.position[2]]);
      expect(site === 'back' ? moved(frame.depth) : (site === 'right' ? 1 : -1) * moved(frame.side), piece.id).toBeCloseTo(1, 6);
      if (site === 'back') expect(frame.depth([cx, cz]), piece.id).toBeGreaterThan(home.lot.depth);
      else expect(Math.abs(frame.side([cx, cz])), piece.id).toBeGreaterThan(home.lot.frontage / 2);
    }
    const forms = new Set(pieces.map(piece => pieceRole(piece.blueprint).form));
    for (const form of ['woodpile', 'barrels', 'crates', 'garden-bed']) expect(forms.has(form), form).toBe(true);
    const years = p.homes.map(h => h.quarterYear), share = (year: number) => {
      const homes = p.homes.filter(h => h.quarterYear === year);
      return homes.filter(h => slots.has(h.slot)).length / homes.length;
    };
    expect(share(Math.min(...years))).toBeGreaterThan(share(Math.max(...years)));
  });

  it('runs field walls and rail fences along one axis, lengths overlapping, two or more to a run', () => {
    const runs = new Map<string, GroundBlocker[]>();
    for (const piece of all(plan).filter(piece => piece.id.startsWith('field:')) as GroundBlocker[]) {
      const key = piece.id.split(':').slice(0, 3).join(':'), list = runs.get(key);
      if (list) list.push(piece); else runs.set(key, [piece]);
    }
    expect(runs.size).toBeGreaterThanOrEqual(6);
    const forms = new Set<string>();
    for (const [key, run] of runs) {
      run.sort((a, b) => Number(a.id.split(':')[3]) - Number(b.id.split(':')[3]));
      expect(run.length, key).toBeGreaterThanOrEqual(2);
      expect(new Set(run.map(piece => piece.blueprint.id)).size, key).toBe(1);
      expect(new Set(run.map(piece => piece.turn)).size, key).toBe(1);
      forms.add(pieceRole(run[0]!.blueprint).form);
      const [ux, , uz] = transformCardinalPoint([0, 0, 0], run[0]!.turn, [1, 0, 0]);
      for (let i = 1; i < run.length; i++) {
        const [ax, az] = centreOf(run[i - 1]!), [bx, bz] = centreOf(run[i]!), along = (bx - ax) * ux + (bz - az) * uz;
        expect(Math.abs((bx - ax) * uz - (bz - az) * ux), key).toBeLessThan(1e-6);
        expect([3.75, 5.15].some(pitch => Math.abs(along - pitch) < 1e-6), `${key}: ${along}`).toBe(true);
      }
    }
    expect(forms).toEqual(new Set(['field-wall', 'rail-fence']));
  });
});

describe('vertex anchor', () => {
  it('extends the clay shader at its one instancing anchor and fails loudly without it', () => {
    const clay = createVoxelMaterial(MATERIALS, 'build');
    expect(clay.material.vertexShader.split(DRESSING_VERTEX_ANCHOR)).toHaveLength(2);
    const derived = dressingVertexShader(clay.material.vertexShader);
    expect(derived).toContain('in vec4 aBand;');
    expect(derived).not.toContain('vLodFade=aLodFade;');
    expect(() => dressingVertexShader(clay.material.vertexShader.replace(DRESSING_VERTEX_ANCHOR, 'local=instanceMatrix*local;'))).toThrow(/anchor/);
    clay.dispose();
  });
});

describe('createGroundDressing', () => {
  const pool = { submit: vi.fn(async (job: VoxelJobInput) => executeVoxelJob({ ...job, id: 1 } as Parameters<typeof executeVoxelJob>[0])), dispose: vi.fn() };
  async function mount() {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.15, 2200);
    const clay = createVoxelMaterial(MATERIALS, 'build'), releases: (() => void)[] = [];
    const registerShadow = vi.fn((mesh: THREE.Mesh) => { void mesh; const release = vi.fn(); releases.push(release); return release; });
    const handle = createGroundDressing({ ...input, plan, scene, camera, pool: pool as unknown as VoxelWorkerPool, clay, registerShadow, signal: new AbortController().signal });
    await handle.ready;
    // Stand in the arrival street, looking along it.
    const view = handle.views().street;
    camera.position.set(...view.eye); camera.lookAt(...view.target); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    handle.update({ time: 0, walkers: [] });
    const meshes = scene.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    return { scene, camera, clay, registerShadow, releases, handle, meshes };
  }

  it('installs only the plan’s own transforms and stays within the draw budget', async () => {
    const { handle, meshes, clay } = await mount();
    const transforms = new Set<string>();
    // Compared as the float32 the instance buffers hold, so rounding never splits one transform in two.
    const key = (array: ArrayLike<number>, at: number) => Array.from({ length: 16 }, (_, i) => Math.fround(array[at + i]!).toFixed(4)).join(',');
    for (const piece of all(plan)) for (const level of [1, 2, 4] as const) { const m = pieceMatrix(piece, level).elements; transforms.add(key(m, 0)); }
    let installed = 0;
    for (const mesh of meshes) for (let i = 0; i < mesh.count; i++) { expect(transforms.has(key(mesh.instanceMatrix.array, i * 16))).toBe(true); installed++; }
    expect(installed).toBeGreaterThan(50);
    const stats = handle.stats();
    expect(stats.drawCalls).toBeGreaterThan(0); expect(stats.drawCalls).toBeLessThanOrEqual(48);
    expect(stats.instances).toBe(installed);
    expect(handle.blockers).toBe(plan.blockers); expect(handle.collisionPieces).toBe(plan.collisionPieces);
    handle.dispose(); clay.dispose();
  }, 120_000);

  it('rewrites nothing while the camera is still, and only the moved levels after', async () => {
    const { handle, meshes, camera, clay } = await mount();
    const versions = () => meshes.map(mesh => `${mesh.instanceMatrix.version}:${mesh.count}`).join('|');
    const before = versions();
    for (let i = 0; i < 5; i++) handle.update({ time: i, walkers: [[0, 0, 0]] });
    expect(versions()).toBe(before);
    camera.position.x += 60; camera.updateMatrixWorld();
    handle.update({ time: 6, walkers: [] });
    expect(versions()).not.toBe(before);
    handle.dispose(); clay.dispose();
  }, 120_000);

  it('hides one lot, its back fence and the fence\'s shadow, and restores them', async () => {
    const { handle, meshes, camera, clay, registerShadow, releases } = await mount();
    const fence = all(plan).find(p => p.id.endsWith(':back-fence') && all(plan).some(o => o.lotSlot === p.lotSlot && pieceRole(o.blueprint).cover))!;
    camera.position.set(fence.position[0] + 6, fence.position[1] + 3, fence.position[2] + 6); camera.lookAt(...fence.position); camera.updateMatrixWorld();
    handle.update({ time: 0, walkers: [] });
    const total = () => meshes.reduce((n, mesh) => n + mesh.count, 0), shown = total();
    const lotPieces = all(plan).filter(p => p.lotSlot === fence.lotSlot).length;
    const casters = () => registerShadow.mock.calls.flatMap(([mesh], i) => mesh.name === `${fence.blueprint.id}:shadow-source` ? [i] : []);
    const caster = () => registerShadow.mock.calls[casters().at(-1)!]![0] as THREE.InstancedMesh;
    const fences = plan.blockers.filter(b => b.blueprint === fence.blueprint).length, first = casters().at(-1)!;
    expect(caster().count).toBe(fences);
    handle.hideLot(fence.lotSlot!); handle.update({ time: 0, walkers: [] });
    expect(total()).toBeLessThan(shown); expect(shown - total()).toBeLessThanOrEqual(lotPieces * 3);
    // Build mode owns the lot: its fence stops casting too, and the old caster is released.
    expect(caster().count).toBe(fences - 1); expect(releases[first]).toHaveBeenCalledTimes(1);
    handle.hideLot(null); handle.update({ time: 0, walkers: [] });
    expect(total()).toBe(shown); expect(caster().count).toBe(fences);
    handle.dispose(); clay.dispose();
  }, 120_000);

  it('casts solids only, releases every shadow and frees only what it owns', async () => {
    const { handle, scene, registerShadow, releases, clay } = await mount();
    const solids = new Map<string, number>();
    // Flush stones and the bed lie in the turf and cast no sun shadow, like the cover.
    for (const blocker of plan.blockers) solids.set(blocker.blueprint.id, (solids.get(blocker.blueprint.id) ?? 0) + 1);
    expect(registerShadow).toHaveBeenCalledTimes(solids.size);
    for (const [mesh] of registerShadow.mock.calls) expect((mesh as THREE.InstancedMesh).count).toBe(solids.get(mesh.name.replace(':shadow-source', '')));
    const clayDisposed = vi.fn(); clay.material.addEventListener('dispose', clayDisposed);
    const owned = scene.children.filter(child => child instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    const geometryDisposed = vi.fn(); for (const mesh of owned) mesh.geometry.addEventListener('dispose', geometryDisposed);
    handle.dispose();
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
    expect(geometryDisposed).toHaveBeenCalledTimes(owned.length);
    expect(scene.children.some(child => child instanceof THREE.InstancedMesh)).toBe(false);
    expect(clayDisposed).not.toHaveBeenCalled(); expect(pool.dispose).not.toHaveBeenCalled();
    clay.dispose();
  }, 120_000);
});
