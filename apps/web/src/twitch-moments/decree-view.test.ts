import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import { CELL } from './banner';
import { POLE_CELLS, PENNANT_CELLS, decreeParts, pennantColumns } from './decree-art';
import { DECREE_LIMITS, DECREE_PLACE, buntingOf, createDecreeLayer } from './decree-view';
import type { SpectaclePlaces } from './spectacle';
import { EMPTY_TOWN, TOWN_COLOURS, type BoardFrame, type TownColour, type TownFrame, type TownLayerHost } from './town';

const PLAZA: Vec3 = [0, 1, 0];
const EAVE = 5.4;
/** Street lines at eave height round a plaza at the origin; the castle stands north (-z). One run lies far beyond reach. */
const line = (from: [number, number], to: [number, number], step = 4): Vec3[] => {
  const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
  return Array.from({ length: n + 1 }, (_, i) => [from[0] + (to[0] - from[0]) * i / n, EAVE, from[1] + (to[1] - from[1]) * i / n] as Vec3);
};
const STREETS: Vec3[][] = [
  line([-120, 12], [120, 12]), line([3, 14], [3, 120]), line([-60, 40], [60, 40]), line([-14, -8], [-14, -90]), line([-80, -200], [80, -200]),
];

function rig(runs: readonly (readonly Vec3[])[] = STREETS, plaza: Vec3 | null = PLAZA) {
  const places: SpectaclePlaces = {
    sky: () => ({ centre: [0, 0, 0], radius: 80, ceiling: 50 }), castle: () => ({ crown: [0, 20, -60], walls: [] }), plaza: () => plaza,
    lair: () => null, track: () => null, bunting: () => runs, roof: () => null, homes: () => [],
  };
  const material = new THREE.MeshBasicMaterial();
  const host: TownLayerHost = {
    kit: 'hearth', places, material, mesh: () => new THREE.Mesh(new THREE.BoxGeometry(CELL, CELL, CELL), material),
    meshAsync: async () => new THREE.BoxGeometry(CELL, CELL, CELL), door: () => null, window: () => null, gate: () => null,
  };
  const root = new THREE.Group();
  return { root, layer: createDecreeLayer(root, host) };
}

const choice = (title: string, share: number, colour: TownColour, winner = false) => ({ id: title.toLowerCase(), title, share, votes: Math.round(share * 100), colour, winner });
function boardFrame(over: Partial<BoardFrame> = {}): BoardFrame {
  return {
    key: 'poll-1', title: 'What colours shall the town fly?', t: 20_000, phase: 'open', decidedT: null, decree: true, raised: 1,
    choices: [choice('Ember', 0.6, 'ember'), choice('Tide', 0.3, 'tide'), choice('Meadow', 0.1, 'meadow')], ...over,
  };
}
const town = (over: Partial<TownFrame> = {}): TownFrame => ({ ...EMPTY_TOWN, ...over });

/** Every visible instance of the layer's parts whose name passes `match`: [name, world position]. */
function instances(root: THREE.Group, match: (name: string) => boolean): { name: string; position: THREE.Vector3 }[] {
  const out: { name: string; position: THREE.Vector3 }[] = [], m = new THREE.Matrix4();
  root.traverse(object => {
    if (!(object instanceof THREE.InstancedMesh) || !object.visible || !match(object.name)) return;
    for (let i = 0; i < object.count; i++) { object.getMatrixAt(i, m); out.push({ name: object.name, position: new THREE.Vector3().setFromMatrixPosition(m) }); }
  });
  return out;
}
const flagsIn = (root: THREE.Group, colour: TownColour) => instances(root, name => name.startsWith(`moment-town-flag-hearth-${colour}-`)).length;

/** The label point's height for a pennant whose hoist top is at `top` cells on a pole standing at the plaza's height. */
const labelAt = (top: number) => PLAZA[1] + (top - PENNANT_CELLS.rows) * CELL - 0.24;
const [LOW, HIGH] = POLE_CELLS.travel;

describe('the decree board, the town colours and the called festival', () => {
  it('prepares unique, non-empty parts and cuts every pennant from its two dyes', () => {
    const { layer } = rig();
    const parts = layer.blueprints();
    expect(new Set(parts.map(p => p.id)).size).toBe(parts.length);
    for (const part of parts) expect(part.boxes.length).toBeGreaterThan(0);
    expect(parts.length).toBeLessThan(40);
    expect(decreeParts('tide').map(p => p.id).every(id => id.includes('tide'))).toBe(true);
    for (const colour of TOWN_COLOURS) {
      const columns = pennantColumns(colour);
      expect(columns).toHaveLength(PENNANT_CELLS.length);
      // The sleeve is whole, and the swallowtail leaves only its two tails at the fly.
      expect(columns[0]).toEqual([{ r0: 0, r1: PENNANT_CELLS.rows, material: expect.any(Number) }]);
      expect(columns.at(-1)!.map(run => run.r1 - run.r0)).toEqual([1, 1]);
    }
  });

  it('stands no board while no poll runs, and hangs only the calm everyday bunting', () => {
    const { root, layer } = rig();
    layer.apply(EMPTY_TOWN, 1000);
    expect(layer.stats()).toMatchObject({ board: 0, choices: 0, pennants: 0, lanterns: 0 });
    expect(layer.captionPoint()).toBeNull();
    expect(layer.choicePoints()).toEqual([]);
    expect(instances(root, name => name.includes('board') || name.includes('pole'))).toEqual([]);
    expect(layer.glow().strength).toBe(0);
    // A board with nowhere to stand is not drawn either.
    const lost = rig(STREETS, null);
    lost.layer.apply(town({ board: boardFrame() }), 1000);
    expect(lost.layer.stats().board).toBe(0);
    expect(lost.layer.captionPoint()).toBeNull();
  });

  it('climbs each pennant to its share, and the winner tops its pole with a flourish while the others sink', () => {
    const { root, layer } = rig();
    layer.apply(town({ board: boardFrame() }), 20_000);
    expect(layer.stats()).toMatchObject({ board: 1, choices: 3 });
    expect(instances(root, name => name === 'moment-town-board-hearth-decree')).toHaveLength(1);
    expect(instances(root, name => name === 'moment-town-pole-hearth')).toHaveLength(3);
    const open = layer.choicePoints().map(p => p.y);
    expect(open).toHaveLength(3);
    open.forEach((y, i) => expect(y).toBeCloseTo(labelAt(LOW + (HIGH - LOW) * [0.6, 0.3, 0.1][i]!), 5));
    // The question hangs above the poles, on the castle's side of the plaza point; labels read left to right.
    const caption = layer.captionPoint()!;
    expect(caption.y).toBeGreaterThan(PLAZA[1] + POLE_CELLS.height * CELL);
    expect(caption.z).toBeLessThan(-DECREE_PLACE.aside + 0.5);
    const xs = layer.choicePoints().map(p => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));

    // Before the board has risen the pennants wait at the foot of their travel.
    layer.apply(town({ board: boardFrame({ t: 600, raised: 1 }) }), 600);
    for (const y of layer.choicePoints().map(p => p.y)) expect(y).toBeCloseTo(labelAt(LOW), 5);

    // Decided: Tide wins on a smaller share than Ember had (a later surge), tops its pole and bursts; the others sink.
    const decided = (decidedT: number) => boardFrame({ phase: 'decided', decidedT,
      choices: [choice('Ember', 0.6, 'ember'), choice('Tide', 0.3, 'tide', true), choice('Meadow', 0.1, 'meadow')] });
    layer.apply(town({ board: decided(1900) }), 30_000);
    expect(layer.stats().motes).toBeGreaterThan(0);
    expect(layer.stats().lights).toBeGreaterThan(0);
    layer.apply(town({ board: decided(3600) }), 31_700);
    const won = layer.choicePoints().map(p => p.y);
    expect(won[1]).toBeCloseTo(labelAt(HIGH), 5);
    expect(won[0]).toBeLessThan(open[0]!);
    expect(won[2]).toBeLessThan(open[2]! + 1e-9);
    expect(layer.stats()).toMatchObject({ motes: 0, lights: 0 });
  });

  it('shows no winner for a divided or cancelled poll', () => {
    const { layer } = rig();
    const tied = [choice('Ember', 0.5, 'ember'), choice('Tide', 0.5, 'tide')];
    layer.apply(town({ board: boardFrame({ phase: 'divided', decidedT: 1900, choices: tied }) }), 40_000);
    expect(layer.stats().motes).toBe(0);
    expect(layer.stats().lights).toBe(0);
    for (const y of layer.choicePoints().map(p => p.y)) expect(y).toBeCloseTo(labelAt(LOW + (HIGH - LOW) * 0.5), 5);
    layer.apply(town({ board: boardFrame({ phase: 'cancelled', decidedT: 5000 }) }), 41_000);
    for (const y of layer.choicePoints().map(p => p.y)) expect(y).toBeCloseTo(labelAt(LOW), 5);
    expect(layer.stats().motes).toBe(0);
  });

  it('lowers the board after the hold, poles last up first down, and leaves nothing when it is gone', () => {
    const { root, layer } = rig();
    layer.apply(town({ board: boardFrame({ raised: 0.5 }) }), 50_000);
    const half = instances(root, name => name === 'moment-town-pole-hearth').map(p => p.position.y);
    expect(half).toHaveLength(3);
    expect(half[0]!).toBeGreaterThan(half[2]!);
    expect(Math.max(...half)).toBeLessThan(PLAZA[1]);
    expect(layer.stats().motes).toBeGreaterThan(0);
    layer.apply(town({ board: boardFrame({ raised: 0 }) }), 51_000);
    expect(layer.stats().board).toBe(0);
    expect(instances(root, name => name.includes('board') || name.includes('pole') || name.includes('ring'))).toEqual([]);
  });

  it('flies the town colours on a bounded string of bunting near the plaza every day', () => {
    const layout = buntingOf(STREETS, PLAZA);
    expect(layout.everydayLength).toBeGreaterThan(30);
    expect(layout.everydayLength).toBeLessThanOrEqual(DECREE_PLACE.everyday.length);
    expect(layout.festivalLength).toBeLessThanOrEqual(DECREE_PLACE.festival.length);
    expect(layout.flags.length).toBeLessThanOrEqual(DECREE_LIMITS.flags);
    // The far run never carries anything.
    expect(layout.cords.every(c => c.matrix.elements[14]! > -150)).toBe(true);

    const { root, layer } = rig();
    layer.apply(town({ colour: 'meadow' }), 2000);
    const flags = instances(root, name => name.startsWith('moment-town-flag-'));
    expect(flags.length).toBe(layout.flags.filter(f => f.everyday).length);
    expect(flags.length).toBeGreaterThan(20);
    expect(flags.length).toBeLessThan(140);
    expect(flags.every(f => f.name.includes('-meadow-'))).toBe(true);
    const near = DECREE_PLACE.everyday.reach + DECREE_PLACE.span / 2 + DECREE_PLACE.lateral + 0.5;
    for (const { position } of flags) {
      expect(Math.hypot(position.x - PLAZA[0], position.z - PLAZA[2])).toBeLessThan(near);
      expect(position.y).toBeGreaterThan(EAVE - 1.2);
    }
    expect(layer.stats().lanterns).toBe(0);
  });

  it('runs a decree landing outward from the plaza: flags turn from the old dyes to the new as the wave passes', () => {
    const { root, layer } = rig();
    const counts = [0, 0.25, 0.5, 0.75, 1].map(wave => {
      layer.apply(town({ colour: 'gold', colourChange: { from: 'gold', to: 'tide', wave } }), 3000);
      return { gold: flagsIn(root, 'gold'), tide: flagsIn(root, 'tide') };
    });
    const total = counts[0]!.gold;
    expect(total).toBeGreaterThan(20);
    expect(counts.map(c => c.gold + c.tide)).toEqual(counts.map(() => total));
    expect(counts[0]!.tide).toBe(0);
    expect(counts[4]!.tide).toBe(total);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!.tide).toBeGreaterThanOrEqual(counts[i - 1]!.tide);
    expect(counts[2]!.tide).toBeGreaterThan(0);
    expect(counts[2]!.tide).toBeLessThan(total);
    // The nearer flags turn first.
    layer.apply(town({ colour: 'gold', colourChange: { from: 'gold', to: 'tide', wave: 0.5 } }), 3000);
    const far = (colour: TownColour) => Math.max(...instances(root, n => n.startsWith(`moment-town-flag-hearth-${colour}-`)).map(f => Math.hypot(f.position.x, f.position.z)));
    const nearGold = Math.min(...instances(root, n => n.startsWith('moment-town-flag-hearth-gold-')).map(f => Math.hypot(f.position.x, f.position.z)));
    expect(far('tide')).toBeLessThan(nearGold + 1);
  });

  it('dresses the streets for a called festival with lanterns, scaled by how dressed they are, and takes it down', () => {
    const { root, layer } = rig();
    const festival = (dressed: number) => town({ colour: 'dusk', festival: { id: 'f1', t: 10_000, dressed, colour: 'dusk' } });
    layer.apply(town({ colour: 'dusk' }), 1000);
    const everyday = layer.stats();
    layer.apply(festival(0), 1000);
    expect(layer.stats()).toMatchObject({ flags: everyday.flags, cords: everyday.cords, lanterns: 0 });
    expect(layer.glow().strength).toBe(0);
    const at = [0.3, 0.6, 1].map(dressed => { layer.apply(festival(dressed), 12_000); const s = layer.stats(); return { flags: s.flags!, lanterns: s.lanterns!, lights: s.lights!, glow: layer.glow().strength }; });
    expect(at[0]!.flags).toBeGreaterThan(everyday.flags!);
    expect(at[1]!.flags).toBeGreaterThan(at[0]!.flags!);
    expect(at[2]!.flags).toBeGreaterThan(at[1]!.flags!);
    expect(at[2]!.flags).toBeLessThanOrEqual(DECREE_LIMITS.flags);
    expect(at[2]!.lanterns).toBeGreaterThan(20);
    expect(at[2]!.lanterns).toBeLessThanOrEqual(DECREE_LIMITS.lanterns);
    expect(at[2]!.lights).toBeGreaterThan(0);
    expect(at[2]!.glow).toBeGreaterThan(0);
    expect(at[2]!.glow).toBeLessThanOrEqual(0.07);
    expect(instances(root, n => n.startsWith('moment-town-flag-')).every(f => f.name.includes('-dusk-'))).toBe(true);
    layer.apply(festival(0), 600_000);
    expect(layer.stats()).toMatchObject({ flags: everyday.flags, lanterns: 0, lights: 0 });
    layer.apply(town({ colour: 'dusk' }), 601_000);
    expect(layer.glow().strength).toBe(0);
  });

  it('turns the board round the plaza when a string passes where it would stand, and clears strings from a standing board', () => {
    const through = [...STREETS, line([0, -30], [0, 0], 2)];
    const { root, layer } = rig(through);
    layer.apply(town({ board: boardFrame() }), 20_000);
    const caption = layer.captionPoint()!;
    expect(Math.abs(caption.x)).toBeGreaterThan(3);
    const flags = instances(root, n => n.startsWith('moment-town-flag-'));
    const origin = new THREE.Vector3(caption.x, 0, caption.z);
    expect(flags.every(f => Math.hypot(f.position.x - origin.x, f.position.z - origin.z) > DECREE_PLACE.keepClear - 1.5)).toBe(true);
  });

  it('draws nothing past its bounds and lets go of everything on dispose', () => {
    const { root, layer } = rig();
    layer.apply(town({ board: boardFrame(), festival: { id: 'f', t: 9000, dressed: 1, colour: 'gold' }, colourChange: { from: 'rose', to: 'gold', wave: 0.4 } }), 9000);
    const stats = layer.stats();
    expect(stats.pennants).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(stats)) expect(Number.isFinite(value), key).toBe(true);
    const m = new THREE.Matrix4();
    root.traverse(object => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      for (let i = 0; i < object.count; i++) { object.getMatrixAt(i, m); expect(m.elements.every(Number.isFinite)).toBe(true); }
    });
    layer.dispose();
    expect(root.children).toHaveLength(0);
  });
});
