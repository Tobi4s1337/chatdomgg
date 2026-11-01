import * as THREE from 'three';
import { REALM_NO_HOME_SLOT, kingdomRoomId, type CollisionWorld, type RealmFoundedManifest } from '@chatdom/shared/realm';
import { samplePublicGround, type RealmFoundedScene } from '@chatdom/world';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import type { VoxelRenderState } from '@chatdom/render';
import { MATERIALS } from '@chatdom/content';
import { createCitizenRenderer, createDefaultCitizenLooks, type CitizenRenderLook } from '../citizens';
import type { RealmClient, RealmCollision, RealmWalkerPose } from '../realm/client';
import { createWalkController, type WalkControllerOptions } from '../walk';
import { createFoundedInteractionRegistry, homeZone, STREET_ZONE } from '@chatdom/world/interactions';
import { interactionSound, mountInteractionController, type InteractionPlaces } from '../interactions';
import { bindWalkInteractions } from './walk-interactions';
import { createHomeStepMaterial } from './walk-footsteps';
import type { createKingdomSound } from './sound';
import { presentWalkers, type WalkerPresentation } from './walker-presentation';

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
}
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
  sound: Pick<ReturnType<typeof createKingdomSound>, 'cue' | 'enabled'>) {
  const looks = binding.appearances ?? createDefaultCitizenLooks();
  const people = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity: 300, pool });
  const client = binding.client;
  const currentWorld = () => 'query' in binding.collision
    ? binding.collision.revision === client.room.state.collisionRevision ? binding.collision : null
    : binding.collision.world(client.room.state.collisionRevision);
  const controller = createWalkController({ camera, surface: canvas, realm: client, collision: currentWorld,
    ...(binding.hud ? { hud: binding.hud } : {}), ...(binding.gestures ? { gestures: binding.gestures } : {}), ...(binding.heading !== undefined ? { heading: binding.heading } : {}) });
  controller.resize(canvas.clientWidth, canvas.clientHeight);
  const registry = createFoundedInteractionRegistry(founded, currentWorld()!);
  const connection = bindWalkInteractions(client.room, interactionSound(sound));
  const host = binding.hud ?? canvas.parentElement;
  if (!host) { connection.dispose(); controller.dispose(); people.dispose(); throw new Error('The kingdom interaction surface is unavailable'); }
  const interactions = mountInteractionController({ host, surface: canvas, session: connection.session, camera: controller,
    ...(binding.interactionPlaces ? { places: binding.interactionPlaces } : {}) });
  const projected = new THREE.Vector3(), direction = new THREE.Vector3(), raycaster = new THREE.Raycaster();
  const homeStepMaterial = createHomeStepMaterial(founded);
  let lastFootstepContext: { now: number; placement: number; revision: number } | undefined;
  const earRight = new THREE.Vector3(), footOffset = new THREE.Vector3();
  const resetFootsteps = () => { lastFootstepContext = undefined; };
  document.addEventListener('visibilitychange', resetFootsteps);
  window.addEventListener('blur', resetFootsteps);
  let poses: readonly WalkerPresentation[] = [], walkingPoses: readonly RealmWalkerPose[] = [], connected = true, waiting = false;
  const left = () => { connected = false; poses = []; resetFootsteps(); controller.release(); people.update([]); };
  const reconnected = () => { connected = true; };
  client.room.onLeave(left);
  client.room.onDrop(left);
  client.room.onReconnect(reconnected);
  const point = new THREE.Vector3();
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
        resetFootsteps(); controller.release(); client.clearInput(); poses = []; people.update([]);
        if (!waiting) { waiting = true; binding.onSceneNeeded?.(); }
        return false;
      }
      const active = selected && connected && !waiting;
      // A place's accepted view holds the same walk token until the interaction controller returns it.
      if (active && controller.owner === 'released' && !interactions.debug.held) { resetFootsteps(); camera.clearViewOffset(); controller.resume(); }
      else if (!active) { if (interactions.debug.held) interactions.leave(); controller.release(); }
      walkingPoses = connected && !waiting ? controller.frame(now) : [];
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
      people.update(connected ? poses.filter(pose => looks.some(look => look.id === pose.look)).map(pose => ({ id: pose.id,
        look: pose.look,
        position: [pose.x, pose.y, pose.z] as const, heading: pose.yaw * Math.PI * 2 / 256,
        distance: pose.distance, moving: Math.min(1, pose.speed / 1.2), speed: pose.speed, gesture: controller.gestureFor(pose.id, now),
        ...(pose.posture ? { posture: pose.posture } : {}),
        opacity: pose.self && controller.owner === 'walking' ? controller.selfOpacity : 1, time: now / 1000 })) : [], camera);
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
        const ground = samplePublicGround(founded.plan, contact.position[0], contact.position[2]);
        const surface = homeStepMaterial(interaction.plotId, contact.position)
          ?? (ground && ground.pavingDistance <= 0 ? 'stone' : 'earth');
        footOffset.set(...contact.position).sub(camera.position);
        earRight.setFromMatrixColumn(camera.matrixWorld, 0);
        const distance = footOffset.length();
        const pan = distance > 0 ? THREE.MathUtils.clamp(footOffset.dot(earRight) / distance, -1, 1) : 0;
        sound.cue('step', { material: surface, pan, distance });
      }
    },
    labels(): WalkerLabel[] {
      if (!connected) return [];
      const labels: WalkerLabel[] = [];
      for (const pose of poses) {
        const opacity = pose.self && controller.owner === 'walking' ? controller.selfOpacity : 1;
        const head = people.heads.get(pose.id);
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
    dispose() { document.removeEventListener('visibilitychange', resetFootsteps); window.removeEventListener('blur', resetFootsteps); client.room.onLeave.remove(left); client.room.onDrop.remove(left); client.room.onReconnect.remove(reconnected); interactions.dispose(); connection.dispose(); controller.dispose(); people.dispose(); },
  };
}
