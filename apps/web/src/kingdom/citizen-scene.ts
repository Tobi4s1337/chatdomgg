import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, type VoxelRenderState } from '@chatdom/render';
import { createCitizenMotion, createCitizenBehaviours, dueBehaviourSteps, type CitizenGoalAnswer, type CitizenMotion, type CitizenMotionSample, type SettlementPlan } from '@chatdom/world';
import { CitizenChatCueSchema, type CitizenChatCue, type KingdomPresenceFrame, type Vec3 } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { CITIZEN_SEATED_HEAD_OFFSET_METRES, createCitizenRenderer, createDefaultCitizenLooks } from '../citizens';
import { walkerSubject, type WalkerSlots } from './observed-walkers';

export interface SpeechLabel { slot: number; name: string | null; x: number; y: number; parts: CitizenChatCue['parts'] }

/** Add public standing points only inside the installed market, without changing the adopted plan. */
function forgeStandingPlan(plan: SettlementPlan): SettlementPlan {
  const market = plan.nodes.find(node => node.id === plan.market.nodeId);
  if (!market) return plan;
  const insideMarket = (x: number, z: number) => {
    const polygon = plan.market.boundary;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!, b = polygon[j]!;
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside && !plan.reservations.some(({ lot }) => x >= lot.minX - .6 && x <= lot.maxX + .6 && z >= lot.minZ - .6 && z <= lot.maxZ + .6);
  };
  const nodes = [...plan.nodes], streets = [...plan.streets], activeStreetIds = [...plan.activeStreetIds];
  for (const [index, [dx, dz]] of [[-4, 0], [4, 0], [-3, 3], [3, 3], [0, 5], [-5, 2], [-4, 5], [2, 6]].entries()) {
    const position: Vec3 = [market.position[0] + dx!, market.position[1], market.position[2] + dz!];
    // Check the whole connector, not just its endpoint, against market and lots.
    if (!Array.from({ length: 21 }, (_, i) => insideMarket(market.position[0] + dx! * i / 20, market.position[2] + dz! * i / 20)).every(Boolean)) continue;
    const id = `forge:watch:${index}`, edgeId = `${id}:path`;
    if (nodes.some(node => node.id === id) || streets.some(edge => edge.id === edgeId)) continue;
    nodes.push({ id, kind: 'junction', position });
    streets.push({ id: edgeId, from: market.id, to: id, kind: 'lane', name: 'Market', points: [market.position, position], width: 2, verge: 0 });
    activeStreetIds.push(edgeId);
  }
  return { ...plan, nodes, streets, activeStreetIds };
}

/** An in-memory handoff for a single scene rebuild; never serialised or shared with the realm. */
export interface CitizenSceneCheckpoint {
  used: boolean;
  readonly revision: string;
  readonly seed: string;
  readonly castleHome: boolean;
  readonly frame: KingdomPresenceFrame;
  readonly motion: CitizenMotion;
  readonly watchers: ReadonlyMap<number, string>;
  readonly looks: ReadonlyMap<number, string>;
}

/** Render-side presentation only: the public presence projection remains unchanged. */
export function createKingdomCitizens(scene: THREE.Scene, layout: SettlementPlan, pool: VoxelWorkerPool, clay: VoxelRenderState, castleHome = false, checkpoint?: CitizenSceneCheckpoint) {
  let motion = createCitizenMotion(forgeStandingPlan(layout), { castleHome });
  let pendingCheckpoint = checkpoint;
  const behaviours = createCitizenBehaviours();
  const capacity = layout.homes.length + Number(castleHome);
  let lastStepMs: number | null = null, answers: CitizenGoalAnswer[] = [];
  const resetBehaviours = () => { behaviours.reset(); lastStepMs=null; answers=[]; };
  const material = createVoxelMaterial(MATERIALS, 'avatar');
  // Moving people receive open-sky fill; per-part baked cavities must not turn
  // darker skin into a silhouette before a nearby window lights.
  material.material.fragmentShader = material.material.fragmentShader.replace('float sky=mix(.24,1.,vSky);', 'float sky=mix(.72,1.,vSky);').replace('vec3 colour=base*edge*light*ao;', 'vec3 colour=base*edge*(light+vec3(.4,.32,.25))*ao;');
  for (const key of ['uLight','uLightOrigin','uLightExtent','uFarLight','uFarOrigin','uFarExtent','uFarCell','uBeaconLight','uBeaconOrigin','uBeaconExtent','uBeaconCell']) material.material.uniforms[key] = clay.material.uniforms[key]!;
  const looks = createDefaultCitizenLooks();
  const knownLooks = new Set(looks.map(look => look.id)), suppliedLooks = new Map<number, string>();
  let renderer: Awaited<ReturnType<typeof createCitizenRenderer>> | undefined;
  let samples: readonly CitizenMotionSample[] = [], frame: KingdomPresenceFrame | undefined;
  let walkers: WalkerSlots = new Map();
  let forge: { anchor: Vec3; atMs: number } | undefined;
  const watchers = new Map<number, string>();
  const speech = new Map<number, CitizenChatCue>();
  let disposed = false;
  const shadowGeometry = new THREE.CircleGeometry(.29, 12); shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#252a24', transparent: true, opacity: .22, depthWrite: false });
  const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, capacity);
  shadows.count = 0; shadows.frustumCulled = false; scene.add(shadows);
  const shadowMatrix = new THREE.Matrix4();
  return {
    material, get motion() { return motion; },
    async prepare() {
      const instance = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity, pool });
      if (disposed) instance.dispose(); else renderer = instance;
    },
    applyFrame(next: KingdomPresenceFrame) {
      // Only restore after a fresh projection has established the same authority and
      // cannot predate the checkpoint. No checkpoint data is visible before this.
      const saved = pendingCheckpoint; pendingCheckpoint = undefined;
      if (saved && !saved.used && saved.revision === layout.revision && saved.seed === layout.config.seed && saved.castleHome === castleHome
        && saved.frame.kingdomId === next.kingdomId && saved.frame.epoch === next.epoch && saved.frame.origin === next.origin
        && next.sequence >= saved.frame.sequence && next.asOf >= saved.frame.asOf
        && (next.sequence > saved.frame.sequence || JSON.stringify(next) === JSON.stringify(saved.frame))) {
        saved.used = true;
        motion = saved.motion;
        for (const [slot, destination] of saved.watchers) if (next.windows.some(window => window.slot === slot && window.present && saved.frame.windows.some(previous => previous.slot === slot && previous.present && previous.since === window.since))) watchers.set(slot, destination);
        for (const [slot, look] of saved.looks) suppliedLooks.set(slot, look);
      }
      if(frame&&(frame.kingdomId!==next.kingdomId||frame.epoch!==next.epoch||frame.origin!==next.origin||next.asOf<frame.asOf)){resetBehaviours();watchers.clear();suppliedLooks.clear();}
      for (const window of next.windows) if (window.look !== undefined) suppliedLooks.set(window.slot, window.look);
      frame = next; motion.applyFrame(next);
    },
    checkpoint(): CitizenSceneCheckpoint | undefined {
      if (!frame) return undefined;
      return { used: false, revision: layout.revision, seed: layout.config.seed, castleHome, frame, motion,
        watchers: new Map(watchers), looks: new Map(suppliedLooks) };
    },
    receiveChat(input: unknown) {
      const result = CitizenChatCueSchema.safeParse(input);
      if (!result.success || !frame) return false;
      const cue = result.data;
      if (cue.kingdomId !== frame.kingdomId || cue.epoch !== frame.epoch || cue.origin !== frame.origin || !frame.windows.some(w => w.slot === cue.slot && w.present)) return false;
      const previous = speech.get(cue.slot);
      if (previous && previous.asOf >= cue.asOf) return false;
      speech.set(cue.slot, cue); return true;
    },
    clearChat(cueIds?: readonly string[]) {
      if (!cueIds) { speech.clear(); return; }
      const removed = new Set(cueIds);
      for (const [slot, cue] of speech) if (removed.has(cue.id)) speech.delete(slot);
    },
    watchForge(active: boolean, atMs: number, anchor: Vec3) {
      if (!active) { forge = undefined; watchers.clear(); return; }
      if (!Number.isFinite(atMs) || !anchor.every(Number.isFinite)) return;
      forge = { anchor, atMs };
    },
    update(atMs: number, time: number, camera?: THREE.Camera, reservedSlots: ReadonlySet<number> = new Set(), walkerFeet: WalkerSlots = new Map()) {
      walkers = walkerFeet;
      if (forge && frame && atMs >= forge.atMs) {
        const present = new Set(frame.windows.filter(window => window.present).map(window => window.slot));
        const current = motion.sample(atMs);
        for (const slot of watchers.keys()) if (!present.has(slot) || reservedSlots.has(slot) || walkers.has(slot) || !current.some(sample => sample.slot === slot && sample.homeLit)) watchers.delete(slot);
        const occupied = new Set(watchers.values());
        const candidates = current.filter(sample => sample.homeLit && present.has(sample.slot) && !watchers.has(sample.slot) && !reservedSlots.has(sample.slot) && !walkers.has(sample.slot)
          && Math.hypot(sample.position[0] - forge!.anchor[0], sample.position[2] - forge!.anchor[2]) < 70)
          .sort((a, b) => Math.hypot(a.position[0] - forge!.anchor[0], a.position[2] - forge!.anchor[2]) - Math.hypot(b.position[0] - forge!.anchor[0], b.position[2] - forge!.anchor[2]));
        for (const sample of candidates) {
          if (watchers.size >= 8) break;
          const destination = motion.destinationsForSlot(sample.slot).find(item => item.nodeId.startsWith('forge:watch:') && !occupied.has(item.nodeId)
            && Math.hypot(item.position[0] - forge!.anchor[0], item.position[2] - forge!.anchor[2]) >= 3
            && Math.hypot(item.position[0] - forge!.anchor[0], item.position[2] - forge!.anchor[2]) <= 9);
          if (destination && motion.requestGoal({ slot: sample.slot, nodeId: destination.nodeId, startAtMs: Math.max(atMs, frame.asOf) }).accepted) {
            watchers.set(sample.slot, destination.nodeId); occupied.add(destination.nodeId);
          }
        }
      }
      if(frame)for(const stepMs of dueBehaviourSteps(lastStepMs,atMs)){
        lastStepMs=stepMs;
        const stepSamples=motion.sample(stepMs),ambientSlots=new Set(stepSamples.filter(sample=>!reservedSlots.has(sample.slot) && !walkers.has(sample.slot) && !watchers.has(sample.slot)).map(sample=>sample.slot));
        const step=behaviours.step({kingdomId:frame.kingdomId,epoch:frame.epoch,origin:frame.origin,atMs:stepMs,samples:stepSamples,ambientSlots,destinationsFor:slot=>motion.destinationsForSlot(slot).filter(destination => !destination.nodeId.startsWith('forge:watch:')),answers});
        answers=step.goals.map(request=>({request,result:motion.requestGoal(request)}));
      }
      samples = motion.sample(atMs);
      const overlays=behaviours.present(samples,atMs);
      const bodies = samples.filter(sample => !walkers.has(sample.slot) && (!suppliedLooks.has(sample.slot) || knownLooks.has(suppliedLooks.get(sample.slot)!)));
      renderer?.update(bodies.map(sample => ({ id: String(sample.slot), look: suppliedLooks.get(sample.slot) ?? looks[sample.slot % looks.length]!.id,
        position: sample.position, heading: forge && watchers.get(sample.slot) === sample.goalNodeId && sample.goalReached
          ? Math.atan2(forge.anchor[0] - sample.position[0], forge.anchor[2] - sample.position[2]) : sample.heading, distance: sample.distance, moving: Math.min(1, sample.speed / 1.2), speed: sample.speed, opacity: sample.opacity, time:overlays.get(sample.slot)?.time??time,
        lookYaw:watchers.has(sample.slot) ? 0 : overlays.get(sample.slot)?.lookYaw??0,
        gesture: reservedSlots.has(sample.slot) || watchers.has(sample.slot)?'none' as const:speech.has(sample.slot) && speech.get(sample.slot)!.expiresAt > atMs ? 'nod' as const : overlays.get(sample.slot)?.gesture??'none' as const })), camera);
      shadows.count = 0;
      for (const sample of bodies) {
        shadowMatrix.makeScale(1, 1, .8); shadowMatrix.setPosition(sample.position[0], sample.position[1] + .018, sample.position[2]);
        shadows.setMatrixAt(shadows.count++, shadowMatrix);
      }
      shadows.instanceMatrix.needsUpdate = true;
      for (const [slot, cue] of speech) if (cue.expiresAt <= atMs || cue.asOf > atMs || !samples.some(s => s.slot === slot)) speech.delete(slot);
      return samples;
    },
    lightFrame(atMs: number): KingdomPresenceFrame | undefined {
      if (!frame) return;
      const arrived = new Map(samples.filter(s => s.homeLit).map(s => [s.slot, s.homeLitAtMs!]));
      return { ...frame, asOf: Math.max(frame.asOf, Math.ceil(atMs)), windows: frame.windows.map(window => ({ ...window,
        since: arrived.has(window.slot) ? Math.ceil(arrived.get(window.slot)!) : window.since,
        present: window.present && arrived.has(window.slot), publicName: window.present && arrived.has(window.slot) ? window.publicName : null })) };
    },
    subject(slot: number) { const sample = samples.find(s => s.slot === slot); return sample ? walkerSubject(sample, walkers) : undefined; },
    speechLabels(camera: THREE.Camera, width: number, height: number, atMs: number, namedHomes: ReadonlySet<number> = new Set()): SpeechLabel[] {
      const labels: SpeechLabel[] = [];
      for (const sample of samples) {
        const cue = speech.get(sample.slot);
        if (!cue || cue.asOf > atMs || cue.expiresAt <= atMs) continue;
        const point = new THREE.Vector3(...walkerSubject(sample, walkers).position);
        point.y += 1.9 + (walkers.get(sample.slot)?.posture ? CITIZEN_SEATED_HEAD_OFFSET_METRES : 0);
        if (point.distanceTo(camera.position) > 28) continue;
        point.project(camera);
        if (point.z < 0 || point.z > 1 || Math.abs(point.x) > .85 || Math.abs(point.y) > .8) continue;
        labels.push({ slot: sample.slot, name: namedHomes.has(sample.slot) ? null : sample.publicName, x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, parts: cue.parts });
        if (labels.length >= 3) break;
      }
      return labels;
    },
    clear() { pendingCheckpoint = undefined; resetBehaviours(); forge = undefined; watchers.clear(); motion.clear(); frame = undefined; samples = []; walkers = new Map(); suppliedLooks.clear(); speech.clear(); renderer?.update([]); shadows.count = 0; },
    dispose() { resetBehaviours(); disposed = true; renderer?.dispose(); material.dispose(); scene.remove(shadows); shadows.dispose(); shadowGeometry.dispose(); shadowMaterial.dispose(); },
  };
}
