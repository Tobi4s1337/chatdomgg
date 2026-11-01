import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content/materials';
import { PORTRAIT_FIXTURES } from '@chatdom/content/avatar-style';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { createCitizenRenderer, createWornCitizenLook, type CitizenGesture } from './index';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#e9dfcb');
const aspect = innerWidth / innerHeight;
const halfWidth = aspect < 1 ? 3.1 : 4.2;
const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfWidth / aspect, -halfWidth / aspect, .1, 100);
camera.position.set(0, 3, 15); camera.lookAt(0, .85, 0);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: '#c8b89d' }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.02; scene.add(ground);
const material = createVoxelMaterial(MATERIALS, 'avatar'); material.setEnvironment(getEnvironment(12));
const looks = PORTRAIT_FIXTURES.slice(0, 3).map((fixture, i) => createWornCitizenLook(`review-${i}`, {
  ...fixture.look, earned: { ...fixture.look.earned, cape: { kind: i === 1 ? 'cheer' : 'tier-cloak', id: `simulated-${i}`, cloth: ['#9d4439', '#4a7092', '#6c7650'][i] as `#${string}`, lining: '#e4b779', trim: '#edcf82' } },
}));
const citizens = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity: 3 });
const names: CitizenGesture[] = ['none', 'wave', 'bow', 'cheer', 'dance', 'sit', 'point', 'nod'];
const chosen = new URLSearchParams(location.search).get('gesture') as CitizenGesture | null;
function seek(seconds: number) {
  const gesture = chosen && names.includes(chosen) ? chosen : names[Math.floor(Math.max(0, seconds) / 3) % names.length]!;
  const walking = gesture === 'none';
  const travel = walking ? (Math.max(0, seconds) % 3) * .8 : 0;
  // Feed a reproducible blend history at fixed intervals, independent of screenshot cadence.
  citizens.update([], camera, seconds * 1000);
  for (let step = 0; step <= 8; step++) citizens.update(looks.map((look, i) => ({
    id: `simulated-${i}`, look: look.id, position: [(i - 1) * 1.7 + Math.sin(-.32) * travel, 0, walking ? -1.2 + Math.cos(-.32) * travel : 0] as const,
    heading: -.32, distance: walking ? travel + i * .25 : 0, moving: walking ? 1 : 0, speed: walking ? .8 : 0, gesture, time: seconds,
  })), camera, step * 100 + seconds * 1000);
  document.querySelector('.label')!.textContent = `SIMULATED · ${gesture === 'none' ? 'walking' : gesture}`;
  renderer.render(scene, camera);
}
const reviewWindow = window as Window & { __chatdomReady?: boolean; __chatdomGestureReview?: { seek(seconds: number): void } };
reviewWindow.__chatdomGestureReview = { seek }; seek(0); reviewWindow.__chatdomReady = true;
