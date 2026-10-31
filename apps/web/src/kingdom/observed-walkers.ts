import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { REALM_NO_HOME_SLOT, REALM_WALKER_FRAME_INTERVAL_MS, type RealmFoundedManifest, type RealmWalkerFeed, type RealmWalkerFrame } from '@chatdom/shared/realm';
import type { VoxelRenderState } from '@chatdom/render';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import type { CitizenMotionSample } from '@chatdom/world';
import { createCitizenRenderer, createDefaultCitizenLooks } from '../citizens';
import type { RealmWalkerPose } from '../realm/client';
import type { WalkerLabel } from './walk-scene';

export type WalkerSlots = ReadonlyMap<number, RealmWalkerPose>;

/** Authority supplies the street link. Names and private identities never participate in matching. */
export function walkerSlots(poses: readonly RealmWalkerPose[]): WalkerSlots {
  return new Map(poses.filter(pose => Number.isInteger(pose.homeSlot) && pose.homeSlot >= 0 && pose.homeSlot < REALM_NO_HOME_SLOT)
    .map(pose => [pose.homeSlot, pose]));
}

/** The motion sample remains the presence/window authority; only its drawn feet can be overridden. */
export function walkerSubject(sample: CitizenMotionSample, slots: WalkerSlots): CitizenMotionSample {
  const walker = slots.get(sample.slot);
  return walker ? { ...sample, position: [walker.x, walker.y, walker.z], heading: walker.yaw * Math.PI * 2 / 256,
    distance: walker.distance, speed: walker.speed } : sample;
}

/**
 * Read-only two-sample interpolation. SDK 0.18.8 Predict attaches to decoded Colyseus schemas and a Room;
 * its interpolation functions are private. An SSE view therefore interpolates two witnessed samples here,
 * with the same 250 ms render delay, no extrapolation, inputs, collision, prediction or reconciliation.
 */
type WalkerScene = Pick<RealmFoundedManifest, 'kingdomId' | 'origin' | 'layoutRevision' | 'collisionRevision'>;
export function createObservedWalkerTrack(manifest: WalkerScene) {
  let previous: { frame: RealmWalkerFrame; at: number } | undefined;
  let latest: { frame: RealmWalkerFrame; at: number } | undefined;
  const clear = () => { previous = undefined; latest = undefined; };
  return {
    clear,
    receive(frame: RealmWalkerFrame, now: number) {
      if (frame.kingdomId !== manifest.kingdomId || frame.origin !== manifest.origin || frame.layoutRevision !== manifest.layoutRevision
        || frame.collisionRevision !== manifest.collisionRevision) { clear(); return; }
      if (latest && latest.frame.writerEpoch === frame.writerEpoch && frame.sampledAt <= latest.frame.sampledAt) return;
      previous = latest?.frame.writerEpoch === frame.writerEpoch ? latest : undefined;
      latest = { frame, at: now };
    },
    sample(now: number): readonly RealmWalkerPose[] {
      if (!latest || now - latest.at >= REALM_WALKER_FRAME_INTERVAL_MS * 10 || now < latest.at) { clear(); return []; }
      const prior = new Map(previous?.frame.walkers.map(walker => [walker.id, walker]));
      const blend = previous && latest.at > previous.at ? THREE.MathUtils.clamp((now - 250 - previous.at) / (latest.at - previous.at), 0, 1) : 1;
      return latest.frame.walkers.map(walker => {
        const before = prior.get(walker.id);
        const t = before && before.placement === walker.placement ? blend : 1;
        const lerp = (key: 'x' | 'y' | 'z' | 'distance' | 'speed') => before ? THREE.MathUtils.lerp(before[key], walker[key], t) : walker[key];
        return { ...walker, x: lerp('x'), y: lerp('y'), z: lerp('z'), distance: lerp('distance'), speed: lerp('speed'), self: false };
      });
    },
  };
}

/** The public stream observes exactly the same actual people, without opening a walk client or input owner. */
export async function createObservedWalkers(scene: THREE.Scene, camera: THREE.Camera, canvas: HTMLCanvasElement,
  pool: VoxelWorkerPool, material: VoxelRenderState, manifest: WalkerScene, feed: RealmWalkerFeed) {
  const looks = createDefaultCitizenLooks(), known = new Set(looks.map(look => look.id));
  const people = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity: 300, pool });
  const track = createObservedWalkerTrack(manifest);
  let poses: readonly RealmWalkerPose[] = [];
  const off = feed.subscribe(frame => track.receive(frame, performance.now()), () => { track.clear(); poses = []; people.update([]); });
  const point = new THREE.Vector3();
  return {
    get poses() { return poses; },
    frame(now: number) { poses = track.sample(now); return poses; },
    draw(now: number, visible = true) {
      people.update((visible ? poses : []).filter(pose => known.has(pose.look)).map(pose => ({ id: pose.id, look: pose.look,
        position: [pose.x, pose.y, pose.z] as const, heading: pose.yaw * Math.PI * 2 / 256,
        distance: pose.distance, moving: Math.min(1, pose.speed / 1.2), speed: pose.speed, time: now / 1000 })), camera);
    },
    labels(): WalkerLabel[] {
      const labels: WalkerLabel[] = [];
      for (const pose of poses) {
        point.set(pose.x, pose.y + 1.95, pose.z);
        if (point.distanceToSquared(camera.position) > 40 ** 2) continue;
        point.project(camera);
        if (point.z < -1 || point.z > 1 || Math.abs(point.x) > .95 || Math.abs(point.y) > .94) continue;
        labels.push({ id: pose.id, name: pose.name, self: false, x: (point.x + 1) * canvas.clientWidth / 2, y: (1 - point.y) * canvas.clientHeight / 2 });
      }
      return labels;
    },
    dispose() { off(); track.clear(); poses = []; people.dispose(); },
  };
}
