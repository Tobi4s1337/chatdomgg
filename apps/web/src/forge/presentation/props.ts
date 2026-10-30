import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Part = { geometry: THREE.BufferGeometry; colour: string; glow?: boolean };

/**
 * One owned, vertex-coloured geometry from simple toy blocks. A fixed warm key light is baked into the colours,
 * as the kingdom's custom voxel lighting does not light ordinary meshes; glowing parts stay unshaded.
 */
function toy(parts: Part[]): THREE.BufferGeometry {
  const colour = new THREE.Color(), baked: THREE.BufferGeometry[] = [];
  for (const { geometry, colour: hex, glow } of parts) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.deleteAttribute('uv');
    const normals = g.getAttribute('normal'), colours = new Float32Array(normals.count * 3);
    colour.set(hex);
    for (let i = 0; i < normals.count; i++) {
      const shade = glow ? 1 : .6 + .3 * Math.max(0, normals.getY(i)) + .1 * Math.max(0, normals.getX(i)) + .04 * Math.max(0, normals.getZ(i));
      colours.set([colour.r * shade, colour.g * shade, colour.b * shade], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    baked.push(g);
  }
  const merged = mergeGeometries(baked);
  baked.forEach(g => g.dispose());
  if (!merged) throw new Error('The Forge props could not be assembled.');
  return merged;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => at(new THREE.BoxGeometry(w, h, d), x, y, z);

function toyMaterial(name: string) {
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true });
  material.name = name;
  return material;
}

export const CRUCIBLE = { radius: .26, height: .4, tilt: 1.15 } as const;

/**
 * A small iron crucible with a brass rim and bail. Its pouring lip is the local origin, so tilting it about
 * +z tips the mouth toward -x while the stream keeps falling from the same point.
 */
export function createCrucible() {
  const { radius: r, height: h } = CRUCIBLE, cx = r * 1.05;
  const bail = new THREE.TorusGeometry(r * 1.18, .016, 4, 14, Math.PI);
  bail.rotateX(Math.PI / 2); bail.rotateZ(Math.PI / 2); bail.rotateY(Math.PI / 2);
  const geometry = toy([
    { geometry: at(new THREE.CylinderGeometry(r * 1.02, r * .8, h, 10), cx, -h / 2, 0), colour: '#3d3a37' },
    { geometry: at(new THREE.CylinderGeometry(r * .84, r * .7, .06, 10), cx, -h + .02, 0), colour: '#2a2827' },
    { geometry: at(new THREE.CylinderGeometry(r * 1.12, r * 1.1, .055, 10), cx, -.028, 0), colour: '#b98846' },
    { geometry: at(new THREE.CylinderGeometry(r * 1.06, r * 1.04, .03, 10), cx, -h * .62, 0), colour: '#8f6a39' },
    { geometry: at(new THREE.CylinderGeometry(r * .93, r * .93, .02, 10), cx, -.05, 0), colour: '#ffb24a', glow: true },
    { geometry: box(.12, .04, .12, .02, -.02, 0), colour: '#4a4643' },
    { geometry: box(.06, .08, .06, cx, -h * .32, r * 1.08), colour: '#b98846' },
    { geometry: box(.06, .08, .06, cx, -h * .32, -r * 1.08), colour: '#b98846' },
    { geometry: at(bail, cx, -h * .32, 0), colour: '#5b5650' },
  ]);
  const material = toyMaterial('forge-crucible');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'forge-crucible'; mesh.frustumCulled = false; mesh.renderOrder = .4; mesh.visible = false;
  return { mesh, material, dispose() { geometry.dispose(); material.dispose(); } };
}

export const STREAM_CUBES = 26;

/** The pour: a falling chain of molten cubes, one instanced draw. Matrices and colours are rewritten in place. */
export function createStream() {
  const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  material.name = 'forge-stream';
  const mesh = new THREE.InstancedMesh(geometry, material, STREAM_CUBES);
  mesh.name = 'forge-stream'; mesh.frustumCulled = false; mesh.renderOrder = .45; mesh.visible = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color());
  mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), position = new THREE.Vector3(), euler = new THREE.Euler();
  let used = 0;
  return {
    mesh,
    begin() { used = 0; },
    push(x: number, y: number, z: number, size: number, spin: number, colour: THREE.Color) {
      if (used >= STREAM_CUBES || size <= .002) return;
      quaternion.setFromEuler(euler.set(spin * .7, spin, 0));
      mesh.setMatrixAt(used, matrix.compose(position.set(x, y, z), quaternion, scale.setScalar(size)));
      mesh.setColorAt(used, colour);
      used++;
    },
    end() {
      mesh.count = used; mesh.visible = used > 0;
      if (used > 0) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true; }
    },
    dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}

export const HAMMER = { reach: 1.05, head: .46 } as const;

/**
 * The Forge's hammer, a toy smith's hammer with brass bands and a warm rune on its cheek. The pivot is the local
 * origin and the haft lies along +x; at rotation 0 the head hangs at (reach, 0, 0) with its face pointing down.
 */
export function createHammer() {
  const { reach: L, head: H } = HAMMER;
  const geometry = toy([
    { geometry: box(L * .9, .075, .075, L * .47, 0, 0), colour: '#8a5a33' },
    { geometry: box(.3, .09, .09, .2, 0, 0), colour: '#4b2f22' },
    { geometry: box(.07, .11, .11, .02, 0, 0), colour: '#bb8a48' },
    { geometry: box(.14, .11, .11, L - .2, 0, 0), colour: '#bb8a48' },
    { geometry: box(.27, H, .27, L, 0, 0), colour: '#474b4f' },
    { geometry: box(.25, .03, .25, L, -H / 2 - .012, 0), colour: '#7b8085' },
    { geometry: box(.25, .03, .25, L, H / 2 + .012, 0), colour: '#7b8085' },
    { geometry: box(.29, .055, .29, L, -H * .27, 0), colour: '#bb8a48' },
    { geometry: box(.29, .055, .29, L, H * .27, 0), colour: '#bb8a48' },
    { geometry: box(.06, .09, .02, L, 0, .141), colour: '#ffc46a', glow: true },
    { geometry: box(.06, .09, .02, L, 0, -.141), colour: '#ffc46a', glow: true },
  ]);
  const material = toyMaterial('forge-hammer');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'forge-hammer'; mesh.frustumCulled = false; mesh.renderOrder = .4; mesh.visible = false;
  return { mesh, material, dispose() { geometry.dispose(); material.dispose(); } };
}
