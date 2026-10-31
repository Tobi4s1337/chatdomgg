import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { assembleForge, checkForge, findForgeSockets, forgeRitualFrame, forgeStyleKit, homeFingerprint, type AssembledForge } from '@chatdom/forge';
import { geometryFromChunks, type VoxelRenderState, type WindowHouse } from '@chatdom/render';
import { VOXEL_METRES, type ForgeRitualFrame, type Vec3 } from '@chatdom/shared';
import { REALM_CASTLE_SLOT, type CommittedForgeAttachment } from '@chatdom/shared/realm';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import type { RealmForgeFeed } from '../../realm/adapters/forge-feed';
import type { createKingdomSound } from '../../kingdom/sound';
import { buildBounds } from '../../build/composition';
import { createForgeEmitters } from '../emitters';
import { createForgePresentation, type ForgePresentation } from '../presentation';
import { createForgeRitualView } from '../ritual-view';
import { createLandingMaterial } from './landing-light';

export interface RealmForgeSceneOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  pool: VoxelWorkerPool;
  material: VoxelRenderState;
  anvil: THREE.Vector3;
  home(slot: number): WindowHouse | undefined;
  sound: ReturnType<typeof createKingdomSound>;
  feed: RealmForgeFeed;
  /** Hide only this committed attachment's static geometry during its arrival. */
  hideAttachment(id: string, hidden: boolean): void;
  registerShadow?(mesh: THREE.Mesh): () => void;
}

interface Casting {
  attachment: CommittedForgeAttachment;
  home: WindowHouse;
  result: AssembledForge;
  bounds: THREE.Box3;
  homeBounds: THREE.Box3;
  destination: THREE.Vector3;
  mesh: THREE.Mesh;
  presentation: ForgePresentation;
  unshadow: (() => void) | undefined;
  started: number | null;
  landed: boolean;
  landedAt: number | null;
  light: ReturnType<typeof createLandingMaterial>;
}

/** This is a room-event presentation sink. It never creates or persists an attachment. */
export function createRealmForgeScene(options: RealmForgeSceneOptions) {
  const view = createForgeRitualView(options.scene, options.material);
  view.root.position.copy(options.anvil);
  view.beginWords();
  const effects = new THREE.Group();
  effects.name = 'realm-forge-presentation';
  options.scene.add(effects);
  const emitters = createForgeEmitters(options.scene);
  const seen = new Set<string>(), completedActivities = new Set<string>(), queue: CommittedForgeAttachment[] = [];
  const standing = new Map<string, { attachment: CommittedForgeAttachment; position: THREE.Vector3; kind: 'smoke' | 'glow'; direction?: THREE.Vector3 }>();
  const stages = new Map<string, { stage: string; started: number }>();
  const focusPoint = options.anvil.clone();
  const anvilFace = options.anvil.clone().add(new THREE.Vector3(0, 1.43, 0));
  let now = 0, revision = 0, epoch = 0, disposed = false, receivedClock = false, castingHeat = 0;
  let preparing: CommittedForgeAttachment | null = null, current: Casting | null = null;
  let landing: { at: number; position: THREE.Vector3; sources: { position: Vec3; normal: Vec3; strength: number }[] } | null = null;

  function assembled(attachment: CommittedForgeAttachment) {
    if ((attachment.hostProfile === 'castle-keep') !== (attachment.slot === REALM_CASTLE_SLOT)) throw new Error('The committed host profile does not match its slot.');
    const home = options.home(attachment.slot);
    if (!home || home.blueprint.id !== attachment.hostId || homeFingerprint(home.blueprint) !== attachment.hostFingerprint) throw new Error('The committed home is no longer visible.');
    const socket = findForgeSockets(home.blueprint, attachment.hostProfile).find(s => s.id === attachment.socketId);
    const kit = forgeStyleKit(attachment.family);
    if (!socket || socket.origin.some((n, axis) => n !== attachment.origin[axis]) || kit.id !== attachment.kitId || kit.revision !== attachment.kitRevision) throw new Error('The committed socket or style has changed.');
    const result = assembleForge(attachment.draft.plan, kit, socket);
    checkForge(result, home.blueprint, attachment.hostProfile);
    return { home, result };
  }

  function rememberStanding(attachment: CommittedForgeAttachment) {
    for (const [id, entry] of standing) if (entry.attachment.slot === attachment.slot && entry.attachment.socketId === attachment.socketId) standing.delete(id);
    try {
      const { home, result } = assembled(attachment);
      if (!result.emitterKind) return;
      const position = new THREE.Vector3(...result.emitter).add(new THREE.Vector3(...attachment.origin))
        .multiplyScalar(VOXEL_METRES.build).applyAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw).add(new THREE.Vector3(...home.position));
      const direction = attachment.draft.plan.motif === 'sleeping-dragon'
        ? new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw) : undefined;
      standing.set(attachment.id, { attachment, position, kind: result.emitterKind, ...(direction ? { direction } : {}) });
    } catch { /* An invisible or superseded host has no standing emitter in this scene. */ }
  }

  function clearCurrent() {
    if (!current) return;
    current.presentation.dispose();
    current.unshadow?.();
    options.scene.remove(current.mesh);
    current.mesh.geometry.dispose();
    current.light.dispose();
    options.hideAttachment(current.attachment.id, false);
    current = null;
  }

  async function next() {
    if (disposed || preparing || current) return;
    const attachment = queue.shift();
    if (!attachment) return;
    const generation = epoch;
    preparing = attachment;
    options.hideAttachment(attachment.id, true);
    let geometry: THREE.BufferGeometry | undefined;
    let mesh: THREE.Mesh | undefined;
    let light: ReturnType<typeof createLandingMaterial> | undefined;
    try {
      const { home, result } = assembled(attachment);
      const output = await options.pool.submit({ kind: 'blueprint', blueprint: result.blueprint, materials: MATERIALS.materials, materialRevision: MATERIALS.revision, revision: ++revision });
      if (disposed || generation !== epoch) return;
      const latest = options.home(attachment.slot);
      if (!latest || homeFingerprint(latest.blueprint) !== attachment.hostFingerprint || latest.yaw !== home.yaw || latest.position.some((n, i) => n !== home.position[i])) throw new Error('The committed home changed during meshing.');
      if (output?.kind !== 'asset' || !output.chunks.length || output.chunks.reduce((n, c) => n + c.mesh.indices.length / 3, 0) > 40000) throw new Error('The committed part could not be meshed.');
      geometry = geometryFromChunks(output.chunks, 'build');
      const destination = new THREE.Vector3(...attachment.origin).multiplyScalar(VOXEL_METRES.build)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw).add(new THREE.Vector3(...home.position));
      light = createLandingMaterial(options.material.material);
      mesh = new THREE.Mesh(geometry, light.material);
      mesh.name = `realm-forge-clone:${attachment.id}`;
      mesh.position.copy(destination); mesh.rotation.y = home.yaw; mesh.frustumCulled = false;
      options.scene.add(mesh); mesh.updateMatrixWorld(true);
      // The shared presentation reads the clone's actual socket pose before moving it to the anvil.
      const presentation = createForgePresentation({ root: effects, anvil: anvilFace.toArray(), landing: destination.toArray(), piece: mesh });
      const bounds = buildBounds(result.blueprint);
      const homeBounds = buildBounds(home.blueprint).union(bounds.clone().translate(new THREE.Vector3(...attachment.origin).multiplyScalar(VOXEL_METRES.build)));
      current = { attachment, home, result, bounds, homeBounds, destination, mesh, presentation,
        unshadow: options.registerShadow?.(mesh), started: receivedClock ? now : null, landed: false, landedAt: null, light };
    } catch {
      if (mesh) options.scene.remove(mesh);
      geometry?.dispose();
      light?.dispose();
      // Geometry failure is not a failed room commit: its static attachment stays authoritative.
      options.hideAttachment(attachment.id, false);
    } finally {
      if (generation === epoch) { preparing = null; if (!current) void next(); }
    }
  }

  const unsubscribe = options.feed.subscribe({
    stage(activityId, stage) {
      if (disposed || completedActivities.has(activityId)) return;
      const previous = stages.get(activityId);
      stages.set(activityId, { stage, started: previous?.started ?? now });
    },
    ended(activityId) {
      if (disposed) return;
      completedActivities.add(activityId);
      stages.delete(activityId);
    },
    committed(attachment, activityId) {
      if (disposed || seen.has(attachment.id)) return;
      seen.add(attachment.id); completedActivities.add(activityId); stages.delete(activityId);
      rememberStanding(attachment);
      queue.push(attachment); void next();
    },
    // Snapshot geometry belongs to the founded scene. Standing smoke never replays its history.
    restored(attachments) { standing.clear(); for (const attachment of attachments) rememberStanding(attachment); },
    unavailable() {
      epoch++; stages.clear(); queue.length = 0; landing = null;
      options.sound.forgeUpdate?.(null);
      if (preparing) options.hideAttachment(preparing.id, false);
      preparing = null; clearCurrent();
    },
  });

  function direct(casting: Casting | null, frame: ForgeRitualFrame | null) {
    const width = Math.max(1, options.canvas.clientWidth), height = Math.max(1, options.canvas.clientHeight);
    const size = casting?.bounds.getSize(new THREE.Vector3()) ?? new THREE.Vector3(3, 2, 3);
    // Above the casting: 0.9√heft for the lip, arrival/departure lift and the tilted bowl/bail (heft ≤ 1.8).
    // Hold this envelope throughout the anvil shot so the pour never clips its crucible or pumps the camera.
    const waiting = !casting;
    const stageHeight = 1.6 + size.y + 2.7;
    // While words are being judged, the engraving is the subject. Reserve the
    // full crucible envelope only once there is an approved casting to pour.
    const target = options.anvil.clone().add(new THREE.Vector3(0, waiting ? 1.15 : stageHeight * .5, 0));
    const fov = 43, half = THREE.MathUtils.degToRad(fov / 2);
    const radius = waiting ? 2.2 : Math.hypot(Math.max(3.4, size.x), stageHeight, Math.max(3.4, size.z)) / 2;
    const distance = Math.max(waiting ? 6 : 10, radius / Math.sin(Math.min(half, Math.atan(Math.tan(half) * width / height))) * 1.15);
    const offset = new THREE.Vector3(-7, 3.6, 11).normalize().multiplyScalar(distance);
    // A front-quarter portrait of the actual occupied home, including its new part.
    // Fit corners in camera space rather than framing only the socket or the lot's reserved air.
    function fit(bounds: THREE.Box3, position: THREE.Vector3, yaw: number, direction: THREE.Vector3) {
      const centre = bounds.getCenter(new THREE.Vector3());
      const backward = direction.clone().normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), backward).normalize();
      const up = new THREE.Vector3().crossVectors(backward, right);
      const tanV = Math.tan(half) * .86, tanH = tanV * width / height;
      let distance = 6;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const corner = new THREE.Vector3(x, y, z).sub(centre).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        const depth = corner.dot(backward);
        distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / tanH, depth + Math.abs(corner.dot(up)) / tanV);
      }
      return { target: centre.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(position), offset: backward.multiplyScalar(distance + .6) };
    }
    if (waiting || frame?.phase === 'words' || frame?.phase === 'blueprint' || frame?.phase === 'pour') {
      // Hold the working smithy and the west/north audience crescent together.
      // Keep a clear foreground wedge so heads never hide the pour.
      const workshop = fit(new THREE.Box3(new THREE.Vector3(-9, -.125, -10), new THREE.Vector3(8.65, Math.max(4.8, waiting ? 0 : stageHeight), 2.5)),
        options.anvil, 0, new THREE.Vector3(-7, 2.4, 11));
      target.copy(workshop.target); offset.copy(workshop.offset);
    }
    if (casting && frame && (frame.phase === 'flight' || frame.phase === 'landed')) {
      const homePosition = new THREE.Vector3(...casting.home.position);
      const home = fit(casting.homeBounds, homePosition, casting.home.yaw, new THREE.Vector3(-.3, .44, 1));
      if (frame.phase === 'flight') {
        const progress = THREE.MathUtils.smootherstep(frame.phaseProgress, 0, 1);
        casting.mesh.updateWorldMatrix(true, false);
        target.lerp(casting.mesh.localToWorld(casting.bounds.getCenter(new THREE.Vector3())), Math.min(1, progress * 4));
        target.lerp(home.target, progress);
        offset.lerp(home.offset, progress);
      } else {
        // Receive it as a house first. Then a slow, finite move gives the gift
        // its own portrait, with the eaves still identifying whose roof it is.
        const roof = casting.bounds.clone().translate(new THREE.Vector3(...casting.attachment.origin).multiplyScalar(VOXEL_METRES.build));
        const centre = roof.getCenter(new THREE.Vector3());
        const roofPortrait = roof.clone().expandByVector(new THREE.Vector3(1.7, 1.05, 1.35));
        roofPortrait.min.y = Math.min(roofPortrait.min.y, casting.homeBounds.max.y * .53);
        // Leave air above the muzzle for its first curls of smoke.
        roofPortrait.max.y += 1.1;
        roofPortrait.min.x = Math.min(roofPortrait.min.x, centre.x - 2.8);
        roofPortrait.max.x = Math.max(roofPortrait.max.x, centre.x + 2.8);
        const portrait = fit(roofPortrait, homePosition, casting.home.yaw, new THREE.Vector3(-.16, .12, 1));
        const age = casting.landedAt === null ? 0 : (now - casting.landedAt) / 1000;
        const settle = THREE.MathUtils.smootherstep(age, .65, 2.8);
        target.copy(home.target).lerp(portrait.target, settle);
        offset.copy(home.offset).lerp(portrait.offset, settle);
      }
    }
    if (width < 640 && casting && frame?.phase !== 'flight' && frame?.phase !== 'landed') offset.multiplyScalar(1.22);
    focusPoint.copy(target);
    options.camera.clearViewOffset(); options.camera.position.copy(target).add(offset);
    options.camera.fov = fov; options.camera.lookAt(target); options.camera.updateProjectionMatrix();
  }

  return {
    /** True only while this presentation has directed a spectator/focused camera this frame. */
    update(nowMs: number, cameraAllowed: boolean): boolean {
      now = nowMs;
      receivedClock = true;
      if (disposed) return false;
      const pending = [...stages.entries()].at(-1);
      let frame: ForgeRitualFrame | null = null;
      if (current) {
        current.started ??= now;
        frame = { ...forgeRitualFrame(current.attachment.id, (now - current.started) / 1000), source: current.attachment.provenance.source };
        current.presentation.update(frame);
        if (frame.phase === 'landed') {
          // Keep the identical committed clone for the brief warm welcome;
          // reveal the room-owned static mesh when this presentation releases it.
          current.mesh.visible = true;
          if (!current.landed) {
            current.landed = true;
            current.landedAt = now;
            const homeBounds = buildBounds(current.home.blueprint);
            const home = current.home;
            const piece = current.bounds.getCenter(new THREE.Vector3()).add(new THREE.Vector3(...current.attachment.origin).multiplyScalar(VOXEL_METRES.build));
            const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), current.home.yaw).toArray() as Vec3;
            const world = (point: THREE.Vector3) => point.applyAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw).add(new THREE.Vector3(...home.position)).toArray() as Vec3;
            // A brief reflected warmth on the roof and upper facade; these are spell lights, never presence windows.
            landing = { at: current.landedAt,
              position: current.bounds.getCenter(new THREE.Vector3()).applyAxisAngle(new THREE.Vector3(0, 1, 0), current.home.yaw).add(current.destination),
              sources: [
                { position: world(piece.clone().add(new THREE.Vector3(0, .2, .2))), normal: front, strength: .85 },
                { position: world(new THREE.Vector3(THREE.MathUtils.clamp(piece.x, homeBounds.min.x, homeBounds.max.x), homeBounds.max.y * .67, homeBounds.max.z + .15)), normal: front, strength: .68 },
              ],
            };
            options.feed.settled(current.attachment.id);
          }
        }
        current.light.setWarmth(current.landedAt === null ? 0 :
          THREE.MathUtils.smoothstep((now - current.landedAt) / 1000, 0, .35) *
          (1 - THREE.MathUtils.smoothstep((now - current.landedAt) / 1000, 5.5, 8)));
        // Let the new house part breathe after it lands. Walking or another
        // explicit camera owner ends this hold immediately once the ritual ends.
        const landingHold = cameraAllowed ? 6 : 0;
        if (frame.elapsed >= frame.duration + landingHold) { clearCurrent(); frame = null; void next(); }
      }
      // Pending requests have a breathing rhythm, never a fabricated candidate or completion fraction.
      const waiting: ForgeRitualFrame | null = !current && (pending || preparing) ? {
        ritualId: pending?.[0] ?? preparing!.runId, phase: 'words', elapsed: Math.max(0, (now - (pending?.[1].started ?? now)) / 1000),
        phaseProgress: 0, duration: 21, source: 'live',
      } : null;
      castingHeat = frame?.phase === 'pour' || frame?.phase === 'strike' ? 1 :
        frame?.phase === 'seal' ? .85 : frame?.phase === 'cool' ? 1 - frame.phaseProgress : 0;
      view.update(waiting, !!waiting && pending?.[1].stage === 'drafting');
      // The external presentation owns the clone, hammer and runes after commit. Heat the physical anvil too,
      // without starting a second set of effects or exposing a candidate while the judges are still working.
      if (frame) view.updateAnvil(frame);
      options.sound.forgeUpdate?.(frame ?? waiting);
      emitters.update({ time: now / 1000, anvil: anvilFace, activity: frame?.phase === 'pour' ? 1 : 0,
        fillHeight: frame?.phase === 'pour' && current ? current.bounds.getSize(new THREE.Vector3()).y * frame.phaseProgress : 0,
        strike: frame?.phase === 'strike' ? 1 - frame.phaseProgress : 0,
        ...(landing ? { landingBeat: {
          position: landing.position, age: (now - landing.at) / 1000, colour: 0xffba60,
        } } : {}),
        landed: [...standing.values()].filter(entry => entry.attachment.id !== preparing?.id && (entry.attachment.id !== current?.attachment.id || current.landed))
          .sort((a, b) => a.position.distanceToSquared(options.camera.position) - b.position.distanceToSquared(options.camera.position)).slice(0, 18),
      });
      if (!cameraAllowed || (!waiting && !current)) return false;
      direct(current, frame); return true;
    },
    setEnvironment: view.setEnvironment,
    active: () => !!(stages.size || preparing || current),
    get focusPoint() { return focusPoint; },
    sources(): readonly { position: Vec3; normal: Vec3; strength: number }[] {
      // The approved casting is luminous while it pours and cools, not only when
      // it lands. Feed the same occluded field used by paving and moving faces.
      const sources: { position: Vec3; normal: Vec3; strength: number }[] = castingHeat > 0 ? [
        { position: [anvilFace.x, anvilFace.y + .45, anvilFace.z], normal: [0, 1, 0], strength: castingHeat },
        { position: [anvilFace.x - 2, options.anvil.y + .3, anvilFace.z + 1.5], normal: [0, 1, 0], strength: castingHeat * .8 },
      ] : [];
      if (!landing) return sources;
      const age = (now - landing.at) / 1000;
      if (age < 0 || age >= 3) return sources;
      const strength = THREE.MathUtils.smoothstep(age, 0, .15) * (1 - THREE.MathUtils.smoothstep(age, .15, 3));
      return [...sources, ...landing.sources.map(source => ({ ...source, strength: source.strength * strength }))];
    },
    get activeAttachmentId() { return current?.attachment.id ?? preparing?.id ?? null; },
    dispose() {
      if (disposed) return;
      disposed = true; epoch++; unsubscribe(); stages.clear(); standing.clear(); queue.length = 0; landing = null;
      options.sound.forgeUpdate?.(null);
      if (preparing) options.hideAttachment(preparing.id, false);
      preparing = null; clearCurrent(); view.dispose(); emitters.dispose(); options.scene.remove(effects);
    },
  };
}
