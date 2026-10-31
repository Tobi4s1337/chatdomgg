import * as THREE from 'three';
import type { Environment } from '@chatdom/render';

/*
 * The far side of the night: the Wilds' ridges in violet layers and the kingdom the footpath leads
 * back to, a soft silhouette with its windows lit and its beacon rising. Aerial perspective is
 * authored per layer (nearer is darker and bluer, farther melts into the horizon), so this layer
 * reads as distance at any exposure. Shapes keep the voxel vocabulary: stepped, never smooth curves.
 */

export const KINGDOM_ANGLE = -2.72;
export const KINGDOM_DISTANCE = 175;

const hash = (n: number): number => { const s = Math.sin(n * 91.7 + 17.3) * 43758.5453; return s - Math.floor(s); };

interface Layer { readonly mesh: THREE.Mesh; readonly depth: number; readonly tone: number }

/** A stepped ridge band: columns of `step` metres whose tops follow layered noise. */
function ridge(radius: number, base: number, height: number, step: number, seed: number, skip?: (angle: number) => number): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  const columns = Math.ceil(Math.PI * 2 * radius / step);
  for (let c = 0; c < columns; c++) {
    const a0 = c / columns * Math.PI * 2, a1 = (c + 1) / columns * Math.PI * 2, mid = (a0 + a1) / 2;
    const n = Math.sin(mid * 3 + seed) * .5 + Math.sin(mid * 7.3 + seed * 2) * .3 + Math.sin(mid * 17.1 + seed * 3) * .2;
    let top = base + height * (.45 + .55 * n) + (hash(c + seed * 100) - .5) * step * .6;
    if (skip) top -= skip(mid);
    top = Math.round(top / (step * .5)) * step * .5;
    const v = positions.length / 3;
    for (const [a, y] of [[a0, -8], [a1, -8], [a1, top], [a0, top]] as const) positions.push(Math.sin(a) * radius, y, Math.cos(a) * radius);
    indices.push(v, v + 2, v + 1, v, v + 3, v + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

const angularDistance = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export interface DistantLand {
  readonly group: THREE.Group;
  /** Where the beacon rises from, for the shared atmosphere. */
  readonly beacon: THREE.Vector3;
  setEnvironment(environment: Environment): void;
  dispose(): void;
}

export function createDistantLand(): DistantLand {
  const group = new THREE.Group();
  group.name = 'campfire.distance';
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const layers: Layer[] = [];
  const material = (): THREE.MeshBasicMaterial => { const m = new THREE.MeshBasicMaterial({ fog: false, side: THREE.DoubleSide }); materials.push(m); return m; };
  // The kingdom sits in a low saddle of the ridges so it reads against the sky.
  const saddle = (amount: number) => (angle: number) => amount * Math.max(0, 1 - angularDistance(angle, KINGDOM_ANGLE) / .5) ** 1.5;
  for (const [i, spec] of [
    { radius: 330, base: 18, height: 30, step: 9, seed: 4.1, saddle: 18, depth: 1, tone: .86 },
    { radius: 240, base: 9, height: 20, step: 6, seed: 1.7, saddle: 16, depth: .7, tone: .58 },
    { radius: 120, base: 3, height: 11, step: 3, seed: 7.9, saddle: 12, depth: .38, tone: .3 },
  ].entries()) {
    const geometry = ridge(spec.radius, spec.base, spec.height, spec.step, spec.seed, saddle(spec.saddle));
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material());
    mesh.name = `ridge-${i}`;
    mesh.renderOrder = -900 + i;
    group.add(mesh);
    layers.push({ mesh, depth: spec.depth, tone: spec.tone });
  }

  // The kingdom: a keep, towers and roofs on its hill, built from stepped boxes.
  const town = new THREE.Group();
  const centre = new THREE.Vector3(Math.sin(KINGDOM_ANGLE) * KINGDOM_DISTANCE, -3, Math.cos(KINGDOM_ANGLE) * KINGDOM_DISTANCE);
  town.position.copy(centre);
  town.lookAt(0, -3, 0);
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, .5, 0);
  geometries.push(box);
  const shapes: { x: number; z: number; w: number; d: number; h: number; roof: number }[] = [
    { x: 0, z: 0, w: 14, d: 12, h: 24, roof: 7 }, { x: -11, z: 2, w: 6, d: 6, h: 31, roof: 8 }, { x: 10, z: -1, w: 5.5, d: 5.5, h: 27, roof: 7 },
    { x: -4, z: -6, w: 4, d: 4, h: 36, roof: 9 }, { x: 18, z: 4, w: 22, d: 5, h: 10, roof: 0 }, { x: -22, z: 5, w: 20, d: 5, h: 9, roof: 0 },
  ];
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1, spread = 18 + hash(i) * 46;
    shapes.push({ x: side * spread, z: 10 + hash(i + 40) * 26, w: 4 + hash(i + 80) * 5, d: 4 + hash(i + 90) * 4, h: 4 + hash(i + 100) * 6, roof: 3 + hash(i + 110) * 3 });
  }
  const hill = new THREE.Mesh(new THREE.CylinderGeometry(70, 95, 16, 10, 1), material());
  hill.position.y = -9;
  geometries.push(hill.geometry);
  town.add(hill);
  const silhouette = material();
  const blocks = new THREE.InstancedMesh(box, silhouette, shapes.length * 3);
  const matrix = new THREE.Matrix4();
  let n = 0;
  for (const s of shapes) {
    blocks.setMatrixAt(n++, matrix.compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion(), new THREE.Vector3(s.w, s.h, s.d)));
    // Two stepped courses make a steep storybook roof at this distance.
    if (s.roof) {
      blocks.setMatrixAt(n++, matrix.compose(new THREE.Vector3(s.x, s.h, s.z), new THREE.Quaternion(), new THREE.Vector3(s.w * .72, s.roof * .55, s.d * .72)));
      blocks.setMatrixAt(n++, matrix.compose(new THREE.Vector3(s.x, s.h + s.roof * .55, s.z), new THREE.Quaternion(), new THREE.Vector3(s.w * .34, s.roof * .45, s.d * .34)));
    }
  }
  blocks.count = n;
  town.add(blocks);
  // Lit windows on the faces that look toward the clearing: warm light is people.
  const windowMaterial = new THREE.MeshBasicMaterial({ color: '#ffc77a', fog: false });
  materials.push(windowMaterial);
  const windows = new THREE.InstancedMesh(box, windowMaterial, 140);
  let w = 0;
  for (const [i, s] of shapes.entries()) {
    const rows = Math.max(1, Math.floor(s.h / 4.5)), cols = Math.max(1, Math.floor(s.w / 3.2));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols && w < 140; c++) {
      if (hash(i * 31 + r * 7 + c) > .42) continue;
      const x = s.x - s.w / 2 + (c + .5) * s.w / cols, y = 1.4 + r * 4.2;
      windows.setMatrixAt(w++, matrix.compose(new THREE.Vector3(x, y, s.z + s.d / 2 + .05), new THREE.Quaternion(), new THREE.Vector3(1.1, 1.5, .1)));
    }
  }
  windows.count = w;
  town.add(windows);
  group.add(town);
  const beacon = new THREE.Vector3(-4, 36 + 9, -6).applyMatrix4(town.matrix.compose(town.position, town.quaternion, town.scale));
  const tint = new THREE.Color(), sky = new THREE.Color(), fog = new THREE.Color(), night = new THREE.Color('#1c1d3d');
  return {
    group, beacon,
    setEnvironment(environment) {
      sky.set(environment.horizon); fog.set(environment.fog);
      for (const layer of layers) {
        // Far layers melt into the horizon; the nearest is a deep Wilds violet.
        tint.copy(night).lerp(new THREE.Color('#3a2f5c'), .55).lerp(sky, layer.tone * .62).lerp(fog, layer.tone * .18);
        (layer.mesh.material as THREE.MeshBasicMaterial).color.copy(tint);
      }
      silhouette.color.copy(night).lerp(sky, .5).lerp(fog, .12);
      (hill.material as THREE.MeshBasicMaterial).color.copy(night).lerp(sky, .44);
    },
    dispose() { for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); blocks.dispose(); windows.dispose(); group.removeFromParent(); },
  };
}
