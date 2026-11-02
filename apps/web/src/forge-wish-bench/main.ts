import * as THREE from 'three';
import { createHome, MATERIALS, MAT, STYLES, type StyleKey } from '@chatdom/content';
import { assembleForge, checkForge, createNativeForgeHost, findForgeSockets, forgeStyleKit } from '@chatdom/forge';
import { createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VOXEL_METRES, type HousePartPlan, type VoxelBlueprint } from '@chatdom/shared';
import { rasterizeBlueprint, VoxelWorkerPool } from '@chatdom/voxel';

type WishWindow = Window & { __chatdomReady?: boolean; __chatdomForgeWishError?: string; __chatdomForgeWish?: unknown };
const state = window as WishWindow;
state.__chatdomReady = false;
const params = new URLSearchParams(location.search);
const style = params.get('style') ?? 'hearth';
const view = params.get('view') ?? 'home';
const motif = params.get('motif') ?? 'crescent-moon';
const hour = Number(params.get('hour') ?? '19');
const kitRevision = Number(params.get('kit') ?? '1');
const kinds = { 'sleeping-dragon': 'chimney', 'crescent-moon': 'lantern', 'watchful-owl': 'weathervane', 'sleeping-fox': 'chimney', sunflower: 'lantern', 'scallop-shell': 'weathervane', 'shooting-star': 'lantern' } as const;
const host = document.querySelector<HTMLElement>('#scene')!;
const cell = VOXEL_METRES.build;

async function main() {
  if (!['hearth', 'tide', 'grove'].includes(style) || !['home', 'piece'].includes(view) || !Object.hasOwn(kinds, motif) || !Number.isFinite(hour) || hour < 0 || hour > 23 || ![1, 2].includes(kitRevision)) throw new Error('Invalid forge review parameters.');
  const family = style as StyleKey, selected = motif as keyof typeof kinds, kind = kinds[selected];
  const home = params.get('host') === 'core' ? createHome('house', family, 0)
    : createNativeForgeHost({ slot: 0, position: [0, 0, 0], rotation: 0, tier: 'house', style: family, variant: 0 }).blueprint;
  const kit = forgeStyleKit(family, kitRevision);
  const socket = findForgeSockets(home, 'street-home', kit.revision).find(candidate => candidate.kind === kind);
  if (!socket) throw new Error('This home has no matching socket.');
  const plan: HousePartPlan = { version: 2, kind, motif: selected, finish: 'native', accent: 'none' };
  const part = assembleForge(plan, kit, socket);
  checkForge(part, home);
  const grade = getEnvironment(hour);
  host.style.background = `linear-gradient(180deg, ${grade.zenith} 0%, ${grade.horizon} 78%, ${grade.fog} 100%)`;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = () => { throw new Error('Forge review shader compilation failed.'); };
  renderer.setPixelRatio(1); renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  host.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .05, 400);
  const material = createVoxelMaterial(MATERIALS, 'build'); material.setEnvironment(grade);
  const pool = new VoxelWorkerPool({ size: 2 });
  const ground: VoxelBlueprint = { version: 1, id: 'forge-wish-review-ground', styleId: STYLES[family].id, kind: 'prop', lattice: 'build', size: [256, 2, 256], boxes: [
    { from: [0, 0, 0], to: [256, 1, 256], material: MAT.earth },
    { from: [0, 1, 0], to: [256, 2, 256], material: MAT.grass },
  ], windows: [] };
  const mesh = async (blueprint: VoxelBlueprint, revision: number) => {
    const out = await pool.submit({ kind: 'blueprint', blueprint, revision, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (out?.kind !== 'asset' || !out.chunks.length) throw new Error(`Could not mesh ${blueprint.id}.`);
    const geometry = geometryFromChunks(out.chunks, 'build');
    // Packed voxel vertices have no Three.js `position` attribute; derive exact
    // occupied bounds from the ordered raster instead of computeBoundingBox().
    const asset = rasterizeBlueprint(blueprint), bounds = new THREE.Box3();
    for (let z = 0; z < asset.size[2]; z++) for (let y = 0; y < asset.size[1]; y++) for (let x = 0; x < asset.size[0]; x++) {
      if (!asset.voxels[x + asset.size[0] * (y + asset.size[1] * z)]) continue;
      bounds.expandByPoint(new THREE.Vector3(x, y, z).multiplyScalar(cell));
      bounds.expandByPoint(new THREE.Vector3(x + 1, y + 1, z + 1).multiplyScalar(cell));
    }
    if (bounds.isEmpty()) throw new Error(`No occupied cells in ${blueprint.id}.`);
    geometry.boundingBox = bounds;
    geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
    return new THREE.Mesh(geometry, material.material);
  };
  const [houseMesh, partMesh, groundMesh] = await Promise.all([mesh(home, 1), mesh(part.blueprint, 2), mesh(ground, 3)]);
  const houseBox = houseMesh.geometry.boundingBox!.clone();
  const pieceBox = partMesh.geometry.boundingBox!.clone();
  if (houseBox.isEmpty() || pieceBox.isEmpty()) throw new Error('Empty forge review geometry.');
  groundMesh.position.set(-12, -2 * cell, -8); scene.add(groundMesh);
  if (view === 'home') { scene.add(houseMesh); partMesh.position.set(...socket.origin).multiplyScalar(cell); }
  else { partMesh.position.set(-pieceBox.min.x, -pieceBox.min.y, -pieceBox.min.z); }
  scene.add(partMesh);
  const target = view === 'home' ? houseBox.getCenter(new THREE.Vector3()) : pieceBox.getCenter(new THREE.Vector3()).add(partMesh.position);
  function aim() {
    const width = host.clientWidth, height = host.clientHeight, aspect = width / height;
    renderer.setSize(width, height, false); camera.aspect = aspect;
    if (view === 'home') {
      // Twelve horizontal metres from the real front facade, looking toward its centre.
      camera.position.set(target.x, Math.max(3, target.y), houseBox.max.z + 12);
      const horizontalFov = 2 * Math.atan((houseBox.max.x - houseBox.min.x) * .62 / 12);
      const verticalFov = 2 * Math.atan((houseBox.max.y - houseBox.min.y) * .62 / 12);
      camera.fov = THREE.MathUtils.radToDeg(Math.max(THREE.MathUtils.degToRad(35), verticalFov, 2 * Math.atan(Math.tan(horizontalFov / 2) / aspect)));
    } else {
      const size = pieceBox.getSize(new THREE.Vector3());
      const half = Math.max(size.x, size.y, size.z) * .75;
      camera.fov = 35;
      const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
      const distance = Math.max(half / Math.tan(vfov / 2), half / Math.tan(hfov / 2));
      camera.position.copy(target).addScaledVector(new THREE.Vector3(-.35, .25, 1).normalize(), distance);
    }
    camera.lookAt(target); camera.updateProjectionMatrix();
  }
  aim();
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  await new Promise<void>(resolve => requestAnimationFrame(() => { renderer.render(scene, camera); renderer.getContext().finish(); resolve(); }));
  state.__chatdomForgeWish = { style, view, motif, kind, hour, kitRevision, home: home.id, piece: part.blueprint.id, socket: socket.id, origin: socket.origin,
    homeBounds: { min: houseBox.min.toArray(), max: houseBox.max.toArray() }, pieceBounds: { min: pieceBox.min.toArray(), max: pieceBox.max.toArray() },
    horizontalFromFacade: view === 'home' ? 12 : null, width: host.clientWidth, height: host.clientHeight };
  state.__chatdomReady = true;
  window.addEventListener('resize', () => { aim(); renderer.render(scene, camera); });
}
void main().catch((error: unknown) => { state.__chatdomForgeWishError = error instanceof Error ? error.message : String(error); console.error(error); });
