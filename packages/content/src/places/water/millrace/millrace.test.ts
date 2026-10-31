import { describe, expect, it } from 'vitest';
import { MAT, type StyleKey } from '../../../materials';
import { pieceFailures, unsupported, voxels } from '../piece-checks';
import { assemble, type CellBox, type WaterPiece } from '../place-piece';
import {
  MILLRACE_BLUEPRINTS, MILLRACE_PIECES, WEIR, WHEEL, WHEEL_AXLE_SEEDS, WHEEL_PIT, createMillWheel, createWeir,
  createWheelPit, weirFrame, weirLevels, wheelPitFrame, wheelPitTrestles,
} from './index';

const STYLE_KEYS = ['hearth', 'tide', 'grove'] as const satisfies readonly StyleKey[];
const SLOW = 120_000;
const styleOf = (p: WaterPiece) => STYLE_KEYS.find(s => p.blueprint.styleId === s)!;
const inside = (box: CellBox, x: number, y: number, z: number) =>
  x >= box.from[0] && x < box.to[0] && y >= box.from[1] && y < box.to[1] && z >= box.from[2] && z < box.to[2];
const clearBox = (p: WaterPiece, role: string) => p.clear.find(c => c.role === role)!.box;
const mount = (p: WaterPiece, id: string) => p.mounts.find(m => m.id === id)!;
/** Feet that climb from the pit towards the leat, as supplied ground usually does. */
const climbing = (run: number) => Array.from({ length: wheelPitTrestles(run) }, (_, i) => Math.min(WHEEL_PIT.foot[1], 6 + 7 * i));

describe('millrace pieces', () => {
  it('every review piece is honest: palette, bounds, support, footings, clear volumes and budgets', () => {
    expect(MILLRACE_PIECES).toHaveLength(9);
    expect(new Set(MILLRACE_PIECES.map(p => p.blueprint.id)).size).toBe(9);
    expect(MILLRACE_BLUEPRINTS).toEqual(MILLRACE_PIECES.map(p => p.blueprint));
    for (const piece of MILLRACE_PIECES) {
      const dynamic = piece.blueprint.kind === 'prop';
      expect(pieceFailures(piece, styleOf(piece), !dynamic), piece.blueprint.id).toEqual([]);
      if (dynamic) expect(unsupported(piece.blueprint, WHEEL_AXLE_SEEDS), piece.blueprint.id).toBe(0);
    }
  }, SLOW);

  it('pits stay honest across the whole run and foot range', () => {
    const cases: [StyleKey, number, number[]][] = [
      ['grove', 16, [0]], ['hearth', 16, [36]], ['tide', 17, [36, 0]], ['grove', 33, [5, 20, 36]],
      ['hearth', 100, climbing(100)], ['tide', 160, climbing(160)],
    ];
    for (const [style, run, feet] of cases) {
      const pit = createWheelPit(style, run, feet);
      expect(pieceFailures(pit, style), pit.blueprint.id).toEqual([]);
      expect(pit.footings.filter(f => f.id.startsWith('foot-'))).toHaveLength(2 * feet.length);
      for (const f of pit.footings.filter(f => f.id.startsWith('foot-'))) expect(feet).toContain(f.box.from[1]);
    }
  }, SLOW);

  it('weirs stay honest across every drop and the width range', () => {
    for (const [i, width] of [24, 61, 96].entries()) for (let drop = WEIR.drop[0]; drop <= WEIR.drop[1]; drop++) {
      const style = STYLE_KEYS[(i + drop) % 3]!, weir = createWeir(style, width, drop);
      expect(pieceFailures(weir, style), weir.blueprint.id).toEqual([]);
    }
  }, SLOW);
});

describe('the wheel', () => {
  const wheel = createMillWheel('hearth');
  const { at } = voxels(wheel.blueprint);

  it('turns true about its hub and reaches its full rim', () => {
    let n = 0, sy = 0, sz = 0, low = Infinity, high = -Infinity;
    for (let z = 0; z < 40; z++) for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) if (at(x, y, z)) {
      n++; sy += y + 0.5; sz += z + 0.5; low = Math.min(low, y); high = Math.max(high, y);
    }
    expect(Math.abs(sy / n - WHEEL.hub[0])).toBeLessThan(0.5);
    expect(Math.abs(sz / n - WHEEL.hub[1])).toBeLessThan(0.5);
    expect([low, high]).toEqual([0, WHEEL.size[1] - 1]);
    expect(mount(wheel, 'axle').position).toEqual([10, WHEEL.hub[0], WHEEL.hub[1]]);
  });

  it('shows 16–24 separate bucket boards round the rim between the shrouds', () => {
    // Walk a circle through the bucket pockets in the middle of the sole span and count boards crossed.
    const x = (WHEEL.sole[0] + WHEEL.sole[1]) >> 1, samples = 720;
    let boards = 0, previous = false;
    for (let i = 0; i <= samples; i++) {
      const phi = (2 * Math.PI * i) / samples, r = 18.6;
      const solid = at(x, Math.floor(WHEEL.hub[0] + r * Math.cos(phi)), Math.floor(WHEEL.hub[1] + r * Math.sin(phi))) !== 0;
      if (i && solid && !previous) boards++;
      previous = solid;
    }
    expect(boards).toBe(WHEEL.buckets);
    expect(boards).toBeGreaterThanOrEqual(16);
    expect(boards).toBeLessThanOrEqual(24);
  });
});

describe('the wheel in its pit', () => {
  for (const [style, run] of [['hearth', 48], ['grove', 16], ['tide', 131]] as const) {
    it(`${style} run ${run}: the wheel swings clear, bears on its blocks and takes water over the lip`, () => {
      const feet = climbing(run), pit = createWheelPit(style, run, feet), wheel = createMillWheel(style), F = wheelPitFrame(run);
      const [ox, oy, oz] = F.wheelOffset;
      const p = voxels(pit.blueprint), w = voxels(wheel.blueprint), swing = clearBox(pit, 'wheel-pit');
      // The frames agree: the pit's axle mount is the wheel's, moved by the documented offset.
      const axle = mount(wheel, 'axle').position;
      expect(mount(pit, 'axle').position).toEqual([axle[0] + ox, axle[1] + oy, axle[2] + oz]);

      let wheelTop = -1;
      const journalBase: [number, number, number][] = [];
      for (let z = 0; z < 40; z++) for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) {
        if (!w.at(x, y, z)) continue;
        const [X, Y, Z] = [x + ox, y + oy, z + oz];
        expect(p.at(X, Y, Z), `wheel cell ${X},${Y},${Z} collides with the pit`).toBe(0);
        // Everything but the journals swings inside the pit's clear volume; the hub, arms, shrouds and buckets keep
        // a clear cell all round.
        const journal = WHEEL.journals.some(([a, c]) => x >= a && x < c);
        if (journal) { if (!w.at(x, y - 1, z)) journalBase.push([X, Y, Z]); } else expect(inside(swing, X, Y, Z)).toBe(true);
        if (x >= WHEEL.hubSpan[0] && x < WHEEL.hubSpan[1]) {
          expect(inside(swing, X - 1, Y - 1, Z - 1) && inside(swing, X + 1, Y + 1, Z + 1), `${X},${Y},${Z} grazes the pit`).toBe(true);
        }
        wheelTop = Math.max(wheelTop, Y);
      }
      // Each journal's lowest layer sits on iron or brass bearing cells of the pit.
      expect(journalBase.length).toBe(8);
      for (const [X, Y, Z] of journalBase) expect([MAT.darkStone, MAT.brass]).toContain(p.at(X, Y - 1, Z));

      // The lip: 0.375–0.5 m over the wheel's top, 2–4 cells past top dead centre on the descending (+Z) side.
      const lip = mount(pit, 'lip').position, hub = F.hub;
      expect(lip[1] - (wheelTop + 1)).toBeGreaterThanOrEqual(3);
      expect(lip[1] - (wheelTop + 1)).toBeLessThanOrEqual(4);
      expect(lip[2] - hub[2]).toBeGreaterThanOrEqual(2);
      expect(lip[2] - hub[2]).toBeLessThanOrEqual(4);
      // Turning positively about +X carries the top towards +Z, so the lip is over the side that descends full.
      expect(mount(pit, 'axle').axis).toEqual([1, 0, 0]);
      // The channel lies over the bucket span, so the spill lands in the pockets, not on a shroud.
      const channel = clearBox(pit, 'spillway');
      expect(channel.from[0]).toBeGreaterThanOrEqual(ox + WHEEL.sole[0]);
      expect(channel.to[0]).toBeLessThanOrEqual(ox + WHEEL.sole[1]);
      expect(lip[0]).toBeGreaterThan(channel.from[0]);
      expect(lip[0]).toBeLessThan(channel.to[0]);

      // Assembled, nothing overlaps and the whole mill race stands on the ground through the bearings.
      const joined = assemble(`water-${style}-millrace-review-${run}`, pit.blueprint.styleId, 'civic', pit.blueprint.size,
        [{ blueprint: pit.blueprint, offset: [0, 0, 0] }, { blueprint: wheel.blueprint, offset: F.wheelOffset }]);
      const count = (a: ArrayLike<number>) => Array.from(a).filter(Boolean).length;
      expect(count(voxels(joined).asset.voxels)).toBe(count(p.asset.voxels) + count(w.asset.voxels));
      expect(unsupported(joined)).toBe(0);
    }, SLOW);
  }
});

describe('the launder', () => {
  it('carries one level floor from the leat end to the lip, with no step for the water to fall over', () => {
    for (const run of [16, 75, 160]) {
      const pit = createWheelPit('tide', run, climbing(run)), F = wheelPitFrame(run), { at } = voxels(pit.blueprint);
      const channel = clearBox(pit, 'spillway'), lip = mount(pit, 'lip').position, leat = mount(pit, 'leat-end').position;
      expect(leat).toEqual([lip[0], F.troughFloor, 0]);
      expect(lip[1]).toBe(F.troughFloor);
      expect(channel.from[1]).toBe(F.troughFloor);
      expect(channel.to[0] - channel.from[0]).toBe(8);
      for (let z = 0; z < lip[2]; z++) for (let x = channel.from[0]; x < channel.to[0]; x++) {
        expect(at(x, F.troughFloor - 1, z), `floor at ${x},${z}`).not.toBe(0);
        for (let y = F.troughFloor; y < channel.to[1]; y++) expect(at(x, y, z)).toBe(0);
        // The walls hold the water all the way along.
        for (let y = F.troughFloor; y < channel.to[1]; y++) {
          expect(at(channel.from[0] - 1, y, z)).not.toBe(0);
          expect(at(channel.to[0], y, z)).not.toBe(0);
        }
      }
      // Both ends are open: the leat runs in at z = 0 and the water leaves over the lip, straight onto the wheel.
      for (let x = channel.from[0]; x < channel.to[0]; x++) {
        expect(at(x, F.troughFloor - 1, lip[2])).toBe(0);
        for (let y = F.wheelOffset[1] + WHEEL.size[1]; y < F.troughFloor; y++) expect(at(x, y, lip[2])).toBe(0);
      }
    }
  }, SLOW);

  it('stands each upstream trestle on its own supplied foot with nothing of the piece beneath it', () => {
    const run = 64, feet = [9, 30, 17, 36], pit = createWheelPit('hearth', run, feet), F = wheelPitFrame(run);
    expect(F.trestles).toHaveLength(feet.length);
    // Ordered from the pit outward.
    expect([...F.trestles].sort((a, b) => b - a)).toEqual(F.trestles);
    feet.forEach((h, i) => {
      for (const side of ['west', 'east']) {
        const foot = pit.footings.find(f => f.id === `foot-${i}-${side}`)!;
        expect(foot.box.from[1]).toBe(h);
        expect(Math.abs((foot.box.from[2] + foot.box.to[2]) / 2 - F.trestles[i]!)).toBeLessThanOrEqual(1.5);
      }
    });
  }, SLOW);
});

describe('the weir', () => {
  it('holds the pond one cell over its crest and the tail water one drop lower, for every drop', () => {
    for (let drop = WEIR.drop[0]; drop <= WEIR.drop[1]; drop++) {
      const levels = weirLevels(drop), weir = createWeir('grove', 40, drop), F = weirFrame(40, drop), { at } = voxels(weir.blueprint);
      expect(levels.upstream).toBe(levels.crestTop + 1);
      expect(levels.upstream - levels.downstream).toBe(drop);
      expect(levels.downstream).toBeGreaterThan(1);
      expect(mount(weir, 'crest').position[1]).toBe(levels.crestTop);
      const top = (x: number, z: number) => { for (let y = F.size[1] - 1; y >= 0; y--) if (at(x, y, z)) return y + 1; return 0; };
      // The crest across the stream stands at crestTop, except one worn stretch a single cell lower.
      const z = (WEIR.cap[0] + WEIR.cap[1]) >> 1, low: number[] = [];
      for (let x = F.channel[0]; x < F.channel[1]; x++) {
        const t = top(x, z);
        expect([levels.crestTop, levels.crestTop - 1]).toContain(t);
        if (t < levels.crestTop && (x < F.dip[0] || x >= F.dip[1])) {
          // A capping joint, one cell wide, is not the dip.
          expect(top(x - 1, z)).toBe(levels.crestTop);
          expect(top(x + 1, z)).toBe(levels.crestTop);
        }
        if (x >= F.dip[0] && x < F.dip[1]) low.push(t);
      }
      expect(low.length).toBeGreaterThanOrEqual(4);
      expect(new Set(low)).toEqual(new Set([levels.crestTop - 1]));
      // The downstream face falls in two or three steps, every one under the crest and above the apron.
      expect(F.steps.length).toBe(drop >= 6 ? 3 : 2);
      F.steps.forEach((t, k) => {
        expect(t).toBeLessThan(k ? F.steps[k - 1]! : levels.crestTop);
        expect(t).toBeGreaterThan(1);
        expect(top(F.channel[0] + 7, WEIR.body[1] + k * WEIR.tread + 1)).toBeLessThanOrEqual(t);
      });
      // The wing walls stand above the water they retain all along both banks (their faces at least a cell over it,
      // the wall behind its mortared face two cells or more).
      for (let zz = 0; zz < F.size[2]; zz++) {
        const water = zz < WEIR.cap[1] ? levels.upstream : levels.downstream;
        for (const [face, body] of [[F.channel[0] - 1, F.channel[0] - 2], [F.channel[1], F.channel[1] + 1]] as const) {
          expect(top(face, zz)).toBeGreaterThan(water);
          expect(top(body, zz)).toBeGreaterThan(water + 1);
        }
      }
      expect(top(F.channel[0] - 1, 0)).toBeGreaterThanOrEqual(levels.upstream + 2);
    }
  }, SLOW);
});

describe('refusals', () => {
  it('refuses impossible sizes, runs and feet', () => {
    expect(() => createMillWheel('marsh' as StyleKey)).toThrow(RangeError);
    for (const run of [15, 161, 40.5, Number.NaN]) expect(() => createWheelPit('hearth', run, [10])).toThrow(RangeError);
    expect(() => createWheelPit('hearth', 48, [10, 20])).toThrow(RangeError);
    expect(() => createWheelPit('hearth', 48, [10, 20, 30, 30])).toThrow(RangeError);
    for (const bad of [-1, 37, 2.5]) expect(() => createWheelPit('hearth', 48, [10, bad, 20])).toThrow(RangeError);
    expect(() => wheelPitTrestles(200)).toThrow(RangeError);
    for (const [width, drop] of [[23, 6], [97, 6], [30.5, 6], [40, 3], [40, 9], [40, 6.5]]) {
      expect(() => createWeir('tide', width!, drop!)).toThrow(RangeError);
    }
    expect(() => weirLevels(10)).toThrow(RangeError);
  });
});
