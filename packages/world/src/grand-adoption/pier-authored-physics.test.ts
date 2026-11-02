import { describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { AuthoredPierError } from './pier-authored-checks';
import { authoredCollision } from './pier-authored-physics';
import { AUTHORED_PIER_BUDGET as B, type AuthoredPierWork } from './pier-authored-types';

const box = (min: Vec3, max: Vec3): SolidBox => ({ min, max });
const hit = (a: SolidBox, b: SolidBox) => a.min.every((n, i) => n < b.max[i]! && a.max[i]! > b.min[i]!);
const work = (): AuthoredPierWork => ({ candidates: 0, preparationChecks: 0, groundSamples: 0, waterSamples: 0,
  coverageQueries: 0, collisionQueries: 0, collisionBoxes: 0, exclusionChecks: 0, proposalBytes: 0,
  blueprintCells: 0, writeCells: 0, compiledBoxes: 0, movementTicks: 0, overlayBoxChecks: 0 });
const empty: CollisionWorld = { revision: 7, query: () => [] };
const compare = (a: SolidBox, b: SolidBox) => {
  for (let i = 0; i < 3; i++) { const d = a.min[i]! - b.min[i]!; if (d) return d; }
  for (let i = 0; i < 3; i++) { const d = a.max[i]! - b.max[i]!; if (d) return d; }
  return 0;
};
function budgetError(action: () => unknown, stage: 'compile' | 'walk'): void {
  try { action(); throw new Error('Expected a bounded refusal'); }
  catch (error) { expect(error).toBeInstanceOf(AuthoredPierError); expect(error).toMatchObject({ reason: 'budget-exceeded', detail: { stage } }); }
}

describe('authored pier spatial broadphase', () => {
  it('checks nearby solids once and skips thousands of distant pieces', () => {
    const near = box([0, 0, 0], [1, 1, 1]);
    const distant = Array.from({ length: 2_000 }, (_, i) => box([8 + i * 8, 0, 0], [9 + i * 8, 1, 1]));
    const measured = work(), world = authoredCollision(empty, [near, ...distant], measured);
    expect(world.query(box([-.1, -.1, -.1], [1.1, 1.1, 1.1]))).toEqual([near]);
    expect(measured.overlayBoxChecks).toBe(1);
    expect(measured.collisionQueries).toBe(1);
  });

  it('matches exact intersection semantics at negative bins, bin edges and point-shaped queries', () => {
    const solids = [box([-8, -1, -4], [-4, 2, 0]), box([-4, 0, 0], [0, 1, 4]),
      box([-5, 2, -5], [9, 3, 9]), box([0, 0, 0], [4, 1, 4]), box([4, -1, 4], [8, 2, 8])];
    const world = authoredCollision(empty, solids, work());
    for (const x of [-8, -4, -.01, 0, 4, 8]) for (const z of [-4, 0, 4, 8]) for (const width of [0, .01, 4]) {
      const query = box([x, -.1, z], [x + width, 2.5, z + width]);
      expect(world.query(query)).toEqual(solids.filter(b => hit(query, b)).sort(compare));
    }
  });

  it('retains the sole base unknown-space barrier and exact sorted deduplication', () => {
    const barrier = box([-8, -4, -8], [8, 8, 8]), spanning = box([-4, 0, -4], [4, 1, 4]);
    const baseQuery = vi.fn(() => [barrier, spanning].sort(compare));
    const measured = work(), world = authoredCollision({ revision: 7, query: baseQuery }, [spanning, spanning], measured);
    expect(world.query(box([-5, -.1, -5], [5, 1.1, 5]))).toEqual([barrier, spanning].sort(compare));
    expect(baseQuery).toHaveBeenCalledTimes(1);
    expect(measured.overlayBoxChecks).toBe(2);
    expect(world.revision).toBe(7);
  });

  it('bounds construction and query work before querying the base, without raising existing caps', () => {
    const baseQuery = vi.fn(() => []), base = { revision: 7, query: baseQuery };
    budgetError(() => authoredCollision(base, [box([0, 0, 0], [4 * (B.overlayBinEntries + 1), 1, 4])], work()), 'compile');
    const world = authoredCollision(base, [], work());
    budgetError(() => world.query(box([0, 0, 0], [4 * B.overlayQueryBins, 1, 1])), 'walk');
    expect(baseQuery).not.toHaveBeenCalled();
    const measured = work(); measured.overlayBoxChecks = B.overlayBoxChecks - 1;
    const near = authoredCollision(base, [box([0, 0, 0], [1, 1, 1]), box([1, 0, 0], [2, 1, 1])], measured);
    budgetError(() => near.query(box([0, 0, 0], [2, 1, 1])), 'walk');
    expect(measured.overlayBoxChecks).toBe(B.overlayBoxChecks);
  });
});
