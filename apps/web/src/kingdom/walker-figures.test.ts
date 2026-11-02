import * as THREE from 'three';
import { expect, it } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial } from '@chatdom/render';
import { createWalkerFigures, FIGURE_ATTRIBUTE_SLOTS, FIGURE_VERTEX, createWalkerSplit, createWalkerViewTest, FIGURE_HEAD_TOP_M, FIGURE_VARYINGS, nearestWalkers, walkerFigureGeometry, WALKER_DETAIL_BLEND_MS } from './walker-figures';

const walker = (id: string, z: number, self = false) => ({ id, x: 0, y: 0, z, ...(self ? { self } : {}) });
const eye = { x: 0, y: 1.6, z: 0 };

it('splits the nearest 64 walkers into full detail and keeps you in full however far the camera is', () => {
  const crowd = Array.from({ length: 100 }, (_, i) => walker(`w${String(i).padStart(3, '0')}`, 1 + i));
  const { full, simple } = nearestWalkers([...crowd].reverse(), eye);
  expect(full.map(pose => pose.id)).toEqual(crowd.slice(0, 64).map(pose => pose.id));
  expect(simple).toHaveLength(36);
  const me = walker('me', 500, true);
  expect(nearestWalkers([...crowd, me], eye).full[0]).toBe(me);
  expect(nearestWalkers([...crowd, { ...walker('lost', 0), x: NaN }], eye).simple.some(pose => pose.id === 'lost')).toBe(false);
});

it('gives full detail to the people in view first, so a high camera never draws the crowd in front of you as figures', () => {
  // The crowd still's camera: 11 m behind and 9 m above the walker, looking down the street, over 160 people 2 to
  // 16 m around the walker; the nearest to the camera stand behind and below it, out of view.
  const camera = new THREE.PerspectiveCamera(55, 1440 / 900, .1, 500);
  camera.position.set(0, 9, -11); camera.lookAt(0, 1, 14); camera.updateMatrixWorld();
  const ring = Array.from({ length: 160 }, (_, i) => {
    const angle = i * 2.399963, radius = 2 + 14 * Math.sqrt((i + .5) / 160);
    return { id: `c${String(i).padStart(3, '0')}`, x: Math.sin(angle) * radius, y: 0, z: Math.cos(angle) * radius };
  });
  const from = { x: 0, y: 9, z: -11 }, inView = createWalkerViewTest(0)(camera);
  const distance = (pose: { x: number; y: number; z: number }) => Math.hypot(pose.x - from.x, pose.y - from.y, pose.z - from.z);
  const seen = ring.filter(inView).sort((a, b) => distance(a) - distance(b));
  expect(seen.length).toBeGreaterThan(64);
  // By distance alone, people out of view take full detail while people in view nearer the walker do not.
  const plain = nearestWalkers(ring, from).full;
  expect(plain.filter(pose => !inView(pose)).length).toBeGreaterThan(10);
  // In view first: the 64 are the nearest people in the picture.
  const { full } = nearestWalkers(ring, from, 64, new Set(), inView);
  expect(full.map(pose => pose.id)).toEqual(seen.slice(0, 64).map(pose => pose.id));
  // With fewer people in view than the budget, the nearest out of view fill the rest.
  const few = [...seen.slice(0, 20), ...ring.filter(pose => !inView(pose))];
  const filled = nearestWalkers(few, from, 64, new Set(), inView).full;
  expect(filled.slice(0, 20).map(pose => pose.id)).toEqual(seen.slice(0, 20).map(pose => pose.id));
  const outside = ring.filter(pose => !inView(pose)).sort((a, b) => distance(a) - distance(b));
  expect(filled.slice(20).map(pose => pose.id)).toEqual(outside.slice(0, 44).map(pose => pose.id));
  // The margin counts people just past the edge of the picture as in view, ready for a turn.
  expect(ring.filter(createWalkerViewTest()(camera)).length).toBeGreaterThan(seen.length);
});

it('never flickers a walker at the 64th place between full and simple', () => {
  const split = createWalkerSplit();
  const crowd = Array.from({ length: 63 }, (_, i) => walker(`a${String(i).padStart(2, '0')}`, 1 + i * .2));
  // Two walkers at the boundary trade places by a few centimetres every frame.
  const levels: string[] = [];
  for (let frame = 0; frame < 120; frame++) {
    const wobble = frame % 2 ? .05 : -.05;
    const { full } = split.split([...crowd, walker('edge-1', 20 + wobble), walker('edge-2', 20 - wobble)], eye, frame * 16);
    levels.push(full.filter(item => item.opacity === 1).map(item => item.pose.id).filter(id => id.startsWith('edge')).join());
  }
  expect(new Set(levels.slice(1)).size).toBe(1);
  // A walker who is clearly nearer does take the place, with a crossfade rather than a swap.
  const later = split.split([...crowd, walker('edge-1', 20), walker('edge-2', 20), walker('close', 2)], eye, 120 * 16);
  const leaving = [...later.full, ...later.simple].filter(item => item.pose.id === levels[1]);
  expect(leaving).toHaveLength(2);
  expect(leaving[0]!.opacity + leaving[1]!.opacity).toBeCloseTo(1, 9);
  let settled = later;
  for (let t = 1; t * 16 <= WALKER_DETAIL_BLEND_MS + 32; t++) settled = split.split([...crowd, walker('edge-1', 20), walker('edge-2', 20), walker('close', 2)], eye, (120 + t) * 16);
  expect(settled.full).toHaveLength(64);
  expect(settled.full.some(item => item.pose.id === 'close')).toBe(true);
  expect(settled.simple.map(item => item.pose.id).sort()).toEqual(['edge-1', 'edge-2']);
});

it('draws every simple figure in one instanced draw, feet on the datum, easing in and out', () => {
  const scene = new THREE.Scene(), lighting = createVoxelMaterial(MATERIALS, 'avatar');
  const figures = createWalkerFigures(scene, lighting, 16);
  try {
    const meshes = () => scene.children.filter(child => child instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    expect(meshes()).toHaveLength(1);
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, position: [i, 3, 0] as const, heading: 0, distance: i, speed: 1.2 }));
    figures.update(many, 0);
    expect(figures.count).toBe(0);
    figures.update(many, 60);
    // Grown past its first capacity, still a single mesh.
    expect(meshes()).toHaveLength(1);
    expect(figures.count).toBe(40);
    const fade = () => meshes()[0]!.geometry.getAttribute('aGait');
    expect(fade().getZ(0)).toBeGreaterThan(0); expect(fade().getZ(0)).toBeLessThan(1);
    figures.update(many, 200);
    expect(fade().getZ(0)).toBe(1);
    const matrix = new THREE.Matrix4(); meshes()[0]!.getMatrixAt(5, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([5, 3, 0]);
    expect(figures.heads.get('f5')!.y).toBeCloseTo(3 + FIGURE_HEAD_TOP_M + .08, 9);
    // Leaving figures fade out rather than vanish.
    figures.update([], 216);
    expect(figures.count).toBe(40);
    for (let t = 300; t <= 700; t += 100) figures.update([], t);
    expect(figures.count).toBe(0);
    // Each person keeps one muted tunic.
    figures.update(many.slice(0, 2), 800); figures.update(many.slice(0, 2), 900);
    const tint = meshes()[0]!.geometry.getAttribute('aTint');
    const first = [tint.getX(0), tint.getY(0), tint.getZ(0)];
    figures.update(many.slice(0, 2), 1000);
    expect([tint.getX(0), tint.getY(0), tint.getZ(0)]).toEqual(first);
    expect(Math.max(...first)).toBeLessThan(.6);
  } finally { figures.dispose(); lighting.dispose(); }
});

it('stands on its soles and feeds every input the kingdom paint shader reads', () => {
  const geometry = walkerFigureGeometry();
  geometry.computeBoundingBox();
  expect(geometry.boundingBox!.min.y).toBe(0);
  expect(geometry.boundingBox!.max.y).toBeCloseTo(FIGURE_HEAD_TOP_M, 6);
  for (const name of ['position', 'normal', 'aPaint', 'aFaceUv', 'aTangentU', 'aTangentV', 'aMask']) expect(geometry.getAttribute(name)).toBeDefined();
  const lighting = createVoxelMaterial(MATERIALS, 'avatar'), scene = new THREE.Scene();
  const figures = createWalkerFigures(scene, lighting);
  const material = (scene.children[0] as THREE.InstancedMesh).material as THREE.ShaderMaterial;
  for (const name of FIGURE_VARYINGS) expect(material.vertexShader).toMatch(new RegExp(`out [^;]*\\b${name}\\b`));
  figures.dispose(); lighting.dispose(); geometry.dispose();
});

it('draws seated walkers in full however far they are, since a simple figure cannot sit', async () => {
  const { nearestWalkers } = await import('./walker-figures');
  const poses = Array.from({ length: 6 }, (_, i) => ({ id: `w${i}`, x: i, y: 0, z: 0 }));
  const seated = { id: 'fire', x: 90, y: 0, z: 0, posture: 'seated' };
  const { full, simple } = nearestWalkers([...poses, seated], { x: 0, y: 0, z: 0 }, 3);
  expect(full.map(pose => pose.id)).toEqual(['fire', 'w0', 'w1']);
  expect(simple.map(pose => pose.id)).not.toContain('fire');
});

it('fits the 16 vertex attribute slots desktop GPUs offer, so the shader links and the kingdom keeps drawing', () => {
  // Every `in` the figure stage declares, plus what three.js adds for an instanced mesh: position, normal and the
  // instance matrix (a mat4, four slots). Over budget the program fails to link and the scene stops on its first figure.
  const declared = [...FIGURE_VERTEX.matchAll(/\bin\s+(vec[234]|float|mat4)\s+([^;]+);/g)]
    .flatMap(([, type, names]) => names!.split(',').map(() => type === 'mat4' ? 4 : 1));
  const slots = declared.reduce((sum, n) => sum + n, 0) + 1 + 1 + 4;
  expect(slots).toBeLessThanOrEqual(FIGURE_ATTRIBUTE_SLOTS);
  const lighting = createVoxelMaterial(MATERIALS, 'avatar'), scene = new THREE.Scene();
  const figures = createWalkerFigures(scene, lighting);
  const mesh = scene.children[0] as THREE.InstancedMesh;
  const used = Object.values(mesh.geometry.attributes).length + 4;
  expect(used).toBeLessThanOrEqual(FIGURE_ATTRIBUTE_SLOTS);
  // Every attribute the stage reads is fed by the geometry (three.js supplies the instance matrix itself).
  for (const [, , names] of FIGURE_VERTEX.matchAll(/\bin\s+(vec[234]|float)\s+([^;]+);/g)) for (const name of names!.split(',').map(n => n.trim())) {
    expect(mesh.geometry.getAttribute(name), name).toBeDefined();
  }
  figures.dispose(); lighting.dispose();
});
