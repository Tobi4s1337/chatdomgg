import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment, type Environment, type VoxelRenderState } from '@chatdom/render';
import { VOXEL_METRES, type VoxelAsset, type VoxelLattice } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import './providers';
import { itemModels } from './catalogue';
import { itemDefinition } from './definitions';

/** Late afternoon: warm key light, blue-violet shadow, the kingdom's own grade. */
export const PORTRAIT_HOUR = 16.8;
const MAX_PIXELS = 1024;
const MAX_BITMAPS = 96;
const MAX_MODELS = 24;
const ELEVATION = .32;

const WORDS = {
  noWebgl: 'Item pictures need WebGL, and this browser has it turned off.',
  noModel: 'This thing has no model to draw yet.',
  noMesh: 'This thing could not be shaped for its picture.',
  away: 'Item pictures were put away.',
} as const;

interface Pose { readonly yaw: number; readonly tilt: number; readonly margin: number }
/** Fish face left to right, nose a little towards you and up; the rod lies on the diagonal, tip to the upper right. */
function poseFor(defId: string, branch: string | undefined): Pose {
  if (defId.startsWith('fish:') || branch === 'gathered') return { yaw: Math.PI / 2 - .52, tilt: .13, margin: .1 };
  if (defId.startsWith('tool:rod') || branch === 'held') return { yaw: -.38, tilt: -Math.PI / 4, margin: .05 };
  return { yaw: .62, tilt: 0, margin: .1 };
}

interface Model { readonly geometry: THREE.BufferGeometry; readonly lattice: VoxelLattice; readonly min: THREE.Vector3; readonly max: THREE.Vector3 }
interface Studio {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly pivot: THREE.Group;
  readonly mesh: THREE.Mesh;
  readonly camera: THREE.OrthographicCamera;
  readonly shadows: ReturnType<typeof createSunShadows>;
  readonly pool: VoxelWorkerPool;
  readonly materials: Map<VoxelLattice, VoxelRenderState>;
  readonly models: Map<string, Model>;
  readonly grade: Environment;
  size: number;
  lost: boolean;
  readonly onLost: (event: Event) => void;
}

let studio: Studio | null = null;
let webglRefused = false;
let generation = 0;
let tail: Promise<unknown> = Promise.resolve();
const bitmaps = new Map<string, Promise<ImageBitmap>>();
const corner = new THREE.Vector3();

function openStudio(): Studio {
  if (studio && !studio.lost) return studio;
  if (studio) closeStudio();
  if (webglRefused || typeof document === 'undefined') throw new Error(WORDS.noWebgl);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  } catch {
    webglRefused = true;
    throw new Error(WORDS.noWebgl);
  }
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 40);
  camera.position.set(0, Math.sin(ELEVATION) * 10, Math.cos(ELEVATION) * 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  // Lit like the world at this hour, with the key turned to the picture: from the upper left, a little in front.
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const back = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
  const key = right.multiplyScalar(-.52).add(up.multiplyScalar(.74)).add(back.multiplyScalar(.42)).normalize();
  const grade: Environment = { ...getEnvironment(PORTRAIT_HOUR), sunDirection: [key.x, key.y, key.z] };
  const shadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(-1.8, -1.8, -1.8), new THREE.Vector3(1.8, 1.8, 1.8)), resolution: 1024 });
  const scene = new THREE.Scene();
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh();
  mesh.frustumCulled = false;
  pivot.add(mesh); scene.add(pivot);
  const pool = new VoxelWorkerPool({ size: 1, maxQueue: 32 });
  const onLost = (event: Event) => { event.preventDefault(); if (studio) studio.lost = true; };
  canvas.addEventListener('webglcontextlost', onLost);
  studio = { canvas, renderer, scene, pivot, mesh, camera, shadows, pool, materials: new Map(), models: new Map(), grade, size: 1, lost: false, onLost };
  return studio;
}

function closeStudio(): void {
  const current = studio;
  if (!current) return;
  studio = null;
  current.canvas.removeEventListener('webglcontextlost', current.onLost);
  current.pool.dispose();
  for (const model of current.models.values()) model.geometry.dispose();
  current.models.clear();
  current.shadows.dispose();
  for (const material of current.materials.values()) material.dispose();
  current.materials.clear();
  current.renderer.dispose();
  current.renderer.forceContextLoss();
}

function materialFor(current: Studio, lattice: VoxelLattice): VoxelRenderState {
  let material = current.materials.get(lattice);
  if (!material) {
    material = createVoxelMaterial(MATERIALS, lattice);
    current.shadows.bindReceiver(material.material);
    material.setEnvironment(current.grade);
    current.materials.set(lattice, material);
  }
  return material;
}

function occupied(asset: VoxelAsset): { min: THREE.Vector3; max: THREE.Vector3 } | null {
  const [sx, sy, sz] = asset.size;
  let x0 = sx, y0 = sy, z0 = sz, x1 = -1, y1 = -1, z1 = -1;
  for (let z = 0, i = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++, i++) {
    if (!asset.voxels[i]) continue;
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  if (x1 < 0) return null;
  const s = VOXEL_METRES[asset.lattice];
  return { min: new THREE.Vector3(x0 * s, y0 * s, z0 * s), max: new THREE.Vector3((x1 + 1) * s, (y1 + 1) * s, (z1 + 1) * s) };
}

async function modelFor(current: Studio, modelId: string): Promise<Model> {
  const cached = current.models.get(modelId);
  if (cached) { current.models.delete(modelId); current.models.set(modelId, cached); return cached; }
  const asset = itemModels.create(modelId);
  if (!asset) throw new Error(WORDS.noModel);
  const bounds = occupied(asset);
  if (!bounds) throw new Error(WORDS.noModel);
  const result = await current.pool.submit({ kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
  if (!result || result.kind !== 'asset' || !result.chunks.length) throw new Error(WORDS.noMesh);
  const model = { geometry: geometryFromChunks(result.chunks, asset.lattice), lattice: asset.lattice, ...bounds };
  if (studio !== current) { model.geometry.dispose(); throw new Error(WORDS.away); }
  current.models.set(modelId, model);
  while (current.models.size > MAX_MODELS) {
    const [oldest, stale] = current.models.entries().next().value!;
    current.models.delete(oldest); stale.geometry.dispose();
  }
  return model;
}

async function draw(defId: string, pixels: number, ticket: number): Promise<ImageBitmap> {
  if (ticket !== generation) throw new Error(WORDS.away);
  const current = openStudio();
  const definition = itemDefinition(defId);
  const model = await modelFor(current, definition?.model ?? defId);
  if (ticket !== generation || studio !== current) throw new Error(WORDS.away);
  const { renderer, camera, pivot, mesh, shadows, canvas } = current;
  const pose = poseFor(defId, definition?.branch);
  const material = materialFor(current, model.lattice);
  mesh.geometry = model.geometry;
  mesh.material = material.material;
  mesh.position.set(-(model.min.x + model.max.x) / 2, -(model.min.y + model.max.y) / 2, -(model.min.z + model.max.z) / 2);
  pivot.rotation.set(0, pose.yaw, pose.tilt, 'ZYX');
  pivot.updateMatrixWorld(true);
  // Frame the eight corners of the occupied cells as the camera sees them.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? model.max.x : model.min.x, i & 2 ? model.max.y : model.min.y, i & 4 ? model.max.z : model.min.z)
      .applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
    minZ = Math.min(minZ, corner.z); maxZ = Math.max(maxZ, corner.z);
  }
  const half = Math.max(maxX - minX, maxY - minY) / 2 * (1 + pose.margin * 2);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  camera.left = cx - half; camera.right = cx + half; camera.top = cy + half; camera.bottom = cy - half;
  camera.near = Math.max(.01, -maxZ - .5); camera.far = -minZ + .5;
  camera.updateProjectionMatrix();

  if (current.size < pixels) {
    current.size = Math.min(MAX_PIXELS, Math.max(pixels, Math.ceil(current.size * 1.5)));
    renderer.setSize(current.size, current.size, false);
  }
  renderer.toneMappingExposure = current.grade.exposure;
  renderer.setRenderTarget(null);
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, pixels, pixels);
  renderer.setScissor(0, 0, pixels, pixels);
  renderer.clear(true, true, false);
  const detach = shadows.register(mesh);
  try {
    shadows.updateSunDirection(current.grade.sunDirection);
    renderer.render(current.scene, camera);
  } finally { detach(); renderer.setScissorTest(false); }
  if (current.lost) throw new Error(WORDS.noWebgl);
  // WebGL rows start at the bottom; the picture is the bottom-left square of the drawing buffer.
  return createImageBitmap(canvas, 0, current.size - pixels, pixels, pixels);
}

/** CSS pixels to device pixels for one square picture. */
export function portraitPixels(size: number): number {
  const ratio = typeof window === 'undefined' ? 1 : Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  return Math.min(MAX_PIXELS, Math.max(16, Math.round((Number.isFinite(size) ? size : 64) * ratio)));
}

/**
 * A small render of the real voxel item, lit like the world in late afternoon, three-quarter view, on a clear
 * background, framed to the model. `size` is in CSS pixels; the picture is drawn at the device's pixel ratio.
 * One shared renderer and worker draw every picture in turn; results are cached by item and pixel size and owned by the
 * cache, so draw them and do not close them. Rejects with plain words when WebGL or the model is unavailable.
 */
export function itemPortrait(defId: string, size: number): Promise<ImageBitmap> {
  const pixels = portraitPixels(size);
  const key = `${defId}@${pixels}`;
  const cached = bitmaps.get(key);
  if (cached) { bitmaps.delete(key); bitmaps.set(key, cached); return cached; }
  const ticket = generation;
  const job = tail.then(() => draw(defId, pixels, ticket));
  tail = job.catch(() => undefined);
  bitmaps.set(key, job);
  // A missing model stays missing for this session; a lost context or teardown may be tried again.
  job.catch((error: unknown) => {
    if (bitmaps.get(key) === job && !(error instanceof Error && (error.message === WORDS.noModel || error.message === WORDS.noWebgl))) bitmaps.delete(key);
  });
  while (bitmaps.size > MAX_BITMAPS) {
    const [oldest, stale] = bitmaps.entries().next().value!;
    bitmaps.delete(oldest);
    void stale.then(bitmap => bitmap.close(), () => undefined);
  }
  return job;
}

/**
 * Draws an item's picture into a canvas at `size` CSS pixels. Resolves true once drawn; false leaves an honest empty
 * frame (`data-portrait="empty"`), never a broken image.
 */
export async function paintItemPortrait(canvas: HTMLCanvasElement, defId: string, size: number): Promise<boolean> {
  const pixels = portraitPixels(size);
  canvas.style.width = canvas.style.height = `${size}px`;
  if (canvas.width !== pixels) canvas.width = pixels;
  if (canvas.height !== pixels) canvas.height = pixels;
  canvas.dataset.portrait = 'pending';
  const token = `${defId}@${pixels}`;
  canvas.dataset.portraitFor = token;
  try {
    const bitmap = await itemPortrait(defId, size);
    if (canvas.dataset.portraitFor !== token) return false;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(WORDS.noWebgl);
    context.clearRect(0, 0, pixels, pixels);
    context.drawImage(bitmap, 0, 0, pixels, pixels);
    canvas.dataset.portrait = 'drawn';
    return true;
  } catch {
    if (canvas.dataset.portraitFor === token) canvas.dataset.portrait = 'empty';
    return false;
  }
}

/** Releases the shared renderer, its worker and every cached picture. The next request starts afresh. */
export function disposeItemPortraits(): void {
  generation++;
  closeStudio();
  webglRefused = false;
  for (const job of bitmaps.values()) void job.then(bitmap => bitmap.close(), () => undefined);
  bitmaps.clear();
}
