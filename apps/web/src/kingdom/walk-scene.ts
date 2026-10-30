import * as THREE from 'three';
import { kingdomRoomId, type CollisionWorld, type RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import type { VoxelRenderState } from '@chatdom/render';
import { MATERIALS } from '@chatdom/content';
import { createCitizenRenderer, createDefaultCitizenLooks } from '../citizens';
import type { RealmClient, RealmCollision, RealmWalkerPose } from '../realm/client';
import { createWalkController } from '../walk';

export interface KingdomWalkBinding {
  readonly client: RealmClient;
  readonly collision: CollisionWorld | RealmCollision;
  /** Already fetched and hash-checked by the entry adapter; never an identity or an entry ticket. */
  readonly manifest: RealmFoundedManifest;
  readonly hud?: HTMLElement;
  /** Arrival view only, in radians. Movement still uses the room's own yaw and quantized input. */
  readonly heading?: number;
  /** Request a new checked scene when authority changes geometry. Called once; entry owns reinstallation. */
  readonly onSceneNeeded?: () => void;
}
export interface WalkerLabel { readonly id: string; readonly name: string; readonly self: boolean; readonly x: number; readonly y: number }

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
  pool: VoxelWorkerPool, material: VoxelRenderState, binding: KingdomWalkBinding) {
  const looks = createDefaultCitizenLooks();
  const people = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity: 300, pool });
  const client = binding.client;
  const currentWorld = () => 'query' in binding.collision
    ? binding.collision.revision === client.room.state.collisionRevision ? binding.collision : null
    : binding.collision.world(client.room.state.collisionRevision);
  const controller = createWalkController({ camera, surface: canvas, realm: client, collision: currentWorld,
    ...(binding.hud ? { hud: binding.hud } : {}), ...(binding.heading !== undefined ? { heading: binding.heading } : {}) });
  controller.resize(canvas.clientWidth, canvas.clientHeight);
  let poses: readonly RealmWalkerPose[] = [], connected = true, waiting = false;
  const left = () => { connected = false; controller.release(); people.update([]); };
  client.room.onLeave(left);
  const point = new THREE.Vector3();
  return {
    controller,
    get poses() { return poses; },
    get connected() { return connected; },
    frame(now: number, selected: boolean) {
      const state = client.room.state;
      if (state.layoutRevision !== binding.manifest.layoutRevision || state.collisionRevision !== binding.manifest.collisionRevision) {
        controller.release(); client.clearInput(); poses = []; people.update([]);
        if (!waiting) { waiting = true; binding.onSceneNeeded?.(); }
        return false;
      }
      const active = selected && connected && !waiting;
      if (active && controller.owner === 'released') { camera.clearViewOffset(); controller.resume(); }
      else if (!active) controller.release();
      poses = controller.frame(now);
      return active;
    },
    /** Call after the final camera transform, so frustum culling uses the camera that actually draws. */
    draw(now: number) {
      people.update(connected ? poses.map(pose => ({ id: pose.id,
        look: looks.find(look => look.id === pose.look)?.id ?? looks[0]!.id,
        position: [pose.x, pose.y, pose.z] as const, heading: pose.yaw * Math.PI * 2 / 256,
        distance: pose.distance, moving: Math.min(1, pose.speed / 1.2), speed: pose.speed,
        opacity: pose.self && controller.owner === 'walking' ? controller.selfOpacity : 1, time: now / 1000 })) : [], camera);
    },
    labels(): WalkerLabel[] {
      if (!connected) return [];
      const labels: WalkerLabel[] = [];
      for (const pose of poses) {
        if ((pose.self && controller.owner === 'walking' && controller.selfOpacity < .1) || camera.position.distanceToSquared(point.set(pose.x, pose.y, pose.z)) > 40 ** 2) continue;
        point.set(pose.x, pose.y + 1.95, pose.z).project(camera);
        if (point.z < -1 || point.z > 1 || Math.abs(point.x) > .95 || Math.abs(point.y) > .94) continue;
        labels.push({ id: pose.id, name: pose.name, self: pose.self, x: (point.x + 1) * canvas.clientWidth / 2, y: (1 - point.y) * canvas.clientHeight / 2 });
      }
      return labels;
    },
    dispose() { client.room.onLeave.remove(left); controller.dispose(); people.dispose(); },
  };
}
