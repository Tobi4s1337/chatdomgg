// An unoccupied art bench: the base bridge and its mature additions, meshed by production workers.
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createHumpbackBridge } from '../../../../packages/content/src/places/water/bridge/bridge';
import { createGrowthCivicForm } from '../../../../packages/content/src/growth-civic/index';

const params = new URLSearchParams(location.search);
const style = params.get('style') === 'tide' ? 'tide' : 'hearth';
const angle = params.get('angle');
if (angle !== 'front' && angle !== 'side' && angle !== 'back') throw new Error('Select a bridge review angle');
document.querySelector('#view')!.textContent = `${style === 'hearth' ? 'Hearth' : 'Tide'} · ${angle}`;
const status = document.querySelector<HTMLElement>('.status')!;
const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight - 74, false);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
const material = createVoxelMaterial(MATERIALS, 'build'); material.setEnvironment(getEnvironment(18));
const pool = new VoxelWorkerPool({ size: 2, maxQueue: 8 });
const scene = new THREE.Scene(); scene.background = new THREE.Color('#343d3d');
const site = { water: 6, bank: 14 };
try {
  for (const blueprint of [createHumpbackBridge(style, site.water, site.bank).blueprint, createGrowthCivicForm('bridge', style, 4, site)]) {
    const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (!result || result.kind !== 'asset' || !result.chunks.length) throw new Error(`Cannot mesh ${blueprint.id}`);
    scene.add(new THREE.Mesh(geometryFromChunks(result.chunks, 'build'), material.material));
  }
  const aspect = innerWidth / (innerHeight - 74), half = 6.8;
  const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, .1, 150);
  const target = new THREE.Vector3(9, 3.8, 2);
  const direction = angle === 'front' ? new THREE.Vector3(0, .3, 1) : angle === 'back' ? new THREE.Vector3(0, .3, -1) : new THREE.Vector3(1, .3, 0);
  camera.position.copy(target).addScaledVector(direction.normalize(), 50); camera.lookAt(target);
  renderer.render(scene, camera);
  status.textContent = 'SIMULATED · production voxel mesher · level 4';
  (window as typeof window & { __chatdomReady?: boolean }).__chatdomReady = true;
} catch (error) { status.textContent = `Fixture failed: ${String(error)}`; throw error; }
