import { describe, expect, it } from 'vitest';
import type { WindowHouse } from '@chatdom/render';
import type { VoxelBlueprint } from '@chatdom/shared';
import { paintedWindows, paintingView } from './windows';

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
