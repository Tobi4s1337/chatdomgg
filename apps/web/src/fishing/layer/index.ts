import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, geometryFromChunks, getEnvironment, windowGlowForHour } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import type { FishingCaughtFish, FishingMood, FishingPierSite, Vec3, VoxelAsset } from '@chatdom/shared';
import { createFishModel, FISH_SPECIES } from '../../../../../packages/content/src/fish';
import { createWillowRod } from '../../../../../packages/content/src/pier/rod';
import { createPierFloat } from '../../../../../packages/content/src/pier/float';
import { formatLength, formatWeight } from '../../bag/words';
import type { FishingController, FishingEvent } from '../controller';
import { createPierLanternGlow } from '../lanterns';
import { createDroplets, createMist, createRings } from './effects';
import { FLIGHT_S, LANDED_S, LEAP_S, REEL_S, SNAP_S, fishPath, floatPosition, leapPosition, linePoint, lineSag, rodPose,
  type LinePhase, type Vec } from './motion';

export interface PierWalker {
  readonly id: string;
  /** Feet, in world metres. */
  readonly position: Vec3;
  /** Radians, 0 faces +Z, as the walk camera turns. */
  readonly yaw: number;
  readonly self: boolean;
  /** The approved public name, as the kingdom already shows it over the walker. */
  readonly name: string;
}
export type PierCue = 'draw' | 'cast' | 'plop' | 'nibble' | 'bite' | 'strike' | 'run' | 'snap' | 'escape' | 'leap' | 'flop' | 'tag' | 'seal' | 'take' | 'stow';
export interface PierLayerSound {
  cue(kind: PierCue, options?: { readonly distance?: number; readonly pan?: number; readonly intensity?: number }): void;
  reel(rate: number): void;
  tension(value: number): void;
  ambience(value: { readonly near: number; readonly mood: FishingMood; readonly hour: number }): void;
  dispose(): void;
}
export interface PierLayerUi {
  prompt(value: { readonly label: string; readonly key?: string; readonly urgent?: boolean } | null): void;
  fight(value: { readonly tension: number; readonly progress: number; readonly phase: 'rest' | 'warning' | 'run'; readonly tired: boolean } | null): void;
  note(message: string, tone?: 'plain' | 'warn'): void;
  caught(tag: { readonly name: string; readonly lore: string; readonly weight: string; readonly length: string; readonly rarity: 'common' | 'uncommon' | 'rare';
    readonly personalFirst: boolean; readonly kingdomFirst: boolean; readonly portrait: Promise<CanvasImageSource | null> | null }): void;
  worldTags(tags: readonly { readonly id: string; readonly x: number; readonly y: number; readonly text: string; readonly first: boolean; readonly visible: boolean }[]): void;
}

/** What a kingdom view hands the pier layer (grand-world's layer mount, or the review bench). */
export interface PierLayerHost {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly site: FishingPierSite;
  readonly lights: readonly Vec3[];
  readonly rack: Vec3 | null;
  readonly controller: FishingController | null;
  hour(): number;
  mood(): FishingMood;
  walkers(): readonly PierWalker[];
  /** The walker's right-hand grip, when the body drawer has one; otherwise the rod is held at a fixed offset. */
  hand?(walkerId: string): THREE.Matrix4 | null;
  /** The viewport in CSS pixels, for world tags. */
  viewport(): { readonly width: number; readonly height: number };
  touch(): boolean;
  readonly sound?: PierLayerSound | null;
  readonly ui?: PierLayerUi | null;
  readonly portrait?: (defId: string) => Promise<CanvasImageSource | null>;
}
export interface PierLayer {
  /** Once per rendered frame, before the render. `time` is local seconds. */
  update(time: number): void;
  stats(): { readonly draws: number; readonly triangles: number; readonly fishers: number; readonly phase: LinePhase | null };
  dispose(): void;
}

const CELL = .0625, MAX_FISHERS = 48, FISH_SLOTS = 3;
// Each upper segment carries one voxel below its joint, so a bend never opens a gap in the rod.
const SEGMENTS: readonly (readonly [number, number])[] = [[0, 11], [11, 21], [21, 32]];
const BEND_SHARE = [0, .35, .65];
const GRIP: Vec = [2.5, 6, 2], TIP: Vec = [2.5, 31.5, 3.5];
const LINE_POINTS = 22;
const SPECIES = new Map(FISH_SPECIES.map(fish => [fish.id, fish]));

interface Fisher {
  id: string; used: boolean; self: boolean; name: string;
  phase: LinePhase; since: number; castId: string | null;
  target: Vec; from: Vec; fishAt: Vec; near: Vec; leapFrom: Vec; deck: Vec; float: Vec; tip: Vec; right: Vec;
  position: Vec; yaw: number; posed: boolean;
  tension: number; progress: number; run: number; tired: boolean; reeling: boolean; fightPhase: 'rest' | 'warning' | 'run';
  nibbleAt: number; lastRing: number; seed: number; plopped: boolean;
  fish: FishingCaughtFish | null; slot: number; tag: (() => void) | null; tagAt: number; equipped: boolean;
}
const blank = (): Fisher => ({ id: '', used: false, self: false, name: '', phase: 'held', since: 0, castId: null,
  target: [0, 0, 0], from: [0, 0, 0], fishAt: [0, 0, 0], near: [0, 0, 0], leapFrom: [0, 0, 0], deck: [0, 0, 0], float: [0, 0, 0], tip: [0, 0, 0], right: [1, 0, 0],
  position: [0, 0, 0], yaw: 0, posed: false, tension: 0, progress: 0, run: 0, tired: false, reeling: false, fightPhase: 'rest',
  nibbleAt: -10, lastRing: 0, seed: 0, plopped: false, fish: null, slot: -1, tag: null, tagAt: 0, equipped: false });

function sliceAsset(asset: VoxelAsset, from: number, to: number, id: string): VoxelAsset {
  const [sx, sy, sz] = asset.size, voxels = new Uint16Array(asset.voxels.length);
  for (let z = 0; z < sz; z++) for (let y = from; y < to; y++) for (let x = 0; x < sx; x++) {
    const index = x + sx * (y + sy * z); voxels[index] = asset.voxels[index]!;
  }
  return { ...asset, id, voxels };
}

async function mesh(pool: VoxelWorkerPool, asset: VoxelAsset): Promise<THREE.BufferGeometry> {
  const result = await pool.submit({ kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
  if (!result || result.kind !== 'asset' || !result.chunks.length) throw new Error('A pier model could not be meshed.');
  return geometryFromChunks(result.chunks, 'avatar');
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, name: string) {
  geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1));
  const object = new THREE.InstancedMesh(geometry, material, capacity);
  object.count = 0; object.frustumCulled = false; object.name = name;
  object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return object;
}

/** The fishing pier's living layer: rods in hands, lines, floats, splashes, leaping fish, lantern glass and mood. */
export async function mountPierLayer(host: PierLayerHost): Promise<PierLayer> {
  const { site } = host, waterY = site.waterY;
  const pool = new VoxelWorkerPool({ size: 1, maxQueue: 24 });
  const material = createVoxelMaterial(MATERIALS, 'avatar');
  const rodModel = createWillowRod(), floatModel = createPierFloat();
  const disposers: (() => void)[] = [];
  let rods: THREE.InstancedMesh[] = [], floats: THREE.InstancedMesh;
  try {
    const geometries = await Promise.all([...SEGMENTS.map(([a, b], index) => mesh(pool, sliceAsset(rodModel.asset, index ? a - 1 : a, b, `pier:rod.${index}`))), mesh(pool, floatModel.asset)]);
    rods = geometries.slice(0, 3).map((geometry, index) => instanced(geometry, material.material, MAX_FISHERS, `pier-rod-${index}`));
    floats = instanced(geometries[3]!, material.material, MAX_FISHERS, 'pier-floats');
    for (const geometry of geometries) disposers.push(() => geometry.dispose());
  } catch (error) { pool.dispose(); material.dispose(); throw error; }
  const root = new THREE.Group(); root.name = 'pier-layer';
  for (const rod of rods) root.add(rod);
  root.add(floats);
  // One buffer for every line: LINE_POINTS - 1 segments per fisher.
  const linePositions = new Float32Array(MAX_FISHERS * (LINE_POINTS - 1) * 2 * 3);
  const lineGeometry = new THREE.BufferGeometry();
  const lineAttribute = new THREE.BufferAttribute(linePositions, 3); lineAttribute.setUsage(THREE.DynamicDrawUsage);
  lineGeometry.setAttribute('position', lineAttribute); lineGeometry.setDrawRange(0, 0);
  const lineMaterial = new THREE.LineBasicMaterial({ color: '#e8e1cf', transparent: true, opacity: .82, depthWrite: false });
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial); lines.frustumCulled = false; lines.name = 'pier-lines';
  const rings = createRings(160), droplets = createDroplets(384);
  let ringsUntil = 0, dropletsUntil = 0;
  const spawnRing = rings.spawn, burst = droplets.burst;
  rings.spawn = (x, y, z, radius, life, strength, at) => { ringsUntil = Math.max(ringsUntil, at + life); spawnRing(x, y, z, radius, life, strength, at); };
  droplets.burst = (x, y, z, count, force, size, at) => { dropletsUntil = Math.max(dropletsUntil, at + 1.7); burst(x, y, z, count, force, size, at); };
  droplets.uniforms.uWater.value = waterY;
  // Banks on the water around the head, from the site frame: fixed, so mist never pops.
  const out = site.turn === 0 ? [0, 1] : site.turn === 1 ? [1, 0] : site.turn === 2 ? [0, -1] : [-1, 0];
  const side = [out[1]!, -out[0]!];
  const head: Vec = [site.root[0] + out[0]! * (site.walk + 2), waterY, site.root[2] + out[1]! * (site.walk + 2)];
  const banks: [number, number, number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const along = 4 + (i * 7.3) % 26, across = ((i * 13.7) % 34) - 17;
    banks.push([head[0] + out[0]! * along + side[0]! * across, waterY + .02, head[2] + out[1]! * along + side[1]! * across, 9 + (i * 5.1) % 7]);
  }
  const mist = createMist(banks);
  const glow = createPierLanternGlow(host.lights);
  root.add(lines, rings.mesh, droplets.points, mist.mesh, glow.root);
  // Leaping fish: a few plain meshes sharing the voxel material, geometry swapped per species.
  const fishGeometry = new Map<string, Promise<{ geometry: THREE.BufferGeometry; size: Vec3; mouth: Vec3 }>>();
  const fishMeshes = Array.from({ length: FISH_SLOTS }, (_, index) => {
    const object = new THREE.Mesh(new THREE.BufferGeometry(), material.material);
    object.visible = false; object.matrixAutoUpdate = false; object.frustumCulled = false; object.name = `pier-fish-${index}`;
    root.add(object); return { object, owner: -1, ready: false, size: [1, 1, 1] as Vec3, scale: 1 };
  });
  const speciesGeometry = (id: string) => {
    let job = fishGeometry.get(id);
    if (!job) {
      const model = createFishModel(id);
      job = mesh(pool, model.asset).then(geometry => { disposers.push(() => geometry.dispose()); return { geometry, size: model.asset.size, mouth: model.mouth }; });
      fishGeometry.set(id, job);
    }
    return job;
  };
  host.scene.add(root);

  const fishers = Array.from({ length: MAX_FISHERS }, blank);
  const index = new Map<string, number>();
  const sound = host.sound ?? null, ui = host.ui ?? null;
  let now = 0, hourChecked = -1, warmth = 0, mood: FishingMood = 'clear', mistLevel = 0, rainNext = 0, hintNext = 0, lastPrompt = '', lastFight = false;
  let draws = 0, triangles = 0, active = 0, disposed = false;
  const tags = Array.from({ length: 6 }, () => ({ id: '', x: 0, y: 0, text: '', first: false, visible: false, until: 0, walker: '' }));
  const fightView = { tension: 0, progress: 0, phase: 'rest' as 'rest' | 'warning' | 'run', tired: false };
  const temp = { matrix: new THREE.Matrix4(), rotation: new THREE.Quaternion(), bend: new THREE.Quaternion(), yaw: new THREE.Quaternion(),
    axisX: new THREE.Vector3(1, 0, 0), axisY: new THREE.Vector3(0, 1, 0), point: new THREE.Vector3(), offset: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1),
    pivot: new THREE.Vector3(), centre: new THREE.Matrix4(), project: new THREE.Vector3(), line: [0, 0, 0] as Vec, pose: { pitch: 0, bend: 0, shake: 0 },
    hand: new THREE.Matrix4(), handQ: new THREE.Quaternion(), handP: new THREE.Vector3(), fishQ: new THREE.Quaternion(), euler: new THREE.Euler() };

  const fisher = (id: string, create: boolean): Fisher | null => {
    const at = index.get(id);
    if (at !== undefined) return fishers[at]!;
    if (!create) return null;
    const free = fishers.findIndex(entry => !entry.used);
    if (free < 0) return null;
    const entry = Object.assign(fishers[free]!, blank(), { id, used: true, seed: (free * 2.37) % 6.28 });
    index.set(id, free);
    return entry;
  };
  const release = (entry: Fisher) => {
    if (entry.slot >= 0) { fishMeshes[entry.slot]!.owner = -1; fishMeshes[entry.slot]!.object.visible = false; }
    index.delete(entry.id); entry.used = false; entry.id = ''; entry.slot = -1; entry.tag = null;
  };
  const enter = (entry: Fisher, phase: LinePhase) => { if (entry.phase !== phase) { entry.phase = phase; entry.since = now; } };
  const listen = (entry: Fisher) => {
    const camera = host.camera.position, dx = entry.float[0] - camera.x, dz = entry.float[2] - camera.z;
    return entry.self ? undefined : { distance: Math.hypot(dx, dz), pan: 0 };
  };
  const cue = (entry: Fisher, kind: PierCue, intensity = 1) => {
    if (!sound) return;
    const where = listen(entry);
    sound.cue(kind, where ? { ...where, intensity } : { intensity });
  };
  const fishSize = (fish: FishingCaughtFish) => {
    const species = SPECIES.get(fish.speciesId);
    if (!species) return .6;
    return (fish.lengthMm - species.lengthMm[0]) / Math.max(1, species.lengthMm[1] - species.lengthMm[0]);
  };
  const assignFish = (entry: Fisher, fish: FishingCaughtFish) => {
    entry.fish = fish;
    let slot = fishMeshes.findIndex(slot => slot.owner < 0);
    if (slot < 0) slot = 0;
    const holder = fishMeshes[slot]!;
    if (holder.owner >= 0 && fishers[holder.owner]) fishers[holder.owner]!.slot = -1;
    holder.owner = fishers.indexOf(entry); holder.ready = false; holder.object.visible = false; entry.slot = slot;
    void speciesGeometry(fish.speciesId).then(model => {
      if (disposed || holder.owner !== fishers.indexOf(entry) || entry.fish !== fish) return;
      holder.object.geometry = model.geometry; holder.size = model.size;
      // The authored model is a mid-size fish; the caught one is drawn at its own length.
      const authored = model.size[2] * CELL, wanted = fish.lengthMm / 1000;
      holder.scale = THREE.MathUtils.clamp(wanted / authored, .55, 1.7); holder.ready = true;
    }).catch(() => { /* The leap shows only the splash if the model cannot be meshed. */ });
    if (entry.phase === 'hauling' || entry.phase === 'fighting') {
      entry.leapFrom[0] = entry.fishAt[0]; entry.leapFrom[1] = waterY - .1; entry.leapFrom[2] = entry.fishAt[2];
      enter(entry, 'leaping'); cue(entry, 'leap', .7 + fishSize(fish) * .6);
      droplets.burst(entry.fishAt[0], waterY, entry.fishAt[2], 26, 4.2, .05, now);
      for (let i = 0; i < 3; i++) rings.spawn(entry.fishAt[0], waterY, entry.fishAt[2], 1.2 + i * .7, 1.4 + i * .4, .8, now + i * .12);
    }
  };
  const showTag = (event: Extract<FishingEvent, { kind: 'kept' }>) => {
    const species = SPECIES.get(event.fish.speciesId);
    if (!ui || !species) return;
    ui.caught({ name: species.name, lore: species.lore, weight: formatWeight(event.fish.weightG), length: formatLength(event.fish.lengthMm),
      rarity: species.rarity, personalFirst: event.personalFirst, kingdomFirst: event.kingdomFirst,
      portrait: host.portrait ? host.portrait(event.fish.speciesId) : null });
  };
  const worldTag = (walker: string, text: string, first: boolean) => {
    let slot = tags.findIndex(tag => !tag.visible && tag.until < now - 1);
    if (slot < 0) slot = tags.reduce((oldest, tag, i) => tag.until < tags[oldest]!.until ? i : oldest, 0);
    Object.assign(tags[slot]!, { id: `${walker}:${Math.round(now * 1000)}`, text, first, visible: true, until: now + 4.5, walker });
  };

  const onEvent = (event: FishingEvent) => {
    if (disposed) return;
    switch (event.kind) {
      case 'draw': { const entry = fisher(event.walkerId, true); if (entry) { entry.castId = event.castId; enter(entry, 'drawing'); cue(entry, 'draw'); } return; }
      case 'cast': { const entry = fisher(event.walkerId, true); if (entry) { entry.castId = event.castId; entry.from[0] = entry.tip[0]; entry.from[1] = entry.tip[1]; entry.from[2] = entry.tip[2]; entry.plopped = false; enter(entry, 'flying'); cue(entry, 'cast'); } return; }
      case 'nibble': { const entry = fisher(event.walkerId, false); if (entry) { entry.nibbleAt = now; rings.spawn(entry.target[0], waterY, entry.target[2], .45, .9, .55, now); cue(entry, 'nibble'); } return; }
      case 'bite': {
        const entry = fisher(event.walkerId, false); if (!entry) return;
        enter(entry, 'bite'); cue(entry, 'bite');
        droplets.burst(entry.target[0], waterY, entry.target[2], 16, 2.6, .035, now);
        for (let i = 0; i < 3; i++) rings.spawn(entry.target[0], waterY, entry.target[2], .7 + i * .45, 1 + i * .3, .85, now + i * .09);
        return;
      }
      case 'hook': { const entry = fisher(event.walkerId, false); if (entry) { entry.fishAt[0] = entry.target[0]; entry.fishAt[2] = entry.target[2]; enter(entry, 'fighting'); cue(entry, 'strike'); } return; }
      case 'pressure': { const entry = fisher(event.walkerId, false); if (entry && entry.fightPhase === 'run') { cue(entry, 'run'); droplets.burst(entry.fishAt[0], waterY, entry.fishAt[2], 10, 2, .03, now); } return; }
      case 'landing': { const entry = fisher(event.walkerId, false); if (entry && entry.phase !== 'leaping' && entry.phase !== 'landed') enter(entry, 'hauling'); return; }
      case 'ended': {
        const entry = fisher(event.walkerId, false); if (!entry || entry.castId !== event.castId) return;
        if (entry.phase === 'leaping' || entry.phase === 'landed') return;
        if (event.outcome === 'snapped') { enter(entry, 'snapped'); cue(entry, 'snap'); rings.spawn(entry.float[0], waterY, entry.float[2], .9, 1.2, .6, now); }
        else {
          if (event.outcome === 'escaped') { cue(entry, 'escape'); droplets.burst(entry.float[0], waterY, entry.float[2], 8, 1.8, .03, now); }
          entry.from[0] = entry.float[0]; entry.from[1] = Math.max(waterY, entry.float[1]); entry.from[2] = entry.float[2];
          enter(entry, entry.phase === 'drawing' ? 'held' : 'reeling');
        }
        entry.castId = null;
        return;
      }
      case 'caught': {
        const entry = fisher(event.walkerId, false);
        if (entry && entry.castId === event.castId && !entry.fish) assignFish(entry, event.fish);
        if (!event.self) {
          const species = SPECIES.get(event.fish.speciesId), name = entry?.name;
          if (species && name) worldTag(event.walkerId, `${name} caught ${/^[AEIOU]/.test(species.name) ? 'an' : 'a'} ${species.name}`, event.kingdomFirst);
        }
        return;
      }
      case 'kept': {
        const self = fishers.find(entry => entry.used && entry.self);
        if (self && self.castId === event.castId && !self.fish) assignFish(self, event.fish);
        if (event.replayed || !self || (self.phase !== 'leaping' && self.phase !== 'hauling')) { showTag(event); return; }
        self.tag = () => showTag(event); self.tagAt = 0;
        return;
      }
      case 'taken': { sound?.cue('take'); return; }
      case 'rod': {
        const entry = fisher(event.walkerId, event.equipped);
        if (!entry) return;
        entry.equipped = event.equipped;
        if (event.self && !event.equipped) sound?.cue('stow');
        return;
      }
      case 'note': ui?.note(event.message, event.tone); return;
      case 'state': return;
    }
  };
  const unsubscribe = host.controller?.subscribe(onEvent) ?? (() => {});

  /** Phase from the server's projection; local motion carries the in-between beats. */
  const follow = (entry: Fisher) => {
    const controller = host.controller;
    if (!controller) return;
    const state = controller.state(), cast = entry.self ? state.cast : state.casts.get(entry.id) ?? null;
    entry.equipped = state.rods.has(entry.id) || (entry.self && !!state.rod);
    if (entry.self && !cast && state.input === 'drawing' && entry.phase !== 'reeling') { enter(entry, 'drawing'); return; }
    if (!cast) {
      if (entry.phase === 'drawing' || entry.phase === 'waiting' || entry.phase === 'bite' || entry.phase === 'flying' || entry.phase === 'fighting') {
        entry.from[0] = entry.float[0]; entry.from[1] = Math.max(waterY, entry.float[1]); entry.from[2] = entry.float[2];
        enter(entry, entry.phase === 'drawing' ? 'held' : 'reeling'); entry.castId = null;
      }
      return;
    }
    if (cast.id !== entry.castId) { entry.castId = cast.id; entry.fish = null; }
    if (cast.float) { entry.target[0] = cast.float[0]; entry.target[1] = waterY; entry.target[2] = cast.float[2]; }
    if (cast.fight) {
      entry.tension = cast.fight.tension / 10_000; entry.progress = cast.fight.progress / 10_000;
      entry.fightPhase = cast.fight.phase; entry.tired = cast.fight.tired;
    }
    entry.reeling = entry.self && state.input === 'reeling';
    const terminal = entry.phase === 'leaping' || entry.phase === 'landed' || entry.phase === 'hauling';
    switch (cast.phase) {
      case 'drawing': if (entry.phase !== 'drawing') enter(entry, 'drawing'); break;
      case 'flying': if (entry.phase !== 'flying') { entry.from[0] = entry.tip[0]; entry.from[1] = entry.tip[1]; entry.from[2] = entry.tip[2]; entry.plopped = false; enter(entry, 'flying'); } break;
      case 'waiting': if (entry.phase !== 'waiting' && entry.phase !== 'flying') enter(entry, 'waiting'); break;
      case 'bite': if (entry.phase !== 'bite') enter(entry, 'bite'); break;
      case 'fighting': if (entry.phase !== 'fighting') { entry.fishAt[0] = entry.target[0]; entry.fishAt[2] = entry.target[2]; enter(entry, 'fighting'); } break;
      case 'landing': if (!terminal) enter(entry, 'hauling'); break;
    }
  };

  const writeRod = (entry: Fisher, slot: number) => {
    const pose = rodPose(entry.phase, now - entry.since, now, { tension: entry.tension, progress: entry.progress, run: entry.run > .5, tired: entry.tired, reeling: entry.reeling },
      now - entry.since, temp.pose);
    const shake = pose.shake * Math.sin(now * 113 + entry.seed);
    const hand = host.hand?.(entry.id) ?? null;
    if (hand) {
      hand.decompose(temp.handP, temp.handQ, temp.scale); temp.scale.set(1, 1, 1);
      temp.pivot.copy(temp.handP);
      temp.euler.setFromQuaternion(temp.handQ, 'YXZ'); temp.yaw.setFromAxisAngle(temp.axisY, temp.euler.y);
    } else {
      // Fallback grip: the right hand, a little forward of the hip.
      const cos = Math.cos(entry.yaw), sin = Math.sin(entry.yaw);
      temp.pivot.set(entry.position[0] - cos * .24 + sin * .3, entry.position[1] + 1.02, entry.position[2] + sin * .24 + cos * .3);
      temp.yaw.setFromAxisAngle(temp.axisY, entry.yaw);
    }
    entry.right[0] = -Math.cos(entry.yaw); entry.right[1] = 0; entry.right[2] = Math.sin(entry.yaw);
    // Pitch: rotate the rod's +Y towards +Z, so pitch above horizontal is pi/2 - angle.
    temp.rotation.setFromAxisAngle(temp.axisX, Math.PI / 2 - pose.pitch + shake).premultiply(temp.yaw);
    let y0 = GRIP[1];
    for (let segment = 0; segment < 3; segment++) {
      const [from, to] = SEGMENTS[segment]!;
      if (segment > 0) {
        temp.offset.set(0, (from - y0) * CELL, 0).applyQuaternion(temp.rotation); temp.pivot.add(temp.offset);
        temp.bend.setFromAxisAngle(temp.axisX, pose.bend * BEND_SHARE[segment]!); temp.rotation.multiply(temp.bend);
      }
      const anchor = segment === 0 ? GRIP[1] : from;
      temp.centre.makeTranslation(-GRIP[0] * CELL, -anchor * CELL, -GRIP[2] * CELL);
      temp.matrix.compose(temp.pivot, temp.rotation, temp.scale).multiply(temp.centre);
      rods[segment]!.setMatrixAt(slot, temp.matrix);
      y0 = segment === 0 ? GRIP[1] : from;
      if (segment === 2) {
        temp.offset.set((TIP[0] - GRIP[0]) * CELL, (TIP[1] - from) * CELL, (TIP[2] - GRIP[2]) * CELL).applyQuaternion(temp.rotation);
        entry.tip[0] = temp.pivot.x + temp.offset.x; entry.tip[1] = temp.pivot.y + temp.offset.y; entry.tip[2] = temp.pivot.z + temp.offset.z;
      }
      void to;
    }
  };

  const writeLine = (entry: Fisher, start: number, end: Vec, sag: number) => {
    for (let i = 0; i < LINE_POINTS - 1; i++) {
      linePoint(entry.tip, end, sag, i / (LINE_POINTS - 1), waterY, temp.line);
      const base = (start + i * 2) * 3;
      linePositions[base] = temp.line[0]; linePositions[base + 1] = temp.line[1]; linePositions[base + 2] = temp.line[2];
      linePoint(entry.tip, end, sag, (i + 1) / (LINE_POINTS - 1), waterY, temp.line);
      linePositions[base + 3] = temp.line[0]; linePositions[base + 4] = temp.line[1]; linePositions[base + 5] = temp.line[2];
    }
  };

  const writeFish = (entry: Fisher) => {
    if (entry.slot < 0) return;
    const holder = fishMeshes[entry.slot]!;
    if (!holder.ready) { holder.object.visible = false; return; }
    const age = now - entry.since;
    let x: number, y: number, z: number, nose: number, roll: number, pitch = 0, scale = holder.scale;
    if (entry.phase === 'leaping') {
      leapPosition(age, entry.leapFrom, entry.deck, temp.line); [x, y, z] = temp.line;
      const u = Math.min(1, age / LEAP_S);
      pitch = (u - .5) * 2.4; roll = Math.sin(age * 22) * .35; nose = entry.yaw + Math.PI + Math.sin(age * 9) * .4;
    } else if (entry.phase === 'landed') {
      const flop = age < 1.8 ? Math.abs(Math.sin(age * 7)) * .12 * (1 - age / 1.8) : 0;
      x = entry.deck[0]; y = entry.deck[1] + flop; z = entry.deck[2];
      roll = Math.PI / 2 + Math.sin(age * 7) * .3 * Math.max(0, 1 - age / 1.8); nose = entry.yaw + Math.PI / 2 + entry.seed * .2;
      // It slips into the bag at the end: a quick shrink, never a pop.
      if (age > LANDED_S - .6) scale *= Math.max(0, (LANDED_S - age) / .6);
    } else { holder.object.visible = false; return; }
    const size = holder.size;
    temp.euler.set(pitch, nose, roll, 'YXZ'); temp.fishQ.setFromEuler(temp.euler);
    temp.point.set(x, y, z); temp.scale.setScalar(scale);
    temp.centre.makeTranslation(-size[0] * CELL / 2, -size[1] * CELL / 2, -size[2] * CELL / 2);
    holder.object.matrix.compose(temp.point, temp.fishQ, temp.scale).multiply(temp.centre); temp.scale.set(1, 1, 1);
    holder.object.matrixWorld.copy(holder.object.matrix);
    holder.object.visible = scale > .01;
  };

  const updateHour = () => {
    const hour = host.hour();
    if (Math.abs(hour - hourChecked) < .02) return;
    hourChecked = hour;
    const grade = getEnvironment(hour);
    material.setEnvironment(grade);
    warmth = windowGlowForHour(hour); glow.update(warmth);
    const sky = new THREE.Color(grade.horizon), sun = new THREE.Color(grade.sun);
    rings.uniforms.uColor.value.copy(sky).lerp(sun, .25).multiplyScalar(1.15 - grade.night * .45);
    rings.uniforms.uFogColor.value.set(grade.fog); rings.uniforms.uFogDensity.value = grade.fogDensity;
    droplets.uniforms.uColor.value.copy(sky).lerp(new THREE.Color('#ffffff'), .5).multiplyScalar(1 - grade.night * .5);
    mist.uniforms.uColor.value.set(grade.fog).lerp(new THREE.Color('#e6e8e6'), .35 - grade.night * .2);
    lineMaterial.color.set('#ece6d4').lerp(new THREE.Color('#d9a868'), warmth * .5).multiplyScalar(1 - grade.night * .35);
  };

  let origin: number | null = null;
  const update = (clock: number) => {
    if (disposed) return;
    // Shader time stays small: float precision on the GPU cannot hold an epoch.
    if (origin === null) origin = clock;
    const time = clock - origin;
    now = time;
    updateHour();
    mood = host.mood();
    const hour = host.hour();
    const mistWanted = mood === 'mist' ? 1 : mood === 'rain' ? .3 : hour >= 5 && hour < 8 ? .25 : 0;
    mistLevel += (mistWanted - mistLevel) * .02;
    rings.uniforms.uTime.value = time; droplets.uniforms.uTime.value = time; mist.uniforms.uTime.value = time; mist.uniforms.uMist.value = mistLevel;
    droplets.uniforms.uScale.value = host.viewport().height * .9;
    if (mood === 'rain' && time >= rainNext) {
      // Rain rings within the pier view, fine and many.
      rainNext = time + .028;
      const angle = (time * 977.3) % (Math.PI * 2), radius = 3 + ((time * 613.1) % 1) * 24;
      rings.spawn(head[0] + Math.cos(angle) * radius, waterY, head[2] + Math.sin(angle) * radius, .22 + ((time * 37) % 1) * .2, .75, .45, time);
    }
    const controller = host.controller, state = controller?.state() ?? null;
    const walkers = host.walkers();
    for (const walker of walkers) {
      const has = !!state && (state.rods.has(walker.id) || state.casts.has(walker.id) || (walker.self && (!!state.rod || state.input === 'drawing')));
      const entry = fisher(walker.id, has);
      if (!entry) continue;
      entry.self = walker.self; entry.name = walker.name; entry.posed = true;
      entry.position[0] = walker.position[0]; entry.position[1] = walker.position[1]; entry.position[2] = walker.position[2]; entry.yaw = walker.yaw;
    }
    let rodCount = 0, floatCount = 0, lineSegments = 0;
    active = 0;
    for (const entry of fishers) {
      if (!entry.used) continue;
      if (!entry.posed) { release(entry); continue; }
      entry.posed = false;
      follow(entry);
      const age = now - entry.since;
      entry.run += ((entry.fightPhase === 'run' ? 1 : 0) - entry.run) * .15;
      const busy = entry.phase !== 'held';
      if (!entry.equipped && !busy) { release(entry); continue; }
      active++;
      // The deck in front of the fisher, where a catch lands.
      entry.deck[0] = entry.position[0] + Math.sin(entry.yaw) * .9 + entry.right[0] * .25; entry.deck[1] = site.deckY + .1;
      entry.deck[2] = entry.position[2] + Math.cos(entry.yaw) * .9 + entry.right[2] * .25;
      entry.near[0] = entry.position[0] + Math.sin(entry.yaw) * 2.2; entry.near[1] = waterY; entry.near[2] = entry.position[2] + Math.cos(entry.yaw) * 2.2;
      writeRod(entry, rodCount++);
      if (entry.phase === 'fighting' || entry.phase === 'hauling') {
        fishPath(now, entry.seed, entry.target, entry.near, entry.right, entry.phase === 'hauling' ? 1 : entry.progress, entry.run, waterY, entry.fishAt);
        if (now - entry.lastRing > (entry.run > .5 ? .18 : .36)) {
          entry.lastRing = now; rings.spawn(entry.fishAt[0], waterY, entry.fishAt[2], .5 + entry.run * .5, .9, .7, now);
          if (entry.run > .5 || entry.phase === 'hauling') droplets.burst(entry.fishAt[0], waterY, entry.fishAt[2], 4, 1.6, .028, now);
        }
      }
      // Phase-local transitions: the float lands, the fish lands, the line comes home.
      if (entry.phase === 'flying' && age >= FLIGHT_S) {
        if (!entry.plopped) { entry.plopped = true; cue(entry, 'plop'); rings.spawn(entry.target[0], waterY, entry.target[2], .9, 1.5, .9, now); rings.spawn(entry.target[0], waterY, entry.target[2], 1.6, 2.2, .45, now + .15); droplets.burst(entry.target[0], waterY, entry.target[2], 7, 1.3, .03, now); }
        enter(entry, 'waiting');
      }
      if (entry.phase === 'leaping' && age >= LEAP_S) { enter(entry, 'landed'); cue(entry, 'flop'); if (entry.tag) { const tag = entry.tag; entry.tag = null; tag(); } }
      if (entry.phase === 'landed' && age >= LANDED_S) { if (entry.slot >= 0) { fishMeshes[entry.slot]!.owner = -1; fishMeshes[entry.slot]!.object.visible = false; entry.slot = -1; } entry.fish = null; enter(entry, 'held'); }
      if (entry.phase === 'hauling' && age > 5) enter(entry, 'reeling');
      if ((entry.phase === 'reeling' && age >= REEL_S) || (entry.phase === 'snapped' && age >= SNAP_S)) enter(entry, 'held');
      const phase = entry.phase, lineAge = now - entry.since;
      const draws = phase === 'flying' || phase === 'waiting' || phase === 'bite' || phase === 'fighting' || phase === 'hauling' || phase === 'leaping' || phase === 'reeling' || phase === 'snapped';
      if (!draws) continue;
      if (phase === 'reeling') {
        const u = Math.min(1, lineAge / REEL_S), k = u * u;
        entry.float[0] = entry.from[0] + (entry.tip[0] - entry.from[0]) * k; entry.float[2] = entry.from[2] + (entry.tip[2] - entry.from[2]) * k;
        entry.float[1] = Math.max(waterY, entry.from[1] + (entry.tip[1] - .3 - entry.from[1]) * k * k);
      } else if (phase === 'snapped') {
        entry.float[1] = waterY + Math.sin(now * 2) * .01;
      } else if (phase === 'leaping') {
        leapPosition(lineAge, entry.leapFrom, entry.deck, entry.float);
      } else {
        floatPosition(phase, lineAge, now, entry.from, entry.target, entry.fishAt, waterY, mood === 'breeze' ? 1 : mood === 'rain' ? .6 : 0,
          Math.max(0, 1 - Math.abs(now - entry.nibbleAt - .08) * 9), entry.float);
      }
      const sag = lineSag(phase, lineAge, entry.tension);
      if (phase !== 'snapped' || lineAge < .35) { writeLine(entry, lineSegments * 2, entry.float, phase === 'snapped' ? sag * (1 + lineAge * 4) : sag); lineSegments += LINE_POINTS - 1; }
      if (phase !== 'leaping' && phase !== 'hauling' && phase !== 'fighting') {
        const fade = phase === 'snapped' ? Math.max(0, 1 - lineAge / SNAP_S) : 1;
        temp.point.set(entry.float[0], entry.float[1] - floatModel.waterline * CELL, entry.float[2]);
        temp.centre.makeTranslation(-1.5 * CELL, 0, -1.5 * CELL);
        temp.rotation.setFromAxisAngle(temp.axisX, phase === 'flying' ? Math.sin(lineAge * 14) * .5 : phase === 'bite' ? .35 : Math.sin(now * 1.7 + entry.seed) * .06);
        temp.scale.setScalar(fade);
        temp.matrix.compose(temp.point, temp.rotation, temp.scale).multiply(temp.centre); temp.scale.set(1, 1, 1);
        floats.setMatrixAt(floatCount++, temp.matrix);
      }
    }
    for (const entry of fishers) if (entry.used && entry.slot >= 0) writeFish(entry);
    for (const rod of rods) { rod.count = rodCount; if (rodCount) rod.instanceMatrix.needsUpdate = true; }
    floats.count = floatCount; if (floatCount) floats.instanceMatrix.needsUpdate = true;
    lineGeometry.setDrawRange(0, lineSegments * 2); if (lineSegments) { lineAttribute.needsUpdate = true; lineAttribute.clearUpdateRanges(); lineAttribute.addUpdateRange(0, lineSegments * 6); }
    // The person's own fight and hint, and the pier bed.
    const self = fishers.find(entry => entry.used && entry.self);
    if (sound) {
      const fightingSelf = !!self && self.phase === 'fighting';
      sound.reel(fightingSelf && self.reeling ? .45 + .55 * (1 - self.tension) : self?.phase === 'reeling' ? .9 : 0);
      sound.tension(fightingSelf ? self.tension : 0);
      const camera = host.camera.position;
      sound.ambience({ near: Math.max(0, 1 - Math.hypot(camera.x - head[0], camera.z - head[2]) / 45), mood, hour });
    }
    if (ui) {
      if (self && self.phase === 'fighting') {
        fightView.tension = self.tension; fightView.progress = self.progress; fightView.phase = self.fightPhase; fightView.tired = self.tired;
        ui.fight(fightView); lastFight = true;
      } else if (lastFight) { ui.fight(null); lastFight = false; }
      if (now >= hintNext || self?.phase === 'bite') {
        hintNext = now + .2;
        const walker = walkers.find(entry => entry.self);
        // The catch has the stage while it leaps and lands: no hint over it.
        const showing = self && (self.phase === 'leaping' || self.phase === 'landed');
        const hint = controller && walker && !showing ? controller.hint(where(walker)) : null;
        const key = hint ? `${hint.label}|${hint.key ?? ''}|${hint.urgent ? 1 : 0}` : '';
        if (key !== lastPrompt) { lastPrompt = key; ui.prompt(hint); }
      }
      let tagged = false;
      const view = host.viewport();
      for (const tag of tags) {
        if (!tag.text) continue;
        const owner = walkers.find(entry => entry.id === tag.walker);
        if (owner) {
          temp.project.set(owner.position[0], owner.position[1] + 2.35 + Math.min(1, (now - (tag.until - 4.5)) / 4) * .35, owner.position[2]).project(host.camera);
          tag.x = (temp.project.x * .5 + .5) * view.width; tag.y = (1 - (temp.project.y * .5 + .5)) * view.height;
        }
        tag.visible = !!owner && now < tag.until && temp.project.z < 1;
        if (!tag.visible && now > tag.until + 1) tag.text = '';
        tagged = true;
      }
      if (tagged) ui.worldTags(tags);
    }
    rings.mesh.visible = now < ringsUntil; droplets.points.visible = now < dropletsUntil; mist.mesh.visible = mistLevel > .01;
    // Costs, for the evidence: only what this layer adds.
    draws = 0; triangles = 0;
    for (const rod of rods) if (rod.count) { draws++; triangles += (rod.geometry.index?.count ?? 0) / 3 * rod.count; }
    if (floatCount) { draws++; triangles += (floats.geometry.index?.count ?? 0) / 3 * floatCount; }
    if (lineSegments) draws++;
    draws += (rings.mesh.visible ? 1 : 0) + (droplets.points.visible ? 1 : 0) + (mist.mesh.visible ? 1 : 0) + (host.lights.length ? 1 : 0);
    triangles += (rings.mesh.visible ? 160 * 2 : 0) + (mist.mesh.visible ? banks.length * 2 : 0) + host.lights.length * 8;
    for (const holder of fishMeshes) if (holder.object.visible) { draws++; triangles += (holder.object.geometry.index?.count ?? 0) / 3; }
  };

  /** The person's own place on the pier, for the quiet hint only; the server checks the lip again. */
  const where = (walker: PierWalker) => {
    const right = site.turn === 0 ? [1, 0] : site.turn === 1 ? [0, -1] : site.turn === 2 ? [-1, 0] : [0, 1];
    const dx = walker.position[0] - site.root[0], dz = walker.position[2] - site.root[2];
    const x = dx * right[0]! + dz * right[1]!, z = dx * out[0]! + dz * out[1]!;
    const onDeck = Math.abs(walker.position[1] - site.deckY) < .5;
    return {
      lip: onDeck && Math.abs(x) <= 3.4 && z >= site.walk + 2.95 && z <= site.walk + 3.8,
      onPier: onDeck && z >= 0 && z <= site.walk + 4 && Math.abs(x) <= 4,
      nearRack: !!host.rack && Math.hypot(walker.position[0] - host.rack[0], walker.position[2] - host.rack[2]) < 2.4,
      touch: host.touch(),
    };
  };

  return {
    update,
    stats: () => ({ draws, triangles: Math.round(triangles), fishers: active, phase: fishers.find(entry => entry.used && entry.self)?.phase ?? null }),
    dispose() {
      if (disposed) return;
      disposed = true; unsubscribe(); host.scene.remove(root);
      for (const rod of rods) rod.dispose();
      floats.dispose(); lineGeometry.dispose(); lineMaterial.dispose(); rings.dispose(); droplets.dispose(); mist.dispose(); glow.dispose();
      for (const holder of fishMeshes) holder.object.geometry = new THREE.BufferGeometry();
      for (const dispose of disposers) dispose();
      material.dispose(); pool.dispose();
      ui?.prompt(null); ui?.fight(null);
    },
  };
}
