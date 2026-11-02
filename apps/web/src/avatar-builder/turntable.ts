import * as THREE from 'three';
import { PORTRAIT, rgb, type CitizenLook } from '../../../../packages/content/src/avatar-style';
import { animateCape } from './cape';
import { citizenGlassMaterial, citizenMaterial, citizenObject, disposeCitizen } from './portrait-renderer';

/*
 * The builder's live turntable (spec B1): the whole citizen standing on a small round of cobbles in the
 * portrait's warm light, turned by dragging (or the arrow keys), with a little weight to the spin. It blinks
 * now and then and a rainbow cape shimmers; when nobody touches it, it turns slowly by itself. It renders only
 * while something moves. `focus` eases the camera in to what is being chosen (the head, the hands, the feet, the
 * badges on the chest, the back for a cape) and out again to the whole figure.
 */

/** Where the camera can lean in. Null is the whole figure. */
export type FocusRegion = 'head' | 'face' | 'chest' | 'badge' | 'hands' | 'legs' | 'feet' | 'back';

export interface TurntableOptions {
  /** A still pose for captures and reduced motion: no idle spin, no blinking. */
  readonly still?: boolean;
  /** Start angle in radians; 0 faces the viewer. */
  readonly yaw?: number;
  /** Turn slowly by itself when nobody touches it (default true). A mirror holds still and only blinks. */
  readonly spin?: boolean;
}

export interface Turntable {
  setLook(look: CitizenLook, dim?: boolean): void;
  /** Turns by a step (keyboard); positive turns the citizen to their left. */
  nudge(radians: number): void;
  /** Ease the camera in to a region, or out to the whole figure (null). `instant` cuts (captures, reduced motion). */
  focus(region: FocusRegion | null, instant?: boolean): void;
  readonly region: FocusRegion | null;
  resize(): void;
  dispose(): void;
}

const colour = (hex: `#${string}`) => new THREE.Color().setRGB(...rgb(hex), THREE.SRGBColorSpace);
/** The rest angle the idle spin settles near: a three-quarter view toward the person's right, like the portrait. */
const REST_YAW = -.42;

/**
 * Close shots in avatar cells: what to aim at, the half height and half width that must fit, how far above the aim
 * the camera rises (a share of its distance), and the angle the citizen settles to (null keeps the person's own).
 */
interface Shot { readonly x: number; readonly y: number; readonly half: number; readonly wide: number; readonly lift: number; readonly yaw: number | null }
const SHOTS: Readonly<Record<FocusRegion, Shot>> = {
  head: { x: 0, y: 21.6, half: 8.6, wide: 7.4, lift: .07, yaw: -.32 },
  face: { x: 0, y: 19.8, half: 5.2, wide: 5.6, lift: .04, yaw: -.18 },
  chest: { x: 0, y: 12.8, half: 6.8, wide: 6.6, lift: .06, yaw: -.3 },
  badge: { x: 1.4, y: 13.2, half: 3.9, wide: 3.9, lift: .05, yaw: -.08 },
  hands: { x: 0, y: 10.4, half: 5.6, wide: 7.6, lift: .1, yaw: -.62 },
  legs: { x: 0, y: 5.4, half: 6.6, wide: 6.2, lift: .1, yaw: -.36 },
  feet: { x: 0, y: 2.4, half: 4, wide: 5.8, lift: .14, yaw: -.42 },
  back: { x: 0, y: 13.2, half: 14.5, wide: 10.5, lift: .12, yaw: Math.PI - .5 },
};

function plinth(): THREE.Object3D {
  // A round of setts, one cell tall, in four warm stone tones, its rim a darker course.
  const group = new THREE.Group();
  const stones = ['#9a8f84', '#8a7f75', '#a69a8c', '#7e746b'].map(c => new THREE.Color(c));
  const cells: [number, number, THREE.Color][] = [];
  const radius = 9.5;
  for (let x = -10; x < 10; x++) for (let z = -10; z < 10; z++) {
    const d = Math.hypot(x + .5, z + .5);
    if (d > radius) continue;
    const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    cells.push([x, z, d > radius - 1.2 ? new THREE.Color('#6a5f57') : stones[Math.floor(h * 4)]!]);
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.94, 1, .94), new THREE.MeshStandardMaterial({ roughness: .92 }), cells.length);
  const m = new THREE.Matrix4();
  cells.forEach(([x, z, c], i) => {
    const h = Math.abs(Math.sin(x * 4.1 + z * 7.7) * 913.1) % 1;
    m.makeTranslation(x + .5, -.5 + h * .12, z + .5);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c);
  });
  mesh.receiveShadow = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(radius + .2, radius + .6, 1.6, 40), new THREE.MeshStandardMaterial({ color: '#4a3c34', roughness: 1 }));
  base.position.y = -1.3;
  base.receiveShadow = true;
  group.add(mesh, base);
  return group;
}

export function createTurntable(canvas: HTMLCanvasElement, options: TurntableOptions = {}): Turntable {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const { light } = PORTRAIT;
  scene.add(new THREE.HemisphereLight(colour(light.sky.colour), colour('#6b4a8e'), light.sky.intensity * .92));
  const key = new THREE.DirectionalLight(colour('#ffefd8'), light.key.intensity * .95);
  key.position.set(14, 30, 26);
  key.target.position.set(0, 10, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 18, bottom: -14, near: 1, far: 90 });
  key.shadow.bias = -.0005;
  key.shadow.normalBias = .04;
  key.shadow.radius = 4;
  const rim = new THREE.DirectionalLight(colour(light.rim.colour), light.rim.intensity * 1.4);
  rim.position.set(-20, 16, -22);
  // A lantern-warm fill low on the left, the kingdom's dusk in the fitting room.
  const lantern = new THREE.PointLight(colour('#ffb062'), 260, 60, 1.6);
  lantern.position.set(-16, 8, 12);
  scene.add(key, key.target, rim, lantern, plinth());

  const camera = new THREE.PerspectiveCamera(24, 1, 1, 400);
  const turn = new THREE.Group();
  scene.add(turn);
  const material = citizenMaterial(), glass = citizenGlassMaterial();
  let open: THREE.Group | null = null, closed: THREE.Group | null = null;

  let yaw = options.yaw ?? REST_YAW, spin = 0, lastTouch = performance.now(), blinkAt = performance.now() + 2600, blinking = false;
  let dirty = true, frame = 0, disposed = false, lastFrame = performance.now(), region: FocusRegion | null = null;
  const start = performance.now();
  // The camera's aim (x, y), half height and lift, eased toward the goal the region asks for.
  const aim = { x: 0, y: 13.2, half: 19.5, lift: .16 }, goal = { ...aim };
  let snap = true;

  const place = () => {
    const distance = aim.half / Math.tan(camera.fov * Math.PI / 360);
    camera.position.set(aim.x, aim.y + .8 + distance * aim.lift, distance);
    camera.lookAt(aim.x, aim.y, 0);
    camera.updateProjectionMatrix();
  };
  const aimAt = () => {
    const shot = region ? SHOTS[region] : null;
    // The whole figure with a tall hat (about 31 cells) and the plinth in the frame's height, or the plinth in its
    // width on a tall, narrow frame; a close shot fits its own height and width the same way.
    if (shot) Object.assign(goal, { x: shot.x, y: shot.y, half: Math.max(shot.half, shot.wide / camera.aspect), lift: shot.lift });
    else Object.assign(goal, { x: 0, y: 13.2, half: Math.max(19.5, 13.5 / camera.aspect), lift: .16 });
    if (snap || options.still) { Object.assign(aim, goal); snap = false; place(); }
    dirty = true;
  };
  const frameCamera = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    aimAt();
    place();
  };

  const loop = (now: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    const dt = Math.min(.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const idle = now - lastTouch > 4200;
    if (!options.still) {
      const settle = region ? SHOTS[region].yaw : null;
      if (Math.abs(spin) > .0004) { yaw += spin; spin *= .92; dirty = true; }
      else if (settle !== null && !dragging) {
        // A close shot turns the citizen to face it, the short way round, unless the person turned them since.
        const turn = Math.atan2(Math.sin(settle - yaw), Math.cos(settle - yaw));
        if (Math.abs(turn) > .002 && now - lastTouch > 900) { yaw += turn * (1 - Math.exp(-dt * 5)); dirty = true; }
      } else if (idle && !region && options.spin !== false) { yaw += .0035; dirty = true; }
      if (!blinking && now > blinkAt && closed) { blinking = true; dirty = true; }
      if (blinking && now > blinkAt + 140) { blinking = false; blinkAt = now + 2800 + Math.random() * 2600; dirty = true; }
      // The camera leans in and out with a soft, unhurried ease: about half a second to settle.
      const k = 1 - Math.exp(-dt * 6.5);
      let moving = false;
      for (const key of ['x', 'y', 'half', 'lift'] as const) {
        const d = goal[key] - aim[key];
        if (Math.abs(d) > (key === 'lift' ? 1e-4 : .002)) { aim[key] += d * k; moving = true; } else aim[key] = goal[key];
      }
      if (moving) { place(); dirty = true; }
    }
    if (open && closed) { open.visible = !blinking; closed.visible = blinking; }
    for (const body of [open, closed]) {
      const cape = body?.getObjectByName('citizen-cape');
      if (cape?.userData.cut?.shimmer && !options.still) { animateCape(cape, (now - start) / 1000); dirty = true; }
    }
    turn.rotation.y = yaw;
    if (dirty) { renderer.render(scene, camera); dirty = false; }
  };

  // Drag to turn, with a little momentum on release.
  let dragging = false as boolean, lastX = 0, lastT = 0;
  const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastT = e.timeStamp; spin = 0; canvas.setPointerCapture(e.pointerId); lastTouch = performance.now(); };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dt = Math.max(1, e.timeStamp - lastT);
    const step = dx / Math.max(160, canvas.clientWidth) * Math.PI * 1.6;
    yaw += step; spin = step * Math.min(1, 16 / dt);
    lastX = e.clientX; lastT = e.timeStamp; lastTouch = performance.now(); dirty = true;
  };
  const up = (e: PointerEvent) => { dragging = false; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); lastTouch = performance.now(); };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  const observer = new ResizeObserver(frameCamera);
  observer.observe(canvas);
  frameCamera();
  frame = requestAnimationFrame(loop);

  const clear = () => {
    for (const body of [open, closed]) if (body) { turn.remove(body); disposeCitizen(body); }
    open = closed = null;
  };

  return {
    setLook(look, dim = false) {
      clear();
      open = citizenObject(look, { dim }, material, glass);
      closed = citizenObject(look, { dim, blink: true }, material, glass);
      closed.visible = false;
      turn.add(open, closed);
      dirty = true;
    },
    nudge(radians) { yaw += radians; lastTouch = performance.now(); dirty = true; },
    focus(next, instant = false) {
      if (next === region && !instant) return;
      region = next;
      if (instant) {
        snap = true;
        const settle = next ? SHOTS[next].yaw : null;
        if (settle !== null) yaw = settle;
      }
      aimAt();
    },
    get region() { return region; },
    resize: frameCamera,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      clear();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      material.dispose();
      glass.dispose();
      renderer.dispose();
    },
  };
}
