// The picture-tree contact sheet: every variant of one species in one home kit, front, side and back at full detail,
// and a fourth column at the LOD 4 the stream view sees most trees at. Production worker meshing, geometry and voxel
// clay material under the authored dusk grade, each tree standing on a patch of turf. Dev-served only (capture.mjs).
import * as THREE from 'three';
import { MAT, MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import type { VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createPictureTree, TREE_SPECIES, TREE_VARIANTS, type StyleFamily, type TreeSpecies } from '../../../../../../packages/content/src/trees';

type BenchWindow = Window & { __chatdomReady?: boolean; __treeSheet?: unknown };
const query = new URLSearchParams(location.search);
const style = (query.get('style') ?? 'hearth') as StyleFamily;
const speciesList = (query.get('species') ?? TREE_SPECIES.join(',')).split(',') as TreeSpecies[];
const hour = Number(query.get('hour') ?? 19);
const cell = Number(query.get('cell') ?? 300);
const fail = (error: unknown) => { console.error('Tree contact sheet failed', error); document.body.dataset.error = String(error); };

const ANGLES = [
  { name: 'front', direction: new THREE.Vector3(1, 0.55, 1.5), lod: 1 },
  { name: 'side', direction: new THREE.Vector3(1.8, 0.5, -0.16), lod: 1 },
  { name: 'back', direction: new THREE.Vector3(-1, 0.55, -1.5), lod: 1 },
  { name: 'stream (LOD 4)', direction: new THREE.Vector3(1, 0.75, 1.5), lod: 4 },
] as const;

try {
  const rows = speciesList.flatMap(species => Array.from({ length: TREE_VARIANTS[species] }, (_, v) => createPictureTree(species, style, v)));
  const canvas = document.querySelector('canvas')!, labels = document.querySelector('[data-labels]')!;
  const width = cell * ANGLES.length, height = cell * rows.length;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = () => { throw new Error('Tree bench shader failed to compile.'); };
  renderer.setPixelRatio(1); renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.setScissorTest(true);
  const clay = createVoxelMaterial(MATERIALS, 'build');
  clay.setEnvironment(getEnvironment(hour));
  const pool = new VoxelWorkerPool({ size: 3, maxQueue: 256 });
  const mesh = async (blueprint: VoxelBlueprint, lod: 1 | 4) => {
    const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision, ...(lod === 1 ? {} : { lodFactor: lod }) });
    if (result?.kind !== 'asset') throw new Error(`Could not mesh ${blueprint.id}`);
    return { geometry: geometryFromChunks(result.chunks, 'build'), triangles: result.chunks.reduce((n, c) => n + c.mesh.indices.length / 3, 0) };
  };
  const stats: { id: string; size: readonly number[]; boxes: number; triangles: number; trianglesLod4: number }[] = [];
  const scenes = await Promise.all(rows.map(async tree => {
    const [full, far] = await Promise.all([mesh(tree.blueprint, 1), mesh(tree.blueprint, 4)]);
    stats.push({ id: tree.id, size: tree.blueprint.size, boxes: tree.blueprint.boxes.length, triangles: full.triangles, trianglesLod4: far.triangles });
    const [sx, sy, sz] = tree.blueprint.size.map(v => v * 0.125) as [number, number, number];
    const turf = Math.max(sx, sz) + 2;
    const ground: VoxelBlueprint = { version: 1, id: 'bench-turf', styleId: tree.blueprint.styleId, kind: 'flora', lattice: 'build', size: [turf * 8, 1, turf * 8], boxes: [{ from: [0, 0, 0], to: [turf * 8, 1, turf * 8], material: MAT.grass }], windows: [] };
    const turfMesh = await mesh(ground, 1);
    const build = (lod: 1 | 4) => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#2b2a33');
      const model = new THREE.Mesh(lod === 1 ? full.geometry : far.geometry, clay.material);
      model.scale.setScalar(lod); model.position.set(-sx / 2, 0, -sz / 2); scene.add(model);
      const patch = new THREE.Mesh(turfMesh.geometry, clay.material); patch.position.set(-turf / 2, -0.125, -turf / 2); scene.add(patch);
      return scene;
    };
    return { tree, full: build(1), far: build(4), bounds: new THREE.Box3(new THREE.Vector3(-sx / 2, 0, -sz / 2), new THREE.Vector3(sx / 2, sy, sz / 2)) };
  }));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  const draw = () => {
    labels.replaceChildren();
    scenes.forEach(({ tree, full, far, bounds }, row) => {
      ANGLES.forEach((angle, column) => {
        const centre = bounds.getCenter(new THREE.Vector3()), radius = bounds.getSize(new THREE.Vector3()).length();
        camera.position.copy(centre).add(angle.direction.clone().normalize().multiplyScalar(radius * 2)); camera.lookAt(centre); camera.updateMatrixWorld(true);
        const projected = new THREE.Box3();
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
        // One metre scale for the whole sheet, so species compare by size as they will stand in the town.
        const half = 8.5, mid = projected.getCenter(new THREE.Vector3());
        camera.left = mid.x - half; camera.right = mid.x + half; camera.bottom = projected.min.y - 0.6; camera.top = camera.bottom + 2 * half;
        camera.updateProjectionMatrix();
        const x = column * cell, y = height - (row + 1) * cell;
        renderer.setViewport(x, y, cell, cell); renderer.setScissor(x, y, cell, cell);
        renderer.render(angle.lod === 4 ? far : full, camera);
        const label = document.createElement('span');
        label.textContent = `${tree.id} · ${angle.name}`; label.style.left = `${x + 6}px`; label.style.top = `${row * cell + 6}px`;
        labels.append(label);
      });
    });
  };
  draw();
  await renderer.compileAsync(scenes[0]!.full, camera);
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  draw(); renderer.getContext().finish();
  (window as BenchWindow).__treeSheet = { style, hour, stats: stats.sort((a, b) => (a.id < b.id ? -1 : 1)) };
  (window as BenchWindow).__chatdomReady = true;
} catch (error) { fail(error); }
