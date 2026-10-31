import * as THREE from 'three';
import { PORTRAIT, rgb, type CitizenLook } from '../../../../packages/content/src/avatar-style';
import { animateCape } from './cape';
import { citizenGlassMaterial, citizenMaterial, citizenObject, disposeCitizen } from './portrait-renderer';

/*
 * The builder's live turntable (spec B1): the whole citizen standing on a small round of cobbles in the
 * portrait's warm light, turned by dragging (or the arrow keys), with a little weight to the spin. It blinks
 * now and then and a rainbow cape shimmers; when nobody touches it, it turns slowly by itself. It renders only
 * while something moves.
 */

export interface TurntableOptions {
  /** A still pose for captures and reduced motion: no idle spin, no blinking. */
  readonly still?: boolean;
  /** Start angle in radians; 0 faces the viewer. */
  readonly yaw?: number;
}

export interface Turntable {
  setLook(look: CitizenLook, dim?: boolean): void;
  /** Turns by a step (keyboard); positive turns the citizen to their left. */
  nudge(radians: number): void;
  resize(): void;
  dispose(): void;
}

const colour = (hex: `#${string}`) => new THREE.Color().setRGB(...rgb(hex), THREE.SRGBColorSpace);
/** The rest angle the idle spin settles near: a three-quarter view toward the person's right, like the portrait. */
const REST_YAW = -.42;

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
  let dirty = true, frame = 0, disposed = false;
  const start = performance.now();

  const frameCamera = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Fit the figure with a tall hat (about 31 cells) and the plinth into the frame's height, or the plinth
    // into its width on a tall, narrow frame.
    const fit = Math.max(19.5, 13.5 / camera.aspect);
    const distance = fit / Math.tan(camera.fov * Math.PI / 360);
    camera.position.set(0, 14 + distance * .16, distance);
    camera.lookAt(0, 13.2, 0);
    camera.updateProjectionMatrix();
    dirty = true;
  };

  const loop = (now: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    const idle = now - lastTouch > 4200;
    if (!options.still) {
      if (Math.abs(spin) > .0004) { yaw += spin; spin *= .92; dirty = true; }
      else if (idle) { yaw += .0035; dirty = true; }
      if (!blinking && now > blinkAt && closed) { blinking = true; dirty = true; }
      if (blinking && now > blinkAt + 140) { blinking = false; blinkAt = now + 2800 + Math.random() * 2600; dirty = true; }
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
  let dragging = false, lastX = 0, lastT = 0;
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
