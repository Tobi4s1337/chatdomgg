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
const params = new URLSearchParams(location.search);
const detail = params.get('detail') === '1';
const turns = params.get('trajectory') === 'turns';
const aspect = innerWidth / innerHeight;
const halfWidth = detail ? 1.6 * aspect : aspect < 1 ? 3.1 : 4.2;
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
const chosen = params.get('gesture') as CitizenGesture | null;
const shown = detail ? looks.slice(0, 1) : looks;
function turnPosition(t: number): { x: number; z: number; heading: number } {
  const forward = Math.min(t, .8) * .8;
  const reverse = Math.min(Math.max(t - .8, 0), .8) * .8;
  return { x: Math.max(0, t - 1.6) * .8, z: forward - reverse, heading: t < .8 ? 0 : t < 1.6 ? Math.PI : Math.PI / 2 };
}
function seek(seconds: number) {
  const gesture = chosen && names.includes(chosen) ? chosen : turns ? 'none' : names[Math.floor(Math.max(0, seconds) / 3) % names.length]!;
  const walking = turns || gesture === 'none';
  const passTime = turns ? Math.min(3, Math.max(0, seconds)) : walking ? Math.max(0, seconds) % 3 : .8;
  if (detail) {
    const point = turns ? turnPosition(passTime) : { x: walking ? Math.sin(-.32) * passTime * .8 : 0, z: walking ? -1.2 + Math.cos(-.32) * passTime * .8 : 0 };
    camera.position.set(point.x, 3, point.z + 15); camera.lookAt(point.x, .85, point.z);
  }
  // Reconstruct the trajectory at fixed steps so a seek includes real stance history.
  citizens.update([], camera, 0);
  const steps = Math.max(1, Math.ceil(passTime * 60));
  for (let step = 0; step <= steps; step++) {
    const t = passTime * step / steps, travel = walking ? t * .8 : 0;
    const point = turns ? turnPosition(t) : { x: Math.sin(-.32) * travel, z: walking ? -1.2 + Math.cos(-.32) * travel : 0, heading: -.32 };
    citizens.update(shown.map((look, i) => ({
      id: `simulated-${i}`, look: look.id, position: [(detail ? 0 : (i - 1) * 1.7) + point.x, 0, point.z] as const,
      heading: point.heading, distance: walking ? travel + i * .25 : 0, moving: walking ? 1 : 0, speed: walking ? .8 : 0, gesture, time: walking ? t : seconds + t,
    })), camera, t * 1000);
  }
  document.querySelector('.label')!.textContent = `SIMULATED · ${turns ? 'forward · reverse · strafe' : gesture === 'none' ? 'walking' : gesture}`;
  renderer.render(scene, camera);
}
const reviewWindow = window as Window & { __chatdomReady?: boolean; __chatdomGestureReview?: { seek(seconds: number): void } };
reviewWindow.__chatdomGestureReview = { seek }; seek(0); reviewWindow.__chatdomReady = true;
