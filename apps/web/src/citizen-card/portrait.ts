import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { REVIEW_LOOKS, assembleLook, compileAvatarPart } from '@chatdom/content/avatars';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { VOXEL_METRES } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createCitizenRenderer, type CitizenLook } from '../citizens';

/**
 * Head-and-shoulders portraits through the product citizen renderer: the same meshed wardrobe parts, rig and
 * voxel material the kingdom draws, posed at rest and turned a little towards the light.
 *
 * This is optional asset generation for the bench and for a host that paints portraits itself. The card never
 * imports it; it only ever receives finished image bytes through `CardHost.assetUrl`. Load it with a dynamic
 * `import()` so three.js stays out of the page and the share image.
 */
export interface PortraitRequest {
  /** Caller's name for the finished image. */
  readonly id: string;
  /** An authored look from the avatar library's review set. */
  readonly look: string;
}

export interface PortraitOptions {
  /** Output size in pixels; the card's window is 25:31. */
  readonly width?: number;
  readonly height?: number;
  /** The hour whose light models the face. */
  readonly hour?: number;
  readonly signal?: AbortSignal;
}

const aborted = () => new DOMException('The portrait sitting was cancelled.', 'AbortError');

/** Renders each request to a PNG. Throws if a look is unknown or the GPU context fails; never substitutes a look. */
export async function paintPortraits(requests: readonly PortraitRequest[], options: PortraitOptions = {}): Promise<Map<string, Blob>> {
  const width = options.width ?? 500, height = options.height ?? 620;
  const ids = [...new Set(requests.map(request => request.look))];
  const looks: CitizenLook[] = ids.map(id => {
    const review = REVIEW_LOOKS.find(look => look.id === id);
    if (!review) throw new Error(`There is no authored look called “${id}”.`);
    const { parts, cape } = assembleLook(review);
    return { id, parts: parts.map(blueprint => ({ blueprint, asset: compileAvatarPart(blueprint, 1) })), ...(cape ? { cape } : {}) };
  });
  const environment = getEnvironment(options.hour ?? 18);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  const pool = new VoxelWorkerPool({ size: 2 });
  const material = createVoxelMaterial(MATERIALS, 'avatar');
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100);
  let citizens: Awaited<ReturnType<typeof createCitizenRenderer>> | undefined;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    material.setEnvironment(environment);
    citizens = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity: 1, pool });
    if (options.signal?.aborted) throw aborted();

    // The camera stands a little off the sun's bearing so the face is modelled by real light, not lit flat.
    const [sx, , sz] = environment.sunDirection;
    const bearing = Math.atan2(sx, sz) - .55;
    const view = new THREE.Vector3(Math.sin(bearing), .16, Math.cos(bearing)).normalize();
    const portraits = new Map<string, Blob>();
    for (const request of requests) {
      citizens.update([{ id: request.id, look: request.look, position: [0, 0, 0], heading: bearing - .34, distance: 0, moving: 0, lookYaw: .12 }]);
      frame(scene, looks, request.look, camera, view, width / height);
      await renderer.compileAsync(scene, camera);
      if (options.signal?.aborted) throw aborted();
      renderer.render(scene, camera);
      renderer.getContext().finish();
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error(`The portrait of ${request.id} could not be encoded.`);
      portraits.set(request.id, blob);
    }
    return portraits;
  } finally {
    citizens?.dispose();
    pool.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/**
 * Frames the head and shoulders: the top of the figure down to mid-chest, a little headroom above the hair.
 * Meshed voxel geometry is bounded by whole 32-cell chunks, so the sitter is measured from each part's authored
 * size under its posed instance matrix. The renderer's first group holds every look's parts in order.
 */
function frame(scene: THREE.Scene, looks: readonly CitizenLook[], look: string, camera: THREE.OrthographicCamera, view: THREE.Vector3, aspect: number): void {
  scene.updateMatrixWorld(true);
  const meshes = (scene.children[0]?.children ?? []).filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
  const parts = looks.flatMap(item => item.parts.map(part => ({ look: item.id, size: part.blueprint.size })));
  if (meshes.length !== parts.length) throw new Error('The citizen renderer’s parts no longer match the look; the portrait cannot be framed.');
  const bounds = new THREE.Box3(), instance = new THREE.Matrix4();
  for (const [index, part] of parts.entries()) {
    const mesh = meshes[index]!;
    if (part.look !== look || mesh.count === 0) continue;
    mesh.getMatrixAt(0, instance);
    const local = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(...part.size).multiplyScalar(VOXEL_METRES.avatar));
    bounds.union(local.applyMatrix4(instance.premultiply(mesh.matrixWorld)));
  }
  if (bounds.isEmpty()) throw new Error('The citizen renderer drew nothing to paint.');
  const tall = bounds.max.y - bounds.min.y;
  const sitter = bounds.clone();
  sitter.min.y = bounds.max.y - tall * .5;
  const centre = sitter.getCenter(new THREE.Vector3());
  const reach = sitter.getSize(new THREE.Vector3()).length() + 2;
  camera.position.copy(centre).addScaledVector(view, reach * 3);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);
  const projected = new THREE.Box3();
  for (const x of [sitter.min.x, sitter.max.x]) for (const y of [sitter.min.y, sitter.max.y]) for (const z of [sitter.min.z, sitter.max.z]) {
    projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
  }
  // Fill the arch with the sitter: the crown of the head near the top, the shoulders running out of the frame.
  const half = Math.max((projected.max.y - projected.min.y) / 2 / .82, (projected.max.x - projected.min.x) / 2 / aspect / 1.15);
  const midX = (projected.max.x + projected.min.x) / 2;
  const top = projected.max.y + half * .3;
  camera.left = midX - half * aspect; camera.right = midX + half * aspect;
  camera.top = top; camera.bottom = top - half * 2;
  camera.near = .01; camera.far = reach * 8;
  camera.updateProjectionMatrix();
}
