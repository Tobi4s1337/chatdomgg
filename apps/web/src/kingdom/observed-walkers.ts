import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { REALM_NO_HOME_SLOT, REALM_WALKER_FRAME_INTERVAL_MS, type CollisionWorld, type RealmFoundedManifest, type RealmWalkerFeed, type RealmWalkerFrame } from '@chatdom/shared/realm';
import type { VoxelRenderState } from '@chatdom/render';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import type { CitizenMotionSample, SettlementPlan } from '@chatdom/world';
import { sampleFoundedTerrain } from '@chatdom/world/founded-collision';
import { createWalkerGround } from '../walk/ground';
import type { InteractionRegistry } from '@chatdom/world/interactions';
import { createCitizenRenderer, createDefaultCitizenLooks } from '../citizens';
import type { RealmWalkerPose } from '../realm/client';
import type { WalkerLabel } from './walk-scene';
import { presentWalkers, type WalkerPresentation } from './walker-presentation';
import { createWalkerFigures, createWalkerSplit, createWalkerViewTest } from './walker-figures';
import { walkerGaze } from './grand-land/monarch/gaze';

export type WalkerSlots = ReadonlyMap<number, WalkerPresentation>;

/** Authority supplies the street link. Names and private identities never participate in matching. */
export function walkerSlots(poses: readonly WalkerPresentation[]): WalkerSlots {
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
    get seats() { return latest?.frame.seats ?? []; },
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

/**
 * The public stream observes exactly the same actual people, without opening a walk client or input owner. With
 * `land` (the installed plan and its compiled collision) every body is drawn on the drawn ground as in the walk;
 * without it bodies stand at their physical height.
 */
export async function createObservedWalkers(scene: THREE.Scene, camera: THREE.Camera, canvas: HTMLCanvasElement,
  pool: VoxelWorkerPool, material: VoxelRenderState, manifest: WalkerScene, feed: RealmWalkerFeed, registry: InteractionRegistry,
  land?: { readonly plan: SettlementPlan; readonly world: CollisionWorld }) {
  const looks = createDefaultCitizenLooks(), known = new Set(looks.map(look => look.id));
  const people = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity: 300, pool });
  // The nearest walkers in full, the rest as simple figures, crossfading at the boundary.
  const split = createWalkerSplit(), inView = createWalkerViewTest(), figures = createWalkerFigures(scene, material);
  const track = createObservedWalkerTrack(manifest);
  let poses: readonly WalkerPresentation[] = [];
  const terrain = land ? sampleFoundedTerrain(land.plan) : undefined;
  const ground = land && terrain ? createWalkerGround({ scene, world: () => land.world, terrainFloorY: terrain.origin[1], terrainCeilingY: terrain.ceilingY }) : undefined;
  const heights = new Map<string, number>();
  let lastDraw: number | null = null;
  const off = feed.subscribe(frame => track.receive(frame, performance.now()), () => { track.clear(); split.clear(); poses = []; people.update([]); figures.update([]); ground?.reset(); });
  const point = new THREE.Vector3(), eye = new THREE.Vector3();
  return {
    get poses() { return poses; },
    get grips() { return people.grips; },
    get heads() { return people.heads; },
    frame(now: number) { poses = presentWalkers(track.sample(now), track.seats, registry); return poses; },
    draw(now: number, visible = true) {
      // A walker whose look is not here yet is still a person in the street: a simple figure until it is.
      const parts = split.split(visible ? poses : [], eye.setFromMatrixPosition(camera.matrixWorld), now, inView(camera));
      const full = parts.full.filter(({ pose }) => known.has(pose.look));
      const simple = [...parts.simple, ...parts.full.filter(({ pose }) => !known.has(pose.look))];
      const dt = lastDraw === null ? 0 : Math.max(0, Math.min(.1, (now - lastDraw) / 1000));
      lastDraw = now;
      heights.clear();
      const bodyY = (pose: WalkerPresentation) => {
        if (!ground) return pose.y;
        let y = heights.get(pose.id);
        if (y === undefined) heights.set(pose.id, y = ground.bodyY(pose.id, { x: pose.x, y: pose.y, z: pose.z, posed: !!pose.posture }, dt));
        return y;
      };
      people.update(full.map(({ pose, opacity }) => ({ id: pose.id, look: pose.look,
        position: [pose.x, bodyY(pose), pose.z] as const, ...(ground ? { ground: ground.groundFor(pose.id), floor: ground.floorAt } : {}), heading: pose.yaw * Math.PI * 2 / 256,
        distance: pose.distance, moving: Math.min(1, pose.speed / 1.2), speed: pose.speed, opacity,
        ...(pose.posture ? { posture: pose.posture } : {}), time: now / 1000, ...walkerGaze(pose) })), camera);
      figures.update(simple.map(({ pose, opacity }) => ({ id: pose.id, position: [pose.x, bodyY(pose), pose.z] as const,
        heading: pose.yaw * Math.PI * 2 / 256, distance: pose.distance, speed: pose.posture ? 0 : pose.speed, opacity })), now);
      ground?.retain(heights);
    },
    labels(): WalkerLabel[] {
      const labels: WalkerLabel[] = [];
      for (const pose of poses) {
        const head = people.heads.get(pose.id) ?? figures.heads.get(pose.id);
        if (!head) continue;
        const distance = head.distanceTo(camera.position);
        if (distance > 40) continue;
        point.copy(head);
        point.project(camera);
        if (point.z < -1 || point.z > 1 || Math.abs(point.x) > .95 || Math.abs(point.y) > .94) continue;
        labels.push({ id: pose.id, name: pose.name, self: false, distance,
          ...(Number.isInteger(pose.homeSlot) && pose.homeSlot >= 0 && pose.homeSlot < REALM_NO_HOME_SLOT ? { slot: pose.homeSlot } : {}), x: (point.x + 1) * canvas.clientWidth / 2, y: (1 - point.y) * canvas.clientHeight / 2 });
      }
      return labels;
    },
    dispose() { off(); track.clear(); split.clear(); poses = []; people.dispose(); figures.dispose(); },
  };
}
