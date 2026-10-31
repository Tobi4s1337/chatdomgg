import * as THREE from 'three';
import { geometryFromChunks, type VoxelRenderState } from '@chatdom/render';
import type { MaterialRegistry, Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { sampleLandWater, samplePublicGround, randomUnit, seedHash, terrainHeight, type SettlementPlan } from '@chatdom/world';
import { createLilies, createReeds } from '../../../../packages/content/src/places/water/shore';
import { sampleTerrainTriangles } from './terrain-worker';

export interface ShorePlacement { kind: 'reeds' | 'lilies'; variant: number; blueprint: VoxelBlueprint; position: Vec3; yaw: number; centre: readonly [number, number]; slope?: readonly [number, number] }
export type ShoreOccupied = readonly { blueprint: VoxelBlueprint; position: Vec3; yaw: number }[];
export interface ShoreHost { scene: THREE.Scene; pool: VoxelWorkerPool; clay: VoxelRenderState; plan: SettlementPlan; occupied?: ShoreOccupied; signal: AbortSignal; registry: MaterialRegistry; style?: 'hearth' | 'tide' | 'grove' }

/** Sample the same triangular surface used by the water shader and the rendered ground. */
function height(plan: SettlementPlan, x: number, z: number): number {
  return sampleTerrainTriangles((a, b) => terrainHeight(plan, a, b), x, z);
}
function rand(seed: string): number { return randomUnit(seedHash(seed)); }
function nearRect(x: number, z: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }, margin: number): boolean {
  return x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin;
}

/** Deterministic sparse pockets anchored to the sampled shoreline, leaving open water and banks between them. */
export function planShoreDressing(plan: SettlementPlan, occupied: ShoreOccupied = [], style: 'hearth' | 'tide' | 'grove' = plan.homes[0]?.style ?? 'hearth'): ShorePlacement[] {
  const lake = plan.lake, seed = plan.config.seed, pieces: ShorePlacement[] = [];
  const obstacles = occupied.map(p => {
    const w = p.blueprint.size[0] * .125, d = p.blueprint.size[2] * .125, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    const corners = [[0, 0], [w, 0], [0, d], [w, d]].map(([a, b]) => [p.position[0] + a! * c + b! * s, p.position[2] - a! * s + b! * c]);
    return { minX: Math.min(...corners.map(p => p[0]!)), maxX: Math.max(...corners.map(p => p[0]!)), minZ: Math.min(...corners.map(p => p[1]!)), maxZ: Math.max(...corners.map(p => p[1]!)) };
  });
  const clear = (x: number, z: number, radius: number) => {
    if (plan.reservations.some(p => nearRect(x, z, p.lot, radius + .5)) || nearRect(x, z, plan.castle.bounds, radius + .5) || obstacles.some(p => nearRect(x, z, p, radius + .5))) return false;
    for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      const publicGround = samplePublicGround(plan, x + dx!, z + dz!);
      if (publicGround && publicGround.reservedDistance < 1) return false;
    }
    return pieces.every(p => Math.hypot(p.centre[0] - x, p.centre[1] - z) > (p.kind === 'reeds' ? 1.35 : 1.1) + radius);
  };
  // Fixed pocket bearings with seeded rotation, not a continuous ring. Each pocket fans over a small arc.
  const rotation = rand(seed + ':shore-rotation') * Math.PI * 2;
  for (let pocket = 0; pocket < 7; pocket++) {
    const base = rotation + pocket * Math.PI * 2 / 7 + (rand(`${seed}:p${pocket}`) - .5) * .4;
    for (let n = 0; n < 9; n++) {
      const key = `${seed}:shore:${pocket}:${n}`, angle = base + (rand(key + ':angle') - .5) * .24;
      const dx = Math.cos(angle), dz = Math.sin(angle);
      // Locate the rendered wet edge along this ray; the analytic water envelope identifies the actual feature.
      let lo = 0, hi = Math.max(lake.radiusX, lake.radiusZ) * 1.3;
      if (height(plan, lake.x, lake.z) >= lake.level) continue;
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (height(plan, lake.x + dx * mid, lake.z + dz * mid) < lake.level) lo = mid; else hi = mid; }
      const kind = n < 6 ? 'reeds' : 'lilies';
      const distance = (lo + hi) / 2 + (kind === 'reeds' ? .65 + rand(key + ':offset') * 1.6 : -2.1 - rand(key + ':offset') * 3.2);
      const x = lake.x + dx * distance, z = lake.z + dz * distance;
      const water = sampleLandWater(plan.landform, x, z);
      if (!water || Math.abs(water.surface - lake.level) > .05 || !clear(x, z, kind === 'reeds' ? 1.05 : .85)) continue;
      const variant = Math.floor(rand(key + ':variant') * 3), blueprint = (kind === 'reeds' ? createReeds(style, variant) : createLilies(style, variant)).blueprint;
      const radius = Math.hypot(blueprint.size[0], blueprint.size[2]) * .0625;
      const samples = [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]].map(([a, b]) => height(plan, x + a!, z + b!));
      if (kind === 'reeds' ? samples.some(h => h < lake.level || Math.abs(h - samples[0]!) > 1.2) : samples.some(h => h >= lake.level - .05)) continue;
      const yaw = rand(key + ':yaw') * Math.PI * 2, c = Math.cos(yaw), s = Math.sin(yaw), w = blueprint.size[0] * .0625, d = blueprint.size[2] * .0625;
      const slope = kind === 'reeds' ? [(samples[1]! - samples[2]!) / (2 * radius), (samples[3]! - samples[4]!) / (2 * radius)] as const : undefined;
      pieces.push({ kind, variant, blueprint, ...(slope ? { slope } : {}), centre: [x, z], yaw, position: [x - c * w - s * d, kind === 'reeds' ? samples[0]! - .04 : lake.level + .015, z + s * w - c * d] });
    }
  }
  return pieces;
}

/** Mounts passive plants using the caller's shared voxel material. */
export function createShoreDressing(host: ShoreHost) {
  const placements = planShoreDressing(host.plan, host.occupied, host.style), meshes: THREE.InstancedMesh[] = [], geometries: THREE.BufferGeometry[] = [];
  let disposed = false, pending: Promise<void> | undefined;
  const abort = () => dispose();
  host.signal.addEventListener('abort', abort, { once: true });
  function dispose(): void {
    if (disposed) return;
    disposed = true; host.signal.removeEventListener('abort', abort);
    for (const mesh of meshes) { host.scene.remove(mesh); mesh.dispose(); }
    for (const geometry of geometries) geometry.dispose();
  }
  function prepare(): Promise<void> {
    return pending ??= (async () => {
      const groups = new Map<string, ShorePlacement[]>();
      for (const p of placements) { const key = `${p.kind}:${p.variant}`, group = groups.get(key); if (group) group.push(p); else groups.set(key, [p]); }
      try {
        await Promise.all([...groups.values()].map(async group => {
          const blueprint = group[0]!.blueprint;
          const result = await host.pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: host.registry.materials, materialRevision: host.registry.revision });
          if (disposed || host.signal.aborted) return;
          if (result?.kind !== 'asset') throw new Error(`Shore dressing could not mesh ${blueprint.id}`);
          const geometry = geometryFromChunks(result.chunks, 'build'); geometries.push(geometry);
          geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(group.length).fill(1), 1));
          const mesh = new THREE.InstancedMesh(geometry, host.clay.material, group.length), matrix = new THREE.Matrix4();
          group.forEach((p, i) => { matrix.makeRotationY(p.yaw); if (p.slope) matrix.premultiply(new THREE.Matrix4().set(1, 0, 0, 0, p.slope[0], 1, p.slope[1], 0, 0, 0, 1, 0, 0, 0, 0, 1)); matrix.setPosition(...p.position); if (p.slope) matrix.elements[13] -= p.slope[0] * (p.centre[0] - p.position[0]) + p.slope[1] * (p.centre[1] - p.position[2]); mesh.setMatrixAt(i, matrix); });
          mesh.instanceMatrix.needsUpdate = true; mesh.name = `shore:${blueprint.id}`; mesh.castShadow = false; mesh.receiveShadow = false; mesh.computeBoundingSphere();
          meshes.push(mesh); host.scene.add(mesh);
        }));
        if (disposed || host.signal.aborted) throw new Error('Shore dressing closed while meshing');
      } catch (error) { dispose(); throw error; }
    })();
  }
  if (host.signal.aborted) dispose();
  return { prepare, dispose, stats: () => ({ instances: placements.length, drawCalls: meshes.length }) };
}
