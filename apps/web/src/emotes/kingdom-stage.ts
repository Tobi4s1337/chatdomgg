import * as THREE from 'three';
import { createDoorLantern, createHearthHome, createMarketSeatLog, createMarketStall, createMarketWell, createStreetProp, DOOR_LANTERN_GLASS, DOOR_LANTERN_MOUNT, MAT, MATERIALS } from '@chatdom/content';
import { createAtmosphere, createPostStack, createSunShadows, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment, type Environment, type PostQuality, type WindowHouse } from '@chatdom/render';
import { buildLightVolume, VoxelWorkerPool } from '@chatdom/voxel';
import { KingdomPresenceFrameSchema, VOXEL_METRES, type Vec3, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
import { homeLifeAnchors } from '@chatdom/world';
import { assembleLook, findReviewLook, REST_POSE, type AvatarPose } from '@chatdom/content/avatars';
import { createCitizen, type Citizen } from '../avatar-bench/stage';
import { createHomeLife, type HomeLifeSite } from '../kingdom/home-life';
import { composeStatueFrame, layoutEmoteBanner, layoutEmoteStatue, sampleEmoteFrame, type ApprovedEmoteVisual, type EmoteBannerMaterials, type EmoteCatalogueView } from '../../../../packages/emotes/src/index';
import { CHAT_CROWD, CHAT_HELD_MS, createKingdomChat, type ChatOverlay, type KingdomChat, type KingdomChatReport } from './kingdom-chat';
import { clothSwing, splitBannerCloth } from './kingdom-banner';
import { CITIZENS, DAIS_OUTER_Y, DAIS_Y, GROUND_Y, HOME_PLOTS, PROPS, SQUARE, squareAsset } from './kingdom-square';
import type { BenchView } from './params';
import { cellBox, fitDistance, glowTexture, hash2, LANTERN_FLAME_CELLS, lanternBlueprint, worldBox } from './stage';

const CELL = VOXEL_METRES.build;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** A held capture shows the cloth, smoke, motes and flames at this moment, so stills compare run to run. */
const HELD_TIME_MS = 4200;
/** The SIMULATED evening the windows and chimneys answer to; people came home a minute before. */
const EVENING_AT = 1_798_340_400_000;
const MOTES = 220;
/** Columns of cloth per banner strip; two cells keep the ripple smooth and the draw count low. */
const STRIP_CELLS = 2;
/** The kingdom's livery for its standards: a deep field, gold trim, oak and brass. */
const LIVERY: EmoteBannerMaterials = { field: MAT.fabricMutedRed, trim: MAT.fabricGold, pole: MAT.timber, finial: MAT.brass, footing: MAT.stone };
/** One arm up, the elbow soft: a citizen waving back at the statue. */
const WAVE_BACK: AvatarPose = { id: 'emote.wave-back', label: 'Waving back at the statue', rotations: { upperArmRight: [0, 0, 148], forearmRight: [0, 0, 18], upperArmLeft: [0, 0, -6], head: [-12, 0, 0] } };

export interface KingdomEmoteStageReport {
  readonly view: BenchView;
  readonly hour: number;
  readonly statueRevision: string;
  readonly heraldryRevision: string;
  readonly statueCells: readonly [number, number, number];
  readonly plinthCells: readonly [number, number];
  readonly statueMetres: number;
  /** Every animation frame's grid; one shared size is what keeps the origin still. */
  readonly frameSizes: readonly string[];
  readonly frames: number;
  readonly distinctFrameMeshes: number;
  readonly frameShown: number;
  readonly playing: boolean;
  readonly homes: number;
  readonly litHomes: number;
  readonly litWindows: number;
  readonly chimneys: number;
  readonly banners: number;
  /** Separately swung cloth columns per banner. */
  readonly clothStrips: number;
  readonly lanterns: number;
  readonly motes: number;
  readonly citizens: number;
  readonly triangles: number;
  readonly draws: number;
  readonly shadowCasters: number;
  readonly post: { readonly hdr: boolean; readonly quality: PostQuality };
  readonly width: number;
  readonly height: number;
  /** The SIMULATED chat layer, when the square is listening to chat. */
  readonly chat: KingdomChatReport | null;
}

export interface KingdomEmoteStage {
  setView(view: BenchView): void;
  setPlaying(playing: boolean): void;
  resize(): void;
  report(): KingdomEmoteStageReport;
  onFrame(listener: (index: number) => void): void;
  readonly environment: Environment;
  dispose(): void;
}

export interface KingdomEmoteStageInput {
  readonly host: HTMLElement;
  readonly hour: number;
  readonly statue: ApprovedEmoteVisual;
  readonly heraldry: ApprovedEmoteVisual;
  /** A held frame (captures, reduced motion) or null to play. */
  readonly frame: number | null;
  readonly isDisposed: () => boolean;
  /**
   * Chat in the square: a SIMULATED crowd and feed through the real chat presentation. The catalogue is
   * the public view the approved revisions came from; bubbles and pops come back through `onOverlay`.
   */
  readonly chat?: { readonly catalogue: EmoteCatalogueView; readonly emoteId: string; readonly emoteAlt: string; readonly kingdomId: string; readonly onOverlay: (overlay: ChatOverlay) => void };
}

/** Frontmost occupied cell face at one column of a blueprint, so a lamp bracket meets the real wall. */
function wallFront(blueprint: VoxelBlueprint, x: number, y: number): number | undefined {
  let solid: [number, number][] = [];
  for (const box of blueprint.boxes) {
    if (x < box.from[0] || x >= box.to[0] || y < box.from[1] || y >= box.to[1]) continue;
    const next: [number, number][] = [];
    for (const [lo, hi] of solid) {
      if (hi <= box.from[2] || lo >= box.to[2]) next.push([lo, hi]);
      else { if (lo < box.from[2]) next.push([lo, box.from[2]]); if (hi > box.to[2]) next.push([box.to[2], hi]); }
    }
    if (box.material) next.push([box.from[2], box.to[2]]);
    solid = next;
  }
  return solid.length ? Math.max(...solid.map(interval => interval[1])) : undefined;
}

const unit = (seed: number) => (seed % 10007) / 10007;

/**
 * The emote raised in the kingdom: the approved statue on its plinth at the heart of a paved town
 * square at dusk, standards carrying the heraldry charge in the wind on either side, real Hearth
 * homes turned to face it with their windows lit by a SIMULATED evening's presence, chimneys
 * smoking, lanterns lighting the stone from below, and the market at the near corners. Everything
 * is meshed by the ordinary voxel workers, lit by the clay material, the voxel light field and sun
 * shadows, and finished through the kingdom's HDR post stack. All motion follows caller time.
 */
export async function createKingdomEmoteStage(input: KingdomEmoteStageInput): Promise<KingdomEmoteStage | null> {
  const { host, statue, heraldry } = input;
  // Listening to chat, the square holds a SIMULATED crowd and its own moment; otherwise one or two people for scale.
  const crowd = input.chat ? CHAT_CROWD : CITIZENS;
  const heldTime = input.chat ? CHAT_HELD_MS : HELD_TIME_MS;
  const environment = getEnvironment(input.hour);
  const quality: PostQuality = navigator.webdriver ? 'capture' : 'balanced';
  const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)) });
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.debug.onShaderError = () => { throw new Error('Kingdom bench shader compilation failed.'); };
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = environment.exposure;
  renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 400);
  const clay = createVoxelMaterial(MATERIALS, 'build'), skin = createVoxelMaterial(MATERIALS, 'avatar');
  clay.setEnvironment(environment); skin.setEnvironment(environment);
  const shadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(-24, -1, -26), new THREE.Vector3(24, 16, 16)), resolution: 2048 });
  shadows.bindReceiver(clay.material); shadows.bindReceiver(skin.material);
  const atmosphere = createAtmosphere(scene);
  const post = createPostStack(renderer, scene, camera, { quality, toneMapping: 'aces', fog: 'material' });
  const geometries: THREE.BufferGeometry[] = [];
  const glow = glowTexture();
  const effects: { dispose(): void }[] = [glow];
  const citizens: Citizen[] = [];
  let frameRequest = 0, released = false;
  let windows: ReturnType<typeof createWindowLights> | undefined, homeLife: ReturnType<typeof createHomeLife> | undefined;
  let chat: KingdomChat | undefined;
  const release = (): void => {
    if (released) return;
    released = true;
    window.cancelAnimationFrame(frameRequest);
    citizens.forEach(c => c.dispose()); geometries.forEach(g => g.dispose()); effects.forEach(e => e.dispose());
    chat?.dispose(); windows?.dispose(); homeLife?.dispose(); atmosphere.dispose(); post.dispose();
    shadows.dispose(); clay.dispose(); skin.dispose(); pool.dispose(); renderer.dispose(); renderer.domElement.remove();
  };

  // Turn the whole square so the hour's sun rakes the statue's face from the front-left.
  const [sx, , sz] = environment.sunDirection;
  const turn = Math.atan2(sx, sz) - .78;
  const composition = new THREE.Group();
  composition.rotation.y = turn;
  scene.add(composition);
  const world = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyAxisAngle(Y_AXIS, turn);

  // The statue: one composite per distinct carved frame, all on the same plinth and origin.
  const layout = layoutEmoteStatue(statue.frames, { footing: MAT.darkStone, body: MAT.limestone, cap: MAT.stone, plate: MAT.brass }, `kingdom.plinth.${statue.revision.slice(-8)}`);
  const frameKeys = statue.frames.map(frame => JSON.stringify(frame.blueprint.boxes));
  const uniqueKeys = [...new Set(frameKeys)];
  const composites = uniqueKeys.map(key => composeStatueFrame(layout, statue.frames[frameKeys.indexOf(key)]!, `kingdom.statue.${statue.revision.slice(-8)}.f${frameKeys.indexOf(key)}`));
  // The standards: the heraldry charge on the kingdom's livery, the cloth cut into swinging columns.
  const banner = layoutEmoteBanner(heraldry.mask, LIVERY, `kingdom.banner.${heraldry.revision.slice(-8)}`);
  const cloth = splitBannerCloth(banner, LIVERY, STRIP_CELLS);
  const lantern = lanternBlueprint();
  const homes = HOME_PLOTS.map(plot => createHearthHome(plot.tier, plot.variant));
  const doorLamp = createDoorLantern('hearth');
  const stall = createMarketStall(0), well = createMarketWell(), seat = createMarketSeatLog();
  const trough = createStreetProp('flower-trough', 'hearth'), shrub = createStreetProp('leafy-shrub', 'hearth'), pot = createStreetProp('flower-pot', 'hearth');

  const meshed = new Map<string, Promise<THREE.BufferGeometry>>();
  const geometryOf = (job: { blueprint: VoxelBlueprint } | { asset: VoxelAsset }): Promise<THREE.BufferGeometry> => {
    const key = 'blueprint' in job ? `b:${job.blueprint.id}` : `a:${job.asset.id}`;
    let pending = meshed.get(key);
    if (!pending) {
      pending = pool.submit('blueprint' in job
        ? { kind: 'blueprint', blueprint: job.blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision }
        : { kind: 'asset', asset: job.asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision }).then(result => {
        if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`The voxel worker returned no geometry for ${key.slice(2)}.`);
        const geometry = geometryFromChunks(result.chunks, 'build');
        geometries.push(geometry);
        return geometry;
      });
      meshed.set(key, pending);
    }
    return pending;
  };
  const meshOf = async (job: { blueprint: VoxelBlueprint } | { asset: VoxelAsset }, name: string): Promise<THREE.Mesh> => {
    const object = new THREE.Mesh(await geometryOf(job), clay.material);
    object.name = name;
    return object;
  };

  try {
    const looks = crowd.map(c => assembleLook(findReviewLook(c.look)).parts);
    const [ground, statueMeshes, bannerParts, lanternMeshes, homeMeshes, lampMeshes, furniture, people] = await Promise.all([
      meshOf({ asset: squareAsset() }, 'square'),
      Promise.all(composites.map((composite, i) => meshOf({ blueprint: composite }, `statue-frame-${i}`))),
      Promise.all(PROPS.banners.map(async (_, b) => ({
        frame: await meshOf({ blueprint: cloth.frame }, `banner-${b}`),
        strips: await Promise.all(cloth.strips.map(strip => meshOf({ blueprint: strip.blueprint }, `banner-${b}-cloth-${strip.x}`))),
      }))),
      Promise.all(PROPS.lanterns.map((_, i) => meshOf({ blueprint: lantern }, `lantern-${i}`))),
      Promise.all(homes.map((home, i) => meshOf({ blueprint: home }, `home-${i}`))),
      Promise.all(homes.map((_, i) => meshOf({ blueprint: doorLamp }, `door-lantern-${i}`))),
      Promise.all([
        meshOf({ blueprint: stall }, 'market-stall'), meshOf({ blueprint: well }, 'well'),
        ...PROPS.seats.map((_, i) => meshOf({ blueprint: seat }, `seat-${i}`)),
        ...PROPS.troughs.map((_, i) => meshOf({ blueprint: trough }, `trough-${i}`)),
        ...PROPS.shrubs.map((_, i) => meshOf({ blueprint: shrub }, `shrub-${i}`)),
        ...PROPS.pots.map((_, i) => meshOf({ blueprint: pot }, `pot-${i}`)),
      ]),
      Promise.all(crowd.map((c, i) => createCitizen(pool, skin, looks[i]!, c.waving ? WAVE_BACK : REST_POSE, 1))),
    ]);
    citizens.push(...people);
    if (input.isDisposed()) { release(); return null; }

    /** Sets a blueprint mesh so its footprint centre stands at (x, z) on `y`, turned by `facing`. */
    const stand = (object: THREE.Object3D, size: readonly number[], x: number, y: number, z: number, facing: number) => {
      const half = new THREE.Vector3(size[0]! / 2 * CELL, 0, size[2]! / 2 * CELL).applyAxisAngle(Y_AXIS, facing);
      object.position.set(x - half.x, y, z - half.z);
      object.rotation.y = facing;
      composition.add(object);
    };

    ground.position.set(SQUARE.min[0], 0, SQUARE.min[1]);
    composition.add(ground);
    const [footW, footD] = layout.footprintCells;
    for (const object of statueMeshes) { object.position.set(-footW / 2 * CELL, DAIS_Y, -footD / 2 * CELL); object.visible = false; composition.add(object); }

    // Standards: the rigid frame, and each cloth column on a hinge at the crossbar.
    const [bannerW, , bannerD] = banner.blueprint.size;
    const hangs = cloth.clothTop - cloth.clothBottom;
    const swings = bannerParts.map(({ frame, strips }, b) => {
      const spec = PROPS.banners[b]!, holder = new THREE.Group();
      stand(holder, [bannerW, 0, bannerD], spec.at[0], GROUND_Y, spec.at[1], spec.facing);
      holder.add(frame);
      return strips.map((strip, i) => {
        const column = cloth.strips[i]!, hinge = new THREE.Group();
        hinge.position.set(column.x * CELL, cloth.clothTop * CELL, cloth.hingeZ * CELL);
        strip.position.set(0, -hangs * CELL, -cloth.hingeZ * CELL);
        hinge.add(strip); holder.add(hinge);
        const across = (column.x + column.width / 2 - cloth.span[0]) / (cloth.span[1] - cloth.span[0]);
        return { hinge, strip, across, seed: b * 3.1 + 1 };
      });
    }).flat();

    lanternMeshes.forEach((object, i) => stand(object, lantern.size, PROPS.lanterns[i]![0], DAIS_OUTER_Y, PROPS.lanterns[i]![1], 0));

    // Homes face the statue; each keeps its authored windows, chimneys and a lamp by its door.
    const houses: WindowHouse[] = [], sites: HomeLifeSite[] = [];
    let chimneys = 0;
    homeMeshes.forEach((object, i) => {
      const plot = HOME_PLOTS[i]!, home = homes[i]!, [hx, , hz] = home.size;
      const local = new THREE.Vector3(hx / 2 * CELL, 0, (hz - 4) * CELL).applyAxisAngle(Y_AXIS, plot.facing);
      object.position.set(plot.front[0] - local.x, GROUND_Y, plot.front[1] - local.z);
      object.rotation.y = plot.facing;
      composition.add(object);
      const at = (cell: readonly number[]) => {
        const p = new THREE.Vector3(cell[0]! * CELL, cell[1]! * CELL, cell[2]! * CELL).applyAxisAngle(Y_AXIS, plot.facing).add(object.position);
        return world(p.x, p.y, p.z);
      };
      const origin = at([0, 0, 0]);
      houses.push({ slot: i, blueprint: home, position: [origin.x, origin.y, origin.z], yaw: plot.facing + turn });
      const anchors = homeLifeAnchors(home), lamp = lampMeshes[i]!;
      chimneys += anchors.chimneys.length;
      const door = anchors.door;
      let x = door ? door.to[0] + 3 : hx / 2;
      if (x + doorLamp.size[0] - DOOR_LANTERN_MOUNT[0] > hx) x = door ? door.from[0] - 3 : x;
      const y = door ? door.to[1] - 1 : 16, z = wallFront(home, x, y) ?? hz - 6;
      const mount = new THREE.Vector3((x - DOOR_LANTERN_MOUNT[0]) * CELL, (y - DOOR_LANTERN_MOUNT[1]) * CELL, z * CELL).applyAxisAngle(Y_AXIS, plot.facing).add(object.position);
      lamp.position.copy(mount); lamp.rotation.y = plot.facing; composition.add(lamp);
      const glass = at([x - DOOR_LANTERN_MOUNT[0] + DOOR_LANTERN_GLASS[0], y - DOOR_LANTERN_MOUNT[1] + DOOR_LANTERN_GLASS[1], z + doorLamp.size[2] + .04]);
      const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(Y_AXIS, plot.facing + turn);
      const vec = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
      sites.push({ slot: i, mouths: anchors.chimneys.map(m => vec(at(m))), lantern: vec(glass), normal: vec(normal) });
    });

    const [stallMesh, wellMesh, ...rest] = furniture;
    stand(stallMesh!, stall.size, PROPS.stall.at[0], GROUND_Y, PROPS.stall.at[1], PROPS.stall.facing);
    stand(wellMesh!, well.size, PROPS.well.at[0], GROUND_Y, PROPS.well.at[1], PROPS.well.facing);
    let next = 0;
    for (const spec of PROPS.seats) stand(rest[next++]!, seat.size, spec.at[0], GROUND_Y, spec.at[1], spec.facing);
    for (const spec of PROPS.troughs) stand(rest[next++]!, trough.size, spec.at[0], GROUND_Y, spec.at[1], spec.facing);
    PROPS.shrubs.forEach(([x, z], i) => stand(rest[next++]!, shrub.size, x, GROUND_Y, z, i * 1.3));
    PROPS.pots.forEach(([x, z], i) => stand(rest[next++]!, pot.size, x, GROUND_Y, z, i * .9));

    // The rig root keeps its own pose matrix (no auto-update), so each citizen is placed by a holder.
    people.forEach((person, i) => {
      const spec = crowd[i]!, holder = new THREE.Group();
      holder.add(person.root);
      holder.position.set(spec.at[0], GROUND_Y, spec.at[1]);
      holder.rotation.y = spec.facing;
      composition.add(holder);
    });
    scene.updateMatrixWorld(true);

    // Sun shadows: everything that stands still casts once. The statue's shown frame and the cloth are
    // re-registered whenever they change, so a hidden frame never leaves its shadow behind.
    const still = [ground, ...lanternMeshes, ...homeMeshes, ...lampMeshes, ...furniture, ...bannerParts.map(p => p.frame)];
    for (const object of still) shadows.register(object);
    for (const person of people) person.root.traverse(child => { if (child instanceof THREE.Mesh) shadows.register(child); });

    // Presence: a SIMULATED evening in which most of the square's homes have someone in.
    const presence = KingdomPresenceFrameSchema.parse({
      version: 1, kingdomId: '900000000000000001', epoch: 'sim:emote-square', sequence: 1, asOf: EVENING_AT, origin: 'simulated', streamLive: true, connection: 'fresh',
      windows: HOME_PLOTS.map((plot, slot) => ({ slot, present: plot.lit, publicName: null, since: EVENING_AT - 60_000 })),
    });
    windows = createWindowLights(scene, houses, { allWindows: true });
    windows.setFrame(presence);
    windows.update(1, input.hour);
    homeLife = createHomeLife(scene, sites);

    // Chat: each present slot's feet in the composition's space; the chat layer never adds a person.
    if (input.chat) {
      const positions = new Map(crowd.map((spec, slot) => [slot, [spec.at[0], GROUND_Y, spec.at[1]] as Vec3]));
      // Weather frames are meshed by the same workers into geometries the chat layer owns and releases.
      const mesh = async (blueprint: VoxelBlueprint): Promise<THREE.BufferGeometry> => {
        const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
        if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`The voxel worker returned no geometry for ${blueprint.id}.`);
        return geometryFromChunks(result.chunks, 'build');
      };
      chat = await createKingdomChat({
        parent: composition, material: clay.material, mesh, glow, catalogue: input.chat.catalogue, emoteId: input.chat.emoteId, emoteAlt: input.chat.emoteAlt,
        kingdomId: input.chat.kingdomId, positions, device: host.clientWidth < 720 ? 'phone' : 'desktop', onOverlay: input.chat.onOverlay,
      });
      if (input.isDisposed()) { release(); return null; }
    }

    // Lantern flames: a warm cell in the voxel light field for the stone, glow sprites for the eye.
    const flames = lanternMeshes.map(object => object.localToWorld(LANTERN_FLAME_CELLS.clone().multiplyScalar(CELL)));
    const halos = flames.map(position => {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff9a40, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .85 }));
      halo.position.copy(position); halo.scale.setScalar(1.6);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff1cf, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      core.position.copy(position); core.scale.setScalar(.45);
      scene.add(halo, core);
      effects.push(halo.material, core.material);
      return { halo, core };
    });
    const lightOrigin: Vec3 = [-30, -1, -32], lightSize: Vec3 = [120, 34, 120];
    const relight = (): void => {
      const emitters = [
        ...flames.map(p => ({ position: [p.x, p.y, p.z] as Vec3, level: 15 })),
        ...windows!.getSources().filter(s => s.strength > 0).map(s => ({ position: s.position, level: Math.round(11 * s.strength) })),
        ...homeLife!.sources().filter(s => s.strength > 0).map(s => ({ position: s.position, level: Math.max(1, Math.min(15, Math.round(s.strength * 22))) })),
      ];
      clay.setLight(buildLightVolume({ revision: 1, origin: lightOrigin, size: lightSize, cellSize: .5, occupancy: new Uint8Array(lightSize[0] * lightSize[1] * lightSize[2]), emitters }));
    };

    // Motes: dust and fireflies drifting through the lantern light round the statue.
    const statueBox = worldBox(statueMeshes[0]!, cellBox(composites[0]!.size));
    const centre = statueBox.getCenter(new THREE.Vector3());
    const seeds = Array.from({ length: MOTES }, (_, i) => {
      const h = hash2(i, 77), g = hash2(i, 191);
      return { angle: unit(h) * Math.PI * 2, radius: 2.2 + unit(g) * 6.5, height: unit(hash2(i, 5)) * 6.5, speed: .08 + (h >>> 20) / 4096 * .22, phase: (g >>> 18) / 16384 * Math.PI * 2 };
    });
    const motePositions = new Float32Array(MOTES * 3);
    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
    const moteMaterial = new THREE.PointsMaterial({ map: glow, color: 0xffcf7f, size: .16, sizeAttenuation: true, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false });
    const motes = new THREE.Points(moteGeometry, moteMaterial);
    motes.frustumCulled = false;
    scene.add(motes);
    effects.push(moteGeometry, moteMaterial);

    const animate = (timeMs: number): void => {
      const t = timeMs / 1000;
      seeds.forEach((seed, i) => {
        const angle = seed.angle + t * seed.speed * .3, rise = (seed.height + t * seed.speed * .5) % 6.5;
        motePositions[i * 3] = centre.x + Math.cos(angle) * seed.radius + Math.sin(t * .7 + seed.phase) * .2;
        motePositions[i * 3 + 1] = GROUND_Y + .3 + rise;
        motePositions[i * 3 + 2] = centre.z + Math.sin(angle) * seed.radius * .8 + Math.cos(t * .5 + seed.phase) * .2;
      });
      moteGeometry.attributes.position!.needsUpdate = true;
      halos.forEach(({ halo, core }, i) => {
        const flicker = 1 + .07 * Math.sin(t * 9.1 + i * 2.3) + .05 * Math.sin(t * 15.7 + i);
        halo.scale.setScalar(1.6 * flicker); core.scale.setScalar(.45 * (2 - flicker));
      });
      for (const swing of swings) swing.hinge.rotation.x = -clothSwing(swing.across, t, swing.seed);
      homeLife!.update(EVENING_AT + timeMs, t, presence, input.hour, camera);
      chat?.update(timeMs, camera, Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    };

    let triangles = 0;
    for (const object of [ground, ...lanternMeshes, ...homeMeshes, ...lampMeshes, ...furniture, ...bannerParts.flatMap(p => [p.frame, ...p.strips])]) triangles += (object.geometry.index?.count ?? 0) / 3;
    triangles += people.reduce((sum, p) => sum + p.stats.triangles, 0);

    // The stream's frame: the statue the hero a little left of centre, a standard at either hand,
    // lit homes behind, the market's corners in front. Phones keep the statue whole and centred.
    const bannerBoxes = bannerParts.map(p => worldBox(p.frame, cellBox(banner.blueprint.size)));
    const aim = (): void => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight), aspect = width / height, portrait = aspect < .8;
      renderer.setSize(width, height);
      post.resize(width, height, renderer.getPixelRatio());
      camera.fov = portrait ? 42 : 30; camera.aspect = aspect;
      const box = statueBox.clone();
      if (!portrait) for (const b of bannerBoxes) box.union(b);
      box.min.y = GROUND_Y;
      const target = box.getCenter(new THREE.Vector3());
      target.y = portrait ? statueBox.getCenter(new THREE.Vector3()).y - .4 : target.y + .1;
      const direction = new THREE.Vector3(.2, portrait ? .3 : .24, 1).normalize().applyAxisAngle(Y_AXIS, turn);
      const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
      camera.position.copy(target).addScaledVector(direction, fitDistance(box, target, direction, vfov, hfov, portrait ? .86 : .7));
      camera.lookAt(target);
      camera.clearViewOffset();
      // Off-centre: the statue sits on the left third line's side of centre, the open square to its right.
      if (!portrait) camera.setViewOffset(width, height, width * .045, -height * .02, width, height);
      camera.updateProjectionMatrix();
    };

    let shown = -1, shownKey = -1;
    let statueCaster: (() => void) | undefined, clothCasters: (() => void)[] = [];
    const listeners: ((index: number) => void)[] = [];
    const castCloth = (): void => {
      clothCasters.forEach(drop => drop());
      for (const swing of swings) swing.strip.updateWorldMatrix(true, false);
      clothCasters = swings.map(swing => shadows.register(swing.strip));
    };
    const show = (frame: number): void => {
      const key = uniqueKeys.indexOf(frameKeys[frame]!);
      if (key !== shownKey) {
        statueMeshes.forEach((object, i) => { object.visible = i === key; });
        statueCaster?.(); statueCaster = shadows.register(statueMeshes[key]!);
        castCloth();
        shownKey = key;
      }
      if (frame !== shown) { shown = frame; listeners.forEach(listener => listener(frame)); }
    };
    let lastRelight = -Infinity;
    const draw = (timeMs: number): void => {
      windows!.update(0, input.hour);
      // The light field follows the door lamps as they warm; it settles after the first second.
      if (timeMs - lastRelight > 1000 || lastRelight > timeMs) { relight(); lastRelight = timeMs; }
      atmosphere.update(input.hour, timeMs / 1000, camera, new THREE.Vector3(0, -50, -200), 0);
      shadows.updateSunDirection(environment.sunDirection);
      post.update({ environment, hour: input.hour, focusDistance: null });
      post.render(1 / 60);
    };
    // Held stills show the held frame at a fixed moment; playing follows the emote's own timing.
    const held = input.frame !== null ? Math.min(input.frame, statue.frames.length - 1) : 0;
    const heldElapsed = statue.frames.slice(0, held).reduce((sum, f) => sum + f.durationMs, 0);
    let playing = false, startedAt = 0, pausedAt = heldTime + heldElapsed;
    const tick = (now: number): void => {
      const elapsed = now - startedAt;
      show(sampleEmoteFrame(statue, elapsed).index);
      animate(elapsed + heldTime);
      draw(elapsed + heldTime);
      if (playing) frameRequest = window.requestAnimationFrame(tick);
    };

    aim();
    animate(heldTime);
    show(held);
    draw(heldTime);
    await renderer.compileAsync(scene, camera);
    if (input.isDisposed()) { release(); return null; }
    draw(heldTime);
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
    if (input.isDisposed()) { release(); return null; }
    draw(heldTime);
    renderer.getContext().finish();
    const setPlaying = (nextPlaying: boolean): void => {
      if (nextPlaying === playing) return;
      playing = nextPlaying;
      window.cancelAnimationFrame(frameRequest);
      if (playing) { const now = performance.now(); startedAt = now - (pausedAt - heldTime); frameRequest = window.requestAnimationFrame(tick); }
      else pausedAt = performance.now() - startedAt + heldTime;
    };
    if (input.frame === null) setPlaying(true);

    const [w, h, d] = statue.frames[0]!.blueprint.size;
    const litWindows = windows.getSources().filter(s => s.strength > 0).length;
    const diagnostics = post.diagnostics();
    const redraw = () => { animate(playing ? performance.now() - startedAt + heldTime : pausedAt); draw(playing ? performance.now() - startedAt + heldTime : pausedAt); };
    return {
      environment,
      setView() { aim(); redraw(); },
      setPlaying,
      resize() { aim(); redraw(); },
      onFrame(listener) { listeners.push(listener); listener(shown); },
      report: () => ({
        view: input.chat ? 'chat' : 'kingdom', hour: input.hour, statueRevision: statue.revision, heraldryRevision: heraldry.revision,
        statueCells: [w, h, d], plinthCells: layout.footprintCells, statueMetres: h * CELL,
        frameSizes: statue.frames.map(f => f.blueprint.size.join('×')), frames: statue.frames.length, distinctFrameMeshes: statueMeshes.length,
        frameShown: shown, playing, homes: homes.length, litHomes: HOME_PLOTS.filter(p => p.lit).length, litWindows, chimneys,
        banners: bannerParts.length, clothStrips: cloth.strips.length, lanterns: lanternMeshes.length, motes: MOTES, citizens: people.length,
        triangles, draws: renderer.info.render.calls, shadowCasters: shadows.stats.casters, post: { hdr: diagnostics.hdr, quality },
        width: host.clientWidth, height: host.clientHeight, chat: chat?.report() ?? null,
      }),
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
