import * as THREE from 'three';
import { render } from 'solid-js/web';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { PeopleLabels, projectToCanvas, publishSpeech, type PersonLabel, type SpeechAnchor } from './index';

/**
 * Dev bench: the label layer through a scripted camera move, drawn by a real WebGL camera.
 *
 * A small dusk street (five homes with lit windows, two people walking) is drawn by three.js; every step moves the
 * camera along a swinging orbit with a fast turn in the middle, draws the frame, projects the walkers' heads and the
 * speaking homes' doors from that same camera, and hands them to `PeopleLabels` exactly as the walk does (names as
 * props, speech on the per-canvas bus). `window.__labelsMotion.step(i)` draws frame `i` and, once the layer has
 * written its transforms, reports where every visible label's tip sits against the anchor projected that frame.
 * A home passes behind another house during the move, so the wall fade is exercised too. No chat connection.
 */

const FRAMES = 16;
const raycaster = new THREE.Raycaster();

interface Home { readonly slot: number; readonly name: string; readonly at: THREE.Vector3; readonly line: string }
interface Walker { readonly id: string; readonly slot: number; readonly name: string; readonly self: boolean; readonly at: THREE.Vector3; readonly line?: string }

const HOMES: readonly Home[] = [
  { slot: 7, name: 'Rowan', at: new THREE.Vector3(-6, 0, -5), line: 'Good to see the lamps lit again.' },
  { slot: 9, name: 'Mirela', at: new THREE.Vector3(5.5, 0, -7), line: 'Who left a goose on the well?' },
  { slot: 12, name: 'Tamsin', at: new THREE.Vector3(9, 0, 2), line: 'Bread is out of the oven, come by' },
];
const PLAIN_HOMES = [new THREE.Vector3(-9, 0, 3), new THREE.Vector3(1, 0, -12), new THREE.Vector3(2.4, 0, 5.5)];
const WALKERS: readonly Walker[] = [
  { id: 'ash', slot: 1, name: 'Ash', self: true, at: new THREE.Vector3(-1, 0, 0), line: 'Hello from the square!' },
  { id: 'river', slot: 2, name: 'River', self: false, at: new THREE.Vector3(2.5, 0, -2.5) },
];

/** The camera at step `i`: a swinging orbit round the square that turns fast in the middle third, as a flick would. */
function cameraAt(camera: THREE.PerspectiveCamera, i: number) {
  const t = i / (FRAMES - 1);
  const fast = THREE.MathUtils.smoothstep(t, .35, .65);
  const angle = -.55 + .5 * t + 1.25 * fast;
  const radius = 15 - 4 * t, height = 5.5 - 1.6 * t;
  camera.position.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
  camera.lookAt(0, 1.4, -1.5);
  camera.updateMatrixWorld();
}

function house(scene: THREE.Scene, at: THREE.Vector3, lit: boolean, solids: THREE.Object3D[]) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 3), new THREE.MeshLambertMaterial({ color: 0x8d7a62 }));
  body.position.set(at.x, 1.3, at.z);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.6, 4), new THREE.MeshLambertMaterial({ color: 0x6b3e2e }));
  roof.position.set(at.x, 3.4, at.z); roof.rotation.y = Math.PI / 4;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(.8, 1.4), new THREE.MeshBasicMaterial({ color: 0x3a2a1e }));
  door.position.set(at.x, .7, at.z + 1.51);
  scene.add(body, roof, door);
  solids.push(body, roof);
  if (!lit) return;
  for (const side of [-.95, .95]) {
    const window = new THREE.Mesh(new THREE.PlaneGeometry(.62, .62), new THREE.MeshBasicMaterial({ color: 0xffc673 }));
    window.position.set(at.x + side, 1.55, at.z + 1.51);
    scene.add(window);
  }
  const glow = new THREE.PointLight(0xffb45e, 6, 7, 1.6);
  glow.position.set(at.x, 1.6, at.z + 2.2);
  scene.add(glow);
}

function figure(scene: THREE.Scene, at: THREE.Vector3, color: number) {
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.32, .9, 4, 10), new THREE.MeshLambertMaterial({ color }));
  body.position.set(at.x, .78, at.z);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.27, 16, 12), new THREE.MeshLambertMaterial({ color: 0xe0b48e }));
  head.position.set(at.x, 1.62, at.z);
  scene.add(body, head);
}

interface Tip { readonly id: string; readonly speech: boolean; readonly opacity: number; readonly tip: { x: number; y: number }; readonly anchor: { x: number; y: number } | null; readonly error: number | null }

function Motion() {
  let canvas!: HTMLCanvasElement;
  const [people, setPeople] = createSignal<readonly PersonLabel[]>([]);
  onMount(() => {
    const width = innerWidth, height = innerHeight;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(1); renderer.setSize(width, height, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2b2f47);
    scene.fog = new THREE.Fog(0x2b2f47, 18, 42);
    scene.add(new THREE.HemisphereLight(0x8f9ccf, 0x3b2f25, 1.1));
    const moon = new THREE.DirectionalLight(0xc8d2ff, .6); moon.position.set(-8, 14, 6); scene.add(moon);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({ color: 0x4d5a3b }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const square = new THREE.Mesh(new THREE.CircleGeometry(5.5, 40), new THREE.MeshLambertMaterial({ color: 0x77716a }));
    square.rotation.x = -Math.PI / 2; square.position.set(0, .01, -1.5); scene.add(square);
    const solids: THREE.Object3D[] = [];
    for (const home of HOMES) house(scene, home.at, true, solids);
    for (const at of PLAIN_HOMES) house(scene, at, false, solids);
    WALKERS.forEach((walker, index) => figure(scene, walker.at, index ? 0x4e6f8f : 0x9b4a3c));
    const camera = new THREE.PerspectiveCamera(55, width / height, .1, 120);
    const eye = new THREE.Vector3(), head = new THREE.Vector3(), door = new THREE.Vector3(), toward = new THREE.Vector3();
    let anchors = new Map<string, { x: number; y: number }>();

    /** Is a solid between the eye and `point`? */
    const hidden = (point: THREE.Vector3) => {
      eye.setFromMatrixPosition(camera.matrixWorld);
      toward.copy(point).sub(eye);
      const far = toward.length();
      raycaster.set(eye, toward.normalize()); raycaster.far = far - .2;
      return raycaster.intersectObjects(solids, false).length > 0;
    };

    function draw(i: number) {
      cameraAt(camera, i);
      renderer.render(scene, camera);
      const next = new Map<string, { x: number; y: number }>();
      const walkers: PersonLabel[] = [];
      for (const walker of WALKERS) {
        head.set(walker.at.x, 2.05, walker.at.z);
        const point = projectToCanvas(head, camera, width, height);
        if (!point) continue;
        next.set(`walker:${walker.id}`, point);
        next.set(`speech:${walker.id}`, point);
        walkers.push({ id: `walker:${walker.id}`, walkerId: walker.id, slot: walker.slot, ...point, self: walker.self, name: walker.name });
      }
      const speech: SpeechAnchor[] = [];
      for (const walker of WALKERS) {
        if (walker.line) speech.push({ slot: walker.slot, cueId: `${walker.id}-1`, from: 'walker', name: null, parts: [{ kind: 'text', text: walker.line }] });
      }
      for (const home of HOMES) {
        door.set(home.at.x, 3.1, home.at.z + 1.7);
        const point = projectToCanvas(door, camera, width, height);
        if (!point) continue;
        next.set(`home:${home.slot}`, point);
        speech.push({ slot: home.slot, cueId: `${home.name}-1`, from: 'home', name: home.name, parts: [{ kind: 'text', text: home.line }],
          ...point, visibility: hidden(door) ? 0 : 1 });
      }
      anchors = next;
      // Names as props, speech on the bus: the same two paths, in the same frame, as the walk.
      setPeople(walkers);
      publishSpeech(canvas, { at: performance.now(), width, height, speech });
    }

    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    function measure(): Tip[] {
      return [...document.querySelectorAll<HTMLElement>('.walk-person-label')].flatMap(element => {
        if (element.style.visibility !== 'visible') return [];
        const id = element.dataset.person ?? '', rect = element.getBoundingClientRect(), speech = element.classList.contains('is-speech');
        const tip = { x: rect.left + rect.width / 2, y: rect.bottom + (speech ? 7 : 0) };
        const anchor = anchors.get(id) ?? null;
        return [{ id, speech, opacity: Number(element.style.opacity), tip, anchor, error: anchor ? Math.hypot(tip.x - anchor.x, tip.y - anchor.y) : null }];
      });
    }
    const api = {
      frames: FRAMES,
      async step(i: number) {
        draw(i);
        await frame();
        return { frame: i, labels: measure() };
      },
      /** Lets fades and the bubble rise settle at the current frame before the sequence starts. */
      async settle(ms: number) { const until = performance.now() + ms; while (performance.now() < until) { draw(0); await frame(); } },
    };
    (window as Window & { __labelsMotion?: typeof api; __chatdomReady?: boolean }).__labelsMotion = api;
    draw(0);
    requestAnimationFrame(() => requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }));
    onCleanup(() => renderer.dispose());
  });
  return <>
    <canvas ref={element => { canvas = element; }} class="motion-canvas" aria-hidden="true" />
    <PeopleLabels people={people()} />
  </>;
}
render(() => <Motion />, document.querySelector('#app')!);
