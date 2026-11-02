import '@chatdom/ui/kit.css';
import * as THREE from 'three';
import { MATERIALS, createForgeLedgerWall as createWallBlueprint, FORGE_LEDGER_WALL_HEADER, FORGE_LEDGER_WALL_NICHES, FORGE_LEDGER_WALL_PIVOT, type StyleKey } from '@chatdom/content';
import { assembleForgeKeepsake, forgeKeepsakeBounds } from '@chatdom/forge';
import { geometryFromChunks, type Environment, type VoxelRenderState } from '@chatdom/render';
import { VOXEL_METRES, type ForgeLedgerEntry, type ForgeLedgerView, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { forgeKeepsakeKey } from './portrait';
import { forgeLedgerByline, watchForgeLedger, type ForgeLedgerRead, type ForgeLedgerState } from './read';

/*
 * The wall at the forge: the newest pieces this kingdom's forge has made, each standing in its own niche as a small
 * copy of itself, with an engraved plate under it naming the piece and who wished for it. The frame is Forge content
 * (`packages/content/src/forge-square/ledger-wall.ts`); this module stands the pieces and hangs the plates, and keeps
 * them current from the public ledger route. It never shows a wish's words.
 */

const CELL = VOXEL_METRES.build;
/** A copy stands no taller than this share of its niche, so every piece keeps a little air around it. */
const FILL = .9;

export interface ForgeLedgerWallOptions {
  readonly scene: THREE.Scene;
  readonly pool: VoxelWorkerPool;
  readonly material: VoxelRenderState;
  /** Where the wall's ground pivot stands, in world metres, and its yaw (radians; 0 means its front faces +Z). */
  readonly position: Vec3;
  readonly yaw: number;
  readonly style: StyleKey;
  readonly kingdomId: string;
  /** False when the land already draws the frame as an installed fixture; the wall then adds only pieces and plates. */
  readonly drawFrame?: boolean;
  readonly read?: ForgeLedgerRead;
  readonly pollMs?: number;
  /** Fixed "now" for the dates on the plates (benches). */
  readonly now?: () => number;
  registerShadow?(mesh: THREE.Mesh): () => void;
}

export interface ForgeLedgerWall {
  readonly root: THREE.Group;
  /** Settles once the frame and the first ledger read are drawn (or the read failed quietly). */
  readonly ready: Promise<void>;
  /** Changes whenever something on the wall changed, for hosts that render on demand. */
  readonly renderRevision: number;
  setEnvironment(grade: Environment): void;
  dispose(): void;
}

interface Niche { readonly mesh: THREE.Mesh | null; readonly plate: THREE.Mesh; readonly key: string; readonly unshadow?: () => void }

export function createForgeLedgerWall(options: ForgeLedgerWallOptions): ForgeLedgerWall {
  const root = new THREE.Group();
  root.name = 'forge-ledger-wall';
  // The blueprint's ground pivot sits on `position`; everything inside is in the wall's own cells.
  root.position.set(...options.position);
  root.rotation.y = options.yaw;
  const local = new THREE.Group();
  local.position.set(-FORGE_LEDGER_WALL_PIVOT[0] * CELL, 0, -FORGE_LEDGER_WALL_PIVOT[2] * CELL);
  root.add(local);
  options.scene.add(root);

  const geometries = new Set<THREE.BufferGeometry>(), plateMaterials = new Set<THREE.MeshBasicMaterial>(), textures = new Set<THREE.Texture>();
  const unshadows: (() => void)[] = [];
  const niches = new Map<number, Niche>();
  const meshes = new Map<string, Promise<THREE.BufferGeometry | null>>();
  let revision = 0, disposed = false, tint = new THREE.Color(1, 1, 1), generation = 0;

  const meshBlueprint = async (blueprint: VoxelBlueprint): Promise<THREE.BufferGeometry | null> => {
    const out = await options.pool.submit({ kind: 'blueprint', blueprint, materials: MATERIALS.materials, materialRevision: MATERIALS.revision, revision: ++revision });
    if (disposed || out?.kind !== 'asset' || !out.chunks.length) return null;
    const geometry = geometryFromChunks(out.chunks, 'build');
    geometries.add(geometry);
    return geometry;
  };
  const addVoxel = (geometry: THREE.BufferGeometry) => {
    const mesh = new THREE.Mesh(geometry, options.material.material);
    mesh.frustumCulled = true;
    const unshadow = options.registerShadow?.(mesh);
    if (unshadow) unshadows.push(unshadow);
    return mesh;
  };

  const frame = options.drawFrame === false ? Promise.resolve() : meshBlueprint(createWallBlueprint(options.style)).then(geometry => {
    if (!geometry || disposed) return;
    local.add(addVoxel(geometry)); revision++;
  });

  // The header board: the wall's name and how many pieces it remembers.
  const header = plate(FORGE_LEDGER_WALL_HEADER.size, FORGE_LEDGER_WALL_HEADER.centre);
  let headerKey = '';
  function paintHeader(total: number | null) {
    const key = String(total);
    if (key === headerKey) return;
    headerKey = key;
    setTexture(header, drawHeader(total, FORGE_LEDGER_WALL_HEADER.size));
  }
  // Plates are painted with the kit's faces; wait for them so the first paint is the right letterform.
  const faces = typeof document !== 'undefined' && document.fonts
    ? Promise.all([document.fonts.load(`40px ${FACE_STORY}`), document.fonts.load(`20px ${FACE_LABEL}`)]).then(() => {}, () => {})
    : Promise.resolve();
  void faces.then(() => { if (!disposed && !headerKey) paintHeader(null); });

  function plate(size: readonly [number, number], centre: readonly [number, number, number]) {
    const material = new THREE.MeshBasicMaterial({ color: tint, transparent: true, toneMapped: true });
    plateMaterials.add(material);
    const geometry = new THREE.PlaneGeometry(size[0] * CELL, size[1] * CELL);
    geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    // A hair in front of the board, so the plate never flickers against it.
    mesh.position.set(centre[0] * CELL, centre[1] * CELL, centre[2] * CELL + .006);
    mesh.visible = false;
    local.add(mesh);
    return mesh;
  }
  function setTexture(mesh: THREE.Mesh, canvas: HTMLCanvasElement | null) {
    const material = mesh.material as THREE.MeshBasicMaterial;
    if (material.map) { textures.delete(material.map); material.map.dispose(); material.map = null; }
    if (canvas) {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
      textures.add(texture);
      material.map = texture;
    }
    material.needsUpdate = true; mesh.visible = !!canvas; revision++;
  }

  async function stand(index: number, entry: ForgeLedgerEntry | undefined, at: number) {
    const anchor = FORGE_LEDGER_WALL_NICHES[index]!, key = entry ? `${entry.id}|${entry.maker.name}` : '';
    const known = niches.get(index);
    if (known?.key === key) return;
    if (known) { known.mesh?.removeFromParent(); known.unshadow?.(); }
    const platesMesh = known?.plate ?? plate(anchor.plaque.size, anchor.plaque.centre);
    if (!entry) { niches.set(index, { mesh: null, plate: platesMesh, key }); setTexture(platesMesh, null); return; }
    setTexture(platesMesh, drawPlaque(entry, anchor.plaque.size, at));
    niches.set(index, { mesh: null, plate: platesMesh, key });
    const blueprint = assembleForgeKeepsake(entry.plan, entry.family, entry.kitRevision);
    const shape = forgeKeepsakeKey(entry);
    let pending = meshes.get(shape);
    if (!pending) { pending = meshBlueprint(blueprint); meshes.set(shape, pending); }
    const geometry = await pending;
    if (!geometry || disposed || niches.get(index)?.key !== key) return;
    const { min, max } = forgeKeepsakeBounds(blueprint), size = [0, 1, 2].map(axis => max[axis]! - min[axis]!);
    const scale = Math.min(1, FILL * anchor.size[0] / size[0]!, FILL * anchor.size[1] / size[1]!, FILL * anchor.size[2] / size[2]!);
    const mesh = addVoxel(geometry);
    mesh.scale.setScalar(scale);
    // Centre the copy over the shelf, its footing on the shelf's top.
    mesh.position.set(
      (anchor.floor[0] - ((min[0] + max[0]) / 2) * scale) * CELL,
      (anchor.floor[1] - min[1] * scale) * CELL,
      (anchor.floor[2] - ((min[2] + max[2]) / 2) * scale) * CELL);
    local.add(mesh);
    niches.set(index, { mesh, plate: platesMesh, key });
    revision++;
  }

  const watch = watchForgeLedger(options.kingdomId, { ...(options.read ? { read: options.read } : {}), ...(options.pollMs ? { pollMs: options.pollMs } : {}) });
  let first: () => void = () => {};
  const firstRead = new Promise<void>(resolve => { first = resolve; });
  const unsubscribe = watch.subscribe((state: ForgeLedgerState) => { void faces.then(() => { if (!disposed) show(state); }); });
  function show(state: ForgeLedgerState) {
    if (state.kind === 'loading') return;
    const view: ForgeLedgerView | null = state.kind === 'ledger' ? state.view : null;
    if (state.kind !== 'unavailable') paintHeader(view?.total ?? 0);
    const mine = ++generation, at = options.now?.() ?? Date.now();
    const work = FORGE_LEDGER_WALL_NICHES.map((_, index) => state.kind === 'unavailable' ? Promise.resolve() : stand(index, view?.entries[index], at));
    void Promise.allSettled(work).then(() => { if (mine === generation) first(); });
  }

  return {
    root,
    ready: Promise.allSettled([frame, firstRead]).then(() => {}),
    get renderRevision() { return revision; },
    setEnvironment(grade) {
      // The plates are painted, not lit by the voxel shader: follow the hour's light, never darker than the forge's
      // own warm glow, so the names stay readable after dusk.
      const light = new THREE.Color(grade.ambient).multiplyScalar(grade.ambientIntensity * .55)
        .add(new THREE.Color(grade.sun).multiplyScalar(grade.sunIntensity * .5));
      const warm = new THREE.Color(.62, .5, .38);
      tint = new THREE.Color(Math.min(1.02, Math.max(warm.r, light.r)), Math.min(1.0, Math.max(warm.g, light.g)), Math.min(.98, Math.max(warm.b, light.b)));
      for (const material of plateMaterials) material.color.copy(tint);
      revision++;
    },
    dispose() {
      if (disposed) return;
      disposed = true; unsubscribe(); watch.dispose();
      for (const unshadow of unshadows.splice(0)) unshadow();
      for (const texture of textures) texture.dispose();
      for (const material of plateMaterials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
      root.removeFromParent();
    },
  };
}

const FACE_STORY = "'IM Fell English', Georgia, 'Times New Roman', serif";
const FACE_LABEL = "'IM Fell English SC', Georgia, 'Times New Roman', serif";
const PX_PER_CELL = 40;

function canvasFor(size: readonly [number, number]): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size[0] * PX_PER_CELL); canvas.height = Math.round(size[1] * PX_PER_CELL);
  const context = canvas.getContext('2d');
  return context ? [canvas, context] : null;
}

/** Fit one line of text into a width, shrinking (never below `min`) and then trimming with an ellipsis. */
function fitLine(context: CanvasRenderingContext2D, text: string, face: string, size: number, min: number, width: number): string {
  for (let px = size; px >= min; px -= 1) { context.font = `${px}px ${face}`; if (context.measureText(text).width <= width) return text; }
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** An engraved brass plate: the piece's title, and who wished for it. */
function drawPlaque(entry: ForgeLedgerEntry, size: readonly [number, number], now: number): HTMLCanvasElement | null {
  const made = canvasFor(size);
  if (!made) return null;
  const [canvas, context] = made, w = canvas.width, h = canvas.height, edge = Math.max(3, h * .06);
  const metal = context.createLinearGradient(0, 0, 0, h);
  metal.addColorStop(0, '#f1d797'); metal.addColorStop(.48, '#d2aa63'); metal.addColorStop(1, '#a87e3e');
  context.fillStyle = '#4a2f17'; context.fillRect(0, 0, w, h);
  context.fillStyle = metal; context.fillRect(edge, edge, w - edge * 2, h - edge * 2);
  context.strokeStyle = '#7a5426'; context.lineWidth = Math.max(1.5, edge * .35);
  context.strokeRect(edge * 1.9, edge * 1.9, w - edge * 3.8, h - edge * 3.8);
  for (const [x, y] of [[edge * 3.1, h / 2], [w - edge * 3.1, h / 2]]) {
    context.fillStyle = '#7a5426'; context.beginPath(); context.arc(x!, y!, edge * .55, 0, Math.PI * 2); context.fill();
  }
  const inner = w - edge * 9;
  context.textAlign = 'center'; context.textBaseline = 'alphabetic';
  context.fillStyle = '#3a230f';
  const title = fitLine(context, entry.title, FACE_STORY, Math.round(h * .38), Math.round(h * .24), inner);
  context.fillText(title, w / 2, h * .5);
  context.fillStyle = '#5b3b1c';
  // The name as the citizen card shows it: the plain face, never small capitals that would change its letters.
  const by = fitLine(context, forgeLedgerByline(entry, now), FACE_STORY, Math.round(h * .27), Math.round(h * .17), inner);
  context.fillText(by, w / 2, h * .83);
  return canvas;
}

/** The carved header: gilt letters on dark walnut. */
function drawHeader(total: number | null, size: readonly [number, number]): HTMLCanvasElement | null {
  const made = canvasFor(size);
  if (!made) return null;
  const [canvas, context] = made, w = canvas.width, h = canvas.height;
  const wood = context.createLinearGradient(0, 0, 0, h);
  wood.addColorStop(0, '#6a4428'); wood.addColorStop(1, '#3f2716');
  context.fillStyle = wood; context.fillRect(0, 0, w, h);
  context.strokeStyle = '#c99f5b'; context.lineWidth = Math.max(2, h * .035);
  context.strokeRect(h * .09, h * .09, w - h * .18, h - h * .18);
  context.textAlign = 'center'; context.textBaseline = 'alphabetic';
  const gilt = context.createLinearGradient(0, h * .2, 0, h * .7);
  gilt.addColorStop(0, '#fbe6a6'); gilt.addColorStop(1, '#d1a253');
  context.fillStyle = gilt;
  context.shadowColor = '#1c0f06'; context.shadowOffsetY = h * .025; context.shadowBlur = h * .02;
  context.fillText(fitLine(context, 'The forge remembers', FACE_STORY, Math.round(h * .46), Math.round(h * .3), w * .9), w / 2, total === null ? h * .66 : h * .58);
  if (total !== null) {
    context.fillStyle = '#e8cf95'; context.shadowOffsetY = h * .015;
    const line = total === 0 ? 'Waiting for the first wish' : total === 1 ? 'One piece forged here' : `${total} pieces forged here`;
    context.fillText(fitLine(context, line, FACE_LABEL, Math.round(h * .2), Math.round(h * .14), w * .8), w / 2, h * .84);
  }
  return canvas;
}
