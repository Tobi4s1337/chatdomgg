import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { createNativeForgeHost } from '@chatdom/forge';
import { generateSettlementPlan } from '@chatdom/world';
import { homeThreshold } from '@chatdom/world/interactions';
import { starterLookRecipe } from '../../../../packages/content/src/avatar-style';
import { citizenObject } from './portrait-renderer';
import { mirrorView, wardrobeObject, wardrobeSpot } from './wardrobe';

/*
 * The wardrobe's dev bench (dev server and the stills script only; no route reaches it). One native home of a
 * founded hamlet, voxelised into its own collision world, the real wardrobe placement in it, and a citizen standing at
 * the press: `?view=mirror` through the mirror's camera, `?view=room` from behind you, `?home=<n>` picks the home.
 * The kingdom draws homes with its own voxel renderer; this draws the same blueprint as plain shaded cells.
 */
declare global { interface Window { __chatdomReady?: boolean } }
const params = new URLSearchParams(location.search);
const view = params.get('view') === 'room' ? 'room' : 'mirror';
const plan = generateSettlementPlan({ seed: 'wardrobe-bench', tier: 'hamlet', firstYear: 2026, year: 2026 });
const plot = plan.homes[Math.max(0, Math.min(plan.homes.length - 1, Number(params.get('home') ?? 0) || 0))]!;
const blueprint = createNativeForgeHost(plot).blueprint;

/** The blueprint as cells, its boxes applied in order (air carves). */
function voxelise(b: Pick<VoxelBlueprint, 'size' | 'boxes'>) {
  const [sx, sy, sz] = b.size, cells = new Uint8Array(sx * sy * sz), at = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  for (const box of b.boxes) for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++)
    for (let x = box.from[0]; x < box.to[0]; x++) cells[at(x, y, z)] = box.material;
  return { size: [sx, sy, sz] as const, get: (x: number, y: number, z: number) => x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : cells[at(x, y, z)]! };
}
const grid = voxelise(blueprint), cell = VOXEL_METRES.build;
const ground: SolidBox = { min: [-40, -1, -40], max: [40, 0, 40] };
const world: CollisionWorld = { revision: 1, query(bounds) {
  const out: SolidBox[] = bounds.min[1] < 0 && bounds.max[1] > -1 ? [ground] : [];
  const lo = bounds.min.map(v => Math.floor(v / cell)), hi = bounds.max.map(v => Math.ceil(v / cell));
  for (let z = lo[2]!; z < hi[2]!; z++) for (let y = Math.max(0, lo[1]!); y < hi[1]!; y++) for (let x = lo[0]!; x < hi[0]!; x++) {
    const m = grid.get(x, y, z);
    if (m && MATERIALS.materials[m]?.solid) out.push({ min: [x * cell, y * cell, z * cell], max: [(x + 1) * cell, (y + 1) * cell, (z + 1) * cell] });
  }
  return out;
} };

const threshold = homeThreshold({ plotId: plot.id, revision: 'bench', blueprint, position: [0, 0, 0], rotation: 0 }, world);
const anchor = threshold.placement?.anchors[0];
if (!threshold.interior || !anchor?.rest) throw new Error(`This home has no way in (${threshold.blocked})`);
const spot = wardrobeSpot({ plotId: plot.id, interior: threshold.interior, door: anchor.position, inside: anchor.rest, world });
if (!spot) throw new Error('No wall in this home takes the wardrobe');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d1626);

// The home: exposed cell faces, coloured by material, a touch darker toward each face's foot.
{
  const positions: number[] = [], normals: number[] = [], colours: number[] = [];
  const c = new THREE.Color();
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  const [sx, sy, sz] = grid.size;
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const m = grid.get(x, y, z);
    if (!m) continue;
    for (const [dx, dy, dz] of dirs) {
      if (grid.get(x + dx, y + dy, z + dz)) continue;
      c.set(MATERIALS.materials[m]?.colour ?? '#888888').convertSRGBToLinear().multiplyScalar(dy > 0 ? 1.05 : dy < 0 ? .6 : .9 + ((x * 7 + y * 13 + z * 5) % 5) * .02);
      const ax = dx ? 0 : dy ? 1 : 2, u = (ax + 1) % 3, v = (ax + 2) % 3, base = [x, y, z];
      const quad: number[][] = [];
      for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
        const p = [...base]; p[ax]! += (dx + dy + dz) > 0 ? 1 : 0; p[u]! += a; p[v]! += b; quad.push(p);
      }
      const order = (dx + dy + dz) > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const i of order) { positions.push(...quad[i]!.map(n => n * cell)); normals.push(dx, dy, dz); colours.push(c.r, c.g, c.b); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92 }));
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x3f4a2c, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);
}
scene.add(wardrobeObject(spot));

// You, standing at the press and facing it.
const stand: Vec3 = [spot.base[0] + spot.normal[0] * .85, spot.base[1], spot.base[2] + spot.normal[1] * .85];
const you = citizenObject(starterLookRecipe('tide')!);
you.scale.setScalar(1 / 16);
you.position.set(...stand);
you.rotation.y = Math.atan2(-spot.normal[0], -spot.normal[1]);
scene.add(you);

// Dusk through the windows, a warm lamp in the room.
scene.add(new THREE.HemisphereLight(0xb9a9d8, 0x3a2a20, .9));
const sun = new THREE.DirectionalLight(0xffc89a, 1.4);
sun.position.set(stand[0] + 8, 14, stand[2] + 6); sun.target.position.set(...stand); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun, sun.target);
const lamp = new THREE.PointLight(0xffb066, 7, 7, 1.6);
lamp.position.set(spot.base[0] + spot.normal[0] * .55, stand[1] + 2.05, spot.base[2] + spot.normal[1] * .55);
scene.add(lamp);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .05, 200);
if (view === 'mirror') {
  const v = mirrorView(spot, stand);
  camera.position.set(...v.eye); camera.lookAt(...v.target);
  camera.fov = v.fov; camera.updateProjectionMatrix();
  scene.getObjectByName('home-wardrobe')!.visible = false;
  // The room's light falling on you from the glass's side, as the kingdom's interior light would.
  const fill = new THREE.PointLight(0xffd2a0, 4, 5, 1.4);
  fill.position.set(v.eye[0] + spot.normal[0] * .3, v.eye[1] + .4, v.eye[2] + spot.normal[1] * .3);
  scene.add(fill);
} else {
  camera.position.set(stand[0] + spot.normal[0] * 1.9, stand[1] + 1.75, stand[2] + spot.normal[1] * 1.9);
  camera.lookAt(spot.base[0], spot.base[1] + 1.1, spot.base[2]);
}
renderer.render(scene, camera);
requestAnimationFrame(() => { renderer.render(scene, camera); window.__chatdomReady = true; });
