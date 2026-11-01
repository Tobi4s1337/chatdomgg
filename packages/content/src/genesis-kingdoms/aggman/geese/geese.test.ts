import { describe, expect, it } from 'vitest';
import { MAT } from '../../../materials';
import { aggmanPieceFailures } from '../checks';
import type { AggmanPiece } from '../piece';
import { BENCH_SET } from './bench-set';
import {
  createGaggle, createGoose, createGooseFamily, gooseCells, GOOSE_PIECES, GOOSE_POSES, GOOSE_VARIANTS, planGaggle, SWIM_DRAFT,
} from './index';

/** Occupied cells as a set of "x,y,z" keys from the blueprint's boxes. */
function occupied(piece: AggmanPiece): Map<string, number> {
  const cells = new Map<string, number>();
  for (const { from, to, material } of piece.blueprint.boxes)
    for (let x = from[0]; x < to[0]; x++) for (let y = from[1]; y < to[1]; y++) for (let z = from[2]; z < to[2]; z++) {
      const key = `${x},${y},${z}`;
      if (cells.has(key)) throw new Error(`${piece.blueprint.id} writes ${key} twice`);
      cells.set(key, material);
    }
  return cells;
}

/** Face-connected components, and how many of them reach y = 0. */
function components(cells: Map<string, number>): { count: number; grounded: number } {
  const seen = new Set<string>();
  let count = 0, grounded = 0;
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    count++;
    let touches = false;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const [x, y, z] = stack.pop()!.split(',').map(Number) as [number, number, number];
      if (y === 0) touches = true;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const key = `${x + dx!},${y + dy!},${z + dz!}`;
        if (cells.has(key) && !seen.has(key)) { seen.add(key); stack.push(key); }
      }
    }
    if (touches) grounded++;
  }
  return { count, grounded };
}

/** Side silhouette (z, y) and front silhouette (x, y) as strings, for comparing shapes. */
function silhouette(piece: AggmanPiece): string {
  const side = new Set<string>(), front = new Set<string>();
  for (const key of occupied(piece).keys()) {
    const [x, y, z] = key.split(',');
    side.add(`${z},${y}`); front.add(`${x},${y}`);
  }
  return `${piece.blueprint.size.join('x')}|${[...side].sort().join(' ')}|${[...front].sort().join(' ')}`;
}

const SINGLES = GOOSE_POSES.flatMap(pose => GOOSE_VARIANTS.map(variant => ({ pose, variant, piece: createGoose(pose, variant) })));

describe('The_AGGman harbour geese', () => {
  it('every shipped piece meets the AGGman piece bar', () => {
    expect(GOOSE_PIECES.length).toBe(GOOSE_POSES.length * GOOSE_VARIANTS.length + 3 + 2);
    for (const piece of GOOSE_PIECES) expect(aggmanPieceFailures(piece), piece.blueprint.id).toEqual([]);
    expect(new Set(GOOSE_PIECES.map(p => p.blueprint.id)).size).toBe(GOOSE_PIECES.length);
  });

  it('every goose is a small Tide prop with no lanterns', () => {
    for (const piece of GOOSE_PIECES) {
      const b = piece.blueprint;
      expect(b.id).toMatch(/^genesis-aggman-goose-[a-z]+-[a-z0-9]+$/);
      expect([b.version, b.lattice, b.styleId, b.kind]).toEqual([1, 'build', 'tide', 'prop']);
      expect(piece.lanterns).toEqual([]);
      expect(b.windows).toEqual([]);
    }
  });

  it('each single goose is one face-connected bird standing on y = 0, six to ten cells long', () => {
    for (const { pose, variant, piece } of SINGLES) {
      const id = `${pose} ${variant}`, cells = occupied(piece);
      expect(components(cells), id).toEqual({ count: 1, grounded: 1 });
      const [sx, sy, sz] = piece.blueprint.size;
      expect(Math.max(sx, sz), id).toBeGreaterThanOrEqual(6);
      expect(Math.max(sx, sz), id).toBeLessThanOrEqual(10);
      expect(sy, id).toBeLessThanOrEqual(9);
      expect(Math.min(sx, sz), id).toBeLessThanOrEqual(5);
      // An eye (shut only on the dozing sitter) and an orange bill on every goose; legs unless sitting or afloat.
      const materials = new Set(cells.values());
      expect(materials.has(MAT.hairBlack), id).toBe(!(pose === 'sitting' && variant === 1));
      expect(materials.has(variant === 2 ? MAT.forgeCopper : MAT.fabricOrange), id).toBe(true);
      const feet = [...cells].filter(([key, m]) => key.split(',')[1] === '0' && (m === MAT.fabricOrange || m === MAT.forgeCopper));
      expect(feet.length > 0, id).toBe(pose !== 'sitting' && pose !== 'swimming');
    }
  });

  it('swimmers ride one cell deep with no legs', () => {
    for (const variant of GOOSE_VARIANTS) {
      const piece = createGoose('swimming', variant);
      expect(piece.draft).toBe(SWIM_DRAFT);
      expect(SWIM_DRAFT).toBe(1);
    }
    for (const { pose, piece } of SINGLES) if (pose !== 'swimming') expect(piece.draft).toBeUndefined();
  });

  it('is deterministic', () => {
    for (const { pose, variant, piece } of SINGLES) expect(createGoose(pose, variant)).toEqual(piece);
    for (const variant of GOOSE_VARIANTS) expect(createGooseFamily(variant)).toEqual(createGooseFamily(variant));
    expect(createGaggle('green')).toEqual(createGaggle('green'));
    expect(createGaggle(17)).toEqual(createGaggle(17));
  });

  it('poses have distinct silhouettes, and so do the variants of each pose', () => {
    const base = GOOSE_POSES.map(pose => silhouette(createGoose(pose, 0)));
    expect(new Set(base).size).toBe(GOOSE_POSES.length);
    for (const pose of GOOSE_POSES) {
      const variants = GOOSE_VARIANTS.map(v => createGoose(pose, v));
      expect(new Set(variants.map(p => JSON.stringify(p.blueprint.boxes))).size, pose).toBe(3);
    }
    // The grazer's eye is at the grass; the stander's is just under its crown, never on top of the head.
    const eye = (pose: 'standing' | 'grazing') => gooseCells(pose, 0).list().find(c => c[3] === MAT.hairBlack)!;
    expect(eye('grazing')[1]).toBe(0);
    const [ex, ey, ez] = eye('standing');
    expect(ey).toBe(createGoose('standing', 0).blueprint.size[1] - 2);
    expect(gooseCells('standing', 0).get(ex, ey + 1, ez)).toBe(MAT.cream);
  });

  it('the family is a gander, a goose and three goslings walking in a line about three metres long', () => {
    for (const variant of GOOSE_VARIANTS) {
      const piece = createGooseFamily(variant), cells = occupied(piece);
      expect(components(cells)).toEqual({ count: 5, grounded: 5 });
      const [sx, , sz] = piece.blueprint.size;
      expect(sz * 0.125).toBeGreaterThanOrEqual(2.5);
      expect(sz * 0.125).toBeLessThanOrEqual(3.5);
      expect(sx).toBeLessThan(sz / 2);
      expect([...cells.values()].filter(m => m === MAT.fabricGold).length).toBeGreaterThan(0);
    }
  });

  it('a gaggle is five to seven grounded adults within about 4 × 3 m, and varies by seed', () => {
    const plans = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const plan = planGaggle(seed), piece = createGaggle(seed);
      expect(plan.length, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      expect(plan.length, `seed ${seed}`).toBeLessThanOrEqual(7);
      expect(components(occupied(piece))).toEqual({ count: plan.length, grounded: plan.length });
      expect(piece.blueprint.size[0]).toBeLessThanOrEqual(32);
      expect(piece.blueprint.size[2]).toBeLessThanOrEqual(24);
      expect(plan.some(m => m.pose === 'swimming')).toBe(false);
      plans.add(JSON.stringify(plan));
    }
    expect(plans.size).toBe(40);
    expect(JSON.stringify(createGaggle('green').blueprint.boxes)).not.toBe(JSON.stringify(createGaggle('shingle').blueprint.boxes));
  });

  it('the bench shows every piece once, swimmer included, without overlaps', () => {
    expect(BENCH_SET.name).toBe('geese');
    expect(BENCH_SET.pieces.map(p => p.piece.blueprint.id).sort()).toEqual(GOOSE_PIECES.map(p => p.blueprint.id).sort());
    expect(BENCH_SET.pieces.some(p => p.piece.draft !== undefined)).toBe(true);
    const rects = BENCH_SET.pieces.map(({ piece, at }) => [at[0], at[1], at[0] + piece.blueprint.size[0], at[1] + piece.blueprint.size[2]] as const);
    rects.forEach((a, i) => rects.slice(i + 1).forEach(b => expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]).toBe(true)));
  });
});
