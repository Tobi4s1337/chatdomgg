// A local art bench: no live data, authority, or production route is implied.
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createForgeHearth } from '../../../../packages/content/src/forge-square/index';
import { FORGE_EXTENSION_HEARTH_OFFSET } from '../../../../packages/content/src/growth-civic/forge-extension';
import { createHumpbackBridge } from '../../../../packages/content/src/places/water/bridge/bridge';
import { createGrowthCivicForm, growthCivicLights, growthCivicWater } from '../../../../packages/content/src/growth-civic/index';

const places = ['market', 'tavern', 'forge', 'castle-court', 'bridge'] as const;
const style = new URLSearchParams(location.search).get('style') === 'tide' ? 'tide' : 'hearth';
document.querySelector('#style')!.textContent = style === 'tide' ? 'Salt & slate' : 'Hearth & heather';
const grid = document.querySelector<HTMLElement>('.grid')!;
const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const status = document.querySelector<HTMLElement>('.status')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(grid.clientWidth, grid.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const material = createVoxelMaterial(MATERIALS, 'build');
material.setEnvironment(getEnvironment(18));
const pool = new VoxelWorkerPool({ size: 2, maxQueue: 64 });
const scenes: { scene: THREE.Scene; camera: THREE.OrthographicCamera }[] = [];
try {
  const forgeBase = createForgeHearth(style);
  const forgeMesh = await pool.submit({ kind: 'blueprint', blueprint: forgeBase, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
  if (!forgeMesh || forgeMesh.kind !== 'asset' || !forgeMesh.chunks.length) throw new Error('Cannot mesh the comparison hearth');
  const forgeGeometry = geometryFromChunks(forgeMesh.chunks, 'build');
  const bridgeBase = createHumpbackBridge(style, 6, 14).blueprint;
  const bridgeMesh = await pool.submit({ kind: 'blueprint', blueprint: bridgeBase, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
  if (!bridgeMesh || bridgeMesh.kind !== 'asset' || !bridgeMesh.chunks.length) throw new Error('Cannot mesh the comparison bridge');
  const bridgeGeometry = geometryFromChunks(bridgeMesh.chunks, 'build');
  for (const place of places) for (let level = 1; level <= 4; level++) {
    const label = document.createElement('div'); label.className = 'label';
    label.innerHTML = `<b>${place[0]!.toUpperCase() + place.slice(1)}</b> · level ${level}`;
    grid.append(label);
    const blueprint = createGrowthCivicForm(place, style, level, { water: 6, bank: 14 });
    const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (!result || result.kind !== 'asset' || !result.chunks.length) throw new Error(`Cannot mesh ${blueprint.id}`);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#343d3d');
    if (place === 'bridge') scene.add(new THREE.Mesh(bridgeGeometry, material.material));
    if (place === 'forge') {
      const original = new THREE.Mesh(forgeGeometry, material.material);
      original.position.set(...FORGE_EXTENSION_HEARTH_OFFSET.map(n => n * .125) as [number, number, number]);
      scene.add(original);
    }
    const mesh = new THREE.Mesh(geometryFromChunks(result.chunks, 'build'), material.material); scene.add(mesh);
    const water = growthCivicWater(place, level);
    if (water) {
      const [x, y, z] = water.from, [X, , Z] = water.to;
      const surface = new THREE.Mesh(new THREE.PlaneGeometry((X - x) * .125, (Z - z) * .125),
        new THREE.MeshBasicMaterial({ color: 0x709ca8, transparent: true, opacity: .75, side: THREE.DoubleSide }));
      surface.rotation.x = -Math.PI / 2; surface.position.set((x + X) * .0625, y * .125 + .01, (z + Z) * .0625);
      scene.add(surface);
    }
    // Civic light is separate from a citizen's presence. These emissive panes make the
    // authored light anchors visible in this simulated bench; the host owns the light field.
    for (const light of growthCivicLights(place, level, { water: 6, bank: 14 })) {
      const [x, y, z] = light.centre.map(v => v * .125) as [number, number, number];
      const glow = new THREE.MeshBasicMaterial({ color: light.kind === 'hearth' ? 0xd96a30 : 0xf0bc71, toneMapped: false });
      const pane = (dx: number, dy: number, w: number, h: number) => {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(w * .125, h * .125), glow);
        plane.position.set(x + dx * .125, y + dy * .125, z + (light.kind === 'lantern' ? .13 : .015)); scene.add(plane);
      };
      if (light.kind === 'window') {
        pane(-2, -2, 2, 4); pane(1.5, -2, 3, 4); pane(-2, 2.5, 2, 3); pane(1.5, 2.5, 3, 3);
      } else pane(0, 0, light.kind === 'lantern' ? 2 : 5, light.kind === 'lantern' ? 3 : 3);
    }
    // Hold one camera for all four levels, fitted to the actual occupied extents rather
    // than the allocation envelope. Both the old hearth and bridge remain visible in context.
    const bounds = new THREE.Box3();
    const include = (form: typeof blueprint, offset: readonly [number, number, number] = [0, 0, 0]) => {
      for (const box of form.boxes) if (box.material !== 0) {
        bounds.expandByPoint(new THREE.Vector3(...box.from).add(new THREE.Vector3(...offset)).multiplyScalar(.125));
        bounds.expandByPoint(new THREE.Vector3(...box.to).add(new THREE.Vector3(...offset)).multiplyScalar(.125));
      }
    };
    for (let n = 1; n <= 4; n++) include(createGrowthCivicForm(place, style, n, { water: 6, bank: 14 }));
    if (place === 'bridge') include(bridgeBase);
    if (place === 'forge') include(forgeBase, FORGE_EXTENSION_HEARTH_OFFSET);
    const target = bounds.getCenter(new THREE.Vector3());
    const direction = new THREE.Vector3(1, .7, 1.4).normalize();
    const right = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    let halfWidth = 0, halfHeight = 0;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const delta = new THREE.Vector3(x, y, z).sub(target);
      halfWidth = Math.max(halfWidth, Math.abs(delta.dot(right)));
      halfHeight = Math.max(halfHeight, Math.abs(delta.dot(up)));
    }
    const aspect = (grid.clientWidth / 4) / (grid.clientHeight / 5 - 27);
    const half = Math.max(halfHeight, halfWidth / aspect, 1) * 1.2;
    const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, .1, 200);
    camera.position.copy(target).addScaledVector(direction, 50); camera.lookAt(target);
    scenes.push({ scene, camera });
  }
  renderer.setScissorTest(true);
  const width = grid.clientWidth / 4, cellHeight = grid.clientHeight / 5, height = cellHeight - 27;
  scenes.forEach(({scene, camera}, i) => {
    const bottom = (4 - Math.floor(i / 4)) * cellHeight + 3;
    renderer.setViewport((i % 4) * width, bottom, width, height);
    renderer.setScissor((i % 4) * width, bottom, width, height);
    renderer.render(scene, camera);
  });
  status.textContent = 'SIMULATED · production voxel mesher';
  (window as typeof window & { __chatdomReady: boolean }).__chatdomReady = true;
} catch (error) { status.textContent = `Fixture could not draw: ${String(error)}`; throw error; }
