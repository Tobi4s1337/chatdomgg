/** Isolated art bench. This is not the grand renderer, a physical world, or a live kingdom. */
import * as THREE from 'three';
import { cornerOcclusion, flipDiagonal, packOcclusion } from './occlusion';
import { createHome } from '../../../../../packages/content/src/core';
import { MATERIALS, type StyleKey } from '../../../../../packages/content/src/materials';
import type { ArtisanKit, KitBox } from '../../../../../packages/world/src/grand/artisans/kit';

type KitModule = Record<string, (...args: never[]) => ArtisanKit>;
const modules = import.meta.glob<KitModule>('../../../../../packages/world/src/grand/artisans/**/index.ts');

interface Bounds { min: [number, number, number]; max: [number, number, number] }
function boundsOf(boxes: readonly KitBox[]): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) for (let d = 0; d < 3; d++) {
    min[d] = Math.min(min[d]!, box.min[d]!); max[d] = Math.max(max[d]!, box.min[d]! + box.size[d]!);
  }
  return { min, max };
}

/** Opaque union, one material per cell; rectangles share coplanar faces. Deliberately a
 * bench mesher, not the production chunk/halo/LOD pipeline. */
function meshKit(boxes: readonly KitBox[], bounds: Bounds, initialLevel: number, cellMetres = .5) {
  let level = initialLevel;
  let factor = 2 ** level;
  let dims = bounds.min.map((v, d) => Math.ceil((bounds.max[d]! - v) / factor));
  while (dims[0]! * dims[1]! * dims[2]! > 64_000_000 && level < 6) {
    factor = 2 ** ++level; dims = bounds.min.map((v, d) => Math.ceil((bounds.max[d]! - v) / factor));
  }
  const [nx, ny, nz] = dims as [number, number, number];
  if (nx * ny * nz > 64_000_000) throw new Error('Kit exceeds review bench capacity');
  const cells = new Uint16Array(nx * ny * nz);
  const colours = new Map<string, number>(); const rgb: THREE.Color[] = [new THREE.Color(0)];
  for (const b of boxes) {
    let id = b.colour === 'air' ? 0 : colours.get(b.colour);
    if (id === undefined) { id = rgb.length; colours.set(b.colour, id); rgb.push(new THREE.Color(b.colour)); }
    const lo = b.min.map((v, d) => Math.max(0, Math.floor((v - bounds.min[d]!) / factor)));
    const hi = b.min.map((v, d) => Math.min(dims[d]!, Math.ceil((v + b.size[d]! - bounds.min[d]!) / factor)));
    for (let y = lo[1]!; y < hi[1]!; y++) for (let z = lo[2]!; z < hi[2]!; z++) {
      cells.fill(id, (y * nz + z) * nx + lo[0]!, (y * nz + z) * nx + hi[0]!);
    }
  }
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  const dims3 = [nx, ny, nz]; let quads = 0;
  const get = (a: readonly number[]) => a[0]! < 0 || a[1]! < 0 || a[2]! < 0 || a[0]! >= nx || a[1]! >= ny || a[2]! >= nz ? 0 : cells[(a[1]! * nz + a[2]!) * nx + a[0]!]!;
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3, w = dims3[u]!, h = dims3[v]!;
    const mask = new Int32Array(w * h);
    for (let slice = -1; slice < dims3[axis]!; slice++) {
      const p = [0, 0, 0]; p[axis] = slice;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        p[u] = i; p[v] = j; const a = get(p); p[axis] = slice + 1; const b = get(p); p[axis] = slice;
        if (!!a === !!b) { mask[j * w + i] = 0; continue; }
        // Sample the empty plane immediately beyond the face, including the diagonal cells.
        // Keep the same four values in the merge key so a greedy rectangle never smooths
        // across an occlusion change. Every source cell, including an air carve, is resolved first.
        const sign = a ? 1 : -1, material = a || b;
        p[axis] = a ? slice + 1 : slice;
        p[u] = i - 1; const left = !!get(p);
        p[u] = i + 1; const right = !!get(p);
        p[u] = i; p[v] = j - 1; const bottom = !!get(p);
        p[v] = j + 1; const top = !!get(p);
        p[u] = i - 1; p[v] = j - 1; const bottomLeft = !!get(p);
        p[u] = i + 1; const bottomRight = !!get(p);
        p[v] = j + 1; const topRight = !!get(p);
        p[u] = i - 1; const topLeft = !!get(p);
        const ao = packOcclusion(cornerOcclusion(left, bottom, bottomLeft), cornerOcclusion(right, bottom, bottomRight),
          cornerOcclusion(right, top, topRight), cornerOcclusion(left, top, topLeft));
        mask[j * w + i] = sign * ((material << 8) | ao);
        p[axis] = slice; p[u] = i; p[v] = j;
      }
      for (let j = 0; j < h; j++) for (let i = 0; i < w;) {
        const value = mask[j * w + i]!;
        if (!value) { i++; continue; }
        let width = 1; while (i + width < w && mask[j * w + i + width] === value) width++;
        let height = 1;
        outer: while (j + height < h) { for (let k = 0; k < width; k++) if (mask[(j + height) * w + i + k] !== value) break outer; height++; }
        for (let y = 0; y < height; y++) mask.fill(0, (j + y) * w + i, (j + y) * w + i + width);
        const base = [0, 0, 0]; base[axis] = slice + 1; base[u] = i; base[v] = j;
        const du = [0, 0, 0], dv = [0, 0, 0]; du[u] = width; dv[v] = height;
        const points = [base, base.map((n, d) => n + du[d]!), base.map((n, d) => n + du[d]! + dv[d]!), base.map((n, d) => n + dv[d]!)];
        const normal = [0, 0, 0]; normal[axis] = Math.sign(value);
        const packed = Math.abs(value), colour = rgb[packed >> 8]!, ao = packed & 255;
        for (let corner = 0; corner < points.length; corner++) {
          const point = points[corner]!, light = .58 + ((ao >> (corner * 2)) & 3) * .14;
          positions.push(...point.map((n, d) => (n * factor + bounds.min[d]!) * cellMetres));
          normals.push(...normal); colors.push(colour.r * light, colour.g * light, colour.b * light);
        }
        const first = quads++ * 4, flipped = flipDiagonal(ao);
        const triangle = flipped ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3];
        if (value < 0) { [triangle[1], triangle[2]] = [triangle[2]!, triangle[1]!]; [triangle[4], triangle[5]] = [triangle[5]!, triangle[4]!]; }
        indices.push(...triangle.map(index => index + first));
        i += width;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeBoundingSphere();
  return { geometry, quads, level, factor, cells: nx * ny * nz };
}

/** Mount an isolated, explicitly simulated study inside an existing grand surface. */
export async function mountArtisanReview(root: HTMLElement, params = new URLSearchParams(location.search)): Promise<() => void> {
  Object.assign(window, { __chatdomReady: false });
const kitName = params.get('kit') ?? 'forest';
const view = params.get('view') ?? 'hero';
const channel = params.get('channel') ?? 'tobi4s_';
const seed = params.get('seed') ?? channel;
const species = params.get('species') ?? 'gold';
const requestedLod = Math.max(0, Math.min(3, Number(params.get('lod') ?? 0) || 0));
const dusk = view === 'dusk' || Number(params.get('hour') ?? 17) >= 19;

const names: Record<string, readonly [string, string, string[]]> = {
  forest: ['forest', 'createForest', [seed, species]], tree: ['forest', 'createTree', [species, seed]],
  geology: ['geology', 'createGeologyReview', [seed]], water: ['geology', 'createWatercourse', [seed]],
  fields: ['fields', 'createFields', [seed]], windmill: ['fields', 'createWindmill', [seed]],
  harbour: ['harbour', 'createHarbour', [seed]], ship: ['harbour', 'createShip', [seed]],
  lighthouse: ['harbour', 'createLighthouse', [seed]], citadel: ['citadel', 'createCitadel', [seed]],
  walls: ['citadel', 'createTownWalls', [seed]], composition: ['composition', 'createComposition', [channel]],
};

async function loadKit(): Promise<ArtisanKit> {
  const config = names[kitName];
  if (!config) throw new Error(`Unknown kit: ${kitName}`);
  const [folder, method, args] = config;
  const entry = Object.entries(modules).find(([path]) => path.endsWith(`/artisans/${folder}/index.ts`));
  if (!entry) throw new Error(`Kit ${folder} is not available in this checkout`);
  const mod = await entry[1]();
  const factory = mod[method];
  if (typeof factory !== 'function') throw new Error(`Kit ${folder} has no ${method}`);
  const result = (factory as (...args: string[]) => ArtisanKit)(...args);
  if (!result || !Array.isArray(result.boxes) || !result.boxes.length) throw new Error(`${kitName} has no review geometry`);
  return result;
}

  let cleanup = () => {};
  try {
  const kit = await loadKit(); const bounds = boundsOf(kit.boxes);
  const generated = meshKit(kit.boxes, bounds, requestedLod);
  const canvas = root.querySelector<HTMLCanvasElement>('.artisan-scene');
  if (!canvas) throw new Error('Review canvas is missing');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  const width = () => root.clientWidth || innerWidth;
  const height = () => root.clientHeight || innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(width(), height());
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = dusk ? 1.25 : 1.22;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const lifecycle: { resize?: () => void; review?: object } = {};
  cleanup = () => {
    if (lifecycle.resize) window.removeEventListener('resize', lifecycle.resize);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const child of scene.children) if (child instanceof THREE.DirectionalLight) child.shadow.dispose();
    renderer.dispose();
    const shared = window as unknown as { __artisanReview?: object; __chatdomReady?: boolean };
    if (shared.__artisanReview === lifecycle.review) { delete shared.__artisanReview; delete shared.__chatdomReady; }
  };
  const camera = new THREE.PerspectiveCamera(38, width() / height(), .1, 10000);
  const solid = new THREE.Mesh(generated.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92 }));
  solid.castShadow = true; solid.receiveShadow = true; scene.add(solid);
  // The composition bench adds the accepted native-resolution unoccupied home geometry at its
  // review origins. These are sample assets, not installed homes, citizens or lit windows.
  let homeCount = 0;
  if (kitName === 'composition') {
    const key = channel.toLowerCase();
    const style: StyleKey = key === 'the_aggman' || key === 'mashad4' ? 'tide' : key === 'pinkkittyrose' ? 'grove' : 'hearth';
    const palette = new Map(MATERIALS.materials.map(material => [material.id, material.colour]));
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92 });
    const variants = [0, 1, 2].map(variant => {
      const blueprint = createHome('cottage', style, variant);
      const boxes: KitBox[] = blueprint.boxes.map(box => ({
        min: box.from, size: [box.to[0] - box.from[0], box.to[1] - box.from[1], box.to[2] - box.from[2]],
        colour: box.material === 0 ? 'air' : palette.get(box.material)!,
      }));
      return meshKit(boxes, boundsOf(boxes), 0, .125).geometry;
    });
    for (const [id, anchor] of Object.entries(kit.anchors)) {
      if (!/^home-\d+$/.test(id)) continue;
      const number = Number(id.slice(5));
      const home = new THREE.Mesh(variants[number % variants.length]!, material);
      home.position.set(anchor[0] * .5, anchor[1] * .5, anchor[2] * .5);
      home.castShadow = true; home.receiveShadow = true; scene.add(home); homeCount++;
    }
  }
  const size = bounds.max.map((n, d) => (n - bounds.min[d]!) * .5);
  const centre = new THREE.Vector3(...bounds.max.map((n, d) => (n + bounds.min[d]!) * .25) as [number, number, number]);
  const radius = Math.max(size[0]!, size[2]!, size[1]! * 1.1, 12);
  const hemi = new THREE.HemisphereLight(dusk ? 0xc4c4e6 : 0xd9e6f4, dusk ? 0x473e59 : 0x766d68, dusk ? 1.8 : 2.05); scene.add(hemi);
  const sun = new THREE.DirectionalLight(dusk ? 0xffc994 : 0xffe0af, dusk ? 2 : 2.7);
  sun.position.copy(centre).add(new THREE.Vector3(-radius, radius * 1.4, radius)); sun.target.position.copy(centre); scene.add(sun, sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -radius; sun.shadow.camera.right = radius; sun.shadow.camera.top = radius; sun.shadow.camera.bottom = -radius; sun.shadow.camera.near = .1; sun.shadow.camera.far = radius * 5; sun.shadow.bias = -.0001;
  const water = ['composition', 'water', 'harbour', 'ship', 'lighthouse'].includes(kitName);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(radius * 14, radius * 14), new THREE.MeshStandardMaterial({ color: water ? '#6c9da5' : '#879564', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  // The composition's sea surface is at y = 0; a matching plane hides the review box edge.
  // Separate isolated harbour and ship studies place their waterline at world y = 0.
  const groundY = kitName === 'composition' ? .01 : ['harbour', 'ship', 'lighthouse'].includes(kitName) ? -.01 : ['tree', 'forest', 'windmill', 'citadel', 'walls', 'fields'].includes(kitName) ? -.01 : bounds.min[1] * .5 - .06;
  ground.position.set(centre.x, groundY, centre.z); ground.receiveShadow = true; scene.add(ground);
  if (dusk) root.querySelector<HTMLElement>('.artisan-sky')!.style.background = 'linear-gradient(180deg,#353855 0%,#66617a 49%,#c98f83 100%)';
  const facesSouth = ['composition', 'harbour', 'lighthouse', 'citadel', 'walls'].includes(kitName);
  let angle = (facesSouth ? Math.PI : 0) + (view === 'coast' ? -.5 : view === 'street' ? .12 : .56);
  const elevation = view === 'street' ? .16 : view === 'coast' ? .25 : .42;
  const target = centre.clone(); target.y = bounds.min[1] * .5 + size[1]! * .43;
  const namedAnchor = kit.anchors[view] ?? (view === 'street' ? (kit.anchors.gate ?? kit.anchors.lane ?? kit.anchors.entrance) : view === 'coast' ? (kit.anchors.coast ?? kit.anchors.landing) : undefined);
  if (namedAnchor) target.set(namedAnchor[0] * .5, namedAnchor[1] * .5, namedAnchor[2] * .5);
  let distanceScale = view === 'street' && namedAnchor ? .46 : view === 'coast' && namedAnchor ? .75 : 1;
  function render() {
    // Fit all eight box corners to the actual vertical AND horizontal field of view, accounting
    // for the anchor's offset and each corner's depth. Street retains its intentional close-up.
    const direction = new THREE.Vector3(Math.sin(angle) * Math.cos(elevation), Math.sin(elevation), Math.cos(angle) * Math.cos(elevation));
    const right = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const up = new THREE.Vector3(-Math.sin(angle) * Math.sin(elevation), Math.cos(elevation), -Math.cos(angle) * Math.sin(elevation));
    const tangent = Math.tan(camera.fov * Math.PI / 360);
    let fit = 1;
    for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
      const corner = new THREE.Vector3(x * .5, y * .5, z * .5).sub(target);
      const projected = Math.max(Math.abs(corner.dot(up)) / tangent, Math.abs(corner.dot(right)) / (tangent * camera.aspect));
      fit = Math.max(fit, projected + corner.dot(direction));
    }
    const streetCap = view === 'street' && namedAnchor && kitName === 'composition' ? 65 : Infinity;
    const d = Math.min(fit * 1.15 * distanceScale, streetCap);
    camera.position.copy(target).addScaledVector(direction, d);
    camera.lookAt(target); camera.updateProjectionMatrix(); renderer.render(scene, camera);
  }
  lifecycle.resize = () => { camera.aspect = width() / height(); renderer.setSize(width(), height()); render(); };
  window.addEventListener('resize', lifecycle.resize);
  const subject = root.querySelector<HTMLElement>('.artisan-subject')!;
  subject.textContent = `${kitName[0]!.toUpperCase()+kitName.slice(1)} · ${view} · ${channel} · art study`;
  const diagnostics = { kit: kit.id, simulatedHomeCount: homeCount, boxes: kit.boxes.length, quads: generated.quads, cells: generated.cells, requestedLod, actualLod: generated.level, triangles: generated.quads * 2 };
  lifecycle.review = { stats: diagnostics, setOrbit: (radians: number, scale = 1) => { angle = radians; distanceScale = Math.max(.1, scale); render(); } };
  Object.assign(window, { __artisanReview: lifecycle.review });
  render(); renderer.getContext().finish();
  Object.assign(window, { __chatdomReady: true });
  return cleanup;
  } catch (error) {
    cleanup();
    const message = root.querySelector<HTMLElement>('.artisan-error');
    if (message) message.textContent = error instanceof Error ? error.message : String(error);
    return () => {};
  }
}
