import * as THREE from 'three';
import { createHome, MAT, MATERIALS, STYLES, type StyleKey } from '@chatdom/content';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit, forgeTitle, planLocalForge } from '@chatdom/forge';
import { createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VOXEL_METRES, type VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createForgeRitualView } from '../forge/ritual-view';
import { BENCH_WISHES, type BenchPart } from './params';

const CELL = VOXEL_METRES.build;
/** World layout: the home at the origin facing +z; the anvil stands out in a paved yard in front and to its right. */
const ANVIL_GROUND = new THREE.Vector3(16, 0, 22), HOME_YAW = 0;
/** Main's anvil stage: the top of its iron face sits 1.45 m above the ground. */
const WORK_SURFACE = 1.45;
const YARD = { origin: new THREE.Vector3(-4, -2 * CELL, 4), size: 256 };
/** Plain meadow tiles around the yard push the ground's edge out to the horizon. */
const MEADOW = 2;

function yard(styleId: VoxelBlueprint['styleId'], paved: boolean): VoxelBlueprint {
  const n = YARD.size, boxes: VoxelBlueprint['boxes'] = [
    { from: [0, 0, 0], to: [n, 1, n], material: MAT.earth },
    { from: [0, 1, 0], to: [n, 2, n], material: MAT.grass },
  ];
  // A worn paved circle around the anvil, one row of build cells at a time.
  const cx = Math.round((ANVIL_GROUND.x - YARD.origin.x) / CELL), cz = Math.round((ANVIL_GROUND.z - YARD.origin.z) / CELL);
  for (const [radius, material] of paved ? [[22, MAT.darkStone], [20, MAT.paving]] as const : []) {
    for (let dz = -radius; dz < radius; dz++) {
      const half = Math.floor(Math.sqrt(radius * radius - (dz + .5) ** 2));
      if (half > 0) boxes.push({ from: [cx - half, 1, cz + dz], to: [cx + half, 2, cz + dz + 1], material });
    }
  }
  return { version: 1, id: paved ? 'forge-ritual-yard' : 'forge-ritual-meadow', styleId, kind: 'prop', lattice: 'build', size: [n, 2, n], boxes, windows: [] };
}

export interface RitualWorld {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; effects: THREE.Group;
  piece: THREE.Mesh; anvil: [number, number, number]; landing: [number, number, number];
  title: string; triangles: number; sky: string;
  aim(width: number, height: number): void;
  dispose(): void;
}

/** Real production pieces: a native home, main's grammar and assembly, worker meshing and main's anvil. */
export async function createRitualWorld(host: HTMLElement, part: BenchPart, family: StyleKey, hour: number, alive: () => boolean): Promise<RitualWorld | null> {
  const home = createHome('house', family, 0);
  const plan = planLocalForge(BENCH_WISHES[part]);
  const socket = findForgeSockets(home).find(s => s.kind === plan.kind);
  if (!socket) throw new Error(`This home has no clear ${plan.kind} socket.`);
  const result = assembleForge(plan, forgeStyleKit(family), socket);
  checkForge(result, home);

  const grade = getEnvironment(hour);
  const pool = new VoxelWorkerPool({ size: 2 });
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = () => { throw new Error('Forge ritual shader compilation failed.'); };
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  host.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .05, 400);
  const material = createVoxelMaterial(MATERIALS, 'build');
  material.setEnvironment(grade);
  const geometries: THREE.BufferGeometry[] = [];
  const stage = createForgeRitualView(scene, material);
  stage.root.position.copy(ANVIL_GROUND); stage.update(null);
  const effects = new THREE.Group(); effects.name = 'forge-ritual-effects'; scene.add(effects);
  const dispose = () => { pool.dispose(); geometries.forEach(g => g.dispose()); stage.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  try {
    const mesh = async (blueprint: VoxelBlueprint, revision: number) => {
      const out = await pool.submit({ kind: 'blueprint', blueprint, revision, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
      if (out?.kind !== 'asset' || !out.chunks.length) throw new Error(`The voxel worker did not return ${blueprint.id}.`);
      const geometry = geometryFromChunks(out.chunks, 'build'); geometries.push(geometry);
      return { geometry, triangles: out.chunks.reduce((n, c) => n + c.mesh.indices.length / 3, 0) };
    };
    const [ground, meadow, house, forged] = await Promise.all([mesh(yard(STYLES[family].id, true), 1), mesh(yard(STYLES[family].id, false), 2), mesh(home, 3), mesh(result.blueprint, 4)]);
    if (!alive()) { dispose(); return null; }
    for (let x = -MEADOW; x <= MEADOW; x++) for (let z = -MEADOW; z <= MEADOW; z++) {
      const tile = new THREE.Mesh(x || z ? meadow.geometry : ground.geometry, material.material);
      tile.position.copy(YARD.origin).add(new THREE.Vector3(x, 0, z).multiplyScalar(YARD.size * CELL)); scene.add(tile);
    }
    const houseMesh = new THREE.Mesh(house.geometry, material.material); houseMesh.rotation.y = HOME_YAW; scene.add(houseMesh);
    // The host's presentation clone, posed at its validated socket like the kingdom poses an arriving part.
    const piece = new THREE.Mesh(forged.geometry, material.material);
    piece.name = 'forge-presentation-clone';
    piece.position.set(...socket.origin).multiplyScalar(CELL).applyAxisAngle(new THREE.Vector3(0, 1, 0), HOME_YAW);
    piece.rotation.y = HOME_YAW; piece.frustumCulled = false; scene.add(piece); piece.updateMatrixWorld(true);
    const size = new THREE.Vector3(...result.blueprint.size).multiplyScalar(CELL);
    const anvil = ANVIL_GROUND.clone().add(new THREE.Vector3(0, WORK_SURFACE, 0));

    const aim = (width: number, height: number) => {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const portrait = width / height < .8;
      const reach = Math.max(1.9, Math.max(size.x, size.z) * .5 + .9), tall = WORK_SURFACE + size.y + .5;
      const target = ANVIL_GROUND.clone().add(new THREE.Vector3(0, tall * (portrait ? .5 : .52), 0));
      const direction = new THREE.Vector3(-.18, .3, 1).normalize();
      const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
      // Fit the orbit and the full blueprint height, leaving the lower band for the bench controls.
      const distance = Math.max(reach / Math.tan(hfov / 2 * .82), tall * .62 / Math.tan(vfov / 2 * .78)) * (portrait ? 1.08 : 1);
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.lookAt(target);
      camera.clearViewOffset();
      // Lift the subject above the control card on phones, and slightly right of the caption on desktop.
      if (portrait) camera.setViewOffset(width, height, 0, height * .12, width, height);
      else camera.setViewOffset(width, height, -width * .06, height * .04, width, height);
      camera.updateProjectionMatrix();
    };
    return {
      renderer, scene, camera, effects, piece, anvil: anvil.toArray(), landing: piece.position.toArray(),
      title: forgeTitle(plan), triangles: forged.triangles,
      sky: `linear-gradient(180deg, ${grade.zenith} 0%, ${grade.horizon} 72%, ${grade.fog} 100%)`,
      aim, dispose,
    };
  } catch (error) { dispose(); throw error; }
}
