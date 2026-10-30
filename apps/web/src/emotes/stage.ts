import * as THREE from 'three';
import { MAT, MATERIALS } from '@chatdom/content';
import { createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment, type Environment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { VOXEL_METRES, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
import { assembleLook, findReviewLook, REST_POSE } from '@chatdom/content/avatars';
import { createCitizen, type Citizen } from '../avatar-bench/stage';
import { composeStatueFrame, layoutEmoteBanner, layoutEmoteStatue, type CompiledEmote, type EmoteBannerLayout, type EmoteStatueLayout } from '../../../../packages/emotes/src/index';
import type { BenchView } from './params';

const CELL = VOXEL_METRES.build;
/** The plaza disc: radius in build cells and the height of its paved top. */
const PLAZA_RADIUS = 64, PLAZA_TOP = 4;
const PLAZA_Y = PLAZA_TOP * CELL;
/** Where the props stand on the plaza, in metres, in the composition's own frame (statue front is +Z). */
const BANNER_AT = new THREE.Vector3(4.7, PLAZA_Y, -1.4);
const CITIZEN_AT = new THREE.Vector3(-2.15, PLAZA_Y, 2.5);
/** The citizen half-turns toward the statue so the scale reads from the front camera. */
const CITIZEN_YAW = .55;

/** Camera directions in the composition's frame, and which props each view frames. */
const VIEWS: Record<BenchView, { direction: THREE.Vector3; focus: readonly ('statue' | 'citizen' | 'banner')[]; fov: number }> = {
  front: { direction: new THREE.Vector3(.16, .3, 1), focus: ['statue', 'citizen'], fov: 30 },
  side: { direction: new THREE.Vector3(1, .26, .1), focus: ['statue', 'citizen'], fov: 30 },
  banner: { direction: new THREE.Vector3(-.3, .14, 1), focus: ['banner'], fov: 30 },
};

export interface EmoteStageReport {
  readonly view: BenchView;
  readonly hour: number;
  readonly statueRevision: string;
  readonly heraldryRevision: string;
  readonly geometryHash: string;
  readonly statueCells: readonly [number, number, number];
  readonly plinthCells: readonly [number, number];
  readonly statueMetres: number;
  readonly triangles: number;
  readonly draws: number;
  readonly shadowCasters: number;
  readonly width: number;
  readonly height: number;
}

export interface EmoteStage {
  setView(view: BenchView): void;
  resize(): void;
  report(): EmoteStageReport;
  readonly environment: Environment;
  dispose(): void;
}

/** Deterministic integer hash for sett colours; the plaza looks the same on every run. */
function hash2(x: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return (h ^ h >>> 16) >>> 0;
}

/**
 * Bench furniture: a round paved plaza on an earth skirt, ringed by a limestone kerb and a band of
 * turf. Setts run in a running bond with a few weathered stones. Built straight into a build-lattice
 * asset so the ordinary mesher bakes its AO against nothing but itself.
 */
function plazaAsset(): VoxelAsset {
  const size: [number, number, number] = [PLAZA_RADIUS * 2, PLAZA_TOP, PLAZA_RADIUS * 2];
  const voxels = new Uint16Array(size[0] * size[1] * size[2]);
  const setts = [MAT.paving, MAT.paving, MAT.paving, MAT.stone, MAT.limestone, MAT.paving, MAT.stone, MAT.darkStone];
  for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
    const d = Math.sqrt((x + .5 - PLAZA_RADIUS) ** 2 + (z + .5 - PLAZA_RADIUS) ** 2);
    if (d > PLAZA_RADIUS) continue;
    const row = Math.floor(z / 2), sett = hash2(Math.floor((x + (row % 2) * 2) / 4), row);
    let top: number;
    if (d > PLAZA_RADIUS - 5) top = hash2(x, z) % 5 === 0 ? MAT.moss : MAT.grass;
    else if (d > PLAZA_RADIUS - 7) top = MAT.limestone;
    else top = setts[sett % setts.length]!;
    for (let y = 0; y < size[1]; y++) {
      const surface = y === size[1] - 1;
      // The turf sits one cell below the kerb, so the paved floor reads as laid, not painted.
      if (surface && d > PLAZA_RADIUS - 5) continue;
      const material = surface || (y === size[1] - 2 && d > PLAZA_RADIUS - 5) ? top : y >= size[1] - 2 && d <= PLAZA_RADIUS - 5 ? MAT.stone : MAT.earth;
      voxels[x + size[0] * (y + size[1] * z)] = material;
    }
  }
  return { id: 'bench.emote-plaza', revision: 1, lattice: 'build', size, voxels };
}

/** World box of a local box under an object; mesh bounds from voxel chunks are chunk-coarse, so callers pass exact ones. */
function worldBox(object: THREE.Object3D, local: THREE.Box3): THREE.Box3 {
  object.updateWorldMatrix(true, false);
  return local.clone().applyMatrix4(object.matrixWorld);
}
const cellBox = (size: readonly number[]): THREE.Box3 => new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(size[0]!, size[1]!, size[2]!).multiplyScalar(CELL));

/** Distance at which every corner of the box fits inside `fill` of the frame along this direction. */
function fitDistance(box: THREE.Box3, target: THREE.Vector3, direction: THREE.Vector3, vfov: number, hfov: number, fill: number): number {
  const forward = direction.clone().negate(), right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  let distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).sub(target), depth = -p.dot(forward);
    distance = Math.max(distance, depth + Math.abs(p.dot(right)) / Math.tan(hfov / 2 * fill), depth + Math.abs(p.dot(up)) / Math.tan(vfov / 2 * fill));
  }
  return distance;
}

export interface EmoteStageInput {
  readonly host: HTMLElement;
  readonly view: BenchView;
  readonly hour: number;
  readonly statue: CompiledEmote;
  readonly heraldry: CompiledEmote;
  readonly isDisposed: () => boolean;
}

/**
 * The plaza bench: the compiled statue standing on its plinth, a banner carrying the heraldry
 * charge, and a SIMULATED citizen for scale, all meshed by the ordinary voxel workers and lit by
 * the kingdom's clay material and sun shadows. Renders on demand; nothing here animates yet.
 */
export async function createEmoteStage(input: EmoteStageInput): Promise<EmoteStage | null> {
  const { host, statue, heraldry } = input;
  const environment = getEnvironment(input.hour);
  const pool = new VoxelWorkerPool({ size: 2 });
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = () => { throw new Error('Emote bench shader compilation failed.'); };
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const clay = createVoxelMaterial(MATERIALS, 'build'), skin = createVoxelMaterial(MATERIALS, 'avatar');
  clay.setEnvironment(environment); skin.setEnvironment(environment);
  const shadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(-9, -1, -9), new THREE.Vector3(9, 9, 9)), resolution: 2048 });
  shadows.bindReceiver(clay.material); shadows.bindReceiver(skin.material);
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 200);
  const geometries: THREE.BufferGeometry[] = [];
  let citizen: Citizen | undefined;
  const release = (): void => {
    citizen?.dispose(); geometries.forEach(g => g.dispose()); shadows.dispose(); clay.dispose(); skin.dispose(); pool.dispose(); renderer.dispose(); renderer.domElement.remove();
  };

  // Turn the whole composition so the statue's face takes the hour's sun from front-left.
  const [sx, , sz] = environment.sunDirection;
  const composition = new THREE.Group();
  composition.rotation.y = Math.atan2(sx, sz) - .62;
  scene.add(composition);

  const plinthMaterials = { footing: MAT.darkStone, body: MAT.limestone, cap: MAT.stone, plate: MAT.brass };
  const layout: EmoteStatueLayout = layoutEmoteStatue(statue.frames, plinthMaterials, `bench.plinth.${statue.revision.slice(-8)}`);
  const composite = composeStatueFrame(layout, statue.frames[0]!, `bench.statue.${statue.revision.slice(-8)}.f0`);
  const banner: EmoteBannerLayout = layoutEmoteBanner(heraldry.mask, { field: MAT.fabricMutedBlue, trim: MAT.fabricGold, pole: MAT.timber, finial: MAT.brass, footing: MAT.stone }, `bench.banner.${heraldry.revision.slice(-8)}`);

  const mesh = async (job: { blueprint: VoxelBlueprint } | { asset: VoxelAsset }, name: string): Promise<THREE.Mesh> => {
    const result = await pool.submit('blueprint' in job
      ? { kind: 'blueprint', blueprint: job.blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision }
      : { kind: 'asset', asset: job.asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`The voxel worker returned no geometry for the ${name}.`);
    const geometry = geometryFromChunks(result.chunks, 'build');
    geometries.push(geometry);
    const object = new THREE.Mesh(geometry, clay.material);
    object.name = name;
    return object;
  };

  try {
    const [plaza, statueMesh, bannerMesh, person] = await Promise.all([
      mesh({ asset: plazaAsset() }, 'plaza'),
      mesh({ blueprint: composite }, 'statue'),
      mesh({ blueprint: banner.blueprint }, 'banner'),
      createCitizen(pool, skin, assembleLook(findReviewLook('citizen-a')), REST_POSE, 1),
    ]);
    citizen = person;
    if (input.isDisposed()) { release(); return null; }
    plaza.position.set(-PLAZA_RADIUS * CELL, 0, -PLAZA_RADIUS * CELL);
    const [footW, footD] = layout.footprintCells;
    statueMesh.position.set(-footW / 2 * CELL, PLAZA_Y, -footD / 2 * CELL);
    const [bannerW] = banner.blueprint.size;
    bannerMesh.position.set(BANNER_AT.x - bannerW / 2 * CELL, BANNER_AT.y, BANNER_AT.z - banner.footprintCells[1] / 2 * CELL);
    person.root.position.copy(CITIZEN_AT);
    person.root.rotation.y = CITIZEN_YAW;
    composition.add(plaza, statueMesh, bannerMesh, person.root);
    scene.updateMatrixWorld(true);
    for (const object of [plaza, statueMesh, bannerMesh]) shadows.register(object);
    person.root.traverse(child => { if (child instanceof THREE.Mesh) shadows.register(child); });

    const focus = {
      statue: () => worldBox(statueMesh, cellBox(composite.size)),
      citizen: () => worldBox(person.root, person.bounds),
      banner: () => worldBox(bannerMesh, cellBox(banner.blueprint.size)),
    } as const;
    let view = input.view, triangles = 0;
    for (const object of [plaza, statueMesh, bannerMesh]) triangles += (object.geometry.index?.count ?? 0) / 3;
    triangles += person.stats.triangles;

    const aim = (): void => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight), aspect = width / height;
      renderer.setSize(width, height);
      const spec = VIEWS[view];
      camera.fov = spec.fov; camera.aspect = aspect;
      const box = new THREE.Box3();
      for (const key of spec.focus) box.union(focus[key]());
      const target = box.getCenter(new THREE.Vector3());
      const direction = spec.direction.clone().normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), composition.rotation.y);
      const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
      camera.position.copy(target).addScaledVector(direction, fitDistance(box, target, direction, vfov, hfov, aspect < .8 ? .9 : .78));
      camera.lookAt(target);
      camera.updateProjectionMatrix();
    };
    const draw = (): void => {
      aim();
      shadows.updateSunDirection(environment.sunDirection);
      renderer.render(scene, camera);
      renderer.getContext().finish();
    };
    aim();
    shadows.updateSunDirection(environment.sunDirection);
    await renderer.compileAsync(scene, camera);
    if (input.isDisposed()) { release(); return null; }
    draw();
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
    if (input.isDisposed()) { release(); return null; }
    draw();

    const [w, h, d] = statue.frames[0]!.blueprint.size;
    return {
      environment,
      setView(next) { view = next; draw(); },
      resize: draw,
      report: () => ({
        view, hour: input.hour, statueRevision: statue.revision, heraldryRevision: heraldry.revision, geometryHash: statue.geometryHash,
        statueCells: [w, h, d], plinthCells: layout.footprintCells, statueMetres: h * CELL, triangles, draws: renderer.info.render.calls,
        shadowCasters: shadows.stats.casters, width: host.clientWidth, height: host.clientHeight,
      }),
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
