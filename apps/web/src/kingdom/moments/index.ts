import * as THREE from 'three';
import { geometryFromChunks, type VoxelRenderState, type WindowHouse } from '@chatdom/render';
import type { KingdomId, KingdomPresenceFrame, MaterialRegistry } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { terrainHeight, type SettlementPlan } from '@chatdom/world';
import { createTwitchMoments, type MomentFrame } from '../../twitch-moments/controller';
import { planRaid, raidCaption, raidFrame, type RaidBeat } from '../../twitch-moments/raid-beat';
import type { DockAct } from '../dock-acts';
import { createTwitchMomentView, type CameraLease, type MomentSoundPort, type SkyGlow } from '../../twitch-moments/view';
import { festivalPlacesOf, withFestivalPlaces } from '../../twitch-moments/festival-places';
import type { CrowdCall } from '../../twitch-moments/stage-beat';
import type { TwitchMomentFeed } from '../../twitch-moments/contracts';
import { bannerMount, doorOf, giftRouteOf, spectaclePlacesOf, windowOf } from './anchors';
import { mountKingdomRaidChat } from './raid-chat';

export interface KingdomMomentsOptions {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; target: THREE.Vector3;
  plan: SettlementPlan; houses: readonly WindowHouse[]; castleKeep?: WindowHouse; pool: VoxelWorkerPool; material: VoxelRenderState; registry: MaterialRegistry;
  kingdomId: KingdomId; feed: TwitchMomentFeed; sound: MomentSoundPort | null; kit: 'hearth' | 'tide'; signal: AbortSignal;
  /** Actual adopted surface, including sculpted terrain, for the festival route and dragon lair. */
  ground?: (x: number, z: number) => number;
}

/** Attach moments to the adopted kingdom. The caller retains the scene, camera, worker and material. */
export function createKingdomMoments(options: KingdomMomentsOptions) {
  const { scene, camera, canvas, target, plan, houses, pool, material, registry, kingdomId, feed, signal } = options;
  const parent = new THREE.Group(); parent.name = 'kingdom-twitch-moments'; scene.add(parent);
  let now = Date.now(), allowed = false, wrote = false, disposed = false, prepared = false, lease: CameraLease | null = null;
  let preparation: 'loading' | 'ready' | 'failed' | 'disposed' = 'loading', preparationError: string | null = null;
  let activeFocus: string | null = null, blockedFocus: string | null = null;
  let lastPresence: KingdomPresenceFrame | undefined;
  let skyGlow: SkyGlow | null = null;
  let crowdCall: CrowdCall | null = null;
  let royalRaid: { act: DockAct; beat: RaidBeat; elapsed: number } | undefined;
  const controller = createTwitchMoments({ kingdomId, expectedOrigin: feed.origin, clock: { now: () => now } });
  const royalFrame = (frame: MomentFrame): MomentFrame => {
    if (!royalRaid) return frame;
    const { beat } = royalRaid, elapsed = Math.max(royalRaid.elapsed, now - beat.startAt);
    if (now >= royalRaid.act.expiresAt || elapsed >= 8500) { royalRaid = undefined; return frame; }
    const caption = raidCaption(beat, beat.startAt + elapsed);
    return { ...frame, focus: null, raids: [raidFrame(beat, beat.startAt + elapsed)],
      captions: [...(caption ? [caption] : []), ...frame.captions.filter(item => item.at.kind !== 'place' || item.at.place !== 'gate')] };
  };
  controller.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: true, safeRects: [], autoOpenKinds: [] });
  const bySlot = new Map(houses.map(h => [h.slot, h])), mounts = new Map<number, ReturnType<typeof bannerMount>>();
  const route = giftRouteOf(plan);
  // The view prepares many shared parts at once; bound submissions to the shared worker pool.
  const meshLanes: Promise<void>[] = Array.from({ length: 4 }, () => Promise.resolve());
  let nextMeshLane = 0, meshFailed = false;
  const view = createTwitchMomentView({
    parent, material: material.material, kit: options.kit, sound: options.sound, light: glow => { skyGlow = glow; }, crowd: call => { crowdCall = call; },
    places: withFestivalPlaces(spectaclePlacesOf(plan, houses, options.castleKeep), festivalPlacesOf(plan, options.ground ?? ((x, z) => terrainHeight(plan, x, z)))),
    async mesh(blueprint) {
      const lane = nextMeshLane++ % meshLanes.length;
      const job = meshLanes[lane]!.then(async () => {
        if (disposed || meshFailed) throw new DOMException('Moments closed while preparing', 'AbortError');
        const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: registry.materials, materialRevision: registry.revision });
        if (disposed || meshFailed) throw new DOMException('Moments closed while preparing', 'AbortError');
        if (result?.kind !== 'asset') throw new Error('A moment part could not be meshed');
        return geometryFromChunks(result.chunks, 'build');
      }).catch(error => { meshFailed = true; throw error; });
      meshLanes[lane] = job.then(() => {}, () => {});
      return job;
    },
    homeAnchor(slot) { if (!mounts.has(slot)) { const house = bySlot.get(slot); mounts.set(slot, house ? bannerMount(house) : null); } return mounts.get(slot)!; },
    doorAnchor(slot) { const house = bySlot.get(slot); return house ? doorOf(house) : null; },
    windowAnchor(slot) { const house = bySlot.get(slot); return house ? windowOf(house) : null; },
    giftRoute: () => route,
    placeAnchor(place) {
      if (!route) return null;
      const [a, b] = place === 'gate' ? [route.inbound[0]!, route.inbound[1]!] : [route.inbound.at(-1)!, route.inbound.at(-2)!];
      const facing = new THREE.Vector3(b[0] - a[0], 0, b[2] - a[2]).normalize();
      return { position: a, facing: (place === 'gate' ? facing : facing.negate()).toArray() };
    },
    viewport: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
    camera: { acquire(_owner, _priority, abort) {
      if (!allowed || lease || disposed || abort.aborted) return null;
      let active = true;
      const current: CameraLease = {
        read: () => ({ eye: camera.position.toArray(), target: target.toArray(), fov: camera.fov }),
        write(pose) {
          if (!active || !allowed || disposed || abort.aborted) return false;
          camera.position.set(...pose.eye); target.set(...pose.target); camera.lookAt(target);
          if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
          camera.updateMatrixWorld(); wrote = true; return true;
        },
        release() { active = false; if (lease === current) lease = null; },
      };
      lease = current; abort.addEventListener('abort', () => current.release(), { once: true }); return current;
    } },
  });
  mountKingdomRaidChat({ canvas, camera, view, feed, kingdomId, signal, clock: () => now, plan, ground: options.ground ?? ((x, z) => terrainHeight(plan, x, z)), party: { scene, material } });
  const disconnect = controller.connect(feed);
  const dispose = () => {
    if (disposed) return;
    disposed = true; allowed = false; lease?.release(); lease = null;
    if (preparation !== 'failed') preparation = 'disposed';
    signal.removeEventListener('abort', dispose); disconnect(); controller.dispose(); view.dispose(); scene.remove(parent);
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  const ready = view.prepare().then(() => { if (!disposed) { prepared = true; preparation = 'ready'; } }).catch(error => {
    if (!disposed) { preparation = 'failed'; preparationError = error instanceof Error ? error.message : 'Moment parts could not be prepared'; }
    dispose(); throw error;
  });
  return {
    ready,
    update(atMs: number, presenceFrame: KingdomPresenceFrame | undefined, cameraAllowed: boolean): boolean {
      if (disposed) return false;
      now = atMs; wrote = false; allowed = cameraAllowed;
      if (!allowed && lease) { blockedFocus = activeFocus; lease.release(); lease = null; }
      if (presenceFrame !== lastPresence) {
        if (presenceFrame) controller.receivePresence(presenceFrame); else controller.clearPresence();
        lastPresence = presenceFrame;
      }
      if (prepared) {
        const frame = royalFrame(controller.sample(atMs));
        if (blockedFocus && frame.focus?.id !== blockedFocus) blockedFocus = null;
        activeFocus = frame.focus?.id ?? null;
        view.apply(blockedFocus && frame.focus?.id === blockedFocus ? { ...frame, focus: null } : frame);
      }
      return wrote;
    },
    /** Re-stage the already witnessed incoming source through the existing banner/caravan layer. No Twitch action. */
    welcomeRaid(act: DockAct, elapsed: number): boolean {
      if (disposed || !prepared || !route || act.kind !== 'raid-welcome' || !act.raid || act.targetId !== act.raid.raidKey
        || act.targetName !== act.raid.from.displayName || act.kingdomId !== kingdomId || act.origin !== feed.origin) return false;
      if (royalRaid?.act.id !== act.id) royalRaid = { act, elapsed,
        beat: planRaid(act.id, { kind: 'raid', key: act.raid.raidKey, displayUntil: act.expiresAt, ...act.raid }, now, name => name) };
      royalRaid.elapsed = elapsed;
      view.apply(royalFrame(controller.sample(now)));
      return elapsed === 0 || Number(view.stats()['raid.gate']) > 0;
    },
    captions: () => disposed || !prepared ? [] : view.labels(camera),
    /** The sky moment’s light on the town this frame, or null. */
    glow: () => disposed ? null : skyGlow,
    /** Present citizens can turn toward the staged moment without changing their routes. */
    crowd: () => disposed ? null : crowdCall,
    metrics: () => ({ preparation, preparationError, controller: controller.metrics(), view: view.stats() }),
    dispose,
  };
}
