import * as THREE from 'three';
import { REALM_NO_HOME_SLOT, kingdomRoomId, type CollisionWorld, type RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import type { VoxelRenderState } from '@chatdom/render';
import { MATERIALS } from '@chatdom/content';
import { createCitizenRenderer, createDefaultCitizenLooks, type CitizenRenderLook } from '../citizens';
import type { RealmClient, RealmCollision, RealmWalkerPose } from '../realm/client';
import { createWalkController, headingFromByte, type WalkControllerOptions } from '../walk';
import { createFoundedInteractionRegistry, homeZone, STREET_ZONE } from '@chatdom/world/interactions';
import { interactionSound, mountInteractionController, type InteractionPlaces } from '../interactions';
import { bindWalkInteractions } from './walk-interactions';
import { createHomeStepMaterial, createOthersSteps, createPlacementStepSurface, createPublicStepSurface, createStepCueMaterial, othersStepDistance } from './walk-footsteps';
import type { createKingdomSound } from './sound';
import type { KingdomAudio } from '@chatdom/audio';
import { presentWalkers, type WalkerPresentation } from './walker-presentation';
import { createWalkerFigures, createWalkerSplit, createWalkerViewTest } from './walker-figures';
import { createPlaySession, type PlaySession } from '../play/session';
import type { PlayBuildEntry, PlayVolume } from '../play/host';
import { wayHomeFrom } from '../play/way-home';
import { placeCameraAt, provideObservedWalkerHands } from '../play/slots';
import { withRegisteredPlaces } from '../play/places';
import { bindPortalSource, type PortalSource } from '../play/portals';
import { mountPlayHud } from '../play';
import { sharedPlaySettings } from '../play/settings';
import { createWalkerGround } from '../walk/ground';
import { sampleFoundedTerrain } from '@chatdom/world/founded-collision';
import type { PlaySettings } from '../play/slots';
import '../play/providers';

/** Other walkers' steps are heard within this many metres. */

export interface KingdomWalkBinding {
  readonly client: RealmClient;
  readonly collision: CollisionWorld | RealmCollision;
  /** Already fetched and hash-checked by the entry adapter; never an identity or an entry ticket. */
  readonly manifest: RealmFoundedManifest;
  readonly hud?: HTMLElement;
  /** Arrival view only, in radians. Movement still uses the room's own yaw and quantized input. */
  readonly heading?: number;
  /** Approved server-owned worn recipes, including all IDs in the room. */
  readonly appearances?: readonly CitizenRenderLook[];
  /** Authenticated current gesture transport, when available. */
  readonly gestures?: WalkControllerOptions['gestures'];
  /** Request a new checked scene when authority changes geometry. Called once; entry owns reinstallation. */
  readonly onSceneNeeded?: () => void;
  /** A real place's own view, opened only after room acceptance. */
  readonly interactionPlaces?: InteractionPlaces;
  /** The play layer's facts the entry knows: whether the stream is live, and where building really opens. */
  readonly play?: { readonly live?: () => boolean; readonly build?: PlayBuildEntry;
    /** The scene's hour and the kingdom's approved name, for walk features (play SEAMS B1c). */
    readonly hour?: () => number; readonly kingdomName?: string };
  /**
   * The entry's way through doors into rooms of their own (the tavern): its session, its transport, leaving this room
   * and joining it again at a door. Without it no door opens (play/portal.ts).
   */
  readonly portal?: Pick<PortalSource, 'entry' | 'endpoint' | 'title' | 'leave' | 'rejoin'>;
  /** Dev stills only (walk/stills, the "before" sole close-ups): false draws every body at its physics height. */
  readonly drawnGround?: boolean;
}

/** Building in a founded kingdom opens with the street; until then the ledger says so in one honest line. */
export const FOUNDED_BUILD_NOTE = 'Building opens here when your street opens to building. Your home stays as the kingdom drew it until then.';

export interface WalkerLabel { readonly id: string; readonly name: string; readonly self: boolean; readonly x: number; readonly y: number; readonly distance: number; readonly slot?: number; readonly opacity?: number }

export function checkWalkBinding(founded: RealmFoundedScene | undefined, binding: KingdomWalkBinding): void {
  const { manifest, client } = binding, state = client.room.state;
  if (!founded || manifest.kingdomId !== founded.kingdomId || manifest.origin !== founded.origin
    || manifest.layoutRevision !== founded.layoutRevision || manifest.collisionRevision !== founded.collisionRevision
    || client.room.roomId !== kingdomRoomId(manifest.kingdomId) || state.kingdomId !== manifest.kingdomId
    || state.origin !== manifest.origin || state.layoutRevision !== manifest.layoutRevision || state.collisionRevision !== manifest.collisionRevision) {
    throw new Error('Walking needs the kingdom’s current founded scene');
  }
  const world = 'query' in binding.collision ? binding.collision : binding.collision.world(manifest.collisionRevision);
  if (!world || world.revision !== manifest.collisionRevision) throw new Error('Walking is waiting for the kingdom’s ground');
}

/** One renderer/camera owner in the existing kingdom. Entry, public state and world production stay with wiring. */
export async function createKingdomWalk(scene: THREE.Scene, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement,
  pool: VoxelWorkerPool, material: VoxelRenderState, binding: KingdomWalkBinding, founded: RealmFoundedScene,
  sound: Pick<ReturnType<typeof createKingdomSound>, 'cue' | 'enabled'> & {
    /** The ledger's volumes, applied live; `volumes` names the faders it really honours. Without it there is no Sound section. */
    setVolumes?: (volume: PlaySettings['volume']) => void; volumes?: readonly PlayVolume[];
    /** The unlocked mixer itself for walk features, or null while it may not sound. Without it features hear nothing. */
    audio?: () => KingdomAudio | null;
  }) {
  const looks = binding.appearances ?? createDefaultCitizenLooks(), lookIds = new Set(looks.map(look => look.id));
  const knownLook = (id: string) => lookIds.has(id);
  const people = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity: 300, pool });
  // The nearest 64 walkers are drawn in full; everyone further off as one instanced draw of simple figures.
  const split = createWalkerSplit(), inView = createWalkerViewTest(), figures = createWalkerFigures(scene, material), eye = new THREE.Vector3();
  const client = binding.client;
  const currentWorld = () => 'query' in binding.collision
    ? binding.collision.revision === client.room.state.collisionRevision ? binding.collision : null
    : binding.collision.world(client.room.state.collisionRevision);
  const controller = createWalkController({ camera, surface: canvas, realm: client, collision: currentWorld, settings: sharedPlaySettings(),
    ...(binding.hud ? { hud: binding.hud } : {}), ...(binding.gestures ? { gestures: binding.gestures } : {}), ...(binding.heading !== undefined ? { heading: binding.heading } : {}) });
  controller.resize(canvas.clientWidth, canvas.clientHeight);
  const registry = createFoundedInteractionRegistry(founded, currentWorld()!);
  const connection = bindWalkInteractions(client.room, interactionSound(sound));
  const host = binding.hud ?? canvas.parentElement;
  if (!host) { connection.dispose(); controller.dispose(); people.dispose(); figures.dispose(); throw new Error('The kingdom interaction surface is unavailable'); }
  const interactions = mountInteractionController({ host, surface: canvas, session: connection.session, camera: controller,
    places: withRegisteredPlaces(binding.interactionPlaces) });
  const projected = new THREE.Vector3(), direction = new THREE.Vector3(), raycaster = new THREE.Raycaster();
  const selfWalker = () => client.room.state.walkers.get(client.selfId);
  // A tool's pose ("hold", "cast", "reel") for you and for walkers whose tools say so. Until the body has those
  // poses, an extended arm (the pointing gesture) carries the tool.
  const toolPoses = new Map<string, 'cast' | 'hold' | 'reel'>();
  const stopHands = provideObservedWalkerHands({
    hand: id => people.grips.get(id) ?? null,
    pose: (id, pose) => { if (pose) toolPoses.set(id, pose); else toolPoses.delete(id); },
  });
  let play: PlaySession;
  const self = { personId: client.selfId, get publicName() { return selfWalker()?.name ?? ''; }, get lookToken() { return selfWalker()?.look ?? ''; } };
  try {
    play = createPlaySession({ host, controller, kingdomId: binding.manifest.kingdomId, self,
      live: binding.play?.live ?? (() => false),
      wayHome() {
        const self = controller.debug.self;
        if (!self) return null;
        camera.getWorldDirection(direction);
        const state = connection.session.snapshot().self;
        return wayHomeFrom(founded, connection.ownedPlotId, [self.x, self.y, self.z], [direction.x, direction.z],
          state.mode === 'interior' && !!state.plotId && state.plotId === connection.ownedPlotId);
      },
      build: binding.play?.build ?? { open: null, note: FOUNDED_BUILD_NOTE },
      volumes: sound.setVolumes ? sound.volumes ?? [] : [],
      cue: surface => { sound.cue('wood', { ui: surface }); },
      use: () => interactions.use(),
      mountHud: mountPlayHud,
      world: {
        room: { onMessage: (type, callback) => client.room.onMessage(type, callback), send: (type, payload) => client.room.send(type, payload) },
        pose() {
          const self = controller.debug.self;
          if (!self) return null;
          return { position: [self.x, self.y, self.z], yaw: headingFromByte(self.yaw), lookUp: -controller.debug.camera.pitch,
            grounded: client.predicted?.grounded ?? true };
        },
        hand: () => people.grips.get(client.selfId) ?? null,
        holdPose: pose => { if (pose) toolPoses.set(client.selfId, pose); else toolPoses.delete(client.selfId); },
        scene, camera,
        now: () => performance.now(),
        interactionFocused: () => !!interactions.debug.focus,
      },
      features: {
        selfWalkerId: () => selfWalker() ? client.selfId : null,
        walkers: () => poses.map(pose => ({ id: pose.id, position: [pose.x, pose.y, pose.z] as const, yaw: headingFromByte(pose.yaw), self: pose.self, name: pose.name })),
        // The kingdom page always lends its hour; dusk is the page's own opening hour when a host lends none.
        hour: () => binding.play?.hour?.() ?? 19.5,
        kingdomName: binding.play?.kingdomName ?? '',
        audio: () => sound.audio?.() ?? null,
        overlayHost: host,
      },
    });
  } catch (error) { stopHands(); interactions.dispose(); connection.dispose(); controller.dispose(); people.dispose(); figures.dispose(); throw error; }
  // A door stands you up first, so no seat is held in a room you have left, and lets the mouse go before the room goes.
  const portal = binding.portal;
  const stopPortal = portal ? bindPortalSource({ kingdomId: binding.manifest.kingdomId, self, entry: portal.entry, endpoint: portal.endpoint,
    title: portal.title, rejoin: arrival => portal.rejoin(arrival),
    leave: async () => { if (interactions.debug.held) interactions.leave(); controller.release(); await portal.leave(); } }) : () => {};
  // While the mouse is captured its position is frozen where the lock began: a click uses what the centre of the
  // view highlights, never a pick at that stale point. The first click only captures (the walk takes it first).
  // The ledger's volumes apply live once the kingdom's sound offers them (asked of the sound's owner in play's progress).
  const applyVolumes = (settings: Readonly<PlaySettings>) => sound.setVolumes?.(settings.volume);
  applyVolumes(sharedPlaySettings().current);
  const stopVolumes = sharedPlaySettings().subscribe(applyVolumes);
  // A seated game's input lease or the tool in hand takes the press first; then a world prompt; then the world.
  const lockedPress = (event: PointerEvent) => {
    if (event.target !== canvas || controller.cursor.mode !== 'locked' || event.pointerType !== 'mouse') return;
    event.stopImmediatePropagation();
    if (play.pointer(event.type === 'pointerdown' ? 'down' : 'up', event.button, event.buttons)) return;
    if (event.type === 'pointerdown' && event.button === 0 && !play.use()) interactions.use();
  };
  // The secondary button never opens the browser's menu over a captured world.
  const lockedMenu = (event: MouseEvent) => { if (controller.cursor.mode === 'locked') event.preventDefault(); };
  canvas.addEventListener('contextmenu', lockedMenu);
  host.addEventListener('pointerdown', lockedPress, { capture: true });
  host.addEventListener('pointerup', lockedPress, { capture: true });
  const homeStepMaterial = createHomeStepMaterial(founded);
  const publicStep = createPublicStepSurface(founded.plan), placedStep = createPlacementStepSurface(founded), stepCue = createStepCueMaterial();
  // A deck, a pier, steps or a floor under the sole decide first; then the public ground under it.
  const groundStep = (at: readonly [number, number, number]) => placedStep(at) ?? publicStep(at[0], at[2]);
  let lastFootstepContext: { now: number; placement: number; revision: number } | undefined;
  const othersSteps = createOthersSteps();
  const earRight = new THREE.Vector3(), footOffset = new THREE.Vector3();
  const resetFootsteps = () => { lastFootstepContext = undefined; };
  document.addEventListener('visibilitychange', resetFootsteps);
  window.addEventListener('blur', resetFootsteps);
  let poses: readonly WalkerPresentation[] = [], walkingPoses: readonly RealmWalkerPose[] = [], connected = true, waiting = false;
  const left = () => { connected = false; poses = []; resetFootsteps(); controller.release(); people.update([]); figures.update([], performance.now()); split.clear(); ground.reset(); };
  const reconnected = () => { connected = true; };
  client.room.onLeave(left);
  client.room.onDrop(left);
  client.room.onReconnect(reconnected);
  const point = new THREE.Vector3();
  let lastPlayFrame: number | null = null;
  // F07: every drawn body rests on the drawn ground. Presentation only: the camera, prediction, collision, reach and
  // footstep gating keep the physics pose; the offset is eased and clamped to the physics gap (walk/ground).
  const terrain = sampleFoundedTerrain(founded.plan);
  const ground = createWalkerGround({ scene, world: () => connected && !waiting ? currentWorld() : null,
    terrainFloorY: terrain.origin[1], terrainCeilingY: terrain.ceilingY });
  const drawnHeights = new Map<string, number>();
  let lastDraw: number | null = null;
  return {
    controller,
    get poses() { return poses; },
    get grips() { return people.grips; },
    get heads() { return people.heads; },
    get connected() { return connected; },
    frame(now: number, selected: boolean) {
      const state = client.room.state;
      if (state.layoutRevision !== binding.manifest.layoutRevision || state.collisionRevision !== binding.manifest.collisionRevision) {
        connection.session.disconnect();
        resetFootsteps(); controller.release(); client.clearInput(); poses = []; people.update([]); figures.update([], now); split.clear(); ground.reset();
        if (!waiting) { waiting = true; binding.onSceneNeeded?.(); }
        return false;
      }
      const active = selected && connected && !waiting;
      // A place's accepted view holds the same walk token until the interaction controller returns it.
      if (active && controller.owner === 'released' && !interactions.debug.held) { resetFootsteps(); camera.clearViewOffset(); controller.resume(); }
      else if (!active) { if (interactions.debug.held) interactions.leave(); controller.release(); }
      walkingPoses = connected && !waiting ? controller.frame(now) : [];
      const self = controller.debug.self;
      const place = self && controller.owner === 'walking' ? placeCameraAt([self.x, self.y, self.z]) : null;
      controller.limitCamera(place ? { maxDistance: place.maxDistance, tilt: place.tilt, seeThrough: seeThroughBoxes(place.seeThrough) } : null);
      play.frame(lastPlayFrame === null ? 0 : Math.max(0, Math.min(.1, (now - lastPlayFrame) / 1000)));
      lastPlayFrame = now;
      poses = presentWalkers(walkingPoses, connection.session.snapshot().seats, registry);
      return active;
    },
    /** After the scene's final camera transform, before drawing: all input paths use these native targets. */
    interact(now: number) {
      const self = controller.debug.self;
      if (!self) return;
      const state = connection.session.snapshot().self;
      camera.getWorldDirection(direction);
      interactions.frame({ now, look: { feet: [self.x, self.y, self.z], forward: [direction.x, direction.y, direction.z] },
        records: registry.records, world: waiting || !connected ? null : currentWorld(),
        actor: { walkerId: client.selfId, zone: state.mode === 'interior' && state.plotId ? homeZone(state.plotId) : STREET_ZONE,
          ownedPlotId: connection.ownedPlotId },
        project(position) {
          projected.set(...position).project(camera);
          if (projected.z < -1 || projected.z > 1) return null;
          const surface = canvas.getBoundingClientRect(), root = host.getBoundingClientRect();
          return { x: surface.left - root.left + (projected.x + 1) * surface.width / 2,
            y: surface.top - root.top + (1 - projected.y) * surface.height / 2 };
        },
        ray(x, y) {
          if (!canvas.clientWidth || !canvas.clientHeight) return null;
          raycaster.setFromCamera(new THREE.Vector2(x / canvas.clientWidth * 2 - 1, 1 - y / canvas.clientHeight * 2), camera);
          const { origin, direction } = raycaster.ray;
          return { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z] };
        },
      });
    },
    interactionDebug: interactions.debug,
    /** Call after the final camera transform, so frustum culling uses the camera that actually draws. */
    draw(now: number) {
      // A walker whose look is not here yet is still a person in the street: a simple figure until it is.
      const parts = split.split(connected ? poses : [], eye.setFromMatrixPosition(camera.matrixWorld), now, inView(camera));
      const full = parts.full.filter(({ pose }) => knownLook(pose.look));
      // Your own body is never a stand-in figure: it hides in first person, which a figure cannot.
      const simple = [...parts.simple, ...parts.full.filter(({ pose }) => !knownLook(pose.look) && !pose.self)];
      const dt = lastDraw === null ? 0 : Math.max(0, Math.min(.1, (now - lastDraw) / 1000));
      lastDraw = now;
      // Once per walker per frame, whichever level (or both, while crossfading) draws them.
      drawnHeights.clear();
      const bodyY = (pose: WalkerPresentation) => {
        let y = drawnHeights.get(pose.id);
        if (y === undefined && binding.drawnGround === false) drawnHeights.set(pose.id, y = pose.y);
        if (y === undefined) drawnHeights.set(pose.id, y = ground.bodyY(pose.id, { x: pose.x, y: pose.y, z: pose.z, posed: !!pose.posture,
          ...(pose.self ? { grounded: client.predicted?.grounded ?? true } : {}) }, dt));
        return y;
      };
      const gaitGround = (id: string) => binding.drawnGround === false ? {} : { ground: ground.groundFor(id), floor: ground.floorAt };
      figures.update(simple.map(({ pose, opacity }) => ({ id: pose.id, position: [pose.x, bodyY(pose), pose.z] as const,
        heading: pose.yaw * Math.PI * 2 / 256, distance: pose.distance, speed: pose.posture ? 0 : pose.speed, opacity })), now);
      people.update(full.map(({ pose, opacity: detail }) => ({ id: pose.id,
        look: pose.look,
        position: [pose.x, bodyY(pose), pose.z] as const, heading: pose.yaw * Math.PI * 2 / 256,
        distance: pose.distance, moving: Math.min(1, pose.speed / 1.2), speed: pose.speed, gesture: toolPoses.has(pose.id) ? 'point' : controller.gestureFor(pose.id, now),
        ...(pose.posture ? { posture: pose.posture } : {}),
        // The gait's drawn ground and floors (citizens-gait-ground.patch, asked of PL11): read once the renderer takes them.
        ...gaitGround(pose.id),
        opacity: detail * (pose.self ? play.selfHidden ? 0 : controller.owner === 'walking' ? controller.selfOpacity : 1 : 1), time: now / 1000 })), camera);
      ground.retain(drawnHeights);
      const self = walkingPoses.find(pose => pose.self), state = client.room.state;
      const interaction = connection.session.snapshot().self;
      // The renderer now has variable walk/run cycles. Sound follows its actual touchdown, never a
      // second distance clock. Retain the existing ownership, prediction and relocation fences.
      const placement = state.walkers.get(client.selfId)?.placement ?? -1, revision = state.collisionRevision;
      const active = connected && !waiting && controller.owner === 'walking' && !interactions.debug.held
        && !document.hidden && sound.enabled && client.predicting && interaction.mode !== 'seated'
        && client.predicted.grounded && !!self && Math.abs(self.y - client.predicted.y) <= .15;
      const prior = lastFootstepContext;
      lastFootstepContext = active ? { now, placement, revision } : undefined;
      const contact = active && prior && now > prior.now && now - prior.now <= 200
        && placement === prior.placement && revision === prior.revision
        ? people.footfalls.find(footfall => footfall.id === client.selfId) : undefined;
      if (contact && self) {
        // The accepted home's installed floor wins over public terrain. Never infer wood from being indoors.
        const surface = homeStepMaterial(interaction.plotId, contact.position) ?? groundStep(contact.position);
        footOffset.set(...contact.position).sub(camera.position);
        earRight.setFromMatrixColumn(camera.matrixWorld, 0);
        const distance = footOffset.length();
        const pan = distance > 0 ? THREE.MathUtils.clamp(footOffset.dot(earRight) / distance, -1, 1) : 0;
        sound.cue('step', { material: stepCue(surface), pan, distance });
      }
      // People walking near you are heard too, nearest first and never more than a small crowd (no silent actions).
      if (connected && !waiting && !document.hidden && sound.enabled) {
        earRight.setFromMatrixColumn(camera.matrixWorld, 0);
        const near = people.footfalls.filter(fall => fall.id !== client.selfId).map(fall => {
          const distance = footOffset.set(...fall.position).sub(camera.position).length();
          const pan = distance > 0 ? THREE.MathUtils.clamp(footOffset.dot(earRight) / distance, -1, 1) : 0;
          return { id: fall.id, position: fall.position, distance, pan };
        });
        for (const fall of othersSteps.choose(now, near)) {
          sound.cue('step', { material: stepCue(groundStep(fall.position)), pan: fall.pan, distance: othersStepDistance(fall.distance) });
        }
      }
    },
    labels(): WalkerLabel[] {
      if (!connected) return [];
      const labels: WalkerLabel[] = [];
      for (const pose of poses) {
        const opacity = pose.self && controller.owner === 'walking' ? controller.selfOpacity : 1;
        const head = people.heads.get(pose.id) ?? figures.heads.get(pose.id);
        if (opacity < .1 || !head) continue;
        const distance = head.distanceTo(camera.position);
        if (distance > 40) continue;
        point.copy(head).project(camera);
        if (point.z < -1 || point.z > 1 || Math.abs(point.x) > .95 || Math.abs(point.y) > .94) continue;
        labels.push({ id: pose.id, name: pose.name, self: pose.self, distance, opacity,
          ...(Number.isInteger(pose.homeSlot) && pose.homeSlot >= 0 && pose.homeSlot < REALM_NO_HOME_SLOT ? { slot: pose.homeSlot } : {}), x: (point.x + 1) * canvas.clientWidth / 2, y: (1 - point.y) * canvas.clientHeight / 2 });
      }
      return labels;
    },
    play,
    dispose() { stopPortal(); stopHands(); stopVolumes(); canvas.removeEventListener('contextmenu', lockedMenu); host.removeEventListener('pointerdown', lockedPress, { capture: true }); host.removeEventListener('pointerup', lockedPress, { capture: true }); play.dispose(); document.removeEventListener('visibilitychange', resetFootsteps); window.removeEventListener('blur', resetFootsteps); client.room.onLeave.remove(left); client.room.onDrop.remove(left); client.room.onReconnect.remove(reconnected); interactions.dispose(); connection.dispose(); controller.dispose(); people.dispose(); figures.dispose(); },
  };
}

const seeThroughBox = new THREE.Box3();
/** World boxes of the meshes a place fades for you: the camera's boom passes through what lies wholly inside them. */
function seeThroughBoxes(objects: readonly THREE.Object3D[]): { min: [number, number, number]; max: [number, number, number] }[] {
  const boxes: { min: [number, number, number]; max: [number, number, number] }[] = [];
  for (const object of objects) {
    seeThroughBox.setFromObject(object);
    if (seeThroughBox.isEmpty()) continue;
    boxes.push({ min: [seeThroughBox.min.x, seeThroughBox.min.y, seeThroughBox.min.z], max: [seeThroughBox.max.x, seeThroughBox.max.y, seeThroughBox.max.z] });
  }
  return boxes;
}
