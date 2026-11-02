import * as THREE from 'three';
import { mountTavern } from './mount';
import { createFire } from '../campfire/fire';
import type { Vec3 } from '@chatdom/shared';

export type TavernFraming = 'bar' | 'room' | 'table';
/** Owned destination stage. The same room mount is composed into the portal surface. */
export function createTavernStage(host: HTMLElement, options: { framing: TavernFraming; style: 'hearth' | 'tide'; hour: number; still: boolean }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute('role', 'img'); renderer.domElement.setAttribute('aria-label', 'The tavern, its hearth and game tables');
  renderer.debug.onShaderError = () => { throw new Error('The tavern shader could not be prepared.'); };
  host.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, .05, 250);
  scene.background = new THREE.Color('#2e2939');
  const phone = host.clientWidth < 600;
  const tavern = mountTavern(scene, { style: options.style, phone });
  scene.add(new THREE.HemisphereLight('#e0c19a', '#5e382a', 2));
  const fire = createFire(); fire.group.position.set(...tavern.kit.hearth); fire.group.scale.setScalar(.75); scene.add(fire.group);
  const frames = new Set<(dt: number, now: number) => void>(), resizes = new Set<(width: number, height: number) => void>();
  let feet: (() => Vec3 | null) | undefined;
  let framing = options.framing, width = 1, height = 1, frame = 0, previous = 0, disposed = false;
  let roomDraws = 0;
  // Count submitted room draws, including zero-instance suppression and camera culling, separately
  // from the shared citizen renderer. These callbacks observe renderer counters; they add no render pass.
  const observeRoomDraws = (group: THREE.Object3D) => group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const before = object.onBeforeRender, after = object.onAfterRender;
    let calls = 0;
    object.onBeforeRender = function (...args) { before.apply(this, args); calls = renderer.info.render.calls; };
    object.onAfterRender = function (...args) { roomDraws += renderer.info.render.calls - calls; after.apply(this, args); };
  });
  function placeCamera() {
    const portrait = width < height;
    camera.aspect = width / height;
    if (framing === 'bar') {
      camera.fov = portrait ? 64 : 50;
      camera.position.set(3.2, 2.8, 7.2); camera.lookAt(8, 1.1, 2);
    } else if (framing === 'room') {
      camera.fov = portrait ? 64 : 48;
      if (portrait) { camera.position.set(7.8, 3.05, 8.8); camera.lookAt(8.8, 1.25, 3.6); }
      else { camera.position.set(8.5, 8.7, 14.8); camera.lookAt(7, .7, 4.5); }
    } else {
      const table = tavern.kit.tables.find(t => t.id === 'west')!;
      camera.fov = portrait ? 51 : 35;
      camera.position.set(table.centre[0] + (portrait ? .65 : 1.25), table.centre[1] + (portrait ? 2.8 : 2.5), table.centre[2] + (portrait ? 3.1 : 2.6));
      camera.lookAt(table.centre[0] + (portrait ? 0 : .35), table.centre[1] + (portrait ? .2 : .45), table.centre[2]);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function draw(at: number) {
    if (disposed) return;
    const dt = previous ? Math.min(.1, (at - previous) / 1000) : .016; previous = at;
    const time = options.still ? 3.5 : at / 1000;
    for (const listener of frames) listener(dt, at);
    tavern.update(options.still ? .1 : dt, feet ? feet() : [7, .125, 5], camera, options.hour);
    fire.update(time, { strength: 1, wind: .02 });
    roomDraws = 0; renderer.render(scene, camera);
    (window as Window & { __chatdomTavern?: unknown }).__chatdomTavern = {
      draws: renderer.info.render.calls, triangles: renderer.info.render.triangles, dynamicLights: 1,
      roomDraws, citizenDraws: renderer.info.render.calls - roomDraws, bakedWarmSources: 4,
    };
    frame = requestAnimationFrame(draw);
  }
  const resize = () => {
    width = host.clientWidth; height = host.clientHeight; renderer.setSize(width, height);
    if (feet) { camera.aspect = width / height; camera.updateProjectionMatrix(); } else placeCamera();
    for (const listener of resizes) listener(width, height);
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  const ready = tavern.ready.then(() => {
    if (disposed) return;
    observeRoomDraws(scene.getObjectByName('gather:tavern')!); observeRoomDraws(fire.group);
    // Settle the cutaway before marking the first meaningful frame ready.
    for (let i = 0; i < 12; i++) tavern.update(.1, [7, .125, 5], camera, options.hour);
    draw(0);
  });
  return { ready, tavern, renderer, scene, camera, canvas: renderer.domElement,
    onFrame(listener: (dt: number, now: number) => void) { frames.add(listener); return () => frames.delete(listener); },
    onResize(listener: (w: number, h: number) => void) { resizes.add(listener); listener(width, height); return () => resizes.delete(listener); },
    localFeet(source: () => Vec3 | null) { feet = source; return () => { if (feet === source) feet = undefined; }; },
    framing(next: TavernFraming) { framing = next; placeCamera(); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); frames.clear(); resizes.clear(); tavern.dispose(); fire.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
