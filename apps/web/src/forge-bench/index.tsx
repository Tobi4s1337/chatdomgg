import { createSignal, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { KingdomPresenceFrameSchema, VOXEL_METRES, type VoxelBlueprint } from '@chatdom/shared';
import { composeForgeFixture, fingerprint, FORGE_PIECES, FORGE_REVIEW } from '../../../../packages/content/src/forge';
import { parseForgeBench, type ForgeBenchState } from './params';
import './style.css';

export interface ForgeBenchReport extends ForgeBenchState {
  model: string;
  fingerprint: string;
  instances: number;
  pieceIds: readonly string[];
  boxes: number;
  windows: number;
  triangles: number;
  draws: number;
  width: number;
  height: number;
}

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomForge?: ForgeBenchReport;
    __chatdomForgeError?: string;
  }
}

const FAMILY_NAMES = { hearthfold: 'Hearthfold', tidewake: 'Tidewake', grovebough: 'Grovebough' } as const;
const NORMALS = { south: [0, 0, 1], north: [0, 0, -1], east: [1, 0, 0], west: [-1, 0, 0] } as const;

function bounds(blueprint: VoxelBlueprint): THREE.Box3 {
  const box = new THREE.Box3();
  for (const b of blueprint.boxes) {
    box.expandByPoint(new THREE.Vector3(...b.from).multiplyScalar(VOXEL_METRES.build));
    box.expandByPoint(new THREE.Vector3(...b.to).multiplyScalar(VOXEL_METRES.build));
  }
  if (box.isEmpty()) throw new Error('The review cottage has no occupied geometry.');
  return box;
}

/** Distance at which every corner of the model sits inside 86% of the frame along this view direction. */
function fitDistance(box: THREE.Box3, target: THREE.Vector3, direction: THREE.Vector3, vfov: number, hfov: number): number {
  const forward = direction.clone().negate(), right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  let distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).sub(target);
    const depth = -p.dot(forward);
    distance = Math.max(distance, depth + Math.abs(p.dot(right)) / Math.tan(hfov / 2 * 0.86), depth + Math.abs(p.dot(up)) / Math.tan(vfov / 2 * 0.86));
  }
  return distance;
}

/** Review adapter for the Forge piece families: composes the real definitions and renders them with production modules. */
export default function ForgeBench() {
  let host!: HTMLDivElement;
  let disposed = false;
  let dispose: (() => void) | undefined;
  const [status, setStatus] = createSignal('Laying out the pieces…');
  const [failed, setFailed] = createSignal(false);
  const [state, setState] = createSignal<ForgeBenchState>();
  const [sky, setSky] = createSignal('');

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomForge;
    delete window.__chatdomForgeError;
    void (async () => {
      const input = parseForgeBench(window.location.search);
      setState(input);
      const fixture = FORGE_REVIEW.find(f => f.familyId === input.family);
      if (!fixture) throw new Error(`${FAMILY_NAMES[input.family]} has no finished review cottage yet.`);
      const { blueprint } = composeForgeFixture(fixture, FORGE_PIECES, input.door);
      const grade = getEnvironment(input.hour);
      setSky(`linear-gradient(180deg, ${grade.zenith} 0%, ${grade.horizon} 78%, ${grade.fog} 100%)`);

      const pool = new VoxelWorkerPool({ size: 2 });
      const scene = new THREE.Scene();
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.debug.onShaderError = () => { throw new Error('Forge review shader compilation failed.'); };
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.domElement.setAttribute('aria-label', `${FAMILY_NAMES[input.family]} review cottage, ${input.view} view`);
      host.append(renderer.domElement);
      const material = createVoxelMaterial(MATERIALS, 'build');
      material.setEnvironment(grade);
      const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 400);
      const box = bounds(blueprint);
      const lights = input.view === 'window' ? createWindowLights(scene, [{ slot: 0, blueprint, position: [0, 0, 0], yaw: 0 }]) : undefined;
      if (lights) {
        lights.setFrame(KingdomPresenceFrameSchema.parse({ version: 1, kingdomId: '1', epoch: 'forge-review', sequence: 1, asOf: 1000, origin: 'simulated', streamLive: true, connection: 'fresh', windows: [{ slot: 0, present: input.presence === 'on', publicName: null, since: 0 }] }));
        lights.update(1, input.hour);
      }
      const geometries: THREE.BufferGeometry[] = [];
      dispose = () => {
        window.removeEventListener('resize', resize);
        pool.dispose(); geometries.forEach(g => g.dispose()); lights?.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove();
      };

      const aim = () => {
        const width = host.clientWidth, height = host.clientHeight, aspect = width / height;
        renderer.setSize(width, height);
        camera.aspect = aspect;
        const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
        let target: THREE.Vector3, direction: THREE.Vector3, distance: number;
        if (input.view === 'assembly') {
          // Front-left three-quarter view, so the authored dusk sun from the west lights the facade it reviews.
          target = box.getCenter(new THREE.Vector3());
          direction = new THREE.Vector3(-0.95, 0.62, 1.55).normalize();
          distance = fitDistance(box, target, direction, vfov, hfov);
        } else {
          const window0 = blueprint.windows[0];
          if (input.view === 'window' && !window0) throw new Error('Window review requires an authored window.');
          const focus = input.view === 'door' ? fixture.entrance : window0!.centre;
          const normal = input.view === 'door' ? NORMALS.south : NORMALS[window0!.facing];
          target = new THREE.Vector3(...focus).multiplyScalar(VOXEL_METRES.build);
          const side = new THREE.Vector3(-normal[2], 0, normal[0]);
          direction = new THREE.Vector3(...normal).addScaledVector(side, 0.32).add(new THREE.Vector3(0, input.view === 'door' ? 0.22 : 0.12, 0)).normalize();
          const half = input.view === 'door' ? 2.6 : 1.25;
          distance = half / Math.tan(Math.min(vfov, hfov) / 2);
        }
        camera.position.copy(target).addScaledVector(direction, distance);
        camera.lookAt(target);
        camera.updateProjectionMatrix();
      };
      const report = (triangles: number): ForgeBenchReport => ({
        ...input, model: blueprint.id, fingerprint: fingerprint(blueprint), instances: fixture.instances.length,
        pieceIds: [...new Set(fixture.instances.map(i => i.pieceId))], boxes: blueprint.boxes.length, windows: blueprint.windows.length,
        triangles, draws: renderer.info.render.calls, width: host.clientWidth, height: host.clientHeight,
      });
      let triangles = 0;
      const frame = () => {
        aim(); renderer.render(scene, camera); renderer.getContext().finish();
        window.__chatdomForge = report(triangles);
      };
      const resize = () => { window.__chatdomReady = false; frame(); window.__chatdomReady = true; };

      setStatus('Joining the pieces and finding their light…');
      const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
      if (disposed) return;
      if (result?.kind !== 'asset' || !result.chunks.length) throw new Error('The voxel worker did not return the cottage.');
      const geometry = geometryFromChunks(result.chunks, 'build');
      geometries.push(geometry);
      triangles = result.chunks.reduce((n, chunk) => n + chunk.mesh.indices.length / 3, 0);
      scene.add(new THREE.Mesh(geometry, material.material));
      aim();
      await renderer.compileAsync(scene, camera);
      if (disposed) return;
      renderer.render(scene, camera);
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      if (disposed) return;
      // Complete the GPU work before readiness so a capture sees the shaded pixels of this exact state.
      frame();
      window.addEventListener('resize', resize);
      host.dataset.family = input.family;
      host.dataset.view = input.view;
      setStatus('');
      window.__chatdomReady = true;
    })().catch(error => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      window.__chatdomForgeError = message;
      setStatus(message); setFailed(true);
      console.error(message);
    });
  });
  onCleanup(() => { disposed = true; dispose?.(); window.__chatdomReady = false; });

  const caption = () => {
    const s = state();
    if (!s) return '';
    const light = s.view === 'window' ? `Window presence preview ${s.presence.toUpperCase()}` : 'unoccupied review assembly';
    return `${s.view === 'window' ? 'window' : `door ${s.door}`} · ${String(s.hour).padStart(2, '0')}:00 · ${light}`;
  };
  return <section class="forge-bench" style={{ background: sky() || undefined }}>
    <div ref={element => { host = element; }} class="forge-bench-stage" />
    <header>
      <span>CHATDOM · FORGE WORKSHOP</span>
      <strong>{state() ? `${FAMILY_NAMES[state()!.family]} cottage · ${state()!.view}` : 'Forge pieces'}</strong>
      <small>{caption()}</small>
    </header>
    {status() && <div class="forge-bench-status" role={failed() ? 'alert' : 'status'}><strong>{failed() ? 'The cottage could not be shown' : 'At the joiner’s bench'}</strong><p>{status()}</p></div>}
  </section>;
}
