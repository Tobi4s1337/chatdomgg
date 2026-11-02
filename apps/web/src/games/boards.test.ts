import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { GatherFrame, PongView } from '@chatdom/shared';
import { createTavernKit } from '../../../../packages/content/src/tavern';
import { createPongHighlights, createTurnBoards } from './boards';

const pong = (paddles: [number, number]): PongView => ({ match: 'match', phase: 'rally', tick: 1, at: 1,
  serveAt: 0, ball: { x: .2, y: -.3, vx: 1, vy: 1 }, paddles, acknowledged: [0, 0], score: [0, 0],
  winner: null, reason: null });
const frame = (view: PongView): GatherFrame => ({ at: 1, tables: [{ table: 'middle', revision: 1,
  seats: ['A', 'B'], pong: view }] });

function instance(mesh: THREE.InstancedMesh, index: number) {
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), colour = new THREE.Color();
  mesh.getMatrixAt(index, matrix); matrix.decompose(position, rotation, scale); mesh.getColorAt(index, colour);
  return { position: position.toArray(), scale: scale.toArray(), colour };
}
function close(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 5));
}

describe('batched tavern boards', () => {
  it('keeps the physical Pong board and empty paddles in the shared pair of meshes', () => {
    const root = new THREE.Group(), host = new THREE.Object3D(); root.add(host);
    const table = createTavernKit('hearth').tables.find(t => t.id === 'middle')!;
    const board = createTurnBoards(root, [table]);
    const meshes = root.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    expect(meshes).toHaveLength(2);
    const boxes = meshes.find(mesh => mesh.name === 'tavern:turn-board-wood-and-dice')!;
    const stones = meshes.find(mesh => mesh.name === 'tavern:turn-board-stones')!;
    expect(boxes.count).toBe(3); // base and two paddles; no invented ball
    expect(stones.count).toBe(0);
    expect((boxes.material as THREE.MeshStandardMaterial).roughness).toBe(.92);
    const [x, y, z] = table.centre;
    const base = instance(boxes, 0), left = instance(boxes, 1), right = instance(boxes, 2);
    close(base.position, [x, y + .008, z]); close(base.scale, [1.25, .016, .9]);
    close(left.position, [x, y + .046, z - .413]); close(right.position, [x, y + .046, z + .413]);
    close(left.scale, [.2604, .06, .07]); close(right.scale, [.2604, .06, .07]);
    close(base.colour.toArray(), new THREE.Color('#29473f').toArray());
    close(left.colour.toArray(), new THREE.Color('#e6bd7c').toArray());
    close(right.colour.toArray(), new THREE.Color('#e6bd7c').toArray());
    board.dispose();
    expect(root.children).toEqual([host]);
  });

  it('projects raw public paddle values independently and resets on an empty table', () => {
    const root = new THREE.Group(), table = createTavernKit('hearth').tables.find(t => t.id === 'middle')!;
    const board = createTurnBoards(root, [table]);
    const boxes = root.getObjectByName('tavern:turn-board-wood-and-dice') as THREE.InstancedMesh;
    const paddles: [number, number] = [-.8, .35], view = pong(paddles), snapshot = frame(view);
    const before = structuredClone(snapshot);
    board.frame(snapshot, 1);
    expect(snapshot).toEqual(before);
    const [x, y, z] = table.centre;
    close(instance(boxes, 1).position, [x - .8 * .62, y + .046, z - .413]);
    close(instance(boxes, 2).position, [x + .35 * .62, y + .046, z + .413]);
    paddles[0] = .9;
    close(instance(boxes, 1).position, [x - .8 * .62, y + .046, z - .413]);
    board.frame(snapshot, 2);
    close(instance(boxes, 1).position, [x + .9 * .62, y + .046, z - .413]);
    board.frame({ at: 3, tables: [] }, 3);
    close(instance(boxes, 1).position, [x, y + .046, z - .413]);
    close(instance(boxes, 2).position, [x, y + .046, z + .413]);
    expect(boxes.count).toBe(3);
    board.dispose();
  });
});

describe('batched Pong highlights', () => {
  it('shows only an authoritative rally ball alongside the unchanged marks and disposes resources', () => {
    const root = new THREE.Group(), table = createTavernKit('hearth').tables.find(t => t.id === 'middle')!;
    const highlights = createPongHighlights(root, [table]);
    const mesh = root.getObjectByName('tavern:pong-highlights') as THREE.InstancedMesh;
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
    const materialDispose = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    expect(mesh.count).toBe(11);
    const firstMark = instance(mesh, 0), [x, y, z] = table.centre;
    close(firstMark.position, [x - .62, y + .019, z]);
    close(firstMark.scale, [.012, .005, .9]);
    close(firstMark.colour.toArray(), new THREE.Color('#bd955e').toArray());
    highlights.frame(frame(pong([0, 0])));
    expect(mesh.count).toBe(12);
    const ball = instance(mesh, 11);
    close(ball.position, [x + .2 * .62, y + .044, z + .3 * .28]);
    close(ball.scale, [.0558, .0558, .0252]);
    close(ball.colour.toArray(), new THREE.Color('#ffe7b8').toArray());
    expect(mesh.boundingSphere!.radius).toBeGreaterThan(0);
    highlights.frame({ at: 2, tables: [] });
    expect(mesh.count).toBe(11);
    highlights.dispose();
    expect(root.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });
  it('handles a room with no Pong tables', () => {
    const root = new THREE.Group(), highlights = createPongHighlights(root, []);
    const mesh = root.getObjectByName('tavern:pong-highlights') as THREE.InstancedMesh;
    expect(mesh.count).toBe(0);
    expect(mesh.boundingSphere!.isEmpty()).toBe(true);
    highlights.dispose();
  });
});
