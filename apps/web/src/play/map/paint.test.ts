import { describe, expect, it } from 'vitest';
import type { SettlementPlan } from '@chatdom/world';
import oldTown from '../../../../realm/src/founded/artifacts/simulated-town.scene.json';
import type { PlayMapView } from '../host';
import { createMapLayers, fitTown, paintTownMap, PERSON_INK, type MapFrame, type MapSurface } from './paint';
import { mapPeople } from './people';
import { routeHome, streetGraph } from './route';
import { homeDoor, townMapFrom, type TownMap } from './town';

/**
 * The painter, against a recording 2D context: it shows you and your friends and nobody else, it paints the town once
 * per revision and scale, and it draws an empty town without a fault.
 */

interface Call { readonly name: string; readonly args: readonly unknown[] }
interface Recording { readonly calls: Call[]; readonly sets: { name: string; value: unknown }[]; readonly context: CanvasRenderingContext2D }

function recorder(): Recording {
  const calls: Call[] = [], sets: { name: string; value: unknown }[] = [];
  const state = new Map<string | symbol, unknown>();
  const gradient = () => ({ addColorStop() { /* a gradient's stops change nothing recorded */ } });
  const context = new Proxy({}, {
    get(_, key) {
      if (state.has(key)) return state.get(key);
      if (key === 'measureText') return (text: string) => { calls.push({ name: 'measureText', args: [text] }); return { width: String(text).length * 7 }; };
      if (key === 'createImageData') return (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args: unknown[]) => { calls.push({ name: String(key), args }); return gradient(); };
      if (key === 'createPattern') return () => ({ pattern: true });
      return (...args: unknown[]) => { calls.push({ name: String(key), args }); };
    },
    set(_, key, value) { state.set(key, value); sets.push({ name: String(key), value }); return true; },
  }) as CanvasRenderingContext2D;
  return { calls, sets, context };
}

function surfaces() {
  const made: { surface: MapSurface; recording: Recording }[] = [];
  const factory = (width: number, height: number): MapSurface => {
    const recording = recorder();
    const surface = { width, height, getContext: () => recording.context };
    made.push({ surface, recording });
    return surface;
  };
  return { made, factory };
}

const plan = (oldTown as unknown as { plan: SettlementPlan }).plan;
const town = townMapFrom(plan);
const home = plan.homes[37]!;
const door = homeDoor(plan, home);
const feet: [number, number, number] = [door[0] + 90, door[1], door[2] + 40];
const route = routeHome(plan, streetGraph(plan), feet, home.id);

const view = (patch: Partial<PlayMapView> = {}): PlayMapView => ({
  town, home: home.id, inside: false, route, view: .4,
  people: { you: { x: feet[0], z: feet[2], heading: .8 }, friends: [] }, ...patch,
});
const mini = (patch: Partial<MapFrame> = {}): MapFrame => ({ width: 132, height: 132, dpr: 1, centre: [feet[0], feet[2]], metresPerPixel: .84, style: 'mini', time: 0, ...patch });
const page = (patch: Partial<MapFrame> = {}): MapFrame => {
  const fit = fitTown(town, 540, 480);
  return { width: 540, height: 480, dpr: 1, centre: fit.centre, metresPerPixel: fit.metresPerPixel, style: 'page', time: 0, ...patch };
};

/** Each person marker sets its own ink exactly once. */
const markers = (recording: Recording, ink: string) => recording.sets.filter(set => set.name === 'strokeStyle' && set.value === ink).length;
const written = (recording: Recording) => recording.calls.filter(call => call.name === 'fillText').map(call => String(call.args[0]));

describe('the painted map shows only you and your friends', () => {
  for (const [style, frame] of [['minimap', mini()], ['big map', page()]] as const) {
    it(`draws one person, you, on the ${style} when you have no friends`, () => {
      const { factory } = surfaces();
      const screen = recorder();
      // Strangers sit right beside you in the street, on a field the map has no business reading.
      const crowded = { ...view(), walkers: [{ id: 'stranger', name: 'Stranger', position: [feet[0] + 2, 0, feet[2] + 1], yaw: 0, self: false }] } as PlayMapView;
      paintTownMap(screen.context, crowded, frame, createMapLayers(factory));
      expect(markers(screen, PERSON_INK.you)).toBe(1);
      expect(markers(screen, PERSON_INK.friend)).toBe(0);
      expect(written(screen)).not.toContain('Stranger');
    });
  }

  it('never draws a stranger from the street at any zoom, on either map, with or without a friend authority', () => {
    // The real door: the walkers in the street through mapPeople, then the painter, at every zoom both maps allow.
    const street = [
      { id: 'me', name: 'MarigoldWren', position: feet, yaw: .8, self: true },
      { id: 'friend', name: 'Wren', position: [feet[0] + 12, feet[1], feet[2]], yaw: 0, self: false },
      { id: 'stranger-1', name: 'MarigoldWren', position: [feet[0] + 1, feet[1], feet[2] + 1], yaw: 0, self: false },
      { id: 'stranger-2', name: 'Tamsin', position: [feet[0] - 40, feet[1], feet[2] + 30], yaw: 0, self: false },
    ] as const;
    const fitted = page().metresPerPixel;
    const zooms = [['minimap', (m: number) => mini({ metresPerPixel: m }), [.3, .84, 2]], ['big map', (m: number) => page({ metresPerPixel: m, centre: [feet[0], feet[2]] }), [fitted / 8, fitted / 2, fitted, fitted * 1.15]]] as const;
    for (const authority of [null, { mutual: () => new Set(['friend']) }]) {
      const people = mapPeople(street, authority);
      for (const [, frame, scales] of zooms) for (const scale of scales) {
        const screen = recorder();
        paintTownMap(screen.context, view({ people }), frame(scale), createMapLayers(surfaces().factory));
        expect(markers(screen, PERSON_INK.you)).toBe(1);
        expect(markers(screen, PERSON_INK.friend)).toBeLessThanOrEqual(authority ? 1 : 0);
        expect(written(screen)).not.toContain('Tamsin');
      }
    }
  });

  it('draws each friend once, named on the big map', () => {
    const { factory } = surfaces();
    const screen = recorder();
    const friends = [{ id: 'f1', name: 'Wren', x: feet[0] + 20, z: feet[2] }, { id: 'f2', name: 'Tamsin', x: feet[0] - 30, z: feet[2] + 10 }];
    paintTownMap(screen.context, view({ people: { you: { x: feet[0], z: feet[2], heading: 0 }, friends } }), page({ centre: [feet[0], feet[2]] }), createMapLayers(factory));
    expect(markers(screen, PERSON_INK.friend)).toBe(2);
    expect(markers(screen, PERSON_INK.you)).toBe(1);
    expect(written(screen)).toEqual(expect.arrayContaining(['Wren', 'Tamsin']));
  });

  it('draws nobody before the walk has placed you', () => {
    const { factory } = surfaces();
    const screen = recorder();
    paintTownMap(screen.context, view({ people: { you: null, friends: [] } }), page(), createMapLayers(factory));
    expect(markers(screen, PERSON_INK.you) + markers(screen, PERSON_INK.friend)).toBe(0);
  });

  it('never writes a home owner: the town layer names places and streets only', () => {
    const { factory, made } = surfaces();
    paintTownMap(recorder().context, view(), page(), createMapLayers(factory));
    const names = new Set([...town.places.map(place => place.name), ...town.streets.map(street => street.name)]);
    const words = made.flatMap(({ recording }) => written(recording));
    expect(words.length).toBeGreaterThan(0);
    // Street names are set letter by letter; every word or letter belongs to a place or a street.
    const letters = new Set([...names].join(''));
    for (const word of words) expect(names.has(word) || (word.length === 1 && letters.has(word)) || /^\d+ m$|^0$/.test(word)).toBe(true);
  });
});

describe('the town layer is painted once and kept', () => {
  it('paints the town once for many frames of one revision, as you walk', () => {
    const { factory } = surfaces();
    const layers = createMapLayers(factory);
    for (let i = 0; i < 6; i++) {
      paintTownMap(recorder().context, view({ people: { you: { x: feet[0] + i * 3, z: feet[2], heading: i * .2 }, friends: [] } }),
        mini({ centre: [feet[0] + i * 3, feet[2]], time: i / 30 }), layers);
    }
    expect(layers.townPaints).toBe(1);
    expect(layers.groundPaints).toBe(1);
  });

  it('paints again for a new revision, a new scale, or new fonts, and reuses it mid-gesture', () => {
    const { factory } = surfaces();
    const layers = createMapLayers(factory);
    const screen = recorder().context;
    paintTownMap(screen, view(), page(), layers);
    expect(layers.townPaints).toBe(1);
    const next: TownMap = { ...town, revision: `${town.revision}:next` };
    paintTownMap(screen, view({ town: next }), page(), layers);
    expect(layers.townPaints).toBe(2);
    paintTownMap(screen, view({ town: next }), page({ metresPerPixel: page().metresPerPixel / 2, quick: true }), layers);
    expect(layers.townPaints).toBe(2);
    paintTownMap(screen, view({ town: next }), page({ metresPerPixel: page().metresPerPixel / 2 }), layers);
    expect(layers.townPaints).toBe(3);
    layers.invalidate();
    paintTownMap(screen, view({ town: next }), page({ metresPerPixel: page().metresPerPixel / 2 }), layers);
    expect(layers.townPaints).toBe(4);
  });

  it('holds only the frame and its surroundings when the whole town would be too large', () => {
    const { factory, made } = surfaces();
    const layers = createMapLayers(factory);
    paintTownMap(recorder().context, view(), page({ metresPerPixel: .05, dpr: 2, centre: [0, 10] }), layers);
    const biggest = Math.max(...made.map(({ surface }) => surface.width * surface.height));
    expect(biggest).toBeLessThanOrEqual(4096 * 4096);
    // A small step inside the held window keeps it; a long walk paints a new one.
    paintTownMap(recorder().context, view(), page({ metresPerPixel: .05, dpr: 2, centre: [1, 10] }), layers);
    expect(layers.townPaints).toBe(1);
    paintTownMap(recorder().context, view(), page({ metresPerPixel: .05, dpr: 2, centre: [80, 10] }), layers);
    expect(layers.townPaints).toBe(2);
  });
});

describe('an empty town', () => {
  const empty: TownMap = {
    revision: 'empty', bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, streets: [], waters: [], streams: [], market: [], courts: [],
    castle: { bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, court: [], modules: [] }, places: [], homes: [],
  };
  it('paints bare paper without a fault, on both maps', () => {
    for (const frame of [mini({ centre: [0, 0] }), page({ centre: [0, 0], metresPerPixel: 1 })]) {
      const { factory } = surfaces();
      expect(() => paintTownMap(recorder().context, { town: empty, people: { you: null, friends: [] }, home: 'plot:gone', inside: false, route: null, view: null }, frame,
        createMapLayers(factory))).not.toThrow();
    }
  });
  it('fits an empty town to a sane frame', () => {
    expect(fitTown(empty, 400, 300)).toEqual({ centre: [0, 0], metresPerPixel: 1 });
  });
  it('paints nothing into a frame with no size', () => {
    const { factory } = surfaces();
    const screen = recorder();
    paintTownMap(screen.context, view(), mini({ width: 0 }), createMapLayers(factory));
    expect(screen.calls).toHaveLength(0);
  });
});
