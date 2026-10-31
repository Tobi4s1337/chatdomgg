import * as THREE from 'three';
import {
  PORTRAIT, buildCitizen, meshCitizen, portraitEye, rgb, slotColours, type CitizenLook, type CitizenMesh, type HeadOptions,
} from '../../../../packages/content/src/avatar-style';

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

/** The character as one mesh in avatar cells, root at the origin, facing +Z. */
export function citizenObject(look: CitizenLook, options: HeadOptions = {}, material: THREE.Material = citizenMaterial()): THREE.Mesh {
  const mesh = new THREE.Mesh(citizenGeometry(meshCitizen(buildCitizen(look, options), slotColours(look))), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'citizen';
  return mesh;
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

export interface PortraitRenderer {
  /** A new canvas of `size` × `size` with the look's bust portrait. */
  render(look: CitizenLook, size: number): HTMLCanvasElement;
  dispose(): void;
}

export function createPortraitRenderer(): PortraitRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
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
  const material = citizenMaterial();

  return {
    render(look, size) {
      const inner = size * PORTRAIT.supersample;
      renderer.setSize(inner, inner, false);
      const subject = citizenObject(look, {}, material);
      scene.add(subject);
      renderer.render(scene, camera);
      scene.remove(subject);
      subject.geometry.dispose();
      const out = document.createElement('canvas');
      out.width = out.height = size;
      const ctx = out.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(renderer.domElement, 0, 0, size, size);
      return out;
    },
    dispose() {
      material.dispose();
      background.dispose();
      renderer.dispose();
    },
  };
}
