import { describe, expect, it } from 'vitest';
import { MAT } from '../../../materials';
import { voxels } from '../../../places/water/piece-checks';
import { aggmanPieceFailures } from '../checks';
import { AGGMAN_LIVERY, type AggmanPiece, type Livery } from '../piece';
import { BENCH_SET } from './bench-set';
import {
  COBLE, HARBOUR_LANTERN, HARBOUR_PIECES, createDrawnUpBoat, createFishCrates, createHarbourCoble, createHarbourLantern,
  createMooringBollard, createNetRack, createPotStack, createSlipwayCapstan,
} from './index';

/** A second livery in materials no harbour piece uses for anything else, so every livery cell can be traced. */
const PROBE: Livery = { red: MAT.fabricViolet, gold: MAT.fabricOrange, cream: MAT.plaster, blue: MAT.fabricGreen, brass: MAT.goldLeaf };
const KEYS = ['red', 'gold', 'cream', 'blue', 'brass'] as const;

const count = (piece: AggmanPiece, material: number, test: (x: number, y: number, z: number) => boolean = () => true) => {
  const { at, size } = voxels(piece.blueprint);
  let n = 0;
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) if (at(x, y, z) === material && test(x, y, z)) n++;
  return n;
};

describe('the working harbour', () => {
  const pieces = HARBOUR_PIECES(AGGMAN_LIVERY);

  it('builds thirteen distinct pieces with the genesis-aggman prefix', () => {
    const ids = pieces.map(p => p.blueprint.id);
    expect(ids).toEqual([
      'genesis-aggman-harbour-coble-0', 'genesis-aggman-harbour-coble-1',
      'genesis-aggman-drawn-up-boat-0', 'genesis-aggman-drawn-up-boat-1', 'genesis-aggman-drawn-up-boat-2',
      'genesis-aggman-mooring-bollard-0', 'genesis-aggman-mooring-bollard-1', 'genesis-aggman-net-rack',
      'genesis-aggman-pot-stack-0', 'genesis-aggman-pot-stack-1', 'genesis-aggman-fish-crates',
      'genesis-aggman-harbour-lantern', 'genesis-aggman-slipway-capstan',
    ]);
    for (const p of pieces) expect([p.blueprint.version, p.blueprint.lattice, p.blueprint.kind, p.blueprint.styleId]).toEqual([1, 'build', 'prop', 'tide']);
  });

  it.each(pieces.map(p => [p.blueprint.id, p] as const))('%s meets the prop bar: schema, budget, materials, support, bounds', (_id, piece) => {
    expect(aggmanPieceFailures(piece)).toEqual([]);
  });

  it('is deterministic', () => {
    expect(HARBOUR_PIECES(AGGMAN_LIVERY)).toEqual(pieces);
    expect(HARBOUR_PIECES(PROBE)).toEqual(HARBOUR_PIECES(PROBE));
  });

  it('paints every livery part from the livery it is given, and only those parts', () => {
    const uses: Record<string, readonly (typeof KEYS)[number][]> = {
      'genesis-aggman-harbour-coble-0': KEYS, 'genesis-aggman-harbour-coble-1': KEYS,
      'genesis-aggman-drawn-up-boat-0': ['blue', 'gold', 'cream', 'brass'],
      'genesis-aggman-drawn-up-boat-1': ['red', 'blue', 'cream', 'brass'],
      'genesis-aggman-drawn-up-boat-2': ['gold', 'red', 'cream', 'brass'],
      'genesis-aggman-net-rack': ['gold', 'cream'],
      'genesis-aggman-pot-stack-0': ['red', 'gold'], 'genesis-aggman-pot-stack-1': ['red', 'gold'],
      'genesis-aggman-fish-crates': ['blue', 'cream', 'red'],
      'genesis-aggman-harbour-lantern': KEYS,
    };
    const probed = HARBOUR_PIECES(PROBE);
    pieces.forEach((piece, i) => {
      const a = voxels(piece.blueprint), b = voxels(probed[i]!.blueprint), changed = new Set<string>();
      expect(b.size).toEqual(a.size);
      for (let k = 0; k < a.asset.voxels.length; k++) {
        const ma = a.asset.voxels[k]!, mb = b.asset.voxels[k]!;
        if (ma === mb) continue;
        const key = KEYS.find(n => AGGMAN_LIVERY[n] === ma && PROBE[n] === mb);
        expect(key, `${piece.blueprint.id}: ${ma} became ${mb}`).toBeDefined();
        changed.add(key!);
      }
      expect([...changed].sort(), piece.blueprint.id).toEqual([...(uses[piece.blueprint.id] ?? [])].sort());
    });
  });

  it('swapping red and blue swaps the hero sail and the hull', () => {
    const swapped = { ...AGGMAN_LIVERY, red: AGGMAN_LIVERY.blue, blue: AGGMAN_LIVERY.red };
    const above = (_x: number, y: number) => y > 14 && y < COBLE.mast.head;
    const sail = count(createHarbourCoble(AGGMAN_LIVERY, 0), AGGMAN_LIVERY.red, above);
    expect(sail).toBeGreaterThan(900);
    expect(count(createHarbourCoble(swapped, 0), AGGMAN_LIVERY.blue, above)).toBe(sail);
    expect(count(createHarbourCoble(swapped, 0), AGGMAN_LIVERY.red, above)).toBe(0);
  });
});

describe('the coble', () => {
  it('sets her sail in variant 0 and furls it in variant 1', () => {
    const aloft = (_x: number, y: number) => y > 14 && y < COBLE.mast.head;
    expect(count(createHarbourCoble(AGGMAN_LIVERY, 0), AGGMAN_LIVERY.red, aloft)).toBeGreaterThan(900);
    expect(count(createHarbourCoble(AGGMAN_LIVERY, 1), AGGMAN_LIVERY.red, aloft)).toBe(0);
    // The furled roll lies low along the boat, over the thwarts.
    expect(count(createHarbourCoble(AGGMAN_LIVERY, 1), AGGMAN_LIVERY.red, (_x, y) => y >= 7 && y <= 12)).toBeGreaterThan(300);
  });

  it('floats on her waterline: tar below it, the cream band at it, and her keel and rudder on y = 0', () => {
    for (const variant of [0, 1] as const) {
      const piece = createHarbourCoble(AGGMAN_LIVERY, variant), { at, size } = voxels(piece.blueprint);
      expect(piece.draft).toBe(COBLE.draft);
      for (let z = 0; z < size[2]; z++) for (let y = 0; y < piece.draft!; y++) for (let x = 0; x < size[0]; x++) {
        const m = at(x, y, z);
        if (m) expect([MAT.bark, MAT.timber]).toContain(m);
      }
      expect(count(piece, AGGMAN_LIVERY.cream, (_x, y) => y === COBLE.draft)).toBeGreaterThan(60);
      expect(count(piece, MAT.bark, (_x, y) => y === 0)).toBeGreaterThan(40);
    }
  });

  it('carries her masthead lantern as glass at the lantern cell, on the mast', () => {
    const piece = createHarbourCoble(AGGMAN_LIVERY, 0), { at } = voxels(piece.blueprint);
    expect(piece.lanterns).toEqual([COBLE.lantern]);
    const [x, y, z] = COBLE.lantern;
    expect(at(x, y, z)).toBe(MAT.glass);
    expect(at(x, COBLE.mast.head - 1, z)).toBe(MAT.timber);
  });
});

describe('the shore pieces', () => {
  it('rests each drawn-up boat on her keel, heeled onto a chock', () => {
    for (const variant of [0, 1, 2] as const) {
      const piece = createDrawnUpBoat(AGGMAN_LIVERY, variant), { at, size } = voxels(piece.blueprint);
      let keel = 0, chock = 0;
      for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
        if (at(x, 0, z) === MAT.bark && at(x, 1, z) !== MAT.air) keel++;
        if (at(x, 0, z) === MAT.bark && at(x, 1, z) === MAT.timber && at(x, 2, z) !== MAT.air) chock++;
      }
      expect(keel, `variant ${variant}`).toBeGreaterThan(8);
      expect(chock, `variant ${variant}`).toBeGreaterThan(0);
      expect(piece.draft).toBeUndefined();
    }
  });

  it('hangs the quay lantern cell inside its glass', () => {
    const piece = createHarbourLantern(AGGMAN_LIVERY), { at } = voxels(piece.blueprint);
    const [x, y, z] = HARBOUR_LANTERN.lantern;
    expect(piece.lanterns).toEqual([HARBOUR_LANTERN.lantern]);
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) expect(at(x + dx!, y + dy!, z + dz!)).toBe(MAT.glass);
  });

  it('rejects variants it does not have', () => {
    expect(() => createHarbourCoble(AGGMAN_LIVERY, 2 as 0)).toThrow(RangeError);
    expect(() => createDrawnUpBoat(AGGMAN_LIVERY, 3 as 0)).toThrow(RangeError);
    expect(() => createMooringBollard(2 as 0)).toThrow(RangeError);
    expect(() => createPotStack(AGGMAN_LIVERY, 2 as 0)).toThrow(RangeError);
  });

  it('keeps the small pieces small', () => {
    for (const piece of [createMooringBollard(0), createMooringBollard(1)]) expect(piece.blueprint.size[1]).toBeLessThanOrEqual(7);
    expect(createNetRack(AGGMAN_LIVERY).blueprint.size[0]).toBe(34);
    expect(createFishCrates(AGGMAN_LIVERY).blueprint.size[1]).toBeLessThanOrEqual(12);
    expect(createSlipwayCapstan().blueprint.size[1]).toBeLessThanOrEqual(12);
    expect(createHarbourLantern(AGGMAN_LIVERY).blueprint.size[1]).toBe(26);
  });
});

describe('the bench set', () => {
  it('lays out every harbour piece once without overlaps', () => {
    expect(BENCH_SET.name).toBe('harbour');
    expect(BENCH_SET.pieces.map(p => p.piece.blueprint.id).sort()).toEqual(HARBOUR_PIECES(AGGMAN_LIVERY).map(p => p.blueprint.id).sort());
    const rects = BENCH_SET.pieces.map(({ piece, at }) => [at[0], at[1], at[0] + piece.blueprint.size[0], at[1] + piece.blueprint.size[2]] as const);
    rects.forEach((a, i) => rects.slice(i + 1).forEach(b => {
      expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]).toBe(true);
    }));
  });
});
