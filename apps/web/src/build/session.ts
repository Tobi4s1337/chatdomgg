import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createWindowLights, geometryFromChunks, type VoxelRenderState } from '@chatdom/render';
import { KingdomIdSchema, VOXEL_METRES, type BuildDraftPolicy, type BuildOperation, type BuildToolsController, type BuildToolsState, type ContentWindow, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { type VoxelWorkerPool } from '@chatdom/voxel';
import { BuildDraft, BuildError, prepareBuildPublication, previewBuildPublication, type BuildPublicationCandidate } from '@chatdom/world';
import { createKingdomSound } from '../kingdom/sound';
import { brushBox, pickBuildCell } from './pick';
import { createBuildStarter } from './starter';
import type { BuildPiece, BuildRackBridge } from './pieces';

export interface BuildSessionOptions {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; pool: VoxelWorkerPool;
  material: VoxelRenderState; policy: BuildDraftPolicy; initialBlueprint: VoxelBlueprint;
  position: Vec3; yaw: number; ownerName: string; source: 'SIMULATED' | 'LIVE';
  slot?: number;
  /** Finished pieces this person may set into the plot (forged gifts kept for later). Absent means none on offer. */
  pieces?: readonly BuildPiece[];
  onPublish(blueprint: VoxelBlueprint): void | Promise<void>;
  /** Runs after the accepted local candidate and private draft have been saved. */
  onPublished?(): void;
  onMesh?(mesh: THREE.Mesh, source: VoxelBlueprint): void;
  onLeave(): void;
  sound?: ReturnType<typeof createKingdomSound>;
}
export interface BuildImportBridge {
  draft: BuildDraft;
  onPreview(blueprint: VoxelBlueprint | null, origin: Vec3): void;
  onChanged(): void;
  /** The rack's view of the same bridge: pieces on offer, their preview and insertion, and the press sound. */
  rack: BuildRackBridge;
}
const storageKey = (policy: BuildDraftPolicy) => `chatdom:build:SIMULATED:1:${policy.plotId}:${policy.ownerId}`;
interface SavedBuild { draft: unknown; published?: BuildPublicationCandidate }

/** Main can restore the local street without replaying a housewarming on reload. */
export function readSimulatedPublication(policy: BuildDraftPolicy): VoxelBlueprint | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(policy)) ?? 'null') as SavedBuild | null;
    if (!saved?.published) return null;
    const draft = new BuildDraft(policy, saved.published.source);
    return prepareBuildPublication(draft, { name: saved.published.name, ownerName: saved.published.ownerName }).blueprint;
  } catch { return null; }
}

export function createBuildSession(options: BuildSessionOptions) {
  const { policy, canvas } = options;
  const listeners = new Set<(state: BuildToolsState) => void>();
  const sound = options.sound ?? createKingdomSound();
  let disposed = false, published: BuildPublicationCandidate | undefined, dirty = false, status = 'Your private draft. The street will wait.', publishing = false;
  let saved: SavedBuild | null = null, storageFailed = false;
  if (options.source === 'SIMULATED') {
    try { saved = JSON.parse(localStorage.getItem(storageKey(policy)) ?? 'null') as SavedBuild | null; }
    catch { status = 'The saved draft could not be read. Your original save is still there.'; storageFailed = true; }
  }
  let draft: BuildDraft, restored = false;
  try { draft = new BuildDraft(policy, saved?.draft); restored = saved?.draft !== undefined; published = saved?.published; }
  catch { draft = new BuildDraft(policy); status = 'This saved draft needs its original plot. It has not been overwritten.'; storageFailed = true; }
  if (!restored) {
    try { draft.insertBlueprint(options.initialBlueprint, [0, 0, 0]); }
    catch { draft.insertBlueprint(createBuildStarter(policy), [0, 0, 0]); status = 'A little cottage is ready to make yours.'; }
    draft = new BuildDraft(policy, draft.serialize());
  }
  dirty = restored && (!published || published.revision !== draft.revision);
  let notifiedRevision = draft.revision;
  if (options.source === 'LIVE') status = 'Building needs a signed-in plot and the kingdom’s draft service.';
  const group = new THREE.Group(); group.position.set(...options.position); group.rotation.y = options.yaw;
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), options.material.material); mesh.frustumCulled = false; group.add(mesh);
  const previewMesh = new THREE.Mesh(new THREE.BufferGeometry(), options.material.material); previewMesh.visible = false; previewMesh.frustumCulled = false; group.add(previewMesh);
  const previewBounds = new THREE.Box3Helper(new THREE.Box3(), '#e3bc72'), previewBoundsMaterial = previewBounds.material as THREE.LineBasicMaterial;
  previewBounds.visible = false; previewBoundsMaterial.depthTest = false; previewBounds.renderOrder = 21; group.add(previewBounds);
  let previewEpoch = 0, previewOpen = false;
  const ghostMaterial = new THREE.MeshBasicMaterial({ color: '#efcf8a', transparent: true, opacity: .23, depthWrite: false });
  const ghostGeometry = new THREE.BoxGeometry(1, 1, 1), ghost = new THREE.Mesh(ghostGeometry, ghostMaterial);
  const ghostEdgeGeometry = new THREE.EdgesGeometry(ghostGeometry), ghostEdgeMaterial = new THREE.LineBasicMaterial({ color: '#ffe3a3', transparent: true, opacity: .9, depthTest: false });
  const ghostEdge = new THREE.LineSegments(ghostEdgeGeometry, ghostEdgeMaterial); ghost.add(ghostEdge); ghost.visible = false; ghost.renderOrder = 20; group.add(ghost);
  const borderPoints = [[policy.editableFrom[0], .05, policy.editableFrom[2]], [policy.editableTo[0], .05, policy.editableFrom[2]], [policy.editableTo[0], .05, policy.editableTo[2]], [policy.editableFrom[0], .05, policy.editableTo[2]], [policy.editableFrom[0], .05, policy.editableFrom[2]]].map(p => new THREE.Vector3(p[0]!, p[1]!, p[2]!).multiplyScalar(VOXEL_METRES.build));
  const borderGeometry = new THREE.BufferGeometry().setFromPoints(borderPoints), borderMaterial = new THREE.LineDashedMaterial({ color: '#d9ba78', dashSize: .35, gapSize: .18, transparent: true, opacity: .6 });
  const border = new THREE.Line(borderGeometry, borderMaterial); border.computeLineDistances(); group.add(border);
  options.scene.add(group); group.updateMatrixWorld(true);
  let windows: ReturnType<typeof createWindowLights> | undefined, ghostTime = 0;
  let tool: BuildToolsState['tool'] = 'place', material = policy.shaping.wall[0]!, brush: 1 | 2 | 4 = 4;
  let pieces: readonly BuildPiece[] = options.source === 'SIMULATED' ? [...options.pieces ?? []] : [], previewPiece: string | null = null;
  let meshedRevision = -1, meshing = false, meshRequested = false, meshTask: Promise<void> = Promise.resolve();
  let pointer: number | null = null, lastStroke = '', lastClient: [number, number] | null = null;
  let strokePlane: { axis: number; value: number; target: number; normal: [number, number, number] } | null = null;
  const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();

  // Mirror mode is retired (decision 35): the frozen contract keeps the field, and it is always null.
  const snapshot = (): BuildToolsState => ({ tool, material, brush, mirror: null, occupied: draft.voxelCount, budget: policy.maxVoxels,
    canUndo: draft.canUndo, canRedo: draft.canRedo, dirty, status, publishing, mode: options.source,
    materials: policy.palette.map(id => { const m = MATERIALS.materials.find(m => m.id === id)!; return { id, name: m.name, colour: m.colour }; }) });
  function notify() { if (!disposed) for (const listener of listeners) listener(snapshot()); }
  function cue() { if (!options.sound) sound.unlock(); sound.cue('wood'); }
  function fail(error: unknown) { status = error instanceof BuildError ? error.message : 'Your draft is safe. That action needs another try.'; notify(); }
  function save() {
    if (options.source !== 'SIMULATED') return;
    if (storageFailed) { status = 'This tab holds your draft. Browser saving needs attention; keep the tab open.'; return; }
    try { localStorage.setItem(storageKey(policy), JSON.stringify({ draft: draft.serialize(), ...(published ? { published } : {}) })); }
    catch { storageFailed = true; status = 'This browser could not save your draft. Keep this tab open.'; }
  }
  function changed() { notifiedRevision = draft.revision; dirty = true; status = 'Private draft saved in this browser.'; save(); requestMesh(); notify(); }
  function installWindows(anchors: ContentWindow[], revision: number) {
    windows?.dispose(); windows = undefined;
    if (options.source !== 'SIMULATED') return;
    const blueprint: VoxelBlueprint = { version: 1, id: `draft:${policy.plotId}`, styleId: policy.styleId, kind: 'home', lattice: 'build', size: [...policy.size], boxes: [], windows: anchors };
    const slot = options.slot ?? 0;
    windows = createWindowLights(options.scene, [{ slot, blueprint, position: options.position, yaw: options.yaw }], { allWindows: true });
    windows.setFrame({ version: 1, kingdomId: KingdomIdSchema.parse('1'), epoch: 'simulated-build', sequence: revision, asOf: 1000, origin: 'simulated', streamLive: true, connection: 'fresh', windows: [{ slot, present: true, publicName: options.ownerName, since: 0 }] });
  }
  function requestMesh() {
    meshRequested = true;
    if (meshing || disposed) return;
    meshing = true; meshRequested = false;
    meshTask = (async () => {
      try {
        const compiled = draft.compile(), revision = draft.revision;
        const result = await options.pool.submit({ kind: 'asset', asset: compiled.asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
        if (disposed || result?.kind !== 'asset' || revision !== draft.revision) return;
        const geometry = geometryFromChunks(result.chunks, 'build');
        mesh.geometry.dispose(); mesh.geometry = geometry; meshedRevision = revision;
        if (!previewOpen) installWindows(compiled.windows, revision);
        options.onMesh?.(mesh, draft.toRawBlueprint());
      } catch (error) { fail(error); }
      finally { meshing = false; if (meshRequested && !disposed) requestMesh(); }
    })();
  }
  function edit(operation: BuildOperation | readonly BuildOperation[]) {
    if (options.source !== 'SIMULATED') { status = 'The kingdom’s draft service must confirm this plot first.'; notify(); return; }
    try { const result = draft.apply(operation); if (result.changed) { clearPreview(); sound.cue('wood'); changed(); } }
    catch (error) { fail(error); }
  }
  function history(backwards: boolean) {
    endStroke();
    if (options.source !== 'SIMULATED') return;
    clearPreview();
    const result = backwards ? draft.undo() : draft.redo();
    if (result.changed) { sound.cue('wood'); changed(); }
  }
  const controller: BuildToolsController = {
    snapshot, subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    tool(value) { endStroke(); tool = value; cue(); notify(); refreshGhost(); },
    material(value) { if (!policy.palette.includes(value)) return; material = value; cue(); notify(); },
    brush(value) { brush = value; cue(); notify(); refreshGhost(); },
    mirror() { /* Retired: building never mirrors. The contract method stays until main removes it. */ },
    undo: () => history(true), redo: () => history(false), leave() { endStroke(); options.onLeave(); },
    async publish() {
      if (disposed || publishing) return;
      endStroke();
      clearPreview();
      if (options.source !== 'SIMULATED') { status = 'Publication needs the kingdom’s review service. Your draft is safe.'; notify(); return; }
      publishing = true; status = 'Preparing your local housewarming…'; notify();
      try {
        const candidate = prepareBuildPublication(draft, { name: `${options.ownerName}’s home`, ownerName: options.ownerName });
        const preview = previewBuildPublication(candidate);
        await options.onPublish(preview.candidate.blueprint);
        published = candidate; dirty = draft.revision !== candidate.revision;
        status = 'Your housewarming is on your street in this browser.'; save(); sound.cue('light');
        if (!disposed) options.onPublished?.();
      } catch (error) { fail(error); }
      finally { publishing = false; notify(); }
    },
  };
  function clearPreview(restoreWindows = true) {
    const active = previewOpen;
    previewEpoch++; previewOpen = false; previewPiece = null; previewMesh.visible = false; previewBounds.visible = false; mesh.visible = true;
    if (active) { windows?.dispose(); windows = undefined; if (restoreWindows && !disposed) requestMesh(); }
  }
  const imports: BuildImportBridge = {
    draft,
    onPreview(blueprint, origin) {
      if (disposed || options.source !== 'SIMULATED') return;
      clearPreview(false);
      if (!blueprint) { requestMesh(); return; }
      const epoch = previewEpoch, sourceRevision = draft.revision;
      previewBounds.box.min.set(...origin).multiplyScalar(VOXEL_METRES.build);
      previewBounds.box.max.set(origin[0] + blueprint.size[0], origin[1] + blueprint.size[1], origin[2] + blueprint.size[2]).multiplyScalar(VOXEL_METRES.build);
      previewBoundsMaterial.color.set('#e3bc72'); previewBounds.visible = true;
      try {
        // Render the exact replacement, including cleared air, without touching the user's source/history.
        const prospective = new BuildDraft(policy, draft.serialize()); prospective.insertBlueprint(blueprint, origin);
        const compiled = prospective.compile(); previewOpen = true;
        void options.pool.submit({ kind: 'asset', asset: compiled.asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision }, { key: `build-import-preview:${policy.plotId}` }).then(result => {
          if (disposed || epoch !== previewEpoch || sourceRevision !== draft.revision || result?.kind !== 'asset') return;
          previewMesh.geometry.dispose(); previewMesh.geometry = geometryFromChunks(result.chunks, 'build');
          previewMesh.visible = true; mesh.visible = false; installWindows(compiled.windows, prospective.revision);
        }).catch(error => { if (!disposed && epoch === previewEpoch) { clearPreview(); fail(error); } });
      } catch (error) { previewBoundsMaterial.color.set('#d27862'); fail(error); }
    },
    onChanged() {
      if (disposed || options.source !== 'SIMULATED' || draft.revision === notifiedRevision) return;
      endStroke(); clearPreview(); sound.cue('wood'); changed();
    },
    rack: {
      pieces: () => options.source === 'SIMULATED' ? pieces : [],
      previewing: () => previewPiece,
      preview(id) {
        if (disposed || options.source !== 'SIMULATED') return;
        const piece = id === null ? undefined : pieces.find(item => item.id === id);
        endStroke();
        imports.onPreview(piece?.blueprint ?? null, piece?.origin ?? [0, 0, 0]);
        previewPiece = piece?.id ?? null; notify();
      },
      place(id) {
        const piece = pieces.find(item => item.id === id);
        if (disposed || options.source !== 'SIMULATED' || !piece) return false;
        endStroke();
        const before = draft.revision;
        try { draft.insertBlueprint(piece.blueprint, piece.origin); }
        catch (error) { fail(error); return false; }
        if (draft.revision === before) { clearPreview(); notify(); return false; }
        imports.onChanged(); return true;
      },
      cue(kind) { if (disposed) return; if (!options.sound) sound.unlock(); sound.cue(kind); },
    },
  };
  function selection(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect(); mouse.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(mouse, options.camera);
    let pick = pickBuildCell(raycaster.ray, draft, group.matrixWorld);
    if (strokePlane) {
      const local = raycaster.ray.clone().applyMatrix4(group.matrixWorld.clone().invert());
      local.origin.multiplyScalar(1 / VOXEL_METRES.build);
      const direction = local.direction.getComponent(strokePlane.axis);
      if (Math.abs(direction) < 1e-8) return null;
      const distance = (strokePlane.value - local.origin.getComponent(strokePlane.axis)) / direction;
      if (distance < 0) return null;
      const point = local.at(distance, new THREE.Vector3());
      const cell: [number, number, number] = [Math.floor(point.x), Math.floor(point.y), Math.floor(point.z)];
      cell[strokePlane.axis] = strokePlane.target - (tool === 'place' ? strokePlane.normal[strokePlane.axis]! : 0);
      pick = { cell, normal: strokePlane.normal, floor: false };
    }
    if (!pick) return null;
    const box = brushBox(pick, brush, tool === 'place', policy);
    return box ? { box, pick } : null;
  }
  function refreshGhost() {
    if (!lastClient) return;
    const selected = selection(...lastClient);
    ghost.visible = !!selected && options.source === 'SIMULATED';
    if (!selected) return;
    const { from, to } = selected.box;
    ghost.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2).multiplyScalar(VOXEL_METRES.build);
    ghost.scale.setScalar(brush * VOXEL_METRES.build + .004);
    ghostMaterial.color.set(tool === 'erase' ? '#d27e65' : '#edcc83');
  }
  function sample(clientX: number, clientY: number) {
    lastClient = [clientX, clientY]; refreshGhost();
    const selected = selection(clientX, clientY);
    if (!selected) return;
    if (!strokePlane && pointer !== null && tool !== 'fill') {
      const axis = selected.pick.normal.findIndex(n => n !== 0);
      if (axis >= 0) {
        const target = selected.pick.cell[axis]! + (tool === 'place' ? selected.pick.normal[axis]! : 0);
        strokePlane = { axis, value: target + .5, target, normal: selected.pick.normal };
      }
    }
    const key = `${tool}:${selected.box.from.join(',')}`;
    if (key === lastStroke) return; lastStroke = key;
    if (tool === 'fill') edit({ kind: 'fill', at: selected.pick.cell, material });
    else if (tool === 'erase') edit({ kind: 'erase', ...selected.box });
    else edit({ kind: tool, ...selected.box, material });
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || options.source !== 'SIMULATED') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!options.sound) sound.unlock();
    pointer = event.pointerId; lastStroke = ''; draft.beginGesture(); canvas.setPointerCapture(pointer); sample(event.clientX, event.clientY);
  }
  function pointerMove(event: PointerEvent) {
    lastClient = [event.clientX, event.clientY]; refreshGhost();
    if (pointer === event.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); sample(event.clientX, event.clientY); }
  }
  function endStroke() {
    if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    pointer = null; lastStroke = ''; strokePlane = null; draft.endGesture(); notify();
  }
  function pointerUp(event: PointerEvent) { if (pointer === event.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); endStroke(); } }
  function pointerLeave() { if (pointer === null) { ghost.visible = false; lastClient = null; } }
  function keyDown(event: KeyboardEvent) {
    if (event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable)) return;
    if (event.key === 'Escape') { event.preventDefault(); controller.leave(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) controller.redo(); else controller.undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); controller.redo(); }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && ['1', '2', '3', '4'].includes(event.key)) controller.tool((['place', 'erase', 'paint', 'fill'] as const)[Number(event.key) - 1]!);
  }
  function interrupted() { endStroke(); save(); }
  canvas.addEventListener('pointerdown', pointerDown, true); canvas.addEventListener('pointermove', pointerMove, true);
  canvas.addEventListener('pointerup', pointerUp, true); canvas.addEventListener('pointercancel', pointerUp, true);
  canvas.addEventListener('pointerleave', pointerLeave); window.addEventListener('keydown', keyDown);
  window.addEventListener('blur', interrupted); window.addEventListener('pagehide', interrupted);
  requestMesh(); if (!storageFailed) save();
  return {
    controller, draft, group, mesh, edit, imports,
    /** Replace the pieces on offer (main feeds kept forged gifts here). A piece being previewed that is gone is taken away. */
    offerPieces(next: readonly BuildPiece[]) {
      if (disposed || options.source !== 'SIMULATED') return;
      pieces = [...next];
      if (previewPiece && !pieces.some(item => item.id === previewPiece)) { clearPreview(); }
      notify();
    },
    projectCell(at: Vec3) {
      const point = new THREE.Vector3(...at).addScalar(.5).multiplyScalar(VOXEL_METRES.build).applyMatrix4(group.matrixWorld).project(options.camera);
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
    },
    get debug() { return { revision: draft.revision, meshedRevision, occupied: draft.voxelCount, mode: options.source, status, storageKey: storageKey(policy) }; },
    async settled() { while (!disposed && (meshing || meshRequested)) await meshTask; },
    getSources() { return windows?.getSources() ?? []; },
    update(elapsedSeconds: number, hour = 19.5) { ghostTime += Math.max(0, elapsedSeconds); windows?.update(elapsedSeconds, hour); ghostMaterial.opacity = .2 + Math.sin(ghostTime * 3) * .035; },
    dispose() {
      if (disposed) return; endStroke(); save(); disposed = true; meshRequested = false; clearPreview();
      canvas.removeEventListener('pointerdown', pointerDown, true); canvas.removeEventListener('pointermove', pointerMove, true);
      canvas.removeEventListener('pointerup', pointerUp, true); canvas.removeEventListener('pointercancel', pointerUp, true);
      canvas.removeEventListener('pointerleave', pointerLeave); window.removeEventListener('keydown', keyDown);
      window.removeEventListener('blur', interrupted); window.removeEventListener('pagehide', interrupted);
      windows?.dispose(); options.scene.remove(group); mesh.geometry.dispose(); previewMesh.geometry.dispose(); previewBounds.geometry.dispose(); previewBoundsMaterial.dispose(); ghostGeometry.dispose(); ghostMaterial.dispose(); ghostEdgeGeometry.dispose(); ghostEdgeMaterial.dispose(); borderGeometry.dispose(); borderMaterial.dispose();
      if (!options.sound) sound.dispose(); listeners.clear();
    },
  };
}
