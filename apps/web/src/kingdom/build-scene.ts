import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createWindowLights, geometryFromChunks, type VoxelRenderState, type WindowHouse } from '@chatdom/render';
import { KingdomIdSchema, type KingdomPresenceFrame, type VoxelBlueprint } from '@chatdom/shared';
import { homeOrigin, type SettlementHome } from '@chatdom/world';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { createBuildSession, readSimulatedPublication } from '../build/session';
import { createPlotBuildPolicy } from '../build/policy';
import { blueprintInReserve, buildBounds, composeBuildCamera } from '../build/composition';
import type { createKingdomSound } from './sound';

export type KingdomBuildSession = ReturnType<typeof createBuildSession>;
export interface KingdomBuildOptions {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement;
  pool: VoxelWorkerPool; material: VoxelRenderState;
  home: SettlementHome; authoredHome: WindowHouse;
  /** Stable simulation identity, scoped by kingdom/seed so repeated plot IDs cannot share drafts. */
  ownerId: string; ownerName: string; source: 'SIMULATED' | 'LIVE';
  sound: ReturnType<typeof createKingdomSound>;
  onSession(session: KingdomBuildSession | null): void;
  onHomeVisibility(hidden: boolean): void;
  /** The published replacement is the same geometry for light blockers, picking and collision. */
  onStreetHome(home: WindowHouse | null, mesh?: THREE.Mesh): void;
  onHousewarming?(ownerName: string | null): void;
  registerShadow?(mesh: THREE.Mesh): () => void;
}

/** Owns one simulated plot. It never authenticates a live deed or claims a moderation verdict. */
export function createKingdomBuild(options: KingdomBuildOptions) {
  const { home, canvas, camera } = options;
  const policy = createPlotBuildPolicy(home, options.ownerId);
  const position = homeOrigin(home, policy.size[2] * .125), yaw = home.rotation * Math.PI / 2;
  const initialBlueprint = blueprintInReserve(options.authoredHome.blueprint, policy);
  const streetMesh = new THREE.Mesh(new THREE.BufferGeometry(), options.material.material);
  streetMesh.name = `local-home:${home.id}`; streetMesh.position.set(...position); streetMesh.rotation.y = yaw;
  streetMesh.visible = false; streetMesh.frustumCulled = false; options.scene.add(streetMesh);
  let session: KingdomBuildSession | null = null, opening: Promise<boolean> | null = null;
  let streetHome: WindowHouse | null = null, streetWindows: ReturnType<typeof createWindowLights> | undefined;
  let streetShadow: (() => void) | undefined, draftShadow: (() => void) | undefined;
  let disposed = false, generation = 0, renderRevision = 0, nowMs = 0;
  let draftShown = false, presenceFrame: KingdomPresenceFrame | undefined;
  let warming: { start: number; duration: 6000 } | null = null;
  let azimuth = .42, elevation = .72, zoom = 1;
  let drag: { id: number; x: number; y: number } | null = null;
  let bounds = buildBounds(initialBlueprint);

  function visibility() {
    streetMesh.visible = !!streetHome && !draftShown;
    options.onHomeVisibility(draftShown || !!streetHome);
    renderRevision++;
  }
  function stopHousewarming() {
    if (!warming) return;
    warming = null; options.onHousewarming?.(null); camera.clearViewOffset(); renderRevision++;
  }
  function closeSession() {
    if (!session) return;
    const previous = session; session = null; draftShown = false;
    draftShadow?.(); draftShadow = undefined;
    previous.dispose(); options.onSession(null); camera.clearViewOffset(); visibility();
    if (streetHome && !disposed) {
      installStreetWindows(streetHome);
      if (!streetShadow) streetShadow = options.registerShadow?.(streetMesh);
    }
  }
  function installStreetWindows(placement: WindowHouse) {
    streetWindows?.dispose();
    streetWindows = createWindowLights(options.scene, [placement]);
    streetWindows.setFrame(presenceFrame ?? { version: 1, kingdomId: KingdomIdSchema.parse('1'), epoch: 'simulated-build', sequence: renderRevision,
      asOf: 1000, origin: 'simulated', streamLive: true, connection: 'fresh',
      windows: [{ slot: home.slot, present: true, publicName: options.ownerName, since: 0 }] });
  }
  async function installPublication(blueprint: VoxelBlueprint, epoch: number) {
    const result = await options.pool.submit({ kind: 'blueprint', blueprint, revision: renderRevision + 1,
      materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (disposed || epoch !== generation || result?.kind !== 'asset') throw new Error('The local home was closed before its new shape was ready.');
    const geometry = geometryFromChunks(result.chunks, 'build');
    streetShadow?.(); streetShadow = undefined;
    streetMesh.geometry.dispose(); streetMesh.geometry = geometry;
    streetHome = { slot: home.slot, blueprint, position, yaw }; bounds = buildBounds(blueprint);
    streetMesh.updateMatrixWorld(true);
    streetShadow = options.registerShadow?.(streetMesh);
    options.onStreetHome(streetHome, streetMesh);
    if (!session) installStreetWindows(streetHome);
    visibility();
  }
  async function prepare() {
    if (disposed || options.source !== 'SIMULATED') return;
    const saved = readSimulatedPublication(policy);
    if (saved) await installPublication(saved, generation);
  }
  function enter(): Promise<boolean> {
    if (disposed || options.source !== 'SIMULATED') return Promise.resolve(false);
    if (session) return opening ?? Promise.resolve(true);
    stopHousewarming(); generation++; azimuth = .42; elevation = canvas.clientWidth < 640 ? .83 : .72; zoom = 1;
    const epoch = generation;
    streetWindows?.dispose(); streetWindows = undefined;
    streetShadow?.(); streetShadow = undefined;
    options.sound.unlock(); options.sound.cue('wood');
    session = createBuildSession({ scene: options.scene, camera, canvas, pool: options.pool, material: options.material,
      policy, initialBlueprint: streetHome?.blueprint ?? initialBlueprint, position, yaw, slot: home.slot,
      ownerName: options.ownerName, source: options.source, sound: options.sound,
      onLeave: leave,
      onMesh(mesh) {
        draftShadow?.(); draftShadow = options.registerShadow?.(mesh);
        if (mesh.geometry.boundingBox && !mesh.geometry.boundingBox.isEmpty()) bounds = mesh.geometry.boundingBox.clone();
        draftShown = true; visibility();
      },
      onPublish: blueprint => installPublication(blueprint, epoch),
      onPublished() {
        if (disposed || generation !== epoch) return;
        closeSession(); warming = { start: nowMs, duration: 6000 }; options.onHousewarming?.(options.ownerName); renderRevision++;
      },
    });
    options.onSession(session);
    // Keep the authored house visible until its actual private geometry has arrived.
    const current = session;
    opening = current.settled().then(() => {
      if (disposed || session !== current || generation !== epoch) return false;
      if (current.debug.meshedRevision < 0) return false;
      visibility(); return true;
    }).finally(() => { opening = null; });
    return opening;
  }
  function leave() { generation++; stopHousewarming(); closeSession(); releaseDrag(); options.sound.cue('wood'); }
  function releaseDrag() {
    if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    drag = null;
  }
  function pointerDown(event: PointerEvent) {
    if (!session || event.button !== 2) return;
    event.preventDefault(); event.stopImmediatePropagation();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    azimuth = THREE.MathUtils.clamp(azimuth - (event.clientX - drag.x) * .006, -Math.PI, Math.PI);
    elevation = THREE.MathUtils.clamp(elevation + (event.clientY - drag.y) * .004, .42, 1.32);
    drag.x = event.clientX; drag.y = event.clientY; renderRevision++;
  }
  function pointerUp(event: PointerEvent) { if (drag?.id === event.pointerId) { event.stopImmediatePropagation(); releaseDrag(); } }
  function contextMenu(event: Event) { if (session) event.preventDefault(); }
  function wheel(event: WheelEvent) {
    if (!session) return;
    event.preventDefault(); event.stopImmediatePropagation();
    zoom = THREE.MathUtils.clamp(zoom * Math.exp(event.deltaY * .001), .8, 1.8); renderRevision++;
  }
  canvas.addEventListener('pointerdown', pointerDown, true); canvas.addEventListener('pointermove', pointerMove, true);
  canvas.addEventListener('pointerup', pointerUp, true); canvas.addEventListener('pointercancel', pointerUp, true);
  canvas.addEventListener('contextmenu', contextMenu); canvas.addEventListener('wheel', wheel, { passive: false, capture: true });
  window.addEventListener('blur', releaseDrag);
  return {
    policy, prepare, enter, leave,
    get session() { return session; },
    get hidden() { return draftShown || !!streetHome; },
    get renderRevision() { return renderRevision; },
    get housewarming() { return warming ? { ownerName: options.ownerName, durationMs: warming.duration, elapsedMs: Math.max(0, nowMs - warming.start) } : null; },
    get streetHome() { return streetHome; },
    setFrame(frame: KingdomPresenceFrame) { presenceFrame = frame; streetWindows?.setFrame(frame); },
    getSources() { return session?.getSources() ?? streetWindows?.getSources() ?? []; },
    /** Call after the ordinary camera pose, before lookAt(target). Uses monotonic render time, even on a paused kingdom. */
    update(timeMs: number, dt: number, hour: number, target: THREE.Vector3): boolean {
      nowMs = timeMs;
      session?.update(dt, hour); streetWindows?.update(dt, hour);
      if (warming && nowMs - warming.start >= warming.duration) stopHousewarming();
      if (!session && !warming) return false;
      const progress = warming ? THREE.MathUtils.smootherstep(nowMs - warming.start, 0, warming.duration) : 0;
      const composition = composeBuildCamera(bounds, position, yaw, { width: canvas.clientWidth, height: canvas.clientHeight },
        { azimuth: warming ? -.4 + progress * .8 : azimuth, elevation: warming ? .65 : elevation, zoom: warming ? 1.1 : zoom, tools: !!session });
      camera.position.copy(composition.position); target.copy(composition.target); camera.fov = composition.fov;
      camera.setViewOffset(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), composition.offsetX, composition.offsetY, Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
      camera.updateProjectionMatrix();
      if (warming) renderRevision++;
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation++; releaseDrag(); stopHousewarming(); closeSession();
      streetShadow?.(); streetWindows?.dispose(); options.scene.remove(streetMesh); streetMesh.geometry.dispose();
      options.onStreetHome(null); options.onHomeVisibility(false);
      canvas.removeEventListener('pointerdown', pointerDown, true); canvas.removeEventListener('pointermove', pointerMove, true);
      canvas.removeEventListener('pointerup', pointerUp, true); canvas.removeEventListener('pointercancel', pointerUp, true);
      canvas.removeEventListener('contextmenu', contextMenu); canvas.removeEventListener('wheel', wheel, true);
      window.removeEventListener('blur', releaseDrag);
    },
  };
}
