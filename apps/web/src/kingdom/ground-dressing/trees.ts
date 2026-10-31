// Tree-form sheets for ground dressing (spec 28, GD02), through the production mesher, render LOD and clay material.
// `?mode=sheet` lays every tree, hedge and woodland form in one row at true scale, full detail above and the LOD-4
// copy below, from one representative angle. `mode=silhouette` draws the same rows black on white. `mode=elder`
// frames the elder oak and its root seat at standing height. `grey=1` greys the canvas for a value check.
// Served by the Vite dev server only (capture.mjs --trees); the shipped app never loads it. No fixture: every model
// is the collection's own blueprint.
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import type { VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createDressing, DRESSING_SIZES, ELDER_OAK_SEAT, type DressingForm } from '../../../../../packages/content/src/props/dressing/registry';

type SheetWindow = Window & { __chatdomReady?: boolean; __chatdomTrees?: unknown };
const TREES: readonly DressingForm[] = ['oak-old-a', 'oak-old-b', 'beech', 'elder-oak', 'pine-windbent', 'fir', 'birch', 'alder',
  'sapling-staked', 'bramble-hedge', 'pear-espalier', 'woodland-clump'];
const CELL = 0.125, GAP = 2.5;
const query = new URLSearchParams(location.search);
const mode = query.get('mode') ?? 'sheet';
if (!['sheet', 'silhouette', 'elder'].includes(mode)) throw new Error(`Unknown tree sheet mode ${mode}`);
const hour = Number(query.get('hour') ?? (mode === 'elder' ? 18 : 15));
document.body.classList.toggle('grey', query.get('grey') === '1');
document.body.classList.toggle('silhouette', mode === 'silhouette');
const canvas = document.querySelector('canvas')!;
const fail = (error: unknown) => { console.error('Tree sheet failed', error); document.body.dataset.error = String(error); };

/** A flat turf slab, one cell deep, for the trees to stand on; at most 256 cells a side, as blueprints allow. */
const turf = (width: number, depth: number): VoxelBlueprint => ({ version: 1, id: 'sheet-turf', styleId: 'grove' as VoxelBlueprint['styleId'],
  kind: 'prop', lattice: 'build', size: [width, 1, depth], boxes: [{ from: [0, 0, 0], to: [width, 1, depth], material: MATERIALS.materials.find(m => m.name === 'grass')!.id }], windows: [] });

try {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Tree sheet shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
    throw new Error('A tree sheet shader could not compile');
  };
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.autoClear = false;
  const grade = getEnvironment(hour);
  const clay = createVoxelMaterial(MATERIALS, 'build'); clay.setEnvironment(grade);
  const silhouette = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: clay.material.uniforms, vertexShader: clay.material.vertexShader,
    fragmentShader: 'out vec4 colour;void main(){colour=vec4(0.,0.,0.,1.);}' });
  const material = mode === 'silhouette' ? silhouette : clay.material;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(mode === 'silhouette' ? '#ffffff' : grade.horizon);
  const pool = new VoxelWorkerPool({ size: 3, maxQueue: 64 });

  // Lay the forms out left to right at true scale, each centred on the row line, a few metres apart.
  const forms = mode === 'elder' ? ['elder-oak' as const] : query.get('forms') ? query.get('forms')!.split(',') as DressingForm[] : TREES;
  let cursor = 0;
  const slots = forms.map(form => {
    const [sx, , sz] = DRESSING_SIZES[form];
    const blueprint = createDressing(form);
    const width = blueprint.size[0] * CELL, origin = new THREE.Vector3(cursor, 0, -blueprint.size[2] * CELL / 2);
    cursor += width + GAP;
    return { form, blueprint, origin, centre: new THREE.Vector3(origin.x + width / 2, 0, 0), max: [sx, sz] };
  });
  const rowWidth = cursor - GAP;
  const height = Math.max(...slots.map(s => s.blueprint.size[1] * CELL));
  const bounds = new THREE.Box3(new THREE.Vector3(-10, -1, -16), new THREE.Vector3(rowWidth + 10, height + 2, 16));
  const shadows = createSunShadows(renderer, { bounds, resolution: 2048 });
  shadows.bindReceiver(clay.material);

  // The detail view turns the elder about its seat, as the kingdom does with a landmark's yaw, so the seat looks
  // into the low sun with a little rake across the bark instead of sitting in the tree's own shade.
  const seat = ELDER_OAK_SEAT, seatAt = slots[0]!.origin.clone().add(new THREE.Vector3(seat.position[0] * CELL, seat.position[1] * CELL, seat.position[2] * CELL));
  const sun = new THREE.Vector3(...grade.sunDirection);
  const yaw = mode === 'elder' ? Math.atan2(sun.x, sun.z) + 0.45 : 0;
  const turned = new THREE.Group(), held = new THREE.Group();
  turned.position.copy(seatAt).setY(0); turned.rotation.y = yaw; held.position.copy(seatAt).setY(0).negate();
  turned.add(held); scene.add(turned);
  const FULL = 1, FAR = 2;
  const stats: Record<string, { triangles: number; lod4Triangles: number; boxes: number }> = {};
  const meshes: THREE.Mesh[] = [];
  const mesh = async (blueprint: VoxelBlueprint, position: THREE.Vector3, layer: number, factor?: 4, parent: THREE.Object3D = scene) => {
    const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision, ...(factor ? { lodFactor: factor } : {}) });
    if (result?.kind !== 'asset') throw new Error(`Could not mesh ${blueprint.id}`);
    const geometry = geometryFromChunks(result.chunks, 'build'), model = new THREE.Mesh(geometry, material);
    model.position.copy(position); if (factor) model.scale.setScalar(factor);
    model.layers.set(layer); model.frustumCulled = false; parent.add(model); meshes.push(model);
    if (layer === FULL && mode !== 'silhouette') shadows.register(model);
    return result.chunks.reduce((n, chunk) => n + chunk.mesh.indices.length / 3, 0);
  };
  const tasks: Promise<unknown>[] = slots.flatMap(slot => [
    mesh(slot.blueprint, slot.origin, FULL, undefined, held).then(t => { stats[slot.form] = { ...stats[slot.form]!, triangles: t, boxes: slot.blueprint.boxes.length }; }),
    ...(mode === 'elder' ? [] : [mesh(slot.blueprint, slot.origin, FAR, 4).then(t => { stats[slot.form] = { ...stats[slot.form]!, lod4Triangles: t }; })]),
  ]);
  if (mode !== 'silhouette') {
    // Turf under both rows, in pieces the mesher can pack.
    const piece = 256 * CELL, ground = turf(256, 256);
    for (let x = -8; x < rowWidth + 8; x += piece) for (const layer of [FULL, FAR]) tasks.push(mesh(ground, new THREE.Vector3(x, -CELL, -16), layer));
  }

  // The representative angle: a little to the right of the trees' front (+Z, where the elder's seat looks), a
  // little above, orthographic so every form keeps its true scale against its neighbours.
  const direction = new THREE.Vector3(0.42, 0.22, 1).normalize();
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  const perspective = new THREE.PerspectiveCamera(46, 1, 0.1, 2000);
  const labels = mode === 'elder' ? [] : slots.map(slot => {
    const label = document.createElement('div'); label.dataset.label = ''; label.textContent = slot.form; document.body.append(label); return label;
  });
  const rows = mode === 'elder' ? [] : ['Full detail', 'LOD 4 · 0.5 m blocks'].map(text => {
    const row = document.createElement('div'); row.dataset.row = ''; row.textContent = text; document.body.append(row); return row;
  });
  document.querySelector('[data-title]')!.innerHTML = mode === 'elder'
    ? `Chatdom · elder oak · ${hour}:00<small>Production voxel pipeline · root seat at (${seat.position.join(', ')}) cells, facing +Z: a content anchor, not a bound seat</small>`
    : `Chatdom · ground dressing · trees, hedges and woods · ${hour}:00<small>Production mesher and clay · one representative angle · true relative scale</small>`;

  const centre = new THREE.Vector3(rowWidth / 2, height / 2, 0);
  function frame(width: number, rowHeight: number) {
    const aspect = width / rowHeight;
    ortho.position.copy(centre).addScaledVector(direction, 400); ortho.lookAt(centre); ortho.updateMatrixWorld(true);
    const projected = new THREE.Box3();
    for (const slot of slots) for (const x of [0, slot.blueprint.size[0]]) for (const y of [0, slot.blueprint.size[1]]) for (const z of [0, slot.blueprint.size[2]])
      projected.expandByPoint(slot.origin.clone().add(new THREE.Vector3(x * CELL, y * CELL, z * CELL)).applyMatrix4(ortho.matrixWorldInverse));
    const half = Math.max((projected.max.y - projected.min.y) * 0.62, (projected.max.x - projected.min.x) / aspect * 0.53);
    const middle = (projected.max.y + projected.min.y) / 2 - half * 0.06, across = (projected.max.x + projected.min.x) / 2;
    ortho.left = across - half * aspect; ortho.right = across + half * aspect; ortho.top = middle + half; ortho.bottom = middle - half;
    ortho.updateProjectionMatrix();
  }

  let loaded = false, drawn = false;
  void Promise.all(tasks).then(() => { loaded = true; }, fail);
  const resize = () => { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); };
  new ResizeObserver(resize).observe(canvas); resize();
  const render = () => {
    try {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      shadows.updateSunDirection(grade.sunDirection);
      renderer.setScissorTest(false); renderer.clear();
      if (mode === 'elder') {
        // Standing in the meadow the seat faces, a little to one side, looking up into the crown.
        perspective.aspect = w / h; perspective.fov = w < h ? 62 : 46; perspective.updateProjectionMatrix();
        const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(seatAt.clone().setY(0));
        perspective.position.copy(at(7, 1.7, 19)); perspective.lookAt(at(-1, 7.4, -2));
        perspective.layers.set(FULL); perspective.updateMatrixWorld(true);
        renderer.setViewport(0, 0, w, h); renderer.render(scene, perspective);
      } else {
        renderer.setScissorTest(true);
        const top = Math.round(h * 0.06), rowHeight = Math.floor((h - top) / 2);
        frame(w, rowHeight);
        [FULL, FAR].forEach((layer, i) => {
          const y = h - top - rowHeight * (i + 1);
          renderer.setViewport(0, y, w, rowHeight); renderer.setScissor(0, y, w, rowHeight);
          ortho.layers.set(layer); renderer.render(scene, ortho);
          rows[i]!.style.top = `${h - y - rowHeight + 8}px`;
        });
        slots.forEach((slot, i) => {
          const p = slot.centre.clone().setY(-0.4).project(ortho);
          labels[i]!.style.left = `${(p.x + 1) / 2 * w}px`; labels[i]!.style.top = `${top + (1 - p.y) / 2 * rowHeight + 2}px`;
        });
      }
      if (loaded && !drawn) {
        drawn = true;
        requestAnimationFrame(() => requestAnimationFrame(() => { renderer.getContext().finish(); (window as SheetWindow).__chatdomReady = true; }));
      }
      requestAnimationFrame(render);
    } catch (error) { fail(error); }
  };
  requestAnimationFrame(render);
  (window as SheetWindow).__chatdomTrees = { stats, mode, hour };
} catch (error) { fail(error); }
