import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { createCitizenRenderer, createDefaultCitizenLooks } from './index';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#ede1c9');
const camera = new THREE.OrthographicCamera(-5.6, 5.6, 3.5, -3.5, .1, 100);
camera.position.set(0, 3, 15); camera.lookAt(0, .85, 0);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: '#d1c3a6' }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.02; scene.add(ground);
const material = createVoxelMaterial(MATERIALS, 'avatar');
material.setEnvironment(getEnvironment(12));
const looks = createDefaultCitizenLooks();
const seated = new URLSearchParams(location.search).get('posture') === 'seated';
if (seated) {
  document.querySelector('h1')!.textContent = 'Seated citizens on simulated benches';
  for (let i = 0; i < looks.length; i++) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1, .22, .65), new THREE.MeshStandardMaterial({ color: '#8a694b' }));
    seat.position.set((i - 2.5) * 1.72, .11, -.35); scene.add(seat);
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0x82705a, 2));
}
try {
  const citizens = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity: 6 });
  citizens.update(looks.map((look, i) => ({ id: `simulated-${i}`, look: look.id, position: [(i - 2.5) * 1.72, 0, 0] as const, heading: seated && i % 2 ? -.65 : -.23, distance: 0, moving: 0, ...(seated ? { posture: 'seated' as const } : {}), time: 0 })), camera);
  renderer.render(scene, camera);
  (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
} catch (error) { document.body.textContent = `Review failed: ${String(error)}`; throw error; }
