import * as THREE from 'three';
import { MAT, MATERIALS } from '@chatdom/content';
import { createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment, type Environment } from '@chatdom/render';
import { buildLightVolume, VoxelWorkerPool } from '@chatdom/voxel';
import { StyleIdSchema, VOXEL_METRES, VoxelBlueprintSchema, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
import { assembleLook, findReviewLook, REST_POSE } from '@chatdom/content/avatars';
import { createCitizen, type Citizen } from '../avatar-bench/stage';
import { composeStatueFrame, layoutEmoteBanner, layoutEmoteStatue, sampleEmoteFrame, type CompiledEmote, type EmoteBannerLayout, type EmoteMask, type EmoteStatueLayout } from '../../../../packages/emotes/src/index';
import type { BenchView } from './params';

const CELL = VOXEL_METRES.build;
/** The plaza disc: radius in build cells and the height of its paved top. */
const PLAZA_RADIUS = 64, PLAZA_TOP = 4;
const PLAZA_Y = PLAZA_TOP * CELL;
/** Where the props stand on the plaza, in metres, in the composition's own frame (statue front is +Z). */
const BANNER_AT = new THREE.Vector3(4.7, PLAZA_Y, -1.4);
const CITIZEN_AT = new THREE.Vector3(-2.15, PLAZA_Y, 2.5);
/** Two lanterns flank the plinth's front corners and light the sculpture from below. */
const LANTERNS_AT = [new THREE.Vector3(-3.55, PLAZA_Y, 1.55), new THREE.Vector3(3.3, PLAZA_Y, 1.75)];
/** The citizen half-turns toward the statue so the scale reads from the front camera. */
const CITIZEN_YAW = .55;
/** A held capture shows the motes and flames at this moment, so stills compare run to run. */
const HELD_TIME_MS = 4200;

/** Camera directions in the composition's frame, and which props each view frames. */
const VIEWS: Record<BenchView, { direction: THREE.Vector3; focus: readonly ('statue' | 'citizen' | 'banner' | 'lanterns')[]; fov: number }> = {
  front: { direction: new THREE.Vector3(.16, .26, 1), focus: ['statue', 'citizen', 'lanterns'], fov: 30 },
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
  /** Every animation frame's grid; one shared size is what keeps the origin still. */
  readonly frameSizes: readonly string[];
  readonly frames: number;
  readonly distinctFrameMeshes: number;
  readonly frameShown: number;
  readonly playing: boolean;
  readonly lanterns: number;
  readonly motes: number;
  /** The scale citizen's world box, min and max corners in metres. */
  readonly citizenBox: readonly number[];
  readonly triangles: number;
  readonly draws: number;
  readonly shadowCasters: number;
  readonly width: number;
  readonly height: number;
}

export interface EmoteStage {
  setView(view: BenchView): void;
  /** Plays from the current moment, or holds the frame on show. */
  setPlaying(playing: boolean): void;
  resize(): void;
  report(): EmoteStageReport;
  /** Called whenever the frame on show changes, so the plaque can follow the statue. */
  onFrame(listener: (index: number) => void): void;
  readonly environment: Environment;
  dispose(): void;
}

/** Deterministic integer hash for sett colours and motes; the plaza looks the same on every run. */
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

/**
 * A plaza lantern in build cells: a dark stone footing, a timber post with a brass collar, and a
 * glazed brass cage under a stepped cap. The flame inside is light, not voxels: a warm field cell
 * for the clay and a glow sprite for the eye.
 */
const LANTERN_FLAME_CELLS = new THREE.Vector3(2.5, 18.5, 2.5);
function lanternBlueprint(): VoxelBlueprint {
  const box = (from: [number, number, number], to: [number, number, number], material: number) => ({ from, to, material });
  const boxes = [
    box([0, 0, 0], [5, 2, 5], MAT.darkStone),
    box([1, 2, 1], [4, 3, 4], MAT.stone),
    box([2, 3, 2], [3, 15, 3], MAT.timber),
    box([1, 15, 1], [4, 16, 4], MAT.brass),
    box([1, 16, 1], [2, 21, 2], MAT.brass), box([3, 16, 1], [4, 21, 2], MAT.brass), box([1, 16, 3], [2, 21, 4], MAT.brass), box([3, 16, 3], [4, 21, 4], MAT.brass),
    box([2, 16, 1], [3, 21, 2], MAT.glass), box([2, 16, 3], [3, 21, 4], MAT.glass), box([1, 16, 2], [2, 21, 3], MAT.glass), box([3, 16, 2], [4, 21, 3], MAT.glass),
    box([0, 21, 0], [5, 22, 5], MAT.brass),
    box([1, 22, 1], [4, 23, 4], MAT.brass),
    box([2, 23, 2], [3, 25, 3], MAT.goldLeaf),
  ];
  return VoxelBlueprintSchema.parse({ version: 1, id: 'bench.plaza-lantern', styleId: StyleIdSchema.parse('emote'), kind: 'prop', lattice: 'build', size: [5, 25, 5], boxes, windows: [] });
}

/** Front face of one compiled frame as a mask, so the banner can carry a chosen pose. */
function frontMask(blueprint: VoxelBlueprint): EmoteMask {
  const [w, h] = blueprint.size, materialIds = new Uint16Array(w * h), depth = new Int16Array(w * h).fill(-1);
  for (const box of blueprint.boxes) for (let y = box.from[1]; y < box.to[1]; y++) for (let x = box.from[0]; x < box.to[0]; x++) {
    const i = x + y * w;
    if (box.to[2] - 1 > depth[i]!) { depth[i] = box.to[2] - 1; materialIds[i] = box.material; }
  }
  return { width: w, height: h, materialIds };
}

/** A soft round glow: white core, warm falloff; tinted per use. */
function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!, gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.18, 'rgba(255,236,200,.85)');
  gradient.addColorStop(.45, 'rgba(255,190,110,.28)');
  gradient.addColorStop(1, 'rgba(255,160,80,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
  /** A held frame (captures, reduced motion) or null to play. */
  readonly frame: number | null;
  readonly isDisposed: () => boolean;
}

const MOTES = 150;

/**
 * The plaza bench: the compiled statue on its plinth playing every carved frame with the emote's
 * own timing, a banner carrying the heraldry charge, lanterns that light the stone through the
 * kingdom's voxel light field, drifting motes, and a SIMULATED citizen for scale. Everything is
 * meshed by the ordinary voxel workers and lit by the clay material and sun shadows.
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
  const glow = glowTexture();
  const effects: { dispose(): void }[] = [glow];
  let citizen: Citizen | undefined, frameRequest = 0;
  const release = (): void => {
    window.cancelAnimationFrame(frameRequest);
    citizen?.dispose(); geometries.forEach(g => g.dispose()); effects.forEach(e => e.dispose());
    shadows.dispose(); clay.dispose(); skin.dispose(); pool.dispose(); renderer.dispose(); renderer.domElement.remove();
  };

  // Turn the whole composition so the statue's face takes the hour's sun from front-left.
  const [sx, , sz] = environment.sunDirection;
  const composition = new THREE.Group();
  composition.rotation.y = Math.atan2(sx, sz) - .62;
  scene.add(composition);

  const plinthMaterials = { footing: MAT.darkStone, body: MAT.limestone, cap: MAT.stone, plate: MAT.brass };
  const layout: EmoteStatueLayout = layoutEmoteStatue(statue.frames, plinthMaterials, `bench.plinth.${statue.revision.slice(-8)}`);
  // Identical carved frames (the wave repeats its poses) share one mesh.
  const frameKeys = statue.frames.map(frame => JSON.stringify(frame.blueprint.boxes));
  const uniqueKeys = [...new Set(frameKeys)];
  const composites = uniqueKeys.map(key => composeStatueFrame(layout, statue.frames[frameKeys.indexOf(key)]!, `bench.statue.${statue.revision.slice(-8)}.f${frameKeys.indexOf(key)}`));
  const bannerPose = heraldry.frames[Math.min(2, heraldry.frames.length - 1)]!.blueprint;
  const banner: EmoteBannerLayout = layoutEmoteBanner(frontMask(bannerPose), { field: MAT.fabricMutedBlue, trim: MAT.fabricGold, pole: MAT.timber, finial: MAT.brass, footing: MAT.stone }, `bench.banner.${heraldry.revision.slice(-8)}`);
  const lantern = lanternBlueprint();

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
    const [plaza, bannerMesh, lanternA, lanternB, person, ...statueMeshes] = await Promise.all([
      mesh({ asset: plazaAsset() }, 'plaza'),
      mesh({ blueprint: banner.blueprint }, 'banner'),
      mesh({ blueprint: lantern }, 'lantern'),
      mesh({ blueprint: lantern }, 'lantern'),
      createCitizen(pool, skin, assembleLook(findReviewLook('citizen-a')).parts, REST_POSE, 1),
      ...composites.map((composite, i) => mesh({ blueprint: composite }, `statue-frame-${i}`)),
    ]);
    citizen = person;
    if (input.isDisposed()) { release(); return null; }
    plaza.position.set(-PLAZA_RADIUS * CELL, 0, -PLAZA_RADIUS * CELL);
    const [footW, footD] = layout.footprintCells;
    // Every frame mesh sits at the same position: the compiler gave them one grid and one origin.
    for (const statueMesh of statueMeshes) { statueMesh.position.set(-footW / 2 * CELL, PLAZA_Y, -footD / 2 * CELL); statueMesh.visible = false; }
    const [bannerW] = banner.blueprint.size;
    bannerMesh.position.set(BANNER_AT.x - bannerW / 2 * CELL, BANNER_AT.y, BANNER_AT.z - banner.footprintCells[1] / 2 * CELL);
    const lanterns = [lanternA, lanternB];
    lanterns.forEach((object, i) => object.position.set(LANTERNS_AT[i]!.x - 2.5 * CELL, LANTERNS_AT[i]!.y, LANTERNS_AT[i]!.z - 2.5 * CELL));
    // The rig root keeps its own pose matrix (no auto-update), so the citizen is placed by a holder.
    const citizenHolder = new THREE.Group();
    citizenHolder.add(person.root);
    citizenHolder.position.copy(CITIZEN_AT);
    citizenHolder.rotation.y = CITIZEN_YAW;
    composition.add(plaza, bannerMesh, ...lanterns, ...statueMeshes, citizenHolder);
    scene.updateMatrixWorld(true);
    for (const object of [plaza, bannerMesh, ...lanterns, ...statueMeshes]) shadows.register(object);
    person.root.traverse(child => { if (child instanceof THREE.Mesh) shadows.register(child); });

    // Flames: a warm cell in the voxel light field lights the clay around each lantern; a glow
    // sprite (additive, so it blooms where post-processing exists) and a bright core sell the fire.
    const flames = lanterns.map(object => object.localToWorld(LANTERN_FLAME_CELLS.clone().multiplyScalar(CELL)));
    const halos = flames.map(position => {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffa64d, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .9 }));
      halo.position.copy(position); halo.scale.setScalar(1.5);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff1cf, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      core.position.copy(position); core.scale.setScalar(.42);
      scene.add(halo, core);
      effects.push(halo.material, core.material);
      return { halo, core };
    });
    const lightOrigin: [number, number, number] = [-16, -1, -16], lightSize: [number, number, number] = [64, 24, 64];
    clay.setLight(buildLightVolume({
      revision: 1, origin: lightOrigin, size: lightSize, cellSize: .5, occupancy: new Uint8Array(lightSize[0] * lightSize[1] * lightSize[2]),
      emitters: flames.map(position => ({ position: [position.x, position.y, position.z] as [number, number, number], level: 15 })),
    }));

    // Motes: dust and fireflies drifting in the lantern light around the sculpture.
    const statueBox = worldBox(statueMeshes[0]!, cellBox(composites[0]!.size));
    const centre = statueBox.getCenter(new THREE.Vector3());
    const seeds = Array.from({ length: MOTES }, (_, i) => {
      const h = hash2(i, 77), g = hash2(i, 191);
      return { angle: (h % 3600) / 3600 * Math.PI * 2, radius: 1.6 + (g % 1000) / 1000 * 3.4, height: PLAZA_Y + .25 + (hash2(i, 5) % 1000) / 1000 * 6, speed: .08 + (h >>> 20) / 4096 * .22, phase: (g >>> 18) / 16384 * Math.PI * 2 };
    });
    const motePositions = new Float32Array(MOTES * 3);
    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
    const moteMaterial = new THREE.PointsMaterial({ map: glow, color: 0xffd68f, size: .17, sizeAttenuation: true, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false });
    const motes = new THREE.Points(moteGeometry, moteMaterial);
    motes.frustumCulled = false;
    scene.add(motes);
    effects.push(moteGeometry, moteMaterial);

    const placeEffects = (timeMs: number): void => {
      const t = timeMs / 1000;
      seeds.forEach((seed, i) => {
        const angle = seed.angle + t * seed.speed * .35, rise = (seed.height - PLAZA_Y + t * seed.speed * .5) % 6.2;
        motePositions[i * 3] = centre.x + Math.cos(angle) * seed.radius + Math.sin(t * .7 + seed.phase) * .18;
        motePositions[i * 3 + 1] = PLAZA_Y + .25 + rise;
        motePositions[i * 3 + 2] = centre.z + Math.sin(angle) * seed.radius * .7 + Math.cos(t * .5 + seed.phase) * .18;
      });
      moteGeometry.attributes.position!.needsUpdate = true;
      halos.forEach(({ halo, core }, i) => {
        const flicker = 1 + .07 * Math.sin(t * 9.1 + i * 2.3) + .05 * Math.sin(t * 15.7 + i);
        halo.scale.setScalar(1.5 * flicker); core.scale.setScalar(.42 * (2 - flicker));
      });
    };

    const focus = {
      statue: () => statueBox,
      citizen: () => worldBox(citizenHolder, person.bounds),
      banner: () => worldBox(bannerMesh, cellBox(banner.blueprint.size)),
      lanterns: () => lanterns.reduce((box, object) => box.union(worldBox(object, cellBox(lantern.size))), new THREE.Box3()),
    } as const;
    let view = input.view, triangles = 0;
    for (const object of [plaza, bannerMesh, ...lanterns, ...statueMeshes]) triangles += (object.geometry.index?.count ?? 0) / 3;
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
      camera.position.copy(target).addScaledVector(direction, fitDistance(box, target, direction, vfov, hfov, aspect < .8 ? .9 : .84));
      camera.lookAt(target);
      camera.updateProjectionMatrix();
    };

    let shown = -1;
    const listeners: ((index: number) => void)[] = [];
    const show = (frame: number): void => {
      const key = uniqueKeys.indexOf(frameKeys[frame]!);
      statueMeshes.forEach((object, i) => { object.visible = i === key; });
      if (frame !== shown) { shown = frame; listeners.forEach(listener => listener(frame)); }
    };
    const draw = (): void => {
      shadows.updateSunDirection(environment.sunDirection);
      renderer.render(scene, camera);
    };
    // Held stills show the held frame at a fixed moment; playing follows the emote's own timing.
    const held = input.frame !== null ? Math.min(input.frame, statue.frames.length - 1) : 0;
    const heldElapsed = statue.frames.slice(0, held).reduce((sum, f) => sum + f.durationMs, 0);
    let playing = false, startedAt = 0, pausedAt = HELD_TIME_MS + heldElapsed;
    const tick = (now: number): void => {
      const elapsed = now - startedAt;
      show(sampleEmoteFrame(statue, elapsed).index);
      placeEffects(elapsed + HELD_TIME_MS);
      draw();
      if (playing) frameRequest = window.requestAnimationFrame(tick);
    };

    aim();
    show(held);
    placeEffects(HELD_TIME_MS);
    shadows.updateSunDirection(environment.sunDirection);
    await renderer.compileAsync(scene, camera);
    if (input.isDisposed()) { release(); return null; }
    draw();
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
    if (input.isDisposed()) { release(); return null; }
    draw();
    renderer.getContext().finish();
    const setPlaying = (next: boolean): void => {
      if (next === playing) return;
      playing = next;
      window.cancelAnimationFrame(frameRequest);
      if (playing) { const now = performance.now(); startedAt = now - (pausedAt - HELD_TIME_MS); frameRequest = window.requestAnimationFrame(tick); }
      else pausedAt = performance.now() - startedAt + HELD_TIME_MS;
    };
    if (input.frame === null) setPlaying(true);

    const [w, h, d] = statue.frames[0]!.blueprint.size;
    return {
      environment,
      setView(next) { view = next; aim(); draw(); },
      setPlaying,
      resize() { aim(); draw(); },
      onFrame(listener) { listeners.push(listener); listener(shown); },
      report: () => ({
        view, hour: input.hour, statueRevision: statue.revision, heraldryRevision: heraldry.revision, geometryHash: statue.geometryHash,
        statueCells: [w, h, d], plinthCells: layout.footprintCells, statueMetres: h * CELL,
        frameSizes: statue.frames.map(f => f.blueprint.size.join('×')), frames: statue.frames.length, distinctFrameMeshes: statueMeshes.length,
        frameShown: shown, playing, lanterns: lanterns.length, motes: MOTES,
        citizenBox: (({ min, max }) => [min.x, min.y, min.z, max.x, max.y, max.z].map(n => Math.round(n * 100) / 100))(focus.citizen()),
        triangles, draws: renderer.info.render.calls, shadowCasters: shadows.stats.casters, width: host.clientWidth, height: host.clientHeight,
      }),
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
