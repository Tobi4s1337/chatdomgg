import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { meshCost, voxels } from '../../../places/water/piece-checks';
import { MAT, STYLES } from '../../../materials';
import { BUILDING_BUDGET, aggmanPieceFailures } from '../checks';
import { AGGMAN_LIVERY, type Livery } from '../piece';
import { SIGN_DEVICE } from './dress';
import { HARBOUR_INN_FRONT, INN, INN_SIZE, createHarbourInn } from './inn';

const inn = createHarbourInn(AGGMAN_LIVERY);
const { at, size } = voxels(inn.blueprint);
const door = HARBOUR_INN_FRONT.door;

describe('The Wren and Willow, the harbour inn', () => {
  it('meets the shared piece bar for a building', () => {
    expect(aggmanPieceFailures(inn, BUILDING_BUDGET)).toEqual([]);
    expect(inn.blueprint.boxes.length).toBeLessThanOrEqual(4000);
    expect(meshCost(inn.blueprint).triangles).toBeLessThanOrEqual(250_000);
  });

  it('is a strict, deterministic Tide civic blueprint inside the host pad', () => {
    const b = inn.blueprint;
    expect(VoxelBlueprintSchema.parse(b)).toBeTruthy();
    expect(b).toMatchObject({ id: 'genesis-aggman-harbour-inn', version: 1, lattice: 'build', styleId: STYLES.tide.id, kind: 'civic' });
    expect(b.size).toEqual([...INN_SIZE]);
    // The host pad is 14.5 m × 11.5 m: 116 × 92 build cells, front to the quay.
    expect(b.size[0]).toBeLessThanOrEqual(116);
    expect(b.size[2]).toBeLessThanOrEqual(92);
    expect(b.size.every(n => n <= 256)).toBe(true);
    expect(JSON.stringify(createHarbourInn(AGGMAN_LIVERY))).toBe(JSON.stringify(inn));
  });

  it('declares the exact ground footprint', () => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) if (at(x, 0, z)) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); z0 = Math.min(z0, z); z1 = Math.max(z1, z + 1);
    }
    expect(inn.footprint).toEqual({ from: [x0, z0], to: [x1, z1] });
  });

  it('stands the ridge at ten to eleven metres', () => {
    let ridge = 0;
    for (let y = 0; y < size[1]; y++) if (at(70, y, 47)) ridge = y + 1;
    expect(ridge * 0.125).toBeGreaterThanOrEqual(10);
    expect(ridge * 0.125).toBeLessThanOrEqual(11);
  });

  it('keeps the door a clear 10 × 20 opening on a supported threshold, with a room behind it', () => {
    const { from, to } = door.opening;
    expect(to[0] - from[0]).toBe(10);
    expect(to[1] - from[1]).toBe(20);
    for (let x = from[0]; x < to[0]; x++) {
      for (let z = from[2]; z < to[2]; z++) {
        for (let y = from[1]; y < to[1]; y++) expect(at(x, y, z), `door ${x},${y},${z}`).toBe(0);
        expect(at(x, door.threshold - 1, z), `threshold ${x},${z}`).not.toBe(0);
      }
      // The vestibule: open floor and full headroom behind the door, on boards at the same level.
      for (let z = 70; z < from[2]; z++) {
        expect(at(x, door.threshold - 1, z), `floor ${x},${z}`).not.toBe(0);
        for (let y = door.threshold; y < to[1]; y++) expect(at(x, y, z), `vestibule ${x},${y},${z}`).toBe(0);
      }
      // The step down: slate one cell high, then the ground.
      expect(at(x, 0, to[2])).not.toBe(0);
      expect(at(x, 1, to[2])).toBe(0);
    }
    const [ax, ay, az] = door.approach;
    expect(at(ax, ay, az)).toBe(0);
    expect(at(ax, ay + 1, az)).toBe(0);
  });

  it('puts every window on glass with two cells of open air outward', () => {
    const windows = inn.blueprint.windows;
    expect(new Set(windows.map(w => w.id)).size).toBe(windows.length);
    expect(windows.length).toBeGreaterThanOrEqual(20);
    for (const w of windows) {
      const along = w.facing === 'north' || w.facing === 'south' ? 0 : 2, normal = along === 0 ? 2 : 0;
      const out = w.facing === 'south' || w.facing === 'east' ? 1 : -1;
      const glassAt = w.centre[normal] - (out > 0 ? 1 : 0), firstOut = w.centre[normal] + (out > 0 ? 0 : -1);
      let glass = 0, total = 0;
      for (let y = w.centre[1] - w.height / 2; y < w.centre[1] + w.height / 2; y++) {
        for (let u = w.centre[along] - w.width / 2; u < w.centre[along] + w.width / 2; u++) {
          const cell: [number, number, number] = [0, y, 0];
          cell[along] = u; cell[normal] = glassAt; total++;
          if (at(...cell) === MAT.glass) glass++;
          for (let n = 0; n < 2; n++) {
            cell[normal] = firstOut + out * n;
            expect(at(...cell), `${w.id} outward ${cell}`).toBe(0);
          }
        }
      }
      expect(glass / total, `${w.id} glass share`).toBeGreaterThan(0.6);
    }
  });

  it('lights its three lanterns from glass', () => {
    expect(inn.lanterns).toHaveLength(3);
    for (const cell of inn.lanterns) expect(at(...(cell as [number, number, number]))).toBe(MAT.glass);
  });

  it('paints the device on both faces of the sign inside its frame', () => {
    const { centre, width, height } = HARBOUR_INN_FRONT.signFace;
    const [cx, cy, plane] = centre;
    const x0 = cx - width / 2, y0 = cy - height / 2;
    const paint: Record<string, number> = { '.': AGGMAN_LIVERY.blue, b: MAT.bark, t: STYLES.tide.trim, c: MAT.cream, s: MAT.bark, l: MAT.moss, g: MAT.grass };
    SIGN_DEVICE.forEach((row, i) => {
      for (let c = 0; c < width; c++) {
        expect(at(x0 + c, y0 + height - 1 - i, plane - 1), `front ${c},${i}`).toBe(paint[row[c]!]);
        expect(at(x0 + width - 1 - c, y0 + height - 1 - i, plane - 4), `back ${c},${i}`).toBe(paint[row[c]!]);
      }
    });
    // Open air in front of the painted face.
    for (let x = x0; x < x0 + width; x++) for (let y = y0; y < y0 + height; y++) expect(at(x, y, plane)).toBe(0);
    // A red margin and a gold border round the field.
    expect(at(x0 - 1, cy, plane - 1)).toBe(AGGMAN_LIVERY.red);
    expect(at(x0 - 2, cy, plane - 1)).toBe(AGGMAN_LIVERY.gold);
  });

  it('dresses its livery parts from the livery argument', () => {
    const swapped: Livery = { ...AGGMAN_LIVERY, red: AGGMAN_LIVERY.blue, blue: AGGMAN_LIVERY.red, gold: MAT.fabricOrange, brass: MAT.goldLeaf };
    const other = voxels(createHarbourInn(swapped).blueprint).at;
    const leaf: [number, number, number] = [50, 12, 70], shutter: [number, number, number] = [14, 40, 70];
    const awning: [number, number, number] = [79, 24, 69], border: [number, number, number] = [45, 32, 88];
    expect(at(...leaf)).toBe(AGGMAN_LIVERY.blue);
    expect(other(...leaf)).toBe(swapped.blue);
    expect(at(...shutter)).toBe(AGGMAN_LIVERY.blue);
    expect(other(...shutter)).toBe(swapped.blue);
    expect(at(...awning)).toBe(AGGMAN_LIVERY.red);
    expect(other(...awning)).toBe(swapped.red);
    expect(at(...border)).toBe(AGGMAN_LIVERY.gold);
    expect(other(...border)).toBe(swapped.gold);
    const lanternFoot = inn.lanterns[0]!;
    expect(other(lanternFoot[0], lanternFoot[1] - 3, lanternFoot[2])).toBe(swapped.brass);
  });

  it('builds the storeys the brief describes', () => {
    // Stone ground floor, timber bressumer, cream upper floor on the front of the main range.
    expect(at(10, 12, INN.main.z1 - 1)).not.toBe(STYLES.tide.wall);
    expect([STYLES.tide.stone, MAT.limestone, MAT.darkStone, MAT.air]).toContain(at(36, 12, INN.main.z1 - 1));
    expect(at(60, INN.ground + 1, INN.main.z1 + 2)).toBe(STYLES.tide.trim);
    expect(at(32, 40, INN.upperFace - 1)).toBe(STYLES.tide.wall);
  });
});
