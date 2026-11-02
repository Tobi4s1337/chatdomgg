/**
 * Dev review of the monarch's crown and title tag on real citizens, in the kingdom's golden-hour light: the
 * production crown, citizen renderer, monarch view (crown marks, presence, gaze, tag) and name-tag layer, without
 * the land. It answers one question quickly on any renderer: does the crown sit on the head at the right size, and
 * does the tag read "Monarch tobi4s_" beside ordinary names. Not reachable from any kingdom.
 *
 *   /src/kingdom/grand-land/monarch/review.html?view=guest|monarch|far
 */
import * as THREE from 'three';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import type { RealmWalkerFeed, RealmWalkerFrame } from '@chatdom/shared/realm';
import { createCitizenRenderer, createDefaultCitizenLooks } from '../../../citizens';
import { PeopleLabels, peopleFromLabels, type PersonLabel } from '../../../walk/labels/index';
import { createMonarchView, walkerGaze } from './index';
import { createArrivalLine } from './arrival-line';

type View = 'guest' | 'monarch' | 'far';
const view = (new URLSearchParams(location.search).get('view') ?? 'guest') as View;
const env = getEnvironment(17.5);

const stage = document.querySelector<HTMLDivElement>('#stage')!, canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
{
  const sky = document.createElement('canvas'); sky.width = 2; sky.height = 256;
  const g = sky.getContext('2d')!, gradient = g.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, env.zenith); gradient.addColorStop(.62, env.horizon); gradient.addColorStop(1, env.glow);
  g.fillStyle = gradient; g.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(sky); texture.colorSpace = THREE.SRGBColorSpace;
  scene.background = texture;
  scene.fog = new THREE.Fog(env.fog, 18, 60);
}
// Warm cobbles under the gate, laid as setts so the feet have something to stand on.
{
  const setts = document.createElement('canvas'); setts.width = setts.height = 256;
  const g = setts.getContext('2d')!;
  g.fillStyle = '#6f5a45'; g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const shade = 150 + ((row * 37 + col * 61) % 23);
    g.fillStyle = `rgb(${shade},${Math.round(shade * .83)},${Math.round(shade * .64)})`;
    g.fillRect(col * 32 + (row % 2) * 16 + 2, row * 32 + 2, 28, 28);
  }
  const texture = new THREE.CanvasTexture(setts); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(24, 24); texture.magFilter = THREE.NearestFilter;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(48, 48), new THREE.MeshBasicMaterial({ map: texture, color: '#e8c79c' }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.01; scene.add(ground);
}

const camera = new THREE.PerspectiveCamera(view === 'far' ? 32 : 42, innerWidth / innerHeight, .1, 200);
const material = createVoxelMaterial(MATERIALS, 'avatar');
material.setEnvironment(env);
const looks = createDefaultCitizenLooks();
const look = (i: number) => looks[i % looks.length]!.id;

// Who stands where. Heading zero faces +Z (toward the guest's camera); yaw bytes as the room sends them.
interface Person { readonly id: string; readonly name: string; readonly look: string; readonly x: number; readonly z: number; readonly heading: number; readonly crown?: string; readonly self?: boolean }
const people: readonly Person[] = view === 'monarch'
  ? [{ id: 'monarch', name: 'tobi4s_', look: look(1), x: 0, z: 0, heading: Math.PI + .12, crown: 'Monarch', self: true },
    { id: 'c1', name: 'mossbright', look: look(0), x: -1.25, z: -3.1, heading: .35 },
    { id: 'c2', name: 'quill_and_ink', look: look(3), x: 1.45, z: -3.8, heading: -.5 }]
  : [{ id: 'monarch', name: 'tobi4s_', look: look(1), x: 0, z: 0, heading: -.18, crown: 'Monarch' },
    { id: 'c1', name: 'mossbright', look: look(0), x: 1.35, z: -.9, heading: -.25 },
    { id: 'c2', name: 'quill_and_ink', look: look(3), x: -1.5, z: -1.7, heading: .55 }];
if (view === 'monarch') { camera.position.set(.55, 2.15, 3.3); camera.lookAt(0, 1.35, -1.6); }
else if (view === 'far') { camera.position.set(1.2, 4.2, 15); camera.lookAt(0, 1.1, 0); }
else { camera.position.set(.35, 1.72, 3.9); camera.lookAt(0, 1.42, 0); }

const yawByte = (heading: number) => heading * 256 / (Math.PI * 2);
// The walker frame as the stream receives it; the monarch view reads only ids and crown marks from it.
const frame = { walkers: people.map(p => ({ id: p.id, ...(p.crown ? { crown: p.crown } : {}) })) } as unknown as RealmWalkerFrame;
const [present, setPresent] = createSignal(false);
const feed: RealmWalkerFeed = { subscribe(receive) { receive(frame); return () => {}; } } as RealmWalkerFeed;

const monarchView = createMonarchView({ scene, lighting: material, kingdomId: '129634568', plan: null, bell: () => {}, storage: null });
monarchView.observe(feed).subscribe(() => {}, () => {});
const [labels, setLabels] = createSignal<readonly PersonLabel[]>([]);
render(() => <PeopleLabels people={labels()} density={{ labels: 'all', bubbles: 'all' }} reducedMotion />, stage);

try {
  const citizens = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity: 8 });
  const poses = () => present() ? people.map(p => ({ id: p.id, x: p.x, y: 0, z: p.z, yaw: yawByte(p.heading), ...(p.self ? { self: true } : {}) })) : [];
  const step = () => {
    const now = performance.now();
    const list = poses();
    citizens.update(list.map((pose, i) => ({ id: pose.id, look: people[i]!.look, position: [pose.x, 0, pose.z] as const, heading: people[i]!.heading,
      distance: 0, moving: 0, time: now / 1000, ...walkerGaze(pose) })), camera);
    monarchView.frame(now, { people: { poses: list, heads: citizens.heads }, camera, night: env.night, time: now / 1000 });
    const point = new THREE.Vector3();
    // Projected from the drawn heads, as the walk's labels() does, then through the monarch view as scene.ts does.
    const projected = list.flatMap(pose => {
      const head = citizens.heads.get(pose.id);
      if (!head) return [];
      point.copy(head).project(camera);
      return [{ id: pose.id, name: people.find(p => p.id === pose.id)!.name, self: !!pose.self, distance: head.distanceTo(camera.position),
        x: (point.x + 1) * innerWidth / 2, y: (1 - point.y) * innerHeight / 2 }];
    });
    setLabels(peopleFromLabels(monarchView.labels(projected, innerHeight), []));
    renderer.render(scene, camera);
  };
  // The view first sees an empty street, then the monarch walks in: the arrival turns heads and the crown is placed.
  step();
  setPresent(true);
  step();
  const line = createArrivalLine(stage);
  line.show(view === 'monarch'
    ? { kingdom: 'Willowmere', monarch: 'tobi4s_', standing: 'monarch', title: 'Monarch', choose: () => {} }
    : { kingdom: 'Willowmere', monarch: 'tobi4s_', standing: 'guest', castle: 'ahead of you' });
  // Heads turn over about a second after the arrival; draw again once they have.
  await new Promise(done => setTimeout(done, 1600));
  step();
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  (window as Window & { __chatdomReady?: boolean; __monarchReview?: unknown }).__monarchReview = { ...monarchView.inspect(), tags: labels().map(l => l.name) };
  (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
} catch (error) { document.body.textContent = `Review failed: ${String(error)}`; throw error; }
