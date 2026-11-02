import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, type VoxelRenderState } from '@chatdom/render';
import { createCitizenMotion, currentFootprint, type CitizenMotion, type CitizenMotionSample, type CitizenRoute, type SettlementPlan } from '@chatdom/world';
import { CitizenChatCueSchema, type CitizenChatCue, type KingdomPresenceFrame, type Vec3 } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import type { ForgeReactionCue } from './forge-flight';
import type { CrowdCall } from '../twitch-moments/stage-beat';
import { walkerSubject, type WalkerSlots } from './observed-walkers';
import { createWalkerLanterns } from './walker-lanterns';
import { createCanvasProbe, disposeCanvasProbe, projectToCanvas, publishSpeech, type SpeechAnchor } from '../walk/labels/bus';
import { speechHoldUntil } from '../walk/labels/timing';

export interface ForgeAudienceBarrel { position: Vec3; height: number }

/** The host's older 80 ms speech shape. Speech now travels per frame on the label bus; see `speechLabels`. */
export interface SpeechLabel { slot: number; name: string | null; x: number; y: number; distance: number; parts: CitizenChatCue['parts'] }

/** A chat-only person's bubble rises from just above their door, in front of the facade. */
export const HOME_SPEECH_RISE_M = 2.7;
const HOME_SPEECH_OUTSET_M = .15;
/**
 * Homes hide a home's bubble only up to this height. The plan knows every footprint but not each roofline, so a
 * cottage's eaves stand in for all of them: a bubble is never hidden by a roof it might clear.
 */
export const HOME_OCCLUDER_HEIGHT_M = 4.2;
/** Home bubbles further than this are never shown (the label layer's widest bubble range plus slack). */
const HOME_SPEECH_REACH_M = 40;

/** Where a chat-only person's speech is anchored: above the door their route ends at, facing the street. */
export function homeSpeechAnchor(route: Pick<CitizenRoute, 'points' | 'homeHeading'>): Vec3 | undefined {
  const door = route.points.at(-1);
  if (!door || !door.every(Number.isFinite) || !Number.isFinite(route.homeHeading)) return undefined;
  // homeHeading faces into the home; the street is behind the person standing at the door.
  const outX = -Math.sin(route.homeHeading), outZ = -Math.cos(route.homeHeading);
  return [door[0] + outX * HOME_SPEECH_OUTSET_M, door[1] + HOME_SPEECH_RISE_M, door[2] + outZ * HOME_SPEECH_OUTSET_M];
}

/** Does the segment a→b pass through the box? Slab test; both ends are in the same space as the box. */
export function segmentHitsBox(a: Vec3, b: Vec3, min: Vec3, max: Vec3): boolean {
  let start = 0, end = 1;
  for (let axis = 0; axis < 3; axis++) {
    const from = a[axis]!, delta = b[axis]! - from;
    if (Math.abs(delta) < 1e-9) { if (from < min[axis]! || from > max[axis]!) return false; continue; }
    const p = (min[axis]! - from) / delta, q = (max[axis]! - from) / delta;
    start = Math.max(start, Math.min(p, q)); end = Math.min(end, Math.max(p, q));
    if (end <= start) return false;
  }
  return true;
}

/** An in-memory handoff for a single scene rebuild; never serialised or shared with the realm. */
export interface CitizenSceneCheckpoint {
  used: boolean;
  readonly revision: string;
  readonly seed: string;
  readonly castleHome: boolean;
  readonly barrelKey: string;
  readonly watcherArrivals: ReadonlyMap<number, number>;
  readonly frame: KingdomPresenceFrame;
  readonly motion: CitizenMotion;
  readonly watchers: ReadonlyMap<number, string>;
  readonly looks: ReadonlyMap<number, string>;
}

/** A present person's sample. Only a walker can be seated: chat-only people have no body to sit down. */
export type CitizenSample = CitizenMotionSample & { readonly posture?: 'seated' };

interface Spoken { readonly cue: CitizenChatCue; firstSeenMs: number | null }

/**
 * Chat-only people as light (decision 13). Someone who chats but is not walking has no body in the streets: they
 * are their lit window and a bubble rising from their home. Bodies belong only to the realm's walkers, drawn by
 * `walk-scene.ts` (you and the people in your room) or `observed-walkers.ts` (the stream's view of them); this
 * module still carries a walker's lantern and keeps their home slot's presence, light and speech.
 *
 * The public presence projection is unchanged. Windows light from presence: a person's window is lit from the
 * moment the projection says they are present (their `since`), with no unseen walk home in between.
 */
export function createKingdomCitizens(scene: THREE.Scene, layout: SettlementPlan, pool: VoxelWorkerPool, clay: VoxelRenderState, castleHome = false, checkpoint?: CitizenSceneCheckpoint, forgeBarrel?: ForgeAudienceBarrel) {
  if (forgeBarrel && (![...forgeBarrel.position, forgeBarrel.height].every(Number.isFinite) || forgeBarrel.height <= 0)) throw new Error('Invalid Forge audience barrel.');
  const barrelKey = JSON.stringify(forgeBarrel ?? null);
  // Routes give every home its door. No goals are requested: nobody unseen walks anywhere.
  let motion = createCitizenMotion(layout, { castleHome });
  let pendingCheckpoint = checkpoint;
  const capacity = layout.homes.length + Number(castleHome);
  // The people material: walkers are drawn with it by the walk and observed renderers. Moving people receive
  // open-sky fill; per-part baked cavities must not turn darker skin into a silhouette before a nearby window lights.
  const material = createVoxelMaterial(MATERIALS, 'avatar');
  material.material.fragmentShader = material.material.fragmentShader.replace('float sky=mix(.24,1.,vSky);', 'float sky=mix(.72,1.,vSky);').replace('vec3 colour=base*edge*light*ao;', 'vec3 colour=base*edge*(light+vec3(.4,.32,.25)*(1.-.85*smithyInfluence))*ao;');
  for (const key of ['uSmithyPower','uSmithyOrigin','uLight','uLightOrigin','uLightExtent','uFarLight','uFarOrigin','uFarExtent','uFarCell','uBeaconLight','uBeaconOrigin','uBeaconExtent','uBeaconCell']) material.material.uniforms[key] = clay.material.uniforms[key]!;
  const lanterns = createWalkerLanterns(scene, Math.max(1, capacity));
  const suppliedLooks = new Map<number, string>();
  let frame: KingdomPresenceFrame | undefined;
  /** Every present person, standing at their own door, unseen (opacity 0). Rebuilt when presence changes. */
  let doorSamples: readonly CitizenMotionSample[] = [], doorBuiltAt = -Infinity, nextArrivalMs = Infinity;
  let samples: readonly CitizenSample[] = [], carrying: readonly CitizenMotionSample[] = [];
  let walkers: WalkerSlots = new Map();
  const speech = new Map<number, Spoken>();
  let lastAtMs = -Infinity, namedHomes: ReadonlySet<number> = new Set();
  // Kept with the frame and the doors they come from, never rebuilt per drawn frame (thousands of chatters).
  let namesBySlot: ReadonlyMap<number, string | null> = new Map(), presentSlots: ReadonlySet<number> = new Set();
  let sampleIndex: ReadonlyMap<number, number> = new Map();

  const probe = createCanvasProbe();
  scene.add(probe);
  const anchors = new Map<number, Vec3 | null>();
  const anchorFor = (slot: number) => {
    if (!anchors.has(slot)) { const route = motion.routeForSlot(slot); anchors.set(slot, route ? homeSpeechAnchor(route) ?? null : null); }
    return anchors.get(slot) ?? undefined;
  };
  // Footprint boxes of every home, for the cheap wall test on home bubbles.
  const occluders = new Float32Array(layout.homes.length * 6);
  layout.homes.forEach((home, index) => {
    const footprint = currentFootprint(home), y = home.position[1];
    occluders.set([footprint.minX, y, footprint.minZ, footprint.maxX, y + HOME_OCCLUDER_HEIGHT_M, footprint.maxZ], index * 6);
  });
  function hidden(eye: Vec3, anchor: Vec3): boolean {
    const minX = Math.min(eye[0], anchor[0]), maxX = Math.max(eye[0], anchor[0]), minZ = Math.min(eye[2], anchor[2]), maxZ = Math.max(eye[2], anchor[2]);
    for (let i = 0; i < occluders.length; i += 6) {
      if (occluders[i + 3]! < minX || occluders[i]! > maxX || occluders[i + 5]! < minZ || occluders[i + 2]! > maxZ) continue;
      if (segmentHitsBox(eye, anchor, [occluders[i]!, occluders[i + 1]!, occluders[i + 2]!], [occluders[i + 3]!, occluders[i + 4]!, occluders[i + 5]!])) return true;
    }
    return false;
  }

  function buildDoors(atMs: number) {
    doorBuiltAt = atMs; nextArrivalMs = Infinity;
    if (!frame) { doorSamples = []; presentSlots = new Set(); sampleIndex = new Map(); return; }
    const built: CitizenMotionSample[] = [];
    for (const window of frame.windows) {
      if (!window.present) continue;
      if (window.since > atMs) { nextArrivalMs = Math.min(nextArrivalMs, window.since); continue; }
      const route = motion.routeForSlot(window.slot), door = route?.points.at(-1);
      if (!route || !door) continue;
      built.push({ slot: window.slot, publicName: window.publicName, state: 'home', position: door, heading: route.homeHeading,
        speed: 0, distance: 0, walkPhase: 0, homeLit: true, homeLitAtMs: window.since, opacity: 0,
        goalNodeId: route.destinationNodeId, goalReached: true });
    }
    doorSamples = built.sort((a, b) => a.slot - b.slot);
    presentSlots = new Set(doorSamples.map(sample => sample.slot));
    sampleIndex = new Map(doorSamples.map((sample, index) => [sample.slot, index]));
  }
  /** A walker's own feet stand in for their door sample; they are drawn, so they are seen. */
  const walkerSample = (sample: CitizenMotionSample): CitizenSample => {
    const subject = walkerSubject(sample, walkers), walker = walkers.get(sample.slot)!;
    return { ...subject, opacity: 1, state: walker.speed > .05 ? 'walking' : 'idle', goalReached: walker.speed <= .05,
      ...(walker.posture ? { posture: walker.posture } : {}) };
  };

  function publish(camera: THREE.Camera) {
    const canvas = probe.canvas;
    if (!canvas) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const lines: SpeechAnchor[] = [];
    if (width > 0 && height > 0 && speech.size) {
      const toWorld = scene.matrixWorld, identity = toWorld.equals(IDENTITY);
      const eyeWorld = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      const eyeLocal = identity ? eyeWorld : eyeWorld.clone().applyMatrix4(new THREE.Matrix4().copy(toWorld).invert());
      const eye: Vec3 = [eyeLocal.x, eyeLocal.y, eyeLocal.z];
      for (const [slot, { cue }] of speech) {
        if (cue.asOf > lastAtMs) continue;
        const walker = walkers.get(slot);
        const name = namedHomes.has(slot) ? null : namesBySlot.get(slot) ?? null;
        if (walker) { lines.push({ slot, cueId: cue.id, name, parts: cue.parts, from: 'walker' }); continue; }
        const anchor = anchorFor(slot);
        if (!anchor) continue;
        const point = new THREE.Vector3(...anchor);
        if (!identity) point.applyMatrix4(toWorld);
        const projected = projectToCanvas(point, camera, width, height);
        if (!projected || projected.distance > HOME_SPEECH_REACH_M) continue;
        lines.push({ slot, cueId: cue.id, name, parts: cue.parts, from: 'home', x: projected.x, y: projected.y,
          distance: projected.distance, visibility: hidden(eye, anchor) ? 0 : 1 });
      }
    }
    publishSpeech(canvas, { at: performance.now(), width, height, speech: lines });
  }

  return {
    material, get motion() { return motion; },
    /** Kept for the host's loading sequence. Chat-only people have no bodies to mesh, so the voxel pool is unused. */
    prepare(): Promise<void> { return Promise.resolve(); },
    applyFrame(next: KingdomPresenceFrame) {
      // Only restore after a fresh projection has established the same authority and
      // cannot predate the checkpoint. No checkpoint data is visible before this.
      const saved = pendingCheckpoint; pendingCheckpoint = undefined;
      if (saved && !saved.used && saved.revision === layout.revision && saved.seed === layout.config.seed && saved.castleHome === castleHome && saved.barrelKey === barrelKey
        && saved.frame.kingdomId === next.kingdomId && saved.frame.epoch === next.epoch && saved.frame.origin === next.origin
        && next.sequence >= saved.frame.sequence && next.asOf >= saved.frame.asOf
        && (next.sequence > saved.frame.sequence || JSON.stringify(next) === JSON.stringify(saved.frame))) {
        saved.used = true;
        motion = saved.motion; anchors.clear();
        for (const [slot, look] of saved.looks) suppliedLooks.set(slot, look);
      }
      if (frame && (frame.kingdomId !== next.kingdomId || frame.epoch !== next.epoch || frame.origin !== next.origin || next.asOf < frame.asOf)) { suppliedLooks.clear(); speech.clear(); }
      for (const window of next.windows) if (window.look !== undefined) suppliedLooks.set(window.slot, window.look);
      frame = next; motion.applyFrame(next);
      namesBySlot = new Map(next.windows.map(window => [window.slot, window.publicName]));
      doorBuiltAt = -Infinity;
    },
    /** Called only after the outgoing renderer has stopped advancing its motion. */
    restoreCheckpoint(saved: CitizenSceneCheckpoint | undefined) {
      if (!saved) return;
      pendingCheckpoint = saved;
      if (frame) this.applyFrame(frame);
    },
    checkpoint(): CitizenSceneCheckpoint | undefined {
      if (!frame) return undefined;
      // Nobody unseen walks to the Forge any more, so there are never watchers to carry across a rebuild.
      return { used: false, revision: layout.revision, seed: layout.config.seed, castleHome, barrelKey, watcherArrivals: new Map(), frame, motion,
        watchers: new Map(), looks: new Map(suppliedLooks) };
    },
    receiveChat(input: unknown) {
      const result = CitizenChatCueSchema.safeParse(input);
      if (!result.success || !frame) return false;
      const cue = result.data;
      if (cue.kingdomId !== frame.kingdomId || cue.epoch !== frame.epoch || cue.origin !== frame.origin || !frame.windows.some(w => w.slot === cue.slot && w.present)) return false;
      const previous = speech.get(cue.slot);
      if (previous && previous.cue.asOf >= cue.asOf) return false;
      speech.set(cue.slot, { cue, firstSeenMs: null }); return true;
    },
    clearChat(cueIds?: readonly string[]) {
      if (!cueIds) { speech.clear(); return; }
      const removed = new Set(cueIds);
      for (const [slot, { cue }] of speech) if (removed.has(cue.id)) speech.delete(slot);
    },
    /** Chat-only people have no bodies to gather at the Forge; walkers come on their own feet. Validated, then ignored. */
    watchForge(active: boolean, atMs: number, anchor: Vec3) {
      if (!Number.isFinite(atMs) || !anchor.every(Number.isFinite) || !active) return;
    },
    /** As with the Forge: only walkers can sit at the royal fire, and they walk there themselves. */
    gatherFire(active: boolean, atMs: number, anchor: Vec3) {
      if (!Number.isFinite(atMs) || !anchor.every(Number.isFinite) || !active) return;
    },
    /**
     * Samples every present person: at their door and unseen for chat-only people, at their own feet for walkers.
     * Forge reactions and crowd calls have no chat-only bodies to turn; walkers' renderers answer them.
     */
    update(atMs: number, _time: number, _camera?: THREE.Camera, _reservedSlots?: ReadonlySet<number>, walkerFeet: WalkerSlots = new Map(), reaction: ForgeReactionCue | null = null, call: CrowdCall | null = null) {
      void reaction; void call;
      walkers = walkerFeet; lastAtMs = atMs;
      if (!Number.isFinite(atMs)) return samples;
      if (doorBuiltAt === -Infinity || atMs < doorBuiltAt || atMs >= nextArrivalMs) buildDoors(atMs);
      samples = walkers.size ? doorSamples.map(sample => walkers.has(sample.slot) ? walkerSample(sample) : sample) : doorSamples;
      carrying = walkers.size ? samples.filter(sample => { const walker = walkers.get(sample.slot); return walker && !walker.posture; }) : [];
      for (const [slot, spoken] of speech) {
        if (!presentSlots.has(slot)) { speech.delete(slot); continue; }
        if (spoken.cue.asOf > atMs) continue;
        spoken.firstSeenMs ??= atMs;
        if (atMs >= speechHoldUntil(spoken.cue, spoken.firstSeenMs)) speech.delete(slot);
      }
      return samples;
    },
    /** Every frame, after the final camera transform: walkers' lanterns, and this frame's speech for the label layer. */
    drawLanterns(time: number, night: number, camera?: THREE.Camera, walkerGrips?: ReadonlyMap<string, THREE.Matrix4>) {
      const grips = new Map<number, THREE.Matrix4>();
      for (const sample of carrying) {
        const walker = walkers.get(sample.slot), grip = walker && walkerGrips?.get(walker.id);
        if (grip) grips.set(sample.slot, grip);
      }
      lanterns.update(carrying, time, night, camera, grips);
      if (camera) publish(camera);
    },
    sources: () => lanterns.sources(),
    lightFrame(atMs: number): KingdomPresenceFrame | undefined {
      if (!frame) return;
      const lit = new Map(doorSamples.map(sample => [sample.slot, sample.homeLitAtMs!]));
      return { ...frame, asOf: Math.max(frame.asOf, Math.ceil(atMs)), windows: frame.windows.map(window => ({ ...window,
        since: lit.has(window.slot) ? Math.ceil(lit.get(window.slot)!) : window.since,
        present: window.present && lit.has(window.slot), publicName: window.present && lit.has(window.slot) ? window.publicName : null })) };
    },
    /**
     * A director's subject. A walker is where their body is. A chat-only person has no body: the honest subject is
     * their own door, unseen (opacity 0) and already home, so an arrival shot frames their lit window and nothing
     * aims at a person who is not there.
     */
    subject(slot: number) { const index = sampleIndex.get(slot); return index === undefined ? undefined : samples[index]; },
    /**
     * The host still calls this every 80 ms. Speech now goes to the label layer every frame from `drawLanterns`,
     * so this returns nothing; it only learns which homes already show their name plate, so a bubble from that home
     * does not repeat the name.
     */
    speechLabels(_camera: THREE.Camera, _width: number, _height: number, _atMs: number, named: ReadonlySet<number> = new Set(), walkerHeads?: ReadonlyMap<string, THREE.Vector3>): SpeechLabel[] {
      // Walker bubbles ride on the walker's own per-frame name label, which the host projects from these same heads.
      void walkerHeads;
      namedHomes = named;
      return [];
    },
    clear() {
      pendingCheckpoint = undefined; motion.clear(); frame = undefined; doorSamples = []; doorBuiltAt = -Infinity; nextArrivalMs = Infinity;
      namesBySlot = new Map(); presentSlots = new Set(); sampleIndex = new Map();
      samples = []; carrying = []; walkers = new Map(); suppliedLooks.clear(); speech.clear(); lanterns.update([], 0, 0);
    },
    dispose() { lanterns.dispose(); material.dispose(); disposeCanvasProbe(probe); speech.clear(); },
  };
}

const IDENTITY = new THREE.Matrix4();
