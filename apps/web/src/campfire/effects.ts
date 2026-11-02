import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content/materials';
import { geometryFromChunks } from '@chatdom/render';
import { CAMPFIRE_SEATS, VOXEL_METRES, type CampfireFrame, type DuskCourtPlayerView } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { CHAT_LANTERNS, createChatLanterns, type ChatLanternField, type ChatTransient } from './chat';
import { ahead, FLAME_BASE, type ClearingFrame } from './clearing';
import { createGameLantern } from './clearing/props';
import { createFire, createLanternFlames, createSuspicionEmbers, type LanternFlame } from './fire';
import type { ClearingLight } from './light';

/*
 * What the fire adds to a clearing someone else draws. The caller owns the scene, the camera and the renderer; the
 * clearing's logs, hearth and chair are founded geometry the caller has already drawn. This layer adds only what
 * moves: the flame, its sparks, embers and smoke; one game lantern beside each playing seat; the Gallery's embers
 * by a suspected player; and Twitch chat rising as small lanterns in the dark beyond the logs.
 *
 * Every pool is sized once. A frame writes instance matrices and colours in place and allocates nothing. Draws: four
 * for the fire, one for its glow and one for the warm pool it throws on the ground, one for the lantern bodies, one for
 * their lit panes, two for their flames and smoke, one for the Gallery's embers, one for the chat lanterns, one for
 * every halo and one for the marks of a tap. No real lights: warmth is offered as light-field sources
 * (`lightSources()`) to whoever owns the field; the glow and the pool are what the fire shows on its own, so it reads
 * as the warmest place in the night even where the field does not reach.
 */

export const EFFECT_DRAWS = 14;
const M = VOXEL_METRES.build;
const SEATS = CAMPFIRE_SEATS + 1;
const CHAT = CHAT_LANTERNS.capacity;
const HALOS = SEATS + CHAT;
const TAU = Math.PI * 2;

const smooth = (t: number): number => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const hash = (n: number): number => { const s = Math.sin(n * 91.3 + 47.7) * 43758.5453; return s - Math.floor(s); };

/** How much of the night has come at this hour: 0 by day, 1 from late dusk to before dawn. */
export function nightAt(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return smooth((Math.abs(h - 12) - 4.6) / 2.2);
}

export type LanternLook = 'lit' | 'snuffed' | 'sent' | 'gone';
/** How long a lantern takes to go out when the dawn shows it snuffed, and when the circle sends its keeper away. */
export const SNUFF_SECONDS = 1.4, SEND_SECONDS = .8;

/** One seat's lantern as it shows at `time`, given what it is and since when. Pure, for the effect and its tests. */
export function lanternShow(look: LanternLook, since: number, time: number, out: { level: number; smoke: number; tip: number }) {
  const t = time - since;
  if (look === 'lit') { out.level = 1; out.smoke = 0; out.tip = 0; return out; }
  if (look === 'gone') { out.level = 0; out.smoke = 0; out.tip = 0; return out; }
  if (look === 'snuffed') {
    out.level = 1 - smooth(t / SNUFF_SECONDS);
    // A puff as it goes, then a thin thread for as long as it stands dark.
    out.smoke = t < SNUFF_SECONDS ? smooth(t / (SNUFF_SECONDS * .6)) : .35 + .65 * (1 - smooth((t - SNUFF_SECONDS) / 3));
    out.tip = 0;
    return out;
  }
  out.level = 1 - smooth(t / SEND_SECONDS);
  out.smoke = t < SEND_SECONDS * 3 ? Math.sin(Math.min(1, t / (SEND_SECONDS * 3)) * Math.PI) * .8 : 0;
  out.tip = smooth((t - SEND_SECONDS * .4) / SEND_SECONDS);
  return out;
}

export const lanternLookOf = (player: DuskCourtPlayerView): LanternLook => player.gone && player.lantern === 'lit' ? 'gone' : player.lantern;

export interface ChatLabel { id: string; words: string; x: number; y: number; glow: number; visible: boolean }

export interface CampfireEffectsInput {
  /** Render time in seconds: the flame and every flicker run on it. */
  time: number;
  /** Local wall-clock ms, for the chat lanterns' lives. */
  now: number;
  /** The kingdom's shared hour. */
  hour: number;
  frame: CampfireFrame | null;
  /** The lantern a tap or a ballot is resting on, and the one already chosen. */
  focus: number | null;
  chosen: number | null;
}

export interface CampfireEffects {
  /** Resolves once the lantern body is meshed (it is drawn from then on). */
  readonly ready: Promise<void>;
  readonly group: THREE.Group;
  /** Twitch chat for this kingdom; feed it the room's `transient` messages. Null without a chat source. */
  readonly chat: ChatLanternField | null;
  update(input: Readonly<CampfireEffectsInput>): void;
  /** Warmth for the light field, in world metres. Reused between calls. */
  lightSources(): readonly ClearingLight[];
  /** Chat words in CSS pixels for the caller's camera. Reused between calls. */
  chatLabels(camera: THREE.Camera, width: number, height: number): readonly ChatLabel[];
  /** A seat's lantern in world metres (its flame), for pointing at it. */
  lanternAt(seat: number, target: THREE.Vector3): THREE.Vector3 | null;
  readonly draws: number;
  dispose(): void;
}

export interface CampfireEffectsOptions {
  readonly parent: THREE.Object3D;
  readonly frame: ClearingFrame;
  /** The shared voxel pool and the scene's build-lattice voxel material, for the lantern body. */
  readonly voxels?: { readonly pool: VoxelWorkerPool; readonly material: THREE.Material };
  /** Whose chat rises here; without it no chat lantern is ever raised. */
  readonly chat?: { readonly kingdomId: () => string; readonly origin: () => string };
  readonly clock?: () => number;
}

/** A soft round spot, made once in memory (no canvas: the effect also mounts headless). */
function haloTexture(size = 32): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + .5 - size / 2, y + .5 - size / 2) / (size / 2), a = Math.max(0, 1 - d) ** 2.2;
    const i = (x + y * size) * 4;
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

const LANTERN_GLOW = new THREE.Color('#ffb85c'), CHAT_GLOW = new THREE.Color('#ffd48a'), CHAT_BODY = new THREE.Color('#f3c27a'), CHAT_RIM = new THREE.Color('#8d5a2b');
const FOCUS = new THREE.Color('#f4dc9d'), CHOSEN = new THREE.Color('#ff9a4a');
/** How far past white a burning lantern's glass goes (linear), into the bloom. */
const PANE_BLOOM = 1.6;
const PANE_LIT = new THREE.Color('#ffc46e'), PANE_DARK = new THREE.Color('#2b2633'), FIRE_GLOW = new THREE.Color('#ff9440'), POOL = new THREE.Color('#ff8a3a');
/** How far the fire's warm pool reaches on the ground, metres (past the logs, fading in the grass). */
export const FIRE_POOL_RADIUS = 4.6;

export function mountCampfireEffects(options: CampfireEffectsOptions): CampfireEffects {
  const { frame } = options, arrangement = frame.arrangement;
  const group = new THREE.Group();
  group.name = 'campfire.effects';
  group.position.set(...frame.origin);
  group.rotation.y = frame.turn * Math.PI / 2;
  options.parent.add(group);
  group.updateMatrixWorld(true);

  const fire = createFire();
  fire.group.position.set(...FLAME_BASE);

  // The fire's own glow round the flame, and the warm pool it throws on the ground: additive, so they only add light.
  const glowTexture = haloTexture(64);
  const glowMaterial = new THREE.SpriteMaterial({ map: glowTexture, color: FIRE_GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const glow = new THREE.Sprite(glowMaterial);
  glow.name = 'campfire.fire-glow';
  glow.position.set(FLAME_BASE[0], FLAME_BASE[1] + .42, FLAME_BASE[2]);
  const poolGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const poolMaterial = new THREE.MeshBasicMaterial({ map: glowTexture, color: POOL, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pool = new THREE.Mesh(poolGeometry, poolMaterial);
  pool.name = 'campfire.fire-pool';
  pool.position.set(FLAME_BASE[0], .02, FLAME_BASE[2]);
  pool.scale.set(FIRE_POOL_RADIUS * 2, 1, FIRE_POOL_RADIUS * 2);
  pool.renderOrder = -1;
  const flames = createLanternFlames(SEATS), suspicion = createSuspicionEmbers(SEATS);
  group.add(fire.group, flames.group, suspicion.group, glow, pool);

  // Seats by number, with each seat's lantern and ember spots worked out once.
  const seatAt: ({ lantern: THREE.Vector3; yaw: number; ember: THREE.Vector3 } | null)[] = Array.from({ length: SEATS }, () => null);
  const prop = createGameLantern(61);
  const flameOffset = new THREE.Vector3(...prop.flame), paneOffset = new THREE.Vector3(...prop.pane.centre);

  // Each lantern's lit glass: one warm box between its posts, dark once its flame is out.
  const paneGeometry = new THREE.BoxGeometry(...prop.pane.size);
  const paneMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const panes = new THREE.InstancedMesh(paneGeometry, paneMaterial, SEATS);
  panes.name = 'campfire.lantern-panes'; panes.count = 0; panes.frustumCulled = false;
  panes.setColorAt(0, PANE_LIT);
  group.add(panes);
  for (const seat of arrangement.seats) {
    if (seat.seat < 0 || seat.seat >= SEATS) continue;
    const [lx, lz] = seat.lantern, yaw = Math.atan2(-lx, -lz);
    const [ex, ez] = ahead(seat.hip, seat.heading, .55);
    seatAt[seat.seat] = { lantern: new THREE.Vector3(lx, 0, lz), yaw, ember: new THREE.Vector3(ex, 0, ez) };
  }

  // Per-seat state: what its lantern is and since when. Written in place; nothing per frame is allocated.
  const looks: (LanternLook | null)[] = Array.from({ length: SEATS }, () => null);
  const since = new Float64Array(SEATS);
  const flameSlots: { flame: THREE.Vector3; level: number; smoke: number; seed: number }[] = Array.from({ length: SEATS }, (_, i) => ({ flame: new THREE.Vector3(), level: 0, smoke: 0, seed: hash(i) }));
  const emberSlots: { at: THREE.Vector3; glow: number }[] = Array.from({ length: SEATS }, () => ({ at: new THREE.Vector3(), glow: 1 }));
  const shown = { level: 0, smoke: 0, tip: 0 };
  let match: string | null = null, firstFrame = true;

  // The lantern bodies: one meshed body, one instance per playing seat.
  let bodies: THREE.InstancedMesh | null = null, disposed = false;
  const ready = (async () => {
    if (!options.voxels) return;
    const result = await options.voxels.pool.submit({ kind: 'asset', asset: { ...prop.asset, voxels: prop.asset.voxels.slice() }, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (disposed) return;
    if (result?.kind !== 'asset') throw new Error('The game lantern did not mesh.');
    const geometry = geometryFromChunks(result.chunks, 'build');
    geometry.translate(-prop.anchor[0] * M, -prop.anchor[1] * M, -prop.anchor[2] * M);
    geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(SEATS).fill(1), 1));
    bodies = new THREE.InstancedMesh(geometry, options.voxels.material, SEATS);
    bodies.name = 'campfire.game-lanterns';
    bodies.count = 0;
    bodies.frustumCulled = false;
    group.add(bodies);
  })();

  // Chat lanterns: a paper body each, risen in the dark beyond the logs.
  const chat = options.chat ? createChatLanterns({ kingdomId: options.chat.kingdomId, origin: options.chat.origin, radius: arrangement.radius, ...(options.clock ? { clock: options.clock } : {}) }) : null;
  const chatGeometry = new THREE.BoxGeometry(.15, .19, .15);
  const chatMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const chatBodies = new THREE.InstancedMesh(chatGeometry, chatMaterial, CHAT);
  chatBodies.name = 'campfire.chat-lanterns'; chatBodies.count = 0; chatBodies.frustumCulled = false;
  chatBodies.setColorAt(0, CHAT_BODY);
  group.add(chatBodies);
  const chatPositions = Array.from({ length: CHAT }, () => new THREE.Vector3());

  // Every halo in one draw: game lanterns first, then chat lanterns. Additive, so a dark colour is no halo at all.
  const haloPositions = new Float32Array(HALOS * 3), haloColours = new Float32Array(HALOS * 3);
  const haloGeometry = new THREE.BufferGeometry();
  haloGeometry.setAttribute('position', new THREE.BufferAttribute(haloPositions, 3).setUsage(THREE.DynamicDrawUsage));
  haloGeometry.setAttribute('color', new THREE.BufferAttribute(haloColours, 3).setUsage(THREE.DynamicDrawUsage));
  const halo = haloTexture();
  const haloMaterial = new THREE.PointsMaterial({ size: .9, sizeAttenuation: true, map: halo, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const halos = new THREE.Points(haloGeometry, haloMaterial);
  halos.name = 'campfire.halos'; halos.frustumCulled = false;
  group.add(halos);

  // The marks of a tap: four motes circling the lantern in focus, four resting round the one chosen.
  const markGeometry = new THREE.BoxGeometry(.035, .035, .035);
  const markMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const marks = new THREE.InstancedMesh(markGeometry, markMaterial, 8);
  marks.name = 'campfire.marks'; marks.count = 0; marks.frustumCulled = false;
  marks.setColorAt(0, FOCUS);
  group.add(marks);

  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1), rotation = new THREE.Quaternion(), euler = new THREE.Euler(), colour = new THREE.Color();
  const lights: { position: [number, number, number]; strength: number; reach: number }[] = Array.from({ length: 1 + SEATS }, () => ({ position: [0, 0, 0], strength: 0, reach: 1 }));
  const lightView: ClearingLight[] = [];
  const labels: ChatLabel[] = Array.from({ length: CHAT }, () => ({ id: '', words: '', x: 0, y: 0, glow: 0, visible: false }));
  const labelView: ChatLabel[] = [];
  let fireStrength = 1, chatCount = 0;
  const chatSample: { id: string; words: string; glow: number }[] = Array.from({ length: CHAT }, () => ({ id: '', words: '', glow: 0 }));

  const players: (DuskCourtPlayerView | null)[] = Array.from({ length: SEATS }, () => null);
  const effects: CampfireEffects = {
    ready, group, chat,
    draws: EFFECT_DRAWS,
    update(input) {
      if (disposed) return;
      const { time } = input, night = nightAt(input.hour);
      // Always lit: banked a little by day, comes into its own after dusk.
      fireStrength = .6 + .4 * night;
      fire.update(time, { strength: fireStrength, wind: .05 + .04 * Math.sin(time * .23) });
      const flicker = .92 + .05 * Math.sin(time * 5.3) * Math.sin(time * 2.1 + 1.3) + .03 * Math.sin(time * 11.7);
      glow.scale.setScalar((1.9 + 1.1 * fireStrength) * flicker);
      glowMaterial.color.copy(FIRE_GLOW).multiplyScalar((.32 + .5 * night) * flicker);
      poolMaterial.color.copy(POOL).multiplyScalar((.1 + .5 * night) * flicker);

      // Who plays, and how each lantern stands.
      const court = input.frame?.court ?? null;
      for (let s = 0; s < SEATS; s++) players[s] = null;
      if (court) for (const player of court.players) if (player.seat >= 0 && player.seat < SEATS && seatAt[player.seat]) players[player.seat] = player;
      // A new round lights every lantern without ceremony; so does the first frame anyone sees.
      const fresh = (court?.match ?? null) !== match || firstFrame;
      match = court?.match ?? null;
      firstFrame = false;
      let lanterns = 0, embers = 0, halo = 0;
      for (let s = 0; s < SEATS; s++) {
        const player = players[s], spot = seatAt[s];
        if (!player || !spot) { looks[s] = null; continue; }
        const look = lanternLookOf(player);
        if (looks[s] !== look) { since[s] = fresh || looks[s] === null ? -1e6 : time; looks[s] = look; }
        lanternShow(look, since[s]!, time, shown);
        // Body: upright on its stake, or tipped over when its keeper was sent from the circle.
        if (bodies) {
          euler.set(-shown.tip * 1.35, spot.yaw, 0, 'YXZ');
          rotation.setFromEuler(euler);
          position.copy(spot.lantern); position.y += shown.tip * .06;
          bodies.setMatrixAt(lanterns, matrix.compose(position, rotation, scale));
        }
        // Its pane, turned and tipped with the body; warm while it burns, the dark glass of a snuffed lantern after.
        euler.set(-shown.tip * 1.35, spot.yaw, 0, 'YXZ');
        rotation.setFromEuler(euler);
        position.copy(paneOffset).applyQuaternion(rotation).add(spot.lantern); position.y += shown.tip * .06;
        panes.setMatrixAt(lanterns, matrix.compose(position, rotation, scale));
        // Past 1 when lit, so the kingdom's HDR bloom (threshold ~1) takes the glass and it reads as light, not paint.
        const lit = shown.level * (.88 + .12 * Math.sin(time * 4.1 + s * 1.7)) * (player.away ? .7 : 1);
        colour.copy(PANE_DARK).lerp(PANE_LIT, lit).multiplyScalar(1 + PANE_BLOOM * lit);
        panes.setColorAt(lanterns, colour);
        const slot = flameSlots[lanterns]!;
        slot.flame.copy(flameOffset).applyAxisAngle(THREE.Object3D.DEFAULT_UP, spot.yaw).add(spot.lantern);
        slot.level = shown.level; slot.smoke = shown.smoke; slot.seed = hash(s);
        // Halo: warm while it burns, gone with the flame.
        const glow = shown.level * (.55 + .08 * Math.sin(time * 2.3 + s)) * (player.away ? .6 : 1);
        haloPositions[halo * 3] = slot.flame.x; haloPositions[halo * 3 + 1] = slot.flame.y; haloPositions[halo * 3 + 2] = slot.flame.z;
        colour.copy(LANTERN_GLOW).multiplyScalar(glow);
        haloColours[halo * 3] = colour.r; haloColours[halo * 3 + 1] = colour.g; haloColours[halo * 3 + 2] = colour.b;
        halo++;
        const light = lights[1 + lanterns]!;
        group.localToWorld(position.copy(slot.flame));
        light.position[0] = position.x; light.position[1] = position.y; light.position[2] = position.z;
        light.strength = .3 * shown.level; light.reach = 2.6;
        lanterns++;
        if (player.embers > 0 && !player.gone) {
          const ember = emberSlots[embers++]!;
          ember.at.copy(spot.ember); ember.glow = player.embers;
        }
      }
      if (bodies) { bodies.count = lanterns; bodies.instanceMatrix.needsUpdate = true; }
      panes.count = lanterns; panes.instanceMatrix.needsUpdate = true; if (panes.instanceColor) panes.instanceColor.needsUpdate = true;
      flames.update(time, flameSlots as readonly LanternFlame[], lanterns);
      suspicion.update(time, emberSlots, embers);
      lightView.length = 0;
      group.localToWorld(position.set(0, .45, 0));
      const fireLight = lights[0]!;
      fireLight.position[0] = position.x; fireLight.position[1] = position.y; fireLight.position[2] = position.z;
      fireLight.strength = fireStrength; fireLight.reach = 9;
      lightView.push(fireLight);
      for (let i = 0; i < lanterns; i++) if (lights[1 + i]!.strength > .01) lightView.push(lights[1 + i]!);

      // Marks: focus circles, the chosen one rests.
      let markCount = 0;
      const mark = (seat: number | null, kind: 'focus' | 'chosen') => {
        const spot = seat === null || seat < 0 || seat >= SEATS ? null : seatAt[seat];
        if (!spot || !players[seat!]) return;
        for (let k = 0; k < 4; k++) {
          const spin = kind === 'focus' ? time * 1.6 : time * .3, angle = spin + k * TAU / 4, r = kind === 'focus' ? .2 : .15;
          position.set(spot.lantern.x + Math.sin(angle) * r, (kind === 'focus' ? .34 : .05) + (kind === 'focus' ? Math.sin(time * 3 + k) * .02 : 0), spot.lantern.z + Math.cos(angle) * r);
          rotation.setFromEuler(euler.set(angle, angle * .5, 0));
          marks.setMatrixAt(markCount, matrix.compose(position, rotation, scale));
          marks.setColorAt(markCount, kind === 'focus' ? FOCUS : CHOSEN);
          markCount++;
        }
      };
      if (input.chosen !== null && input.chosen !== input.focus) mark(input.chosen, 'chosen');
      mark(input.focus, 'focus');
      marks.count = markCount;
      marks.instanceMatrix.needsUpdate = true; if (marks.instanceColor) marks.instanceColor.needsUpdate = true;

      // Chat lanterns rise from the dark beyond the logs and drift up as they fade.
      chatCount = 0;
      if (chat) for (const lantern of chat.sample(input.now)) {
        if (chatCount >= CHAT) break;
        const rise = .7 + smooth(lantern.age * 1.4) * .9 + lantern.age * 1.6, sway = Math.sin(time * .9 + lantern.slot * 1.7) * .06;
        const angle = lantern.angle + Math.sin(time * .15 + lantern.slot) * .02;
        const p = chatPositions[chatCount]!.set(Math.sin(angle) * lantern.reach + sway, rise, Math.cos(angle) * lantern.reach);
        rotation.setFromEuler(euler.set(0, time * .2 + lantern.slot, Math.sin(time * 1.1 + lantern.slot) * .08));
        scale.setScalar(.6 + .4 * lantern.glow);
        chatBodies.setMatrixAt(chatCount, matrix.compose(p, rotation, scale));
        scale.setScalar(1);
        colour.copy(CHAT_RIM).lerp(CHAT_BODY, lantern.glow);
        chatBodies.setColorAt(chatCount, colour);
        haloPositions[halo * 3] = p.x; haloPositions[halo * 3 + 1] = p.y; haloPositions[halo * 3 + 2] = p.z;
        colour.copy(CHAT_GLOW).multiplyScalar(.6 * lantern.glow);
        haloColours[halo * 3] = colour.r; haloColours[halo * 3 + 1] = colour.g; haloColours[halo * 3 + 2] = colour.b;
        halo++;
        const sample = chatSample[chatCount]!;
        sample.id = lantern.id; sample.words = lantern.words; sample.glow = lantern.glow;
        chatCount++;
      }
      chatBodies.count = chatCount;
      chatBodies.instanceMatrix.needsUpdate = true; if (chatBodies.instanceColor) chatBodies.instanceColor.needsUpdate = true;
      haloGeometry.setDrawRange(0, halo);
      (haloGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (haloGeometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    },
    lightSources: () => lightView,
    chatLabels(camera, width, height) {
      labelView.length = 0;
      group.updateMatrixWorld();
      for (let i = 0; i < chatCount; i++) {
        const label = labels[i]!, sample = chatSample[i]!;
        position.copy(chatPositions[i]!); position.y += .2;
        group.localToWorld(position).project(camera);
        label.id = sample.id; label.words = sample.words; label.glow = sample.glow;
        label.x = (position.x + 1) / 2 * width; label.y = (1 - position.y) / 2 * height;
        label.visible = position.z < 1 && position.z > -1 && Math.abs(position.x) < 1.1 && Math.abs(position.y) < 1.1;
        labelView.push(label);
      }
      return labelView;
    },
    lanternAt(seat, target) {
      const spot = seat >= 0 && seat < SEATS ? seatAt[seat] : null;
      if (!spot) return null;
      group.updateMatrixWorld();
      return group.localToWorld(target.copy(flameOffset).applyAxisAngle(THREE.Object3D.DEFAULT_UP, spot.yaw).add(spot.lantern));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      chat?.clear();
      fire.dispose(); flames.dispose(); suspicion.dispose();
      glowMaterial.dispose(); glowTexture.dispose(); poolGeometry.dispose(); poolMaterial.dispose();
      paneGeometry.dispose(); paneMaterial.dispose(); panes.dispose();
      if (bodies) { bodies.geometry.dispose(); bodies.dispose(); }
      chatGeometry.dispose(); chatMaterial.dispose(); chatBodies.dispose();
      haloGeometry.dispose(); haloMaterial.dispose(); halo.dispose();
      markGeometry.dispose(); markMaterial.dispose(); marks.dispose();
      group.removeFromParent();
    },
  };
  return effects;
}

/** Feeds a kingdom room's `transient` messages to the chat lanterns. Returns the unsubscribe. */
export function listenForChat(room: { onMessage<T>(type: string, callback: (message: T) => void): () => void }, effects: Pick<CampfireEffects, 'chat'>): () => void {
  if (!effects.chat) return () => {};
  const chat = effects.chat;
  return room.onMessage<ChatTransient>('transient', message => chat.receive(message));
}
