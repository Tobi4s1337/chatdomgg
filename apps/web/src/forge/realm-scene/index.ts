import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { assembleForge, checkForge, findForgeSockets, forgeRitualFrame, forgeStyleKit, homeFingerprint, type AssembledForge } from '@chatdom/forge';
import { geometryFromChunks, type VoxelRenderState, type WindowHouse } from '@chatdom/render';
import { VOXEL_METRES, type ForgeRitualFrame } from '@chatdom/shared';
import type { CommittedForgeAttachment } from '@chatdom/shared/realm';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import type { RealmForgeFeed } from '../../realm/adapters/forge-feed';
import type { createKingdomSound } from '../../kingdom/sound';
import { buildBounds } from '../../build/composition';
import { createForgeEmitters } from '../emitters';
import { createForgePresentation, type ForgePresentation } from '../presentation';
import { createForgeRitualView } from '../ritual-view';
import { playForgeSound } from '../sound';

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
  destination: THREE.Vector3;
  mesh: THREE.Mesh;
  presentation: ForgePresentation;
  unshadow: (() => void) | undefined;
  started: number | null;
  lastPhase: string;
  landed: boolean;
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
  const standing = new Map<string, { attachment: CommittedForgeAttachment; position: THREE.Vector3; kind: 'smoke' | 'glow' }>();
  const stages = new Map<string, { stage: string; started: number }>();
  const anvilFace = options.anvil.clone().add(new THREE.Vector3(0, 1.43, 0));
  let now = 0, revision = 0, epoch = 0, disposed = false, receivedClock = false;
  let preparing: CommittedForgeAttachment | null = null, current: Casting | null = null;

  function assembled(attachment: CommittedForgeAttachment) {
    const home = options.home(attachment.slot);
    if (!home || home.blueprint.id !== attachment.hostId || homeFingerprint(home.blueprint) !== attachment.hostFingerprint) throw new Error('The committed home is no longer visible.');
    const socket = findForgeSockets(home.blueprint).find(s => s.id === attachment.socketId);
    const kit = forgeStyleKit(attachment.family);
    if (!socket || socket.origin.some((n, axis) => n !== attachment.origin[axis]) || kit.id !== attachment.kitId || kit.revision !== attachment.kitRevision) throw new Error('The committed socket or style has changed.');
    return { home, result: assembleForge(attachment.draft.plan, kit, socket) };
  }

  function rememberStanding(attachment: CommittedForgeAttachment) {
    for (const [id, entry] of standing) if (entry.attachment.slot === attachment.slot && entry.attachment.socketId === attachment.socketId) standing.delete(id);
    try {
      const { home, result } = assembled(attachment);
      if (!result.emitterKind) return;
      const position = new THREE.Vector3(...result.emitter).add(new THREE.Vector3(...attachment.origin))
        .multiplyScalar(VOXEL_METRES.build).applyAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw).add(new THREE.Vector3(...home.position));
      standing.set(attachment.id, { attachment, position, kind: result.emitterKind });
    } catch { /* An invisible or superseded host has no standing emitter in this scene. */ }
  }

  function clearCurrent() {
    if (!current) return;
    current.presentation.dispose();
    current.unshadow?.();
    options.scene.remove(current.mesh);
    current.mesh.geometry.dispose();
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
    try {
      const { home, result } = assembled(attachment);
      checkForge(result, home.blueprint);
      const output = await options.pool.submit({ kind: 'blueprint', blueprint: result.blueprint, materials: MATERIALS.materials, materialRevision: MATERIALS.revision, revision: ++revision });
      if (disposed || generation !== epoch) return;
      const latest = options.home(attachment.slot);
      if (!latest || homeFingerprint(latest.blueprint) !== attachment.hostFingerprint || latest.yaw !== home.yaw || latest.position.some((n, i) => n !== home.position[i])) throw new Error('The committed home changed during meshing.');
      if (output?.kind !== 'asset' || !output.chunks.length || output.chunks.reduce((n, c) => n + c.mesh.indices.length / 3, 0) > 40000) throw new Error('The committed part could not be meshed.');
      geometry = geometryFromChunks(output.chunks, 'build');
      const destination = new THREE.Vector3(...attachment.origin).multiplyScalar(VOXEL_METRES.build)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw).add(new THREE.Vector3(...home.position));
      mesh = new THREE.Mesh(geometry, options.material.material);
      mesh.name = `realm-forge-clone:${attachment.id}`;
      mesh.position.copy(destination); mesh.rotation.y = home.yaw; mesh.frustumCulled = false;
      options.scene.add(mesh); mesh.updateMatrixWorld(true);
      // The shared presentation reads the clone's actual socket pose before moving it to the anvil.
      const presentation = createForgePresentation({ root: effects, anvil: anvilFace.toArray(), landing: destination.toArray(), piece: mesh });
      current = { attachment, home, result, bounds: buildBounds(result.blueprint), destination, mesh, presentation,
        unshadow: options.registerShadow?.(mesh), started: receivedClock ? now : null, lastPhase: '', landed: false };
    } catch {
      if (mesh) options.scene.remove(mesh);
      geometry?.dispose();
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
      if (!previous) playForgeSound(options.sound, 'words');
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
      epoch++; stages.clear(); queue.length = 0;
      if (preparing) options.hideAttachment(preparing.id, false);
      preparing = null; clearCurrent();
    },
  });

  function direct(casting: Casting | null, frame: ForgeRitualFrame | null) {
    const width = Math.max(1, options.canvas.clientWidth), height = Math.max(1, options.canvas.clientHeight);
    const size = casting?.bounds.getSize(new THREE.Vector3()) ?? new THREE.Vector3(3, 2, 3);
    const target = options.anvil.clone().add(new THREE.Vector3(0, (1.6 + size.y) * .5, 0));
    const fov = 43, half = THREE.MathUtils.degToRad(fov / 2);
    const radius = Math.hypot(Math.max(3.4, size.x), 1.6 + size.y, Math.max(3.4, size.z)) / 2;
    const distance = Math.max(10, radius / Math.sin(Math.min(half, Math.atan(Math.tan(half) * width / height))) * 1.15);
    const offset = new THREE.Vector3(7, 3.6, 11).normalize().multiplyScalar(distance);
    if (casting && frame && (frame.phase === 'flight' || frame.phase === 'landed')) {
      const centre = casting.bounds.getCenter(new THREE.Vector3()).applyAxisAngle(new THREE.Vector3(0, 1, 0), casting.home.yaw).add(casting.destination);
      const homeOffset = new THREE.Vector3(casting.result.plan.kind === 'lantern' ? 4.2 : -4.5, casting.result.plan.kind === 'lantern' ? 1.8 : 2.6, 6.4)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), casting.home.yaw);
      if (frame.phase === 'flight') {
        const progress = THREE.MathUtils.smootherstep(frame.phaseProgress, 0, 1);
        casting.mesh.updateWorldMatrix(true, false);
        target.lerp(casting.mesh.localToWorld(casting.bounds.getCenter(new THREE.Vector3())), Math.min(1, progress * 4));
        offset.lerp(homeOffset, progress);
      } else { target.copy(centre); offset.copy(homeOffset); }
    }
    if (width < 640) offset.multiplyScalar(1.22);
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
        if (current.lastPhase !== frame.phase) { playForgeSound(options.sound, frame.phase); current.lastPhase = frame.phase; }
        if (frame.phase === 'landed') {
          current.mesh.visible = false;
          if (!current.landed) {
            current.landed = true;
            options.hideAttachment(current.attachment.id, false);
            options.feed.settled(current.attachment.id);
          }
        }
        if (frame.elapsed >= frame.duration) { clearCurrent(); frame = null; void next(); }
      }
      // Pending requests have a breathing rhythm, never a fabricated candidate or completion fraction.
      const waiting: ForgeRitualFrame | null = !current && (pending || preparing) ? {
        ritualId: pending?.[0] ?? preparing!.runId, phase: 'words', elapsed: Math.max(0, (now - (pending?.[1].started ?? now)) / 1000),
        phaseProgress: 0, duration: 21, source: 'live',
      } : null;
      view.update(waiting, !!waiting && pending?.[1].stage === 'drafting');
      emitters.update({ time: now / 1000, anvil: anvilFace, activity: frame?.phase === 'pour' ? 1 : 0,
        fillHeight: frame?.phase === 'pour' && current ? current.bounds.getSize(new THREE.Vector3()).y * frame.phaseProgress : 0,
        strike: frame?.phase === 'strike' ? 1 - frame.phaseProgress : 0,
        landed: [...standing.values()].filter(entry => entry.attachment.id !== preparing?.id && (entry.attachment.id !== current?.attachment.id || current.landed))
          .sort((a, b) => a.position.distanceToSquared(options.camera.position) - b.position.distanceToSquared(options.camera.position)).slice(0, 18),
      });
      if (!cameraAllowed || (!waiting && !current)) return false;
      direct(current, frame); return true;
    },
    setEnvironment: view.setEnvironment,
    get activeAttachmentId() { return current?.attachment.id ?? preparing?.id ?? null; },
    dispose() {
      if (disposed) return;
      disposed = true; epoch++; unsubscribe(); stages.clear(); standing.clear(); queue.length = 0;
      if (preparing) options.hideAttachment(preparing.id, false);
      preparing = null; clearCurrent(); view.dispose(); emitters.dispose(); options.scene.remove(effects);
    },
  };
}
