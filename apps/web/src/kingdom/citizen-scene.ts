import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, type VoxelRenderState } from '@chatdom/render';
import { createCitizenMotion, createCitizenBehaviours, dueBehaviourSteps, type CitizenGoalAnswer, type CitizenMotionSample, type SettlementPlan } from '@chatdom/world';
import { CitizenChatCueSchema, type CitizenChatCue, type KingdomPresenceFrame } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { CITIZEN_SEATED_HEAD_OFFSET_METRES, createCitizenRenderer, createDefaultCitizenLooks } from '../citizens';
import { walkerSubject, type WalkerSlots } from './observed-walkers';

export interface SpeechLabel { slot: number; name: string | null; x: number; y: number; parts: CitizenChatCue['parts'] }

/** Render-side presentation only: the public presence projection remains unchanged. */
export function createKingdomCitizens(scene: THREE.Scene, layout: SettlementPlan, pool: VoxelWorkerPool, clay: VoxelRenderState, castleHome = false) {
  const motion = createCitizenMotion(layout, { castleHome }), behaviours = createCitizenBehaviours();
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
  const speech = new Map<number, CitizenChatCue>();
  let disposed = false;
  const shadowGeometry = new THREE.CircleGeometry(.29, 12); shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#252a24', transparent: true, opacity: .22, depthWrite: false });
  const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, capacity);
  shadows.count = 0; shadows.frustumCulled = false; scene.add(shadows);
  const shadowMatrix = new THREE.Matrix4();
  return {
    material, motion,
    async prepare() {
      const instance = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity, pool });
      if (disposed) instance.dispose(); else renderer = instance;
    },
    applyFrame(next: KingdomPresenceFrame) {
      if(frame&&(frame.kingdomId!==next.kingdomId||frame.epoch!==next.epoch||frame.origin!==next.origin||next.asOf<frame.asOf)){resetBehaviours();suppliedLooks.clear();}
      for (const window of next.windows) if (window.look !== undefined) suppliedLooks.set(window.slot, window.look);
      frame = next; motion.applyFrame(next);
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
    update(atMs: number, time: number, camera?: THREE.Camera, reservedSlots: ReadonlySet<number> = new Set(), walkerFeet: WalkerSlots = new Map()) {
      walkers = walkerFeet;
      if(frame)for(const stepMs of dueBehaviourSteps(lastStepMs,atMs)){
        lastStepMs=stepMs;
        const stepSamples=motion.sample(stepMs),ambientSlots=new Set(stepSamples.filter(sample=>!reservedSlots.has(sample.slot)).map(sample=>sample.slot));
        const step=behaviours.step({kingdomId:frame.kingdomId,epoch:frame.epoch,origin:frame.origin,atMs:stepMs,samples:stepSamples,ambientSlots,destinationsFor:slot=>motion.destinationsForSlot(slot),answers});
        answers=step.goals.map(request=>({request,result:motion.requestGoal(request)}));
      }
      samples = motion.sample(atMs);
      const overlays=behaviours.present(samples,atMs);
      const bodies = samples.filter(sample => !walkers.has(sample.slot) && (!suppliedLooks.has(sample.slot) || knownLooks.has(suppliedLooks.get(sample.slot)!)));
      renderer?.update(bodies.map(sample => ({ id: String(sample.slot), look: suppliedLooks.get(sample.slot) ?? looks[sample.slot % looks.length]!.id,
        position: sample.position, heading: sample.heading, distance: sample.distance, moving: Math.min(1, sample.speed / 1.2), speed: sample.speed, opacity: sample.opacity, time:overlays.get(sample.slot)?.time??time,
        lookYaw:overlays.get(sample.slot)?.lookYaw??0,
        gesture: reservedSlots.has(sample.slot)?'none' as const:speech.has(sample.slot) && speech.get(sample.slot)!.expiresAt > atMs ? 'nod' as const : overlays.get(sample.slot)?.gesture??'none' as const })), camera);
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
    speechLabels(camera: THREE.Camera, width: number, height: number, atMs: number): SpeechLabel[] {
      const labels: SpeechLabel[] = [];
      for (const sample of samples) {
        const cue = speech.get(sample.slot);
        if (!cue || cue.asOf > atMs || cue.expiresAt <= atMs) continue;
        const point = new THREE.Vector3(...walkerSubject(sample, walkers).position);
        point.y += 1.9 + (walkers.get(sample.slot)?.posture ? CITIZEN_SEATED_HEAD_OFFSET_METRES : 0);
        if (point.distanceTo(camera.position) > 28) continue;
        point.project(camera);
        if (point.z < 0 || point.z > 1 || Math.abs(point.x) > .85 || Math.abs(point.y) > .8) continue;
        labels.push({ slot: sample.slot, name: sample.publicName, x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, parts: cue.parts });
        if (labels.length >= 3) break;
      }
      return labels;
    },
    clear() { resetBehaviours(); motion.clear(); frame = undefined; samples = []; walkers = new Map(); suppliedLooks.clear(); speech.clear(); renderer?.update([]); shadows.count = 0; },
    dispose() { resetBehaviours(); disposed = true; renderer?.dispose(); material.dispose(); scene.remove(shadows); shadows.dispose(); shadowGeometry.dispose(); shadowMaterial.dispose(); },
  };
}
