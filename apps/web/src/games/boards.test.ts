import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { DiceView, GatherFrame, PongView } from '@chatdom/shared';
import { createTavernKit } from '../../../../packages/content/src/tavern';
import { createPongHighlights, createTurnBoards, DICE_PEG_LANES, dicePegs, dicePotSpot } from './boards';

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

  it('shows Hearth Dice as pegs for banked points, chips for the pot and a cap on whose turn it is, all inside the tray', () => {
    const root = new THREE.Group(), table = createTavernKit('hearth').tables.find(t => t.id === 'hearth')!;
    const board = createTurnBoards(root, [table]);
    const boxes = root.getObjectByName('tavern:turn-board-wood-and-dice') as THREE.InstancedMesh;
    const counters = root.getObjectByName('tavern:turn-board-stones') as THREE.InstancedMesh;
    const empty = boxes.count;
    expect(counters.count).toBe(0);
    const dice = (view: Partial<DiceView>): GatherFrame => ({ at: 1, tables: [{ table: 'hearth', revision: 1, seats: ['A', 'B'], pong: null,
      dice: { match: 'm', phase: 'playing', revision: 4, scores: [0, 0, 0], active: [true, true, true], turn: 1, pot: 0,
        die: null, deadline: 0, winner: null, reason: null, last: null, ...view } }] });
    board.frame(dice({ scores: [12, 50, 4], pot: 13, die: 5 }), 1);
    // Ten holes per lane are always there; 12 points is two pegs, 50 is the full ten, 4 is none yet.
    const pegs = 2 + 10, die = 1 + 5;
    expect(boxes.count).toBe(empty + pegs + die);
    expect(counters.count).toBe(13 + 1);
    const [x, y, z] = table.centre, inside = (p: number[]) => {
      expect(Math.abs(p[0]! - x)).toBeLessThan(.47); expect(Math.abs(p[2]! - z)).toBeLessThan(.305); expect(p[1]! - y).toBeGreaterThan(.06);
    };
    for (let i = empty - 40; i < boxes.count; i++) inside(instance(boxes, i).position);
    for (let i = 0; i < counters.count; i++) inside(instance(counters, i).position);
    // The turn cap is brass and sits at the near end of the second player's lane.
    const cap = instance(counters, 0);
    close([cap.position[0]!], [x + DICE_PEG_LANES[1]]);
    expect(dicePegs(49)).toBe(9); expect(dicePegs(75)).toBe(10); expect(dicePegs(-1)).toBe(0);
    // Thirteen is two striped stacks of five and three loose chips, none on another, and no two stacks or loose
    // chips line up along either axis a seated player looks down.
    const chips = Array.from({ length: 13 }, (_, i) => instance(counters, 1 + i).position);
    const loose = chips.filter(p => Math.abs(p[1]! - (y + .069)) < 1e-6 && !chips.some(q => q !== p && q[0] === p[0] && q[2] === p[2]));
    expect(loose).toHaveLength(3);
    const columns = [...new Map(chips.filter(p => !loose.includes(p)).map(p => [`${p[0]}:${p[2]}`, p])).values()];
    expect(columns).toHaveLength(2);
    for (const group of [loose, columns]) for (const a of group) for (const b of group) if (a !== b) {
      expect(Math.abs(a[0]! - b[0]!)).toBeGreaterThan(.03); expect(Math.abs(a[2]! - b[2]!)).toBeGreaterThan(.03);
    }
    // Every spot the pot can use, all eight stacks and four loose chips, stays clear of the cup, the die and the rails.
    for (const [row, slot] of [[0, 0], [0, 3], [1, 0], [1, 2], [3, 0], [3, 2]] as const) {
      const [px, pz] = dicePotSpot(row, slot);
      expect(Math.abs(px) + .023).toBeLessThan(.47); expect(Math.abs(pz) + .023).toBeLessThan(.305);
      expect(px + .023 < -.06 || pz - .023 > .06 || pz + .023 < -.1, `die ${row}:${slot}`).toBe(true);
      expect(pz + .023 < .035, `cup ${row}:${slot}`).toBe(true);
    }
    // A one sweeps the pot away; a finished match keeps the pegs and drops the turn cap.
    board.frame(dice({ scores: [12, 50, 4], pot: 0, die: 1, last: 'bust', revision: 5 }), 2);
    expect(counters.count).toBe(1);
    board.frame(dice({ scores: [12, 52, 4], phase: 'finished', winner: 1, reason: 'fifty', revision: 6 }), 3);
    expect(counters.count).toBe(0);
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
