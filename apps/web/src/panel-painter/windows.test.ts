import { describe, expect, it } from 'vitest';
import type { WindowHouse } from '@chatdom/render';
import type { VoxelBlueprint } from '@chatdom/shared';
import * as THREE from 'three';
import { createSight, paintedWindows, paintingView } from './windows';

const blueprint = (centre: [number, number, number]) => ({ id: 'home', size: [16, 16, 16], boxes: [],
  windows: [{ id: 'front', centre, width: 4, height: 6, facing: 'south' }] }) as unknown as VoxelBlueprint;
const house = (slot: number, position: [number, number, number], centre: [number, number, number] = [0, 0, 0], yaw = 0): WindowHouse =>
  ({ slot, position, yaw, blueprint: blueprint(centre) });
const view = { eye: [0, 0, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 50 };

describe('lit windows in a painting', () => {
  it('places a window straight ahead at the centre of the frame', () => {
    expect(paintedWindows([house(4, [0, 0, 0])], new Set([4]), view, 636, 400)).toEqual([[4, 5000, 5000]]);
  });
  it('uses the first authored pane in build voxels, turned with the house', () => {
    // 16 build voxels to the east is two metres; a quarter turn sends it north (away from this camera's right).
    const [[, east]] = paintedWindows([house(1, [0, 0, 0], [16, 0, 0])], new Set([1]), view, 636, 400) as [[number, number, number]];
    expect(east).toBeGreaterThan(5000);
    const [[, turnedX, turnedY]] = paintedWindows([house(1, [0, 0, 0], [16, 0, 0], Math.PI / 2)], new Set([1]), view, 636, 400) as [[number, number, number]];
    expect(turnedX).toBe(5000); expect(turnedY).toBe(5000);
  });
  it('marks only present windows that are inside the frame and in front of the camera', () => {
    const marks = paintedWindows([house(1, [0, 2, 0]), house(2, [0, -2, 0]), house(3, [40, 0, 0]), house(5, [0, 0, 20])], new Set([1, 3, 5]), view, 636, 400);
    expect(marks.map(([slot]) => slot)).toEqual([1]);
    expect(marks[0]![2]).toBeLessThan(5000);
  });

  it('keeps the renderer’s hero shot while every lit window sits well inside it', () => {
    const houses = [house(1, [0, 1, 0]), house(2, [40, 0, 0])];
    expect(paintingView(view, houses, new Set([1]), 636, 400)).toBe(view);
    expect(paintingView(view, houses, new Set(), 636, 400)).toBe(view);
  });
  it('steps back along the hero’s direction until an edge-of-town window and the castle both fit', () => {
    // Like a newcomer's home at the edge of a hamlet: below and to the side of the hero frame.
    const hero = { eye: [-65, 40, 128] as [number, number, number], target: [0, 29, 2] as [number, number, number], fov: 52 };
    const edge = house(11, [-75, 8, 86]), inner = house(0, [-37, 8, 14]);
    expect(paintedWindows([edge], new Set([11]), hero, 636, 400)).toEqual([]);
    const widened = paintingView(hero, [edge, inner], new Set([11, 0]), 636, 400);
    expect(widened).not.toBe(hero); expect(widened.fov).toBe(52);
    const marks = paintedWindows([edge, inner], new Set([11, 0]), widened, 636, 400);
    expect(marks.map(([slot]) => slot)).toEqual([11, 0]);
    for (const [, x, y] of marks) { expect(Math.abs(x - 5000)).toBeLessThanOrEqual(4100); expect(Math.abs(y - 5000)).toBeLessThanOrEqual(4100); }
    // The castle the hero aimed at stays in the picture.
    const castle = house(65534, hero.target);
    expect(paintedWindows([castle], new Set([65534]), widened, 636, 400)).toHaveLength(1);
    // Same direction: the new eye lies behind the new aim along the hero's own line of sight.
    const along = (v: { eye: readonly number[]; target: readonly number[] }) => { const d = v.eye.map((e, i) => e - v.target[i]!); const n = Math.hypot(...d); return d.map(x => x / n); };
    along(widened).forEach((value, index) => expect(value).toBeCloseTo(along(hero)[index]!, 6));
  });
});

const solidOf = (position: [number, number, number], size: [number, number, number], yaw = 0) => ({ position, yaw,
  blueprint: { id: 'wall', size, boxes: [{ from: [0, 0, 0], to: size, material: 1 }], windows: [] } as unknown as VoxelBlueprint });
// A home whose window sits in a recess inside its own wall, as authored homes do: centre 2 cells inside the front face.
const recessed = (slot: number, position: [number, number, number], yaw = 0): WindowHouse => ({ slot, position, yaw,
  blueprint: { id: 'home', size: [16, 16, 16], boxes: [{ from: [0, 0, 0], to: [16, 16, 16], material: 1 }],
    windows: [{ id: 'front', centre: [8, 8, 14], width: 4, height: 6, facing: 'south' }] } as unknown as VoxelBlueprint });

describe('what the painting can see', () => {
  const flat = () => 0;
  it('marks a window in its own recess, but not one behind a neighbour, a hill or turned away', () => {
    const home = recessed(1, [-1, 0, -1]);
    const eye = { eye: [0, 1, 12] as [number, number, number], target: [0, 1, 0] as [number, number, number], fov: 50 };
    const open = createSight([home], flat);
    expect(paintedWindows([home], new Set([1]), eye, 636, 400, open).map(([slot]) => slot)).toEqual([1]);
    const wall = createSight([home, solidOf([-2, 0, 5], [32, 24, 4])], flat);
    expect(paintedWindows([home], new Set([1]), eye, 636, 400, wall)).toEqual([]);
    const hill = createSight([home], (_x, z) => z > 4 && z < 7 ? 5 : 0);
    expect(paintedWindows([home], new Set([1]), eye, 636, 400, hill)).toEqual([]);
    // The same house turned to face away from the camera: its glass is on the far side.
    expect(paintedWindows([recessed(1, [1, 0, 1], Math.PI)], new Set([1]), eye, 636, 400, open)).toEqual([]);
  });
  it('reads the land once per metre, even for many sightlines', () => {
    let reads = 0;
    const sight = createSight([], () => { reads++; return 0; });
    for (let i = 0; i < 50; i++) expect(sight(new THREE.Vector3(0, 30, 120), new THREE.Vector3(i - 25, 1, 0))).toBe(true);
    const once = reads;
    for (let i = 0; i < 50; i++) sight(new THREE.Vector3(0, 30, 120), new THREE.Vector3(i - 25, 1, 0));
    expect(reads).toBe(once);
  });
  it('turns around the castle to a newcomer whose window faces away from the hero shot', () => {
    // Hero shot as the renderer frames a hamlet: eye south-west of the market, aim 16 m ahead toward the castle.
    const eye = new THREE.Vector3(-65, 40, 128), castle = new THREE.Vector3(0, 32, -60);
    const hero = { eye: eye.toArray() as [number, number, number], target: eye.clone().add(castle.clone().sub(eye).normalize().multiplyScalar(16)).toArray() as [number, number, number], fov: 52 };
    // An edge home turned a quarter, so its glass looks east, edge-on to the hero.
    const edge = recessed(11, [-66.5, 8, 85], Math.PI / 2);
    expect(paintedWindows([edge], new Set([11]), hero, 636, 400, createSight([edge], flat))).toEqual([]);
    const framing = { castle: castle.toArray() as [number, number, number], sight: createSight([edge], flat), ground: flat };
    const view = paintingView(hero, [edge], new Set([11]), 636, 400, framing);
    expect(view).not.toBe(hero);
    expect(paintedWindows([edge], new Set([11]), view, 636, 400, framing.sight).map(([slot]) => slot)).toEqual([11]);
    expect(paintedWindows([recessed(0, [castle.x - 1, castle.y - 8, castle.z - 1])], new Set([0]), view, 636, 400)).toHaveLength(1);
    // Nobody lit, or every lit window already showing: the hero shot stays.
    expect(paintingView(hero, [edge], new Set(), 636, 400, framing)).toBe(hero);
  });
  it('keeps the hero shot when no turn shows more lit glass', () => {
    const eye = new THREE.Vector3(-65, 40, 128), castle = new THREE.Vector3(0, 32, -60);
    const hero = { eye: eye.toArray() as [number, number, number], target: eye.clone().add(castle.clone().sub(eye).normalize().multiplyScalar(16)).toArray() as [number, number, number], fov: 52 };
    const buried = recessed(3, [-40, 0, 40]);
    // A ridge all around the home: no eye can see its glass.
    const ground = (x: number, z: number) => Math.hypot(x + 39, z - 41) > 3 && Math.hypot(x + 39, z - 41) < 6 ? 12 : 0;
    const framing = { castle: castle.toArray() as [number, number, number], sight: createSight([buried], ground), ground };
    expect(paintingView(hero, [buried], new Set([3]), 636, 400, framing)).toBe(hero);
  });
});
