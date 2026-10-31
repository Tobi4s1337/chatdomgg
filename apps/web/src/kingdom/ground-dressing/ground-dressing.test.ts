import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial } from '@chatdom/render';
import { executeVoxelJob, type VoxelJobInput, type VoxelWorkerPool } from '@chatdom/voxel';
import { currentFootprint, homeFrame, samplePublicGround, terrainHeight, type KingdomLand, type SettlementPlan } from '@chatdom/world';
import { createCastleContent } from '../castle-content';
import { placeMarketContent, placeSettlementContent } from '../settlement-content';
import { sampleTerrainTriangles } from '../terrain-worker';
import { simulatedLand, simulatedWaterKeepOut } from './fixture';
import { DRESSING_VERTEX_ANCHOR, dressingVertexShader } from './material';
import { createGroundDressing, pieceMatrix } from './mount';
import { footprintCorners, patchArea, pieceRole, planGroundDressing, polygonDistance, type GroundDressingInput, type GroundDressingPlan, type GroundPiece } from './plan';

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

let land: KingdomLand, input: GroundDressingInput, plan: GroundDressingPlan;
// A keep-out and keep-clear placed over open ground the meadow would otherwise dress.
const keepOutSquare = [[-120, 120], [-100, 120], [-100, 140], [-120, 140]] as const;
beforeAll(() => {
  land = simulatedLand({ seed: 'willowmere', tier: 'town' });
  input = inputFor(land, { keepOut: [keepOutSquare.map(p => [...p] as [number, number])] });
  plan = planGroundDressing(input);
}, 240_000);

describe('planGroundDressing', () => {
  it('is deterministic, with unique semantic IDs', () => {
    const again = planGroundDressing(inputFor(land, { keepOut: input.keepOut! }));
    expect(JSON.stringify([...again.pieces])).toBe(JSON.stringify([...plan.pieces]));
    const ids = all(plan).map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => /^(meadow|lot:[^:]+|forecourt:\d+:-?1|drift:-?\d+:-?\d+)(:[^:]+)*$/.test(id))).toBe(true);
    expect(all(plan).length).toBeGreaterThan(4000);
    expect(all(plan).length).toBeLessThanOrEqual(40_000);
  }, 240_000);

  it('keeps every clearance of R3', () => {
    const p = land.plan;
    const homes = p.homes.map(home => ({ home, rect: currentFootprint(home), frame: homeFrame(home) }));
    for (const piece of all(plan)) {
      const role = pieceRole(piece.blueprint), height = piece.blueprint.size[1] * CELL;
      for (const [x, z] of footprintPoints(piece)) {
        const sample = samplePublicGround(p, x, z);
        expect(sample ? sample.pavingDistance : Infinity, `${piece.id} on paving`).toBeGreaterThan(0.25);
        if (role.solid) expect(sample ? sample.reservedDistance : Infinity, `${piece.id} in a verge`).toBeGreaterThanOrEqual(0.6);
        for (const { rect, frame } of homes) {
          expect(x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ, `${piece.id} on a home`).toBe(false);
          const dx = x - frame.front[0], dz = z - frame.front[2];
          const out = dx * frame.outward[0] + dz * frame.outward[2], side = dx * frame.right[0] + dz * frame.right[2];
          if (out > 0 && out < 3.5 && Math.abs(side) < 4) {
            expect(Math.abs(side + 0.25) >= 1.75, `${piece.id} in an entrance band`).toBe(true);
            expect(height, `${piece.id} tall in a forecourt`).toBeLessThanOrEqual(0.6);
          }
        }
        const castle = p.castle.bounds;
        expect(x > castle.minX && x < castle.maxX && z > castle.minZ && z < castle.maxZ, `${piece.id} in the castle`).toBe(false);
        for (const polygon of [p.market.boundary, ...p.courts.map(c => c.boundary), p.castle.court.boundary, keepOutSquare])
          expect(polygonDistance(polygon, x, z), `${piece.id} in a square or keep-out`).toBeGreaterThan(0);
        expect(Math.hypot(x, z - 8), `${piece.id} in the Forge plaza`).toBeGreaterThan(7);
        expect(input.waterKeepOut(x, z, 0.5), `${piece.id} in water`).toBe(false);
      }
      // Occupied placements: never overlapped; solids keep 1.5 m.
      const corners = footprintCorners(piece.blueprint, piece.position, piece.yaw, CELL);
      const box = { minX: Math.min(...corners.map(c => c[0])), maxX: Math.max(...corners.map(c => c[0])), minZ: Math.min(...corners.map(c => c[1])), maxZ: Math.max(...corners.map(c => c[1])) };
      for (const other of input.occupied) {
        const o = footprintCorners(other.blueprint, other.position, other.yaw), margin = role.solid ? 1.5 : 0.2;
        const ob = { minX: Math.min(...o.map(c => c[0])) - margin, maxX: Math.max(...o.map(c => c[0])) + margin, minZ: Math.min(...o.map(c => c[1])) - margin, maxZ: Math.max(...o.map(c => c[1])) + margin };
        expect(box.minX < ob.maxX && box.maxX > ob.minX && box.minZ < ob.maxZ && box.maxZ > ob.minZ, `${piece.id} on ${other.blueprint.id}`).toBe(false);
      }
    }
  }, 240_000);

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

  it('grounds cover on its slope and sets solids level', () => {
    for (const piece of all(plan)) {
      const role = pieceRole(piece.blueprint), [gx, gz] = piece.slope ?? [0, 0];
      const heights = footprintPoints(piece, 0.5).map(([x, z]) => {
        const plane = piece.position[1] + gx * (x - piece.position[0]) + gz * (z - piece.position[2]);
        return { plane, ground: input.ground(x, z) };
      });
      if (role.cover) {
        expect(Math.hypot(gx, gz)).toBeLessThanOrEqual(Math.tan(35 * Math.PI / 180) + 1e-9);
        // Never floating, never more than a few cells buried.
        for (const { plane, ground } of heights) { expect(plane - ground, piece.id).toBeLessThan(0.06); expect(ground - plane, piece.id).toBeLessThan(0.3); }
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
    const lotDistance = (x: number, z: number) => Math.min(...p.reservations.map(({ lot }) => {
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
    const centres = cover.map(centreOf);
    const open = eligible.filter(([x, z]) => !centres.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 2)).length;
    expect(open / eligible.length).toBeGreaterThanOrEqual(0.4);
    // Drifts: 5–15 patches of one flower colour, 3–6 m across (plus the patch itself).
    const drifts = new Map<string, GroundPiece[]>();
    for (const piece of cover.filter(piece => pieceRole(piece.blueprint).form.startsWith('wildflowers-'))) {
      const key = piece.id.split(':').slice(0, -1).join(':'), list = drifts.get(key);
      if (list) list.push(piece); else drifts.set(key, [piece]);
    }
    expect(drifts.size).toBeGreaterThan(40);
    for (const [key, patches] of drifts) {
      expect(patches.length, key).toBeGreaterThanOrEqual(5); expect(patches.length, key).toBeLessThanOrEqual(15);
      expect(new Set(patches.map(p => p.blueprint.id)).size, key).toBe(1);
      const cs = patches.map(centreOf), span = Math.max(...cs.flatMap(a => cs.map(b => Math.hypot(a[0] - b[0], a[1] - b[1]))));
      expect(span, key).toBeLessThanOrEqual(6.5);
    }
    // Forecourt drifts lead to doors in the older quarters too, not only out in the meadow.
    expect([...drifts.keys()].filter(key => key.startsWith('forecourt:')).length).toBeGreaterThan(20);
  });

  it('changes only the grown lot when a home grows deeper', () => {
    const home = land.plan.homes.find(h => h.allowedDepth <= 10 && all(plan).some(p => p.lotSlot === h.slot))!;
    const grown: KingdomLand = { ...land, plan: { ...land.plan, homes: land.plan.homes.map(h => h === home ? { ...h, allowedDepth: h.allowedDepth + 4 } : h) } };
    const after = planGroundDressing({ ...input, land: grown });
    const outside = (p: GroundDressingPlan) => JSON.stringify(all(p).filter(piece => piece.lotSlot !== home.slot).sort((a, b) => (a.id < b.id ? -1 : 1)));
    expect(outside(after)).toBe(outside(plan));
    const inside = (p: GroundDressingPlan) => all(p).filter(piece => piece.lotSlot === home.slot).map(piece => piece.id);
    expect(inside(after)).not.toEqual(inside(plan));
    const rect = currentFootprint({ ...home, allowedDepth: home.allowedDepth + 4 });
    for (const piece of all(after).filter(piece => piece.lotSlot === home.slot))
      for (const [x, z] of footprintPoints(piece)) expect(x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ).toBe(false);
  }, 240_000);
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
    const key = (array: ArrayLike<number>, at: number) => Array.from({ length: 16 }, (_, i) => array[at + i]!.toFixed(4)).join(',');
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

  it('hides one lot and restores it', async () => {
    const { handle, meshes, camera, clay } = await mount();
    const piece = all(plan).find(p => p.lotSlot !== undefined)!;
    camera.position.set(piece.position[0] + 6, piece.position[1] + 3, piece.position[2] + 6); camera.lookAt(...piece.position); camera.updateMatrixWorld();
    handle.update({ time: 0, walkers: [] });
    const total = () => meshes.reduce((n, mesh) => n + mesh.count, 0), shown = total();
    const lotPieces = all(plan).filter(p => p.lotSlot === piece.lotSlot).length;
    handle.hideLot(piece.lotSlot!); handle.update({ time: 0, walkers: [] });
    expect(total()).toBeLessThan(shown); expect(shown - total()).toBeLessThanOrEqual(lotPieces * 2);
    handle.hideLot(null); handle.update({ time: 0, walkers: [] });
    expect(total()).toBe(shown);
    handle.dispose(); clay.dispose();
  }, 120_000);

  it('casts solids only, releases every shadow and frees only what it owns', async () => {
    const { handle, scene, registerShadow, releases, clay } = await mount();
    const solids = new Map<string, number>();
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
