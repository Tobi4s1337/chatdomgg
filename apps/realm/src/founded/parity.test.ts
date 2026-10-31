import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { CollisionWorld, PlayerState, RealmFoundedManifest, SolidBox } from '@chatdom/shared/realm';
import { transformCardinalPoint, type CardinalTurn, type RealmFoundedPlacement, type RealmFoundedScene } from '@chatdom/world';
import { bodyStuck, embeddedSolids, stepPlayer, supported } from '@chatdom/world/movement';
// The renderer's own terrain field: the browser half reuses what it already sampled to draw the ground.
import { prepareTerrainField } from '../../../web/src/kingdom/terrain-worker';
import {
  COLLISION_COMPILER_VERSION, CollisionAssetCache, FOUNDED_TERRAIN, compileFoundedCollision, foundedCollisionKey,
  sampleFoundedTerrain, terrainFromRenderField, type CompiledCollisionWorld, type SampledTerrain,
} from './collision';
import { decodeFoundedScene } from './validate';

/**
 * Producer parity on the actual current town: FW01's SIMULATED adopted plan and committed owned home, decoded from
 * its immutable bytes once as the server would and once as a browser would, compiled on each side and walked with
 * the one movement law. Everything here is SIMULATED fixture authority; the geometry is the real town's.
 */
const at = (name: string) => new URL(`./artifacts/simulated-town.${name}`, import.meta.url);
const OWNED_PLOT = 'plot:2023:8', ATTACHED = 'forge:simulated-run-2';
const GLASS = 14;
const TICK = 1 / 30;

let server: { scene: RealmFoundedScene; terrain: SampledTerrain; world: CompiledCollisionWorld };
let browser: { scene: RealmFoundedScene; terrain: SampledTerrain; world: CompiledCollisionWorld };
let evidence: Record<string, number | string>;

beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(at('scene.json')));
  const manifest = JSON.parse(await readFile(at('manifest.json'), 'utf8')) as RealmFoundedManifest;
  const heap = process.memoryUsage().heapUsed, cpu = process.cpuUsage();
  let t = performance.now();
  const serverScene = await decodeFoundedScene(bytes, manifest);
  const decodeMs = performance.now() - t;
  t = performance.now();
  const serverTerrain = sampleFoundedTerrain(serverScene.plan);
  const sampleMs = performance.now() - t;
  t = performance.now();
  const serverWorld = compileFoundedCollision(serverScene, { terrain: serverTerrain, cache: new CollisionAssetCache() });
  const compileMs = performance.now() - t;
  const heapAfter = process.memoryUsage().heapUsed, cpuUsed = process.cpuUsage(cpu);
  server = { scene: serverScene, terrain: serverTerrain, world: serverWorld };

  // The browser: its own copy of the bytes, its own decode, the renderer's terrain field and its own asset cache.
  const browserScene = await decodeFoundedScene(bytes.slice(), { ...manifest });
  t = performance.now();
  const browserTerrain = terrainFromRenderField(prepareTerrainField(browserScene.plan));
  const fieldMs = performance.now() - t;
  const browserWorld = compileFoundedCollision(browserScene, { terrain: browserTerrain, cache: new CollisionAssetCache() });
  browser = { scene: browserScene, terrain: browserTerrain, world: browserWorld };
  t = performance.now();
  compileFoundedCollision(serverScene, { terrain: serverTerrain, cache: new CollisionAssetCache() });
  const recompileMs = performance.now() - t;
  evidence = {
    label: 'SIMULATED authority, actual town geometry', decodeMs: Math.round(decodeMs), terrainSampleMs: Math.round(sampleMs),
    rendererFieldMs: Math.round(fieldMs), compileMs: Math.round(compileMs), recompileMs: Math.round(recompileMs),
    cpuUserMs: Math.round(cpuUsed.user / 1000), heapDeltaMB: Math.round((heapAfter - heap) / 1e5) / 10,
    terrainColumns: serverTerrain.columns * serverTerrain.rows, ...serverWorld.stats,
  };
  console.log(`founded collision parity evidence ${JSON.stringify(evidence)}`);
}, 600_000);

function state(world: CollisionWorld, [x, y, z]: Vec3): PlayerState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, yaw: 0, distance: 0, collisionRevision: world.revision };
}
/** Settle for one second, then hold a world-relative direction for `ticks` at walking speed. */
function walk(world: CollisionWorld, from: Vec3, direction: readonly [number, number], ticks: number): { start: PlayerState; end: PlayerState } {
  const s = state(world, from);
  const input = (moveX: number, moveZ: number) => ({ moveX, moveZ, buttons: 0, yaw: 0, collisionRevision: world.revision });
  for (let i = 0; i < 30; i++) stepPlayer(s, input(0, 0), TICK, world);
  const start = { ...s };
  for (let i = 0; i < ticks; i++) stepPlayer(s, input(Math.round(direction[0] * 127), Math.round(direction[1] * 127)), TICK, world);
  return { start, end: s };
}
function solidAt(world: CollisionWorld, [x, y, z]: Vec3): boolean {
  return world.query({ min: [x, y, z], max: [x, y, z] }).some(b => b.min[0] < x && x < b.max[0] && b.min[1] < y && y < b.max[1] && b.min[2] < z && z < b.max[2]);
}
const placement = (scene: RealmFoundedScene, id: string) => scene.placements.find(p => p.id === id)!;
const blueprintOf = (scene: RealmFoundedScene, p: RealmFoundedPlacement) => scene.assets.find(a => a.assetHash === p.assetHash)!.blueprint;
/** World point of a local build-cell coordinate (cell units), through the placement's own cardinal frame. */
const worldOf = (p: RealmFoundedPlacement, cell: Vec3, metres = .125): Vec3 =>
  transformCardinalPoint(p.position, p.rotation as CardinalTurn, [cell[0] * metres, cell[1] * metres, cell[2] * metres]);
const directionOf = (p: RealmFoundedPlacement, local: Vec3): [number, number] => {
  const d = transformCardinalPoint([0, 0, 0], p.rotation as CardinalTurn, local);
  return [d[0], d[2]];
};
/** Reference final material per cell, replaying the blueprint's ordered operations densely. */
function finalMaterials(blueprint: VoxelBlueprint): (x: number, y: number, z: number) => number {
  const [sx, sy, sz] = blueprint.size, cells = new Uint16Array(sx * sy * sz);
  for (const op of blueprint.boxes) for (let z = op.from[2]; z < op.to[2]; z++) for (let y = op.from[1]; y < op.to[1]; y++)
    cells.fill(op.material, op.from[0] + sx * (y + sy * z), op.to[0] + sx * (y + sy * z));
  return (x, y, z) => cells[x + sx * (y + sy * z)]!;
}
const terrainTop = (terrain: SampledTerrain, x: number, z: number) =>
  terrain.heights[Math.floor((x - terrain.originX) / terrain.cellMetres) + terrain.columns * Math.floor((z - terrain.originZ) / terrain.cellMetres)]! * terrain.cellMetres;

describe('the founded town is the same solid world in browser and server (spec 38 R4-R5)', () => {
  it('compiles identical worlds and answers identical queries from the same immutable bytes', () => {
    expect(browser.terrain).toEqual(server.terrain);
    expect(browser.world.revision).toBe(server.scene.collisionRevision);
    expect(browser.world.stats).toEqual(server.world.stats);
    expect(server.world.stats).toMatchObject({ compilerVersion: COLLISION_COMPILER_VERSION, placements: 924, assets: 49, barrierBoxes: 6 });
    expect(server.world.footprint).toEqual({ minX: -192, maxX: 272, minZ: -112, maxZ: 304, bottom: FOUNDED_TERRAIN.bottom, ceiling: FOUNDED_TERRAIN.ceiling });
    // Deterministic probes across the whole footprint and past its edges: equal boxes in the same order.
    let seed = 38;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (let n = 0; n < 3000; n++) {
      const x = -200 + next() * 480, z = -120 + next() * 432, y = -2 + next() * 30, e = next() * 3;
      const q: SolidBox = { min: [x, y, z], max: [x + e, y + e, z + e] };
      const a = server.world.query(q), b = browser.world.query(q);
      expect(b).toEqual(a);
      expect(new Set(a).size).toBe(a.length);
      expect(server.world.query(q).every((box, i) => box === a[i])).toBe(true);
    }
    expect(foundedCollisionKey('8f1122605164f55c39724a58c1dd6096b602d4ff649dca47a97425c14474d905')).toBe(`8f1122605164f55c39724a58c1dd6096b602d4ff649dca47a97425c14474d905:c${COLLISION_COMPILER_VERSION}:t1`);
  }, 60_000);

  it('walks through the approved owned home\'s carved doorway, and its closed front wall stops the same walk', () => {
    const home = placement(server.scene, `home:${OWNED_PLOT}`);
    expect(home.plotId).toBe(OWNED_PLOT);
    const blueprint = blueprintOf(server.scene, home), material = finalMaterials(blueprint);
    // The doorway is an ordered carve through the porch wall: air at its centre in the final cells.
    const door = blueprint.boxes.find(op => op.material === 0 && op.from[1] === 2 && op.to[1] - op.from[1] >= 15 && op.to[0] - op.from[0] >= 8)!;
    expect(door).toBeDefined();
    const doorX = (door.from[0] + door.to[0]) / 2;
    expect(material(Math.floor(doorX), 8, door.from[2])).toBe(0);
    const inward = directionOf(home, [0, 0, -1]);
    for (const side of [server, browser]) {
      const through = walk(side.world, worldOf(home, [doorX, 24, 130]), inward, 75);
      const local = (s: PlayerState) => (s.x - home.position[0]) * -inward[0] + (s.z - home.position[2]) * -inward[1];
      expect(local(through.start)).toBeGreaterThan(door.to[2] * .125);
      // Inside the hut, past the whole thickness of the carved wall, standing on its interior floor.
      expect(local(through.end)).toBeLessThan(door.from[2] * .125 - .28);
      expect(through.end).toMatchObject({ grounded: true, y: home.position[1] + 2 * .125 });
      expect(bodyStuck(through.end, side.world)).toBe(false);
      // Two metres along the same front, the solid wall (and its glazed window) is a wall.
      const wall = walk(side.world, worldOf(home, [16, 24, 132]), inward, 75);
      expect(local(wall.end)).toBeGreaterThan(124 * .125 + .28 - 1e-9);
      expect(embeddedSolids(wall.end, side.world)).toEqual([]);
    }
    expect(walk(browser.world, worldOf(home, [doorX, 24, 130]), inward, 75)).toEqual(walk(server.world, worldOf(home, [doorX, 24, 130]), inward, 75));
  }, 60_000);

  it('keeps thin glass physical and the attached forged part solid where the scene places it', () => {
    const glassMaterial = server.scene.materials.materials.find(m => m.id === GLASS)!;
    // Solidity is the only material fact collision reads; glass is see-through to people and solid to bodies.
    expect(glassMaterial).toMatchObject({ surface: 'glass', solid: true });
    const home = placement(server.scene, `home:${OWNED_PLOT}`), blueprint = blueprintOf(server.scene, home), material = finalMaterials(blueprint);
    const panes = blueprint.boxes.filter(op => op.material === GLASS && op.to[2] - op.from[2] === 1);
    expect(panes.length).toBeGreaterThan(0);
    for (const pane of panes) {
      const cell: Vec3 = [Math.floor((pane.from[0] + pane.to[0]) / 2), Math.floor((pane.from[1] + pane.to[1]) / 2), pane.from[2]];
      if (material(...cell) !== GLASS) continue;
      expect(solidAt(server.world, worldOf(home, [cell[0] + .5, cell[1] + .5, cell[2] + .5]))).toBe(true);
    }
    // The approved attached part: present in this revision, absent from a world compiled without it.
    const part = placement(server.scene, ATTACHED);
    expect(part.plotId).toBe(OWNED_PLOT);
    const size = blueprintOf(server.scene, part).size;
    const corners = [worldOf(part, [0, 0, 0]), worldOf(part, size)];
    const bounds: SolidBox = { min: [0, 1, 2].map(d => Math.min(corners[0]![d]!, corners[1]![d]!)) as unknown as Vec3,
      max: [0, 1, 2].map(d => Math.max(corners[0]![d]!, corners[1]![d]!)) as unknown as Vec3 };
    const without = compileFoundedCollision({ ...server.scene, placements: server.scene.placements.filter(p => p.id !== ATTACHED) }, { terrain: server.terrain });
    const added = server.world.query(bounds).filter(box => !without.query(bounds).some(b => b.min.every((v, d) => v === box.min[d]) && b.max.every((v, d) => v === box.max[d])));
    expect(added.length).toBeGreaterThan(0);
    for (const box of added) for (let d = 0; d < 3; d++) {
      expect(box.min[d]).toBeGreaterThanOrEqual(bounds.min[d]! - 1e-9);
      expect(box.max[d]).toBeLessThanOrEqual(bounds.max[d]! + 1e-9);
    }
  }, 60_000);

  it('places every cardinal turn cell for cell', () => {
    const { scene, world, terrain } = server;
    const boxesOf = (p: RealmFoundedPlacement) => {
      const corners = [worldOf(p, [0, 0, 0]), worldOf(p, blueprintOf(scene, p).size)];
      return { min: [0, 1, 2].map(d => Math.min(corners[0]![d]!, corners[1]![d]!)), max: [0, 1, 2].map(d => Math.max(corners[0]![d]!, corners[1]![d]!)) };
    };
    const extents = scene.placements.map(p => ({ p, b: boxesOf(p) }));
    for (const turn of [0, 1, 2, 3]) {
      // A placement standing clear of every other one, so each of its cells answers only for itself.
      const cells = (p: RealmFoundedPlacement) => blueprintOf(scene, p).size.reduce((n, v) => n * v, 1);
      const alone = extents.filter(({ p }) => p.rotation === turn).sort((a, b) => cells(a.p) - cells(b.p) || (a.p.id < b.p.id ? -1 : 1))
        .find(({ p, b }) => extents.every(o => o.p === p || o.b.min.some((v, d) => v >= b.max[d]!) || o.b.max.some((v, d) => v <= b.min[d]!)))!;
      expect(alone, `turn ${turn}`).toBeDefined();
      const blueprint = blueprintOf(scene, alone.p), material = finalMaterials(blueprint), [sx, sy, sz] = blueprint.size;
      let solids = 0, openings = 0;
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        const point = worldOf(alone.p, [x + .5, y + .5, z + .5]);
        if (point[1] <= terrainTop(terrain, point[0], point[2]) + 1e-9) continue;
        const solid = material(x, y, z) !== 0;
        expect(solidAt(world, point), `${alone.p.id} ${x},${y},${z}`).toBe(solid);
        if (solid) solids++; else openings++;
      }
      expect(solids).toBeGreaterThan(0);
      expect(openings).toBeGreaterThan(0);
    }
  }, 60_000);

  it('climbs up and down a half-metre terrain step and stops at the unknown edge of the footprint', () => {
    const { terrain, world } = server;
    const { columns, rows, heights, originX, originZ, cellMetres: c } = terrain;
    const find = (rise: number): Vec3 | undefined => {
      for (let k = 40; k < rows - 40; k += 3) for (let i = 40; i < columns - 40; i++) {
        const h = heights[i + columns * k]!;
        let flat = true;
        for (let dk = -3; dk <= 3 && flat; dk++) for (let di = 1; di <= 6 && flat; di++) {
          flat = heights[i - di + 1 + columns * (k + dk)] === h && heights[i + di + columns * (k + dk)] === h + rise;
        }
        if (!flat) continue;
        const x = originX + (i + 1) * c, z = originZ + (k + .5) * c;
        if (world.query({ min: [x - 4, h * c + .01, z - 1], max: [x + 4, h * c + 3, z + 1] }).some(b => Number.isFinite(b.max[0]) && b.max[1] > (h + rise) * c)) continue;
        return [x, h * c, z];
      }
      return undefined;
    };
    const half = find(1)!;
    expect(half).toBeDefined();
    for (const side of [server, browser]) {
      const up = walk(side.world, [half[0] - 1.5, half[1] + .5, half[2]], [1, 0], 30);
      expect(up.start).toMatchObject({ grounded: true, y: half[1] });
      expect(up.end).toMatchObject({ grounded: true, y: half[1] + .5 });
      expect(up.end.x).toBeGreaterThan(half[0] + .5);
      const down = walk(side.world, [half[0] + 1.5, half[1] + 1, half[2]], [-1, 0], 30);
      expect(down.end).toMatchObject({ grounded: true, y: half[1] });
      expect(down.end.x).toBeLessThan(half[0] - .5);
    }
    // West edge: open ground right up to the footprint, then unknown space blocks the body.
    const edge = world.footprint;
    const z = (edge.minZ + edge.maxZ) / 2;
    const ground = terrainTop(terrain, edge.minX + .25, z);
    for (const side of [server, browser]) {
      const out = walk(side.world, [edge.minX + 2, ground + .5, z], [-1, 0], 60);
      expect(out.end.x).toBe(edge.minX + .28);
      expect(supported(out.end, side.world)).toBe(true);
    }
    const beyond = world.query({ min: [edge.minX - 3, ground, z], max: [edge.minX - 2, ground + 2, z + 1] });
    expect(beyond.some(b => b.min[0] === -Infinity && b.max[0] === edge.minX)).toBe(true);
    expect(solidAt(world, [edge.maxX + 1, 10, z]) && solidAt(world, [0, edge.bottom - 1, 0]) && solidAt(world, [0, edge.ceiling + 1, 0])).toBe(true);
  }, 60_000);

  it('records the evidence', () => {
    expect(evidence.label).toMatch(/SIMULATED/);
    expect(Number(evidence.boxes)).toBe(Number(evidence.structureBoxes) + Number(evidence.terrainBoxes) + 6);
  });
});
