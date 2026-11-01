import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment, type WindowHouse } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import type { KingdomPresenceFrame, MaterialRegistry, Vec3, VoxelBlueprint } from '@chatdom/shared';

/** One placed voxel model of the kingdom, in settlement metres at its blueprint's local origin. */
export interface KingdomPlacement {
  readonly id: string;
  readonly blueprint: VoxelBlueprint;
  readonly position: Vec3;
  readonly yaw: number;
  /** The citizen home slot whose windows this model carries. */
  readonly slot?: number;
  /** SHA-256 of the blueprint's canonical bytes (`assetHashOf`): the asset identity meshes are shared by. */
  readonly assetHash: string;
}

export interface GrandKingdomLayerInput {
  /** Settlement metres + offset = land metres (the seat). */
  readonly offset: Vec3;
  readonly placements: readonly KingdomPlacement[];
  /** Street homes (and the keep) whose windows carry presence, in settlement metres. */
  readonly houses: readonly WindowHouse[];
  readonly materials?: MaterialRegistry;
  /** Presence for the windows. A potential kingdom shows a labelled SIMULATED study, never invented people. */
  readonly presence: KingdomPresenceFrame | null;
  /** Open flames (court and gate braziers, Forge square fires), in settlement metres: a warm glow after dusk. */
  readonly fires?: readonly Vec3[];
}

/** What the grand engine lends a layer. */
export interface GrandLayerHost {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Ask for another frame: new geometry arrived or lights changed. */
  invalidate(): void;
}

export interface GrandKingdomLayerStats {
  blueprints: number;
  placements: number;
  meshed: number;
  instancesByLevel: [number, number, number];
  triangles: number;
  /** Blueprint jobs the workers could not mesh; their placements stay at a coarser level or absent. */
  failed: number;
}

export interface GrandKingdomLayer {
  /** Resolves once every blueprint has its coarsest mesh installed. */
  readonly ready: Promise<void>;
  /** Every blueprint has its full-detail mesh too: the town is as finished as the camera can ask for. */
  isReady(): boolean;
  readonly stats: GrandKingdomLayerStats;
  /** The settlement's frame inside the land scene. */
  readonly root: THREE.Object3D;
  /** The hour drives the clay's light and the windows; the sun direction is the land's own. */
  setLight(hour: number, sunDirection: THREE.Vector3): void;
  /** Per rendered frame: picks each placement's detail from its distance and advances the window lights. */
  update(seconds: number): void;
  dispose(): void;
}

type Factor = 1 | 2 | 4;
const FACTORS: readonly Factor[] = [4, 2, 1];
/**
 * Detail by distance (metres). A build cell is 0.125 m: at 1080p and a 38° lens it is ~2 px at 90 m, so full detail
 * holds to there, factor 2 to 260 m, and factor 4 (half a metre, the land's own cell) beyond. A 15% band of
 * hysteresis stops a home flickering between meshes while the camera glides.
 */
const NEAR = 90, MID = 260, HYSTERESIS = 0.15;

interface Batch {
  readonly blueprint: VoxelBlueprint;
  readonly placements: KingdomPlacement[];
  readonly matrices: THREE.Matrix4[];
  readonly centres: THREE.Vector3[];
  readonly level: Uint8Array;
  readonly meshes: Map<Factor, THREE.InstancedMesh>;
}

/**
 * The kingdom on the grand land: the exact settlement content (homes, castle, market, props, seats) meshed by the
 * shared voxel workers and drawn at the seat, each placement at the detail its distance needs, with the presence
 * windows of every citizen home. Settlement metres throughout; one `root` translation puts it on the land.
 */
export function mountGrandKingdom(host: GrandLayerHost, input: GrandKingdomLayerInput): GrandKingdomLayer {
  const registry = input.materials ?? MATERIALS;
  // A nested scene keeps window lights and meshes in settlement metres under the seat translation.
  const root = new THREE.Scene();
  root.name = 'grand-kingdom';
  root.position.set(...input.offset);
  root.matrixWorldAutoUpdate = true;
  host.scene.add(root);
  const clay = createVoxelMaterial(registry, 'build');
  const pool = new VoxelWorkerPool({ size: 2, maxQueue: 256 });
  const batches = new Map<string, Batch>();
  for (const placement of input.placements) {
    // One mesh per asset identity: equal bytes share it, and an ID never stands in for content.
    const key = placement.assetHash;
    let batch = batches.get(key);
    if (!batch) batches.set(key, batch = { blueprint: placement.blueprint, placements: [], matrices: [], centres: [], level: new Uint8Array(0), meshes: new Map() });
    batch.placements.push(placement);
  }
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const batch of batches.values()) {
    const b = batch.blueprint, half = new THREE.Vector3(b.size[0] / 16, b.size[1] / 16, b.size[2] / 16);
    for (const p of batch.placements) {
      const position = new THREE.Vector3(...p.position);
      q.setFromAxisAngle(up, p.yaw);
      batch.matrices.push(new THREE.Matrix4().compose(position, q, new THREE.Vector3(1, 1, 1)));
      batch.centres.push(half.clone().applyQuaternion(q).add(position).add(new THREE.Vector3(...input.offset)));
    }
    (batch as { level: Uint8Array }).level = new Uint8Array(batch.placements.length).fill(4);
  }
  const stats: GrandKingdomLayerStats = { blueprints: batches.size, placements: input.placements.length, meshed: 0, instancesByLevel: [0, 0, 0], triangles: 0, failed: 0 };
  let disposed = false, dirty = true, finished = 0;
  const lastEye = new THREE.Vector3(Infinity, 0, 0);

  const windows = input.houses.length ? createWindowLights(root, input.houses) : null;
  if (windows && input.presence) windows.setFrame(input.presence);

  const install = (batch: Batch, factor: Factor, chunks: Parameters<typeof geometryFromChunks>[0]) => {
    const geometry = geometryFromChunks(chunks, 'build');
    geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(batch.placements.length).fill(1), 1));
    const mesh = new THREE.InstancedMesh(geometry, clay.material, batch.placements.length);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = `${batch.blueprint.id}@${factor}`;
    root.add(mesh);
    batch.meshes.set(factor, mesh);
    stats.meshed++;
    dirty = true;
    host.invalidate();
  };

  // Coarse first so the whole town appears at once, then the detail that the near streets need.
  const jobs = FACTORS.flatMap(factor => [...batches.values()].map(batch => ({ factor, batch })));
  let next = 0;
  const ready = new Promise<void>((resolve, reject) => {
    let coarse = 0;
    const coarseTotal = batches.size;
    if (!coarseTotal) { resolve(); return; }
    const run = async (): Promise<void> => {
      while (next < jobs.length && !disposed) {
        const { factor, batch } = jobs[next++]!;
        const result = await pool.submit({ kind: 'blueprint', blueprint: batch.blueprint, revision: 1, materials: registry.materials, materialRevision: registry.revision, ...(factor === 1 ? {} : { lodFactor: factor }) });
        if (disposed) return;
        finished++;
        if (result?.kind === 'asset') install(batch, factor, result.chunks);
        else stats.failed++;
        if (factor === 4 && ++coarse === coarseTotal) resolve();
      }
    };
    void Promise.all(Array.from({ length: 6 }, run)).catch(reject);
  });

  const choose = (batch: Batch, i: number, eye: THREE.Vector3): Factor => {
    const d = batch.centres[i]!.distanceTo(eye), current = batch.level[i] as Factor;
    const want: Factor = d < NEAR ? 1 : d < MID ? 2 : 4;
    if (want === current) return current;
    // Only cross a threshold once past its hysteresis band.
    const edge = want < current ? (current === 4 ? MID : NEAR) * (1 - HYSTERESIS) : (current === 1 ? NEAR : MID) * (1 + HYSTERESIS);
    const refine = want < current;
    const factor = refine ? (d < edge ? want : current) : (d > edge ? want : current);
    // A placement shows the finest level already meshed at or below what it wants, never nothing.
    if (batch.meshes.has(factor)) return factor;
    for (const f of refine ? [current, ...FACTORS] : FACTORS) if (batch.meshes.has(f as Factor)) return f as Factor;
    return factor;
  };

  const assign = () => {
    const eye = host.camera.position;
    if (!dirty && eye.distanceToSquared(lastEye) < 4) return;
    lastEye.copy(eye);
    dirty = false;
    const counts: [number, number, number] = [0, 0, 0];
    let triangles = 0;
    for (const batch of batches.values()) {
      for (const mesh of batch.meshes.values()) mesh.count = 0;
      for (let i = 0; i < batch.placements.length; i++) {
        const factor = choose(batch, i, eye);
        batch.level[i] = factor;
        const mesh = batch.meshes.get(factor);
        if (!mesh) continue;
        const scale = factor;
        const m = batch.matrices[i]!.clone();
        if (scale !== 1) m.multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
        mesh.setMatrixAt(mesh.count++, m);
        counts[factor === 1 ? 0 : factor === 2 ? 1 : 2]++;
        triangles += (mesh.geometry.index?.count ?? 0) / 3;
        const slot = batch.placements[i]!.slot;
        if (slot !== undefined) windows?.setLod(slot, factor);
      }
      for (const mesh of batch.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
    }
    stats.instancesByLevel = counts;
    stats.triangles = triangles;
  };

  const fires = input.fires?.length ? createFireGlow(root, input.fires) : null;
  let hour = 17.6;
  return {
    ready, stats, root,
    isReady: () => finished === jobs.length,
    setLight(nextHour, sunDirection) {
      hour = nextHour;
      const env = getEnvironment(hour);
      clay.setEnvironment({ ...env, sunDirection: [sunDirection.x, sunDirection.y, sunDirection.z] });
      host.invalidate();
    },
    update(seconds) {
      if (disposed) return;
      assign();
      windows?.update(seconds, hour);
      fires?.update(seconds, hour);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pool.dispose();
      windows?.dispose();
      fires?.dispose();
      for (const batch of batches.values()) for (const mesh of batch.meshes.values()) { mesh.geometry.dispose(); mesh.dispose(); }
      clay.dispose();
      host.scene.remove(root);
    },
  };
}

/**
 * Flame glow seen from afar: one soft additive point per open fire, half a metre above its bowl. Bright from dusk to
 * dawn, a faint shimmer by day, each fire flickering on its own phase. Light reaches nothing; it is the far read of a
 * flame the kingdom view draws in full.
 */
function createFireGlow(root: THREE.Object3D, fires: readonly Vec3[]) {
  const positions = new Float32Array(fires.length * 3), phase = new Float32Array(fires.length);
  fires.forEach((fire, i) => { positions.set([fire[0], fire[1] + 0.5, fire[2]], i * 3); phase[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1; });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const uniforms = { uTime: { value: 0 }, uNight: { value: 1 } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aPhase; uniform float uTime; uniform float uNight; varying float vGlow;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        float flicker = 0.82 + 0.18 * sin(uTime * 9.0 + aPhase * 40.0) * sin(uTime * 3.7 + aPhase * 17.0);
        vGlow = flicker * mix(0.18, 1.0, uNight);
        gl_PointSize = clamp(2600.0 / -view.z, 3.0, 64.0);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = exp(-d * d * 9.0), halo = exp(-d * d * 2.5) * 0.35;
        gl_FragColor = vec4(vec3(1.0, 0.62, 0.26) * (core + halo) * vGlow, 1.0);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  root.add(points);
  return {
    update(seconds: number, hour: number) {
      uniforms.uTime.value = seconds;
      // Full glow from an hour before sunset to an hour after sunrise; the same window the window lights keep.
      const dusk = Math.min(1, Math.max(0, (hour - 17) / 1.5)), dawn = Math.min(1, Math.max(0, (7.5 - hour) / 1.5));
      uniforms.uNight.value = Math.max(dusk, dawn);
    },
    dispose() { root.remove(points); geometry.dispose(); material.dispose(); },
  };
}
