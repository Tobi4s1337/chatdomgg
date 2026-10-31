import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import type { Vec3 } from '@chatdom/shared';
import type { SolidBox } from '@chatdom/shared/realm';
import { createCitizenRenderer, createDefaultCitizenLooks, type CitizenSample } from '../../citizens';
import { ANVIL_IRON, ANVIL_STUMP, FIRE_STONES, LOGS } from './court';

/**
 * The SIMULATED court drawn at night: a fire ring with four logs and an anvil on a stump. Every collision box in
 * `court.ts` is drawn where it collides; the rest (flames, tiles, trees) is dressing with no collision.
 */
export interface BenchStage {
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  /** Draw one frame looking along `yaw` from behind `feet`. */
  frame(input: { readonly now: number; readonly feet: Vec3; readonly yaw: number; readonly people: readonly CitizenSample[] }): void;
  /** CSS px of a world point, or null when it is behind the camera. */
  project(point: Vec3): { readonly x: number; readonly y: number } | null;
  /** Camera view direction in world space. */
  forward(): Vec3;
  resize(): void;
  dispose(): void;
}

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: .92, ...extra });

export async function createBenchStage(host: HTMLElement, options: { readonly reducedMotion: boolean }): Promise<BenchStage> {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.domElement.className = 'ix-bench-canvas';
  renderer.domElement.setAttribute('aria-label', 'A simulated fire court at night with four logs and an anvil');
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const night = new THREE.Color('#141a2c');
  scene.background = night;
  scene.fog = new THREE.Fog(night, 9, 24);
  const camera = new THREE.PerspectiveCamera(46, 1, .1, 80);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(thing: T) => { disposables.push(thing); return thing; };

  scene.add(new THREE.HemisphereLight(0x6f7fb0, 0x2a1d16, 1.5));
  const moon = new THREE.DirectionalLight(0xa9bbe6, 1.1); moon.position.set(-6, 12, -8); scene.add(moon);
  const fireLight = new THREE.PointLight(0xff9a48, 9, 9, 1.7); fireLight.position.set(0, 1.0, 0); scene.add(fireLight);

  const unit = keep(new THREE.BoxGeometry(1, 1, 1));
  const solid = (b: SolidBox, material: THREE.Material) => {
    const mesh = new THREE.Mesh(unit, material);
    mesh.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    scene.add(mesh); return mesh;
  };
  const cube = (x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material) =>
    solid({ min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2] }, material);

  // Ground: half-metre tiles, trodden earth near the fire, grass beyond.
  const tile = keep(new THREE.BoxGeometry(.5, .06, .5));
  const tileMaterial = keep(mat('#ffffff'));
  const tiles = new THREE.InstancedMesh(tile, tileMaterial, 48 * 48);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const earth = ['#4f3f31', '#544335', '#4b3b2e', '#574638'], grass = ['#2f3f29', '#33442c', '#2d3c27', '#36472f'];
  let n = 0;
  for (let i = -24; i < 24; i++) for (let j = -24; j < 24; j++) {
    const x = i * .5 + .25, z = j * .5 + .25, r = Math.hypot(x, z * .9);
    const hash = Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1;
    const trodden = r < 3.1 + hash * .6;
    m.makeTranslation(x, -.03 - hash * .015, z); tiles.setMatrixAt(n, m);
    tiles.setColorAt(n, c.set((trodden ? earth : grass)[Math.floor(hash * 4)]!)); n++;
  }
  scene.add(tiles);

  // Fire: stone ring (the collision box is the ring's footprint), a charcoal bed and stacked flames.
  const stone = ['#77736d', '#6b6862', '#858077', '#625f5a'].map(colour => keep(mat(colour)));
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * Math.PI * 2, r = .43;
    const s = cube(Math.cos(a) * r, 0, Math.sin(a) * r, .24, .2 + (k % 3) * .05, .22, stone[k % 4]!);
    s.rotation.y = -a;
  }
  void FIRE_STONES;
  cube(0, 0, 0, .56, .1, .56, keep(mat('#231915', { emissive: '#4a1606', emissiveIntensity: .8 })));
  const flameMaterials = ['#ffcf6a', '#ff9a3a', '#f0662a'].map(colour => keep(new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: .92, fog: false })));
  const flames: { mesh: THREE.Mesh; base: number; phase: number }[] = [];
  const flameSpec: readonly (readonly [number, number, number, number, number])[] = [
    [0, .1, 0, .3, 2], [.08, .3, -.05, .2, 1], [-.07, .27, .06, .2, 1], [0, .48, .02, .14, 0], [.05, .62, -.02, .08, 0], [-.12, .14, -.1, .14, 2], [.13, .12, .1, .13, 2],
  ];
  for (const [x, y, z, s, tone] of flameSpec) {
    const mesh = cube(x, y, z, s, s, s, flameMaterials[tone]!);
    flames.push({ mesh, base: y, phase: x * 13 + z * 7 });
  }
  for (const log of [[-.12, .1, .05, -.6], [.12, .1, -.05, .7]] as const) {
    const fuel = cube(log[0], log[1] - .02, log[2], .62, .1, .1, keep(mat('#2c1d14', { emissive: '#5c1e08', emissiveIntensity: .7 })));
    fuel.rotation.y = log[3];
  }

  // Logs: faceted bark round, pale end grain, lying exactly in their collision boxes (tops at seat height).
  const bark = keep(mat('#4a3020')), grain = keep(mat('#b48d5e')), barkDark = keep(mat('#3a2518'));
  for (const b of Object.values(LOGS)) {
    const alongX = b.max[0] - b.min[0] > b.max[2] - b.min[2];
    const length = alongX ? b.max[0] - b.min[0] : b.max[2] - b.min[2], radius = (b.max[1] - b.min[1]) / 2;
    const log = new THREE.Mesh(keep(new THREE.CylinderGeometry(radius, radius * 1.04, length, 9)), [bark, grain, grain]);
    log.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
    log.position.set((b.min[0] + b.max[0]) / 2, radius, (b.min[2] + b.max[2]) / 2);
    scene.add(log);
    // Two bark seams so the round reads as wood, not a pipe.
    for (const offset of [-.3, .22]) {
      const seam = new THREE.Mesh(keep(new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, .05, 9)), barkDark);
      seam.rotation.copy(log.rotation);
      seam.position.set(log.position.x + (alongX ? offset * length : 0), radius, log.position.z + (alongX ? 0 : offset * length));
      scene.add(seam);
    }
  }

  // Anvil on its stump: drawn inside the collision hull, with horn, waist and foot.
  solid(ANVIL_STUMP, keep(mat('#6b4a2e')));
  solid({ min: [ANVIL_STUMP.min[0] + .04, ANVIL_STUMP.max[1] - .01, ANVIL_STUMP.min[2] + .04], max: [ANVIL_STUMP.max[0] - .04, ANVIL_STUMP.max[1] + .005, ANVIL_STUMP.max[2] - .04] }, keep(mat('#a17a50')));
  const iron = keep(mat('#3c3f46', { metalness: .65, roughness: .42 })), face = keep(mat('#8d929b', { metalness: .8, roughness: .3 }));
  const [ax0, ay0, az0] = ANVIL_IRON.min, [ax1, ay1, az1] = ANVIL_IRON.max, mz = (az0 + az1) / 2;
  solid({ min: [ax0 + .14, ay0, az0 + .02], max: [ax1 - .1, ay0 + .08, az1 - .02] }, iron);
  solid({ min: [ax0 + .22, ay0 + .08, mz - .07], max: [ax1 - .2, ay0 + .26, mz + .07] }, iron);
  solid({ min: [ax0 + .14, ay0 + .26, az0], max: [ax1, ay1 - .02, az1] }, iron);
  solid({ min: [ax0 + .16, ay1 - .02, az0 + .02], max: [ax1 - .02, ay1, az1 - .02] }, face);
  solid({ min: [ax0, ay0 + .3, mz - .07], max: [ax0 + .14, ay1 - .04, mz + .07] }, iron);
  solid({ min: [ax0 - .06, ay0 + .32, mz - .04], max: [ax0, ay1 - .07, mz + .04] }, iron);

  // Dressing beyond the court: a few voxel trees and a low dry-stone arc, so the fire sits somewhere.
  const trunk = keep(mat('#4a3526')), leaves = ['#30472a', '#38532f', '#2a3f25'].map(colour => keep(mat(colour)));
  const trees: readonly (readonly [number, number, number])[] = [[-6.5, -4.5, 1.1], [-7.5, 2.5, 1.3], [6.8, -5.2, 1.2], [-3.5, -8, 1], [4.5, -8.5, 1.4], [8.5, 1.5, 1], [-9, -1.2, .9]];
  for (const [x, z, s] of trees) {
    cube(x, 0, z, .35 * s, 1.6 * s, .35 * s, trunk);
    cube(x, 1.3 * s, z, 1.6 * s, 1.1 * s, 1.6 * s, leaves[0]!);
    cube(x + .2, 2.2 * s, z - .1, 1.1 * s, .9 * s, 1.1 * s, leaves[1]!);
    cube(x - .15, 2.9 * s, z + .05, .6 * s, .6 * s, .6 * s, leaves[2]!);
  }
  const rocks: readonly (readonly [number, number, number])[] = [[-4.6, 3.2, .5], [-3.9, 3.9, .32], [4.9, -2.6, .44], [5.6, -1.9, .3], [-5.2, -2.8, .38], [1.4, -5.1, .5], [2.1, -5.5, .3]];
  for (const [x, z, s] of rocks) { const rock = cube(x, 0, z, s * 1.5, s, s * 1.2, stone[Math.round(x * 3 + z) & 3]!); rock.rotation.y = x * z; }

  // People: the real citizen renderer and the default looks.
  const environment = getEnvironment(19.5);
  const avatar = createVoxelMaterial(MATERIALS, 'avatar');
  avatar.setEnvironment(environment);
  avatar.material.fragmentShader = avatar.material.fragmentShader.replace('vec3 colour=base*edge*light*ao;', 'vec3 colour=base*edge*(light*.62+vec3(.5,.34,.22))*ao;');
  const looks = createDefaultCitizenLooks();
  const citizens = await createCitizenRenderer(scene, { registry: MATERIALS, material: avatar, looks, capacity: 8 });
  const shadowGeometry = keep(new THREE.CircleGeometry(.32, 20)); shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMaterial = keep(new THREE.MeshBasicMaterial({ color: '#0d0a08', transparent: true, opacity: .34, depthWrite: false }));
  const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, 8); shadows.frustumCulled = false; scene.add(shadows);

  let portrait = false;
  const resize = () => {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    portrait = width / height < 1;
    camera.aspect = width / height; camera.fov = portrait ? 62 : 46; camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  resize();

  const view = new THREE.Vector3();
  return {
    camera, canvas: renderer.domElement,
    frame({ now, feet, yaw, people }) {
      const t = now / 1000;
      for (const flame of flames) {
        const k = options.reducedMotion ? 0 : Math.sin(t * 7.3 + flame.phase) * .5 + Math.sin(t * 11.1 + flame.phase * 2) * .5;
        flame.mesh.position.y = flame.base + flame.mesh.scale.y / 2 + (options.reducedMotion ? 0 : k * .025);
        flame.mesh.rotation.y = options.reducedMotion ? 0 : t * .8 + flame.phase;
      }
      fireLight.intensity = options.reducedMotion ? 9 : 8.6 + Math.sin(t * 9.1) * .7 + Math.sin(t * 13.7) * .5;
      const distance = portrait ? 3.7 : 3, height = portrait ? 3 : 2.5, shoulder = portrait ? 1.05 : 1.35;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      // Wide over the right shoulder, so a log at arm's length stands clear of your own body. The kingdom uses walk-camera.
      camera.position.set(feet[0] - fx * distance - fz * shoulder, feet[1] + height, feet[2] - fz * distance + fx * shoulder);
      camera.lookAt(feet[0] + fx * 2, feet[1] + .35, feet[2] + fz * 2);
      citizens.update(people, camera);
      shadows.count = 0;
      for (const p of people) { m.makeTranslation(p.position[0], .012, p.position[2]); shadows.setMatrixAt(shadows.count++, m); }
      shadows.instanceMatrix.needsUpdate = true;
      renderer.render(scene, camera);
    },
    project(point) {
      view.set(point[0], point[1], point[2]).project(camera);
      if (view.z < -1 || view.z > 1) return null;
      return { x: (view.x + 1) / 2 * host.clientWidth, y: (1 - view.y) / 2 * host.clientHeight };
    },
    forward() { camera.getWorldDirection(view); return [view.x, view.y, view.z]; },
    resize,
    dispose() {
      citizens.dispose(); avatar.dispose(); tiles.dispose(); shadows.dispose();
      for (const thing of disposables) thing.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
