import * as THREE from 'three';
import {
  PORTRAIT, buildCitizen, meshCitizen, portraitEye, rgb, slotColours, type CitizenLook, type CitizenMesh, type HeadOptions,
} from '../../../../packages/content/src/avatar-style';
import { capeObject, disposeCape } from './cape';

/*
 * The citizen renderer. `citizenObject` is the character as a three.js mesh in avatar cells (scale it by
 * 1/16 for metres), for the builder's turntable and for main to wire into the kingdom, stream and card.
 * `createPortraitRenderer` draws the bust portrait on the Twitch-purple gradient at any size (spec L6).
 *
 * The look of the reference comes from three things, all here: hard voxels with a narrow bevel on true outer
 * edges only, soft corner occlusion in the creases, and one warm key light with a soft shadow so the fringe
 * shades the forehead.
 */

const linear = (c: number) => (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);

export function citizenGeometry(mesh: CitizenMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const colours = mesh.colours.map(linear);
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.setAttribute('occlusion', new THREE.BufferAttribute(mesh.occlusion, 1));
  g.setAttribute('faceUv', new THREE.BufferAttribute(mesh.faceUv, 2));
  g.setAttribute('edges', new THREE.BufferAttribute(mesh.edges, 4));
  g.setAttribute('tangentU', new THREE.BufferAttribute(mesh.tangentU, 3));
  g.setAttribute('tangentV', new THREE.BufferAttribute(mesh.tangentV, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** Vertex-coloured standard material with the convex-edge bevel and corner occlusion patched in. */
export function citizenMaterial(bevel: number = PORTRAIT.bevel): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: 0 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float occlusion; attribute vec2 faceUv; attribute vec4 edges; attribute vec3 tangentU; attribute vec3 tangentV;
varying float vOcclusion; varying vec2 vFaceUv; varying vec4 vEdges; varying vec3 vTangentU; varying vec3 vTangentV;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vOcclusion = occlusion; vFaceUv = faceUv; vEdges = edges;
vTangentU = normalize(normalMatrix * tangentU); vTangentV = normalize(normalMatrix * tangentV);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vOcclusion; varying vec2 vFaceUv; varying vec4 vEdges; varying vec3 vTangentU; varying vec3 vTangentV;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= vOcclusion;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
{
  float w = ${bevel.toFixed(3)};
  float a = vEdges.x * (1.0 - smoothstep(0.0, w, vFaceUv.x));
  float b = vEdges.y * (1.0 - smoothstep(0.0, w, 1.0 - vFaceUv.x));
  float c = vEdges.z * (1.0 - smoothstep(0.0, w, vFaceUv.y));
  float d = vEdges.w * (1.0 - smoothstep(0.0, w, 1.0 - vFaceUv.y));
  normal = normalize(normal + ((b - a) * vTangentU + (d - c) * vTangentV) * 1.15);
}`);
  };
  material.customProgramCacheKey = () => `citizen-voxel-${bevel}`;
  return material;
}

/** Lens glass: tinted, glossy and see-through, so the eye blocks read behind it. */
export function citizenGlassMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .12, metalness: 0, transparent: true, depthWrite: false });
}

/**
 * Lens geometry with per-vertex alpha from the tint: clear and pale glass is barely there so the eyes read
 * fully through it, smoked glass is dark enough to read as sunglasses.
 */
function glassGeometry(mesh: CitizenMesh): THREE.BufferGeometry {
  const g = citizenGeometry(mesh);
  const rgba = new Float32Array(mesh.faces * 16);
  for (let v = 0; v < mesh.faces * 4; v++) {
    const [r, gr, b] = [mesh.colours[v * 3]!, mesh.colours[v * 3 + 1]!, mesh.colours[v * 3 + 2]!];
    const luma = r * .2126 + gr * .7152 + b * .0722;
    rgba.set([linear(r), linear(gr), linear(b), luma > .7 ? .2 : luma > .4 ? .34 : .62], v * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  return g;
}

export interface CitizenOptions extends HeadOptions {
  /** Sub pieces after a lapsed sub: dimmed, still worn. Main reads it from `subLapsed(entitlements)`. */
  readonly dim?: boolean | undefined;
  /** Leave the cape off (a runtime that draws its own cloth from `capeCut`). */
  readonly noCape?: boolean | undefined;
}

/**
 * The character in avatar cells, root at the origin, facing +Z: the opaque body as `citizen-solid`, any
 * lenses as `citizen-glass` drawn after it, and a cape as `citizen-cape` (cloth at rest). Dispose with
 * `disposeCitizen`; the voxel materials are the caller's, the cape's are the citizen's own.
 */
export function citizenObject(
  look: CitizenLook, options: CitizenOptions = {},
  material: THREE.Material = citizenMaterial(), glass: THREE.Material = citizenGlassMaterial(),
): THREE.Group {
  const grid = buildCitizen(look, options), colours = slotColours(look, { subLapsed: options.dim });
  const group = new THREE.Group();
  group.name = 'citizen';
  const solid = new THREE.Mesh(citizenGeometry(meshCitizen(grid, colours, 'solid')), material);
  solid.name = 'citizen-solid';
  solid.castShadow = solid.receiveShadow = true;
  group.add(solid);
  const lenses = meshCitizen(grid, colours, 'glass');
  if (lenses.faces) {
    const mesh = new THREE.Mesh(glassGeometry(lenses), glass);
    mesh.name = 'citizen-glass';
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  const cape = options.noCape ? null : capeObject(look, options.dim);
  if (cape) group.add(cape);
  return group;
}

export function disposeCitizen(citizen: THREE.Object3D): void {
  const cape = citizen.getObjectByName('citizen-cape');
  if (cape) { cape.removeFromParent(); disposeCape(cape); }
  citizen.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
}

const colour = (hex: `#${string}`) => new THREE.Color().setRGB(...rgb(hex), THREE.SRGBColorSpace);

function gradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, PORTRAIT.gradient.from);
  g.addColorStop(.5, PORTRAIT.gradient.mid);
  g.addColorStop(1, PORTRAIT.gradient.to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The highest a silhouette may reach in the frame (normalised device y). */
const HEADROOM = .84;
/** How far the frame may rise for a tall hat before it widens instead, in cells. */
const MAX_LIFT = 2.4;

/**
 * Every portrait uses the same framing, except that a tall silhouette (a pompom, a pointed hat, a top knot under
 * a beanie) never touches the top edge: the frame first rises with it, losing a little chest, and only past
 * `MAX_LIFT` widens. Short silhouettes keep the bust framing exactly.
 */
function frameSubject(camera: THREE.PerspectiveCamera, subject: THREE.Object3D): void {
  const { target, fovDegrees, halfHeight } = PORTRAIT.camera;
  const eye = new THREE.Vector3(...portraitEye()), aim = new THREE.Vector3(...target);
  const points: THREE.Vector3[] = [];
  subject.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const position = (o.geometry as THREE.BufferGeometry).getAttribute('position');
    for (let i = 0; i < position.count; i++) if (position.getY(i) > target[1]) points.push(new THREE.Vector3().fromBufferAttribute(position, i));
  });
  const top = () => {
    camera.updateMatrixWorld(true);
    let max = -Infinity;
    for (const p of points) max = Math.max(max, p.clone().project(camera).y);
    return max;
  };
  const place = (lift: number, fov: number) => {
    camera.fov = fov;
    camera.position.copy(eye).add(new THREE.Vector3(0, lift, 0));
    camera.lookAt(aim.clone().add(new THREE.Vector3(0, lift, 0)));
    camera.updateProjectionMatrix();
  };
  let lift = 0, fov = fovDegrees;
  place(lift, fov);
  for (let i = 0; i < 4; i++) {
    const over = top() - HEADROOM;
    if (over <= 0) break;
    if (lift < MAX_LIFT) lift = Math.min(MAX_LIFT, lift + over * halfHeight * 1.05);
    else fov *= 1 + over * .55;
    place(lift, fov);
  }
}

/**
 * What a picture shows. `bust` is the portrait (spec L6), the same everywhere: card, passport, builder. `figure`
 * is the whole citizen, for clothes and shoes; `back` the whole citizen from behind, for capes; `chest` the face
 * and chest close, for pins, ribbons and scarves; `nape` the shoulders from behind, for the hood; `face` the face
 * close, for eyes, freckles and glasses; `lower` the hips down, for bottoms and shoes.
 */
export type PortraitView = 'bust' | 'figure' | 'back' | 'chest' | 'nape' | 'face' | 'lower';

export interface PortraitOptions {
  readonly view?: PortraitView | undefined;
  readonly dim?: boolean | undefined;
  /** Draw over a transparent background instead of the purple gradient (builder tiles on parchment). */
  readonly transparent?: boolean | undefined;
}

export interface PortraitRenderer {
  /** A new canvas of `size` × `size` with the look's bust portrait (or another view). */
  render(look: CitizenLook, size: number, options?: PortraitOptions): HTMLCanvasElement;
  /** The same picture as PNG bytes, for a host that stores or uploads it (the card, the passport). */
  renderBlob(look: CitizenLook, size: number, options?: PortraitOptions): Promise<Blob>;
  dispose(): void;
}

/** The whole-figure views: yaw from the person's front, toward their right; target and half height in cells. */
const FIGURE_VIEWS = {
  figure: { yaw: 24, pitch: 12, target: [0, 13.4, 0], halfHeight: 15.2 },
  back: { yaw: 180 - 34, pitch: 12, target: [0, 12, 0], halfHeight: 12.6 },
  chest: { yaw: 22, pitch: 8, target: [0, 15.2, 0], halfHeight: 7.4 },
  nape: { yaw: 180 - 38, pitch: 18, target: [0, 16.4, 0], halfHeight: 8.6 },
  face: { yaw: 18, pitch: 6, target: [0, 19.4, 0], halfHeight: 5.6 },
  lower: { yaw: 26, pitch: 14, target: [0, 7.6, 0], halfHeight: 8.8 },
} as const;

function placeFigure(camera: THREE.PerspectiveCamera, view: keyof typeof FIGURE_VIEWS): void {
  const v = FIGURE_VIEWS[view], fov = PORTRAIT.camera.fovDegrees;
  const yaw = v.yaw * Math.PI / 180, pitch = v.pitch * Math.PI / 180;
  const distance = v.halfHeight / Math.tan(fov * Math.PI / 360);
  camera.fov = fov;
  camera.position.set(-Math.sin(yaw) * Math.cos(pitch) * distance, v.target[1] + Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance);
  camera.lookAt(v.target[0], v.target[1], v.target[2]);
  camera.updateProjectionMatrix();
}

export function createPortraitRenderer(): PortraitRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  const background = gradientTexture();
  scene.background = background;
  const { light, camera: frame } = PORTRAIT;
  const camera = new THREE.PerspectiveCamera(frame.fovDegrees, 1, 1, 200);
  camera.position.set(...portraitEye());
  camera.lookAt(...frame.target);

  const sky = new THREE.HemisphereLight(colour(light.sky.colour), colour(light.sky.ground), light.sky.intensity);
  const key = new THREE.DirectionalLight(colour(light.key.colour), light.key.intensity);
  const keyDir = new THREE.Vector3(...light.key.direction).normalize();
  key.position.copy(keyDir.clone().multiplyScalar(40).add(new THREE.Vector3(...frame.target)));
  key.target.position.set(...frame.target);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 90 });
  key.shadow.bias = -.0004;
  key.shadow.normalBias = .04;
  key.shadow.radius = 3;
  const rim = new THREE.DirectionalLight(colour(light.rim.colour), light.rim.intensity);
  rim.position.copy(new THREE.Vector3(...light.rim.direction).normalize().multiplyScalar(40).add(new THREE.Vector3(...frame.target)));
  rim.target.position.set(...frame.target);
  scene.add(sky, key, key.target, rim, rim.target);
  const material = citizenMaterial(), glass = citizenGlassMaterial();

  const render = (look: CitizenLook, size: number, options: PortraitOptions = {}) => {
      const inner = size * PORTRAIT.supersample;
      renderer.setSize(inner, inner, false);
      const view = options.view ?? 'bust';
      const subject = citizenObject(look, { dim: options.dim }, material, glass);
      if (view === 'bust') frameSubject(camera, subject);
      else placeFigure(camera, view);
      scene.background = options.transparent ? null : background;
      renderer.setClearColor(0x000000, 0);
      scene.add(subject);
      renderer.render(scene, camera);
      scene.remove(subject);
      disposeCitizen(subject);
      const out = document.createElement('canvas');
      out.width = out.height = size;
      const ctx = out.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(renderer.domElement, 0, 0, size, size);
      return out;
  };
  return {
    render,
    renderBlob(look, size, options) {
      const canvas = render(look, size, options);
      return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The portrait could not be encoded.'))), 'image/png'));
    },
    dispose() {
      material.dispose();
      glass.dispose();
      background.dispose();
      renderer.dispose();
    },
  };
}
