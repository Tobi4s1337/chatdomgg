// The grand land set piece (S04, S19): the GrandEngine staged by read-only import, flown along camera paths
// (`paths.ts`). Every pose is a function of the clock, so a frame-stepped recording is exact.
//
//   /studio/set.html?scene=grand&channel=tobi4s_&path=island-golden
//
// `window.__set.idle()` is true once every region is meshed at its chosen level and nothing is queued, so the
// recorder never captures pop-in.
import * as THREE from 'three';
import './contract';
import { GrandEngine, GRAND_TIERS } from '../../../web/src/grand/engine';
import { grandChannel } from '../../../web/src/grand/channels';
import { GRAND_VOXEL_METRES as M } from '../../../../packages/world/src/grand/types';
import { PATHS, samplePath, type PathKey, type SiteName } from './paths';


interface EngineInside {
  camera: THREE.PerspectiveCamera;
  controls: { target: THREE.Vector3; update(): boolean; enabled: boolean; enableDamping: boolean };
  land: { size: number; seaLevel: number; ground: Uint16Array; sites: Record<string, { x: number; z: number; y?: number; top?: number; level?: number } | null> } | null;
  settings: Record<string, unknown>;
  dirty: boolean;
  stats: { phase: string; queued: number; busyWorkers: number; installsPending: number };
  frame: (now: number) => void;
  govern: (now: number) => void;
  clouds: { mesh: THREE.Object3D } | null;
}

export async function start(query: URLSearchParams, canvas: HTMLCanvasElement): Promise<void> {
  const path = PATHS[query.get('path') ?? 'island-golden'] ?? PATHS['island-golden']!;
  const channel = grandChannel(query.get('channel') ?? 'tobi4s_');
  const hour = query.has('hour') ? Number(query.get('hour')) : path.hour;
  const offset = Number(query.get('from') ?? 0);

  const engine = new GrandEngine(canvas, channel.seed, { tier: 'ultra', capture: false, hour, view: 'orbit', time: null });
  const inside = engine as unknown as EngineInside;
  // Film settings: the ultra tier at the frame's full pixel count, with no per-frame install budget, so a
  // frame waits for its land instead of streaming it in. The resolution governor is off: frame time is virtual.
  inside.settings = { ...GRAND_TIERS.ultra, pixels: 9e6, ratio: 2, installBytes: 1e12, installMillis: 1e6, residentBytes: 1536 * 1024 * 1024, mainTriangles: Infinity };
  inside.govern = () => {};
  inside.controls.enableDamping = false;
  inside.controls.enabled = false;

  let start: number | null = null;
  const time = () => start === null ? 0 : offset + (performance.now() - start) / 1000;

  function site(name: SiteName | readonly [number, number, number]): THREE.Vector3 {
    const land = inside.land!;
    const width = land.size * M;
    if (typeof name !== 'string') return new THREE.Vector3(name[0] * width, name[1], name[2] * width);
    const ground = (x: number, z: number) => land.ground[Math.round(z) * land.size + Math.round(x)]! * M;
    if (name === 'centre') return new THREE.Vector3(width / 2, land.seaLevel * M, width / 2);
    const s = land.sites[name];
    if (!s) return new THREE.Vector3(width / 2, land.seaLevel * M, width / 2);
    const y = s.top ?? s.level ?? s.y ?? ground(s.x, s.z);
    return new THREE.Vector3(s.x * M, y * M, s.z * M);
  }

  function front(): number {
    const land = inside.land!;
    const c = land.size / 2, h = land.sites.harbour!;
    return Math.atan2(h.z - c, h.x - c);
  }

  function pose(key: PathKey) {
    const land = inside.land!;
    const target = site(key.at).add(new THREE.Vector3(0, key.lift ?? 0, 0));
    const bearing = front() + THREE.MathUtils.degToRad(key.yaw), pitch = THREE.MathUtils.degToRad(key.pitch);
    const distance = key.dist * land.size * M;
    const eye = new THREE.Vector3(Math.cos(bearing) * Math.cos(pitch), Math.sin(pitch), Math.sin(bearing) * Math.cos(pitch)).multiplyScalar(distance).add(target);
    return { eye, target, fov: key.fov };
  }

  function place(): void {
    if (!inside.land) return;
    // A path that climbs through the deck flies without it: from above, at night, the clouds read as dark slabs.
    if (inside.clouds) inside.clouds.mesh.visible = path.clouds !== false;
    const { a, b, u } = samplePath(path, time());
    const p = pose(a), q = pose(b);
    const eye = p.eye.lerp(q.eye, u), target = p.target.lerp(q.target, u);
    inside.camera.fov = p.fov + (q.fov - p.fov) * u;
    inside.camera.updateProjectionMatrix();
    inside.controls.target.copy(target);
    inside.camera.position.copy(eye);
    inside.camera.lookAt(target);
    inside.dirty = true;
  }

  const original = inside.frame;
  Object.defineProperty(engine, 'frame', { value: (now: number) => { place(); original(now); }, configurable: true });
  engine.onReady = () => {
    if (start === null) start = performance.now();
    window.__chatdomReady = true;
  };
  window.__set = {
    scene: 'grand',
    duration: path.duration,
    canvas,
    idle: () => inside.stats.phase === 'ready' && inside.stats.queued === 0 && inside.stats.busyWorkers === 0 && inside.stats.installsPending === 0,
    t: time,
    stats: () => ({ ...inside.stats }),
  };
  window.addEventListener('resize', () => engine.resize());
  void engine.start();
}
