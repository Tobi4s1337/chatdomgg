import { describe, expect, it } from 'vitest';
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import type { GateSnapshot, JourneySnapshot } from './controller';
import {
  ARRIVAL_FRESH_MS, arrivingHere, clearJourneyMemo, gateForPage, JOURNEY_MEMO_KEY, JOURNEY_MEMO_MS, journeyScene, readJourneyMemo, RISE_MS, ROAD_MS,
  stepThroughAt, walkPath, writeJourneyMemo, type JourneyMemo, mapCarriesJourney } from './journey';

const T0 = 1_800_000_000_000;
const HOME = { kingdomId: '129634568' as KingdomId, name: 'Willowmere', login: '' };
const FERN = '41000002' as KingdomId;

function store(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(), key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, String(value)); }, removeItem: key => { values.delete(key); },
  };
}

const memo = (extra: Partial<JourneyMemo> = {}): JourneyMemo => ({ version: 1, home: HOME, to: null, at: T0, ...extra });

function trip(state: JourneySnapshot['state'], extra: Partial<JourneySnapshot> = {}): JourneySnapshot {
  return { kind: 'raid', ticket: 't-1', state, from: HOME.kingdomId, to: FERN, destination: null, role: state === 'committed' ? 'visitor' : null,
    arrivalId: state === 'committed' ? 'arrival.t-1' : null, overrun: false, refusal: null, busy: null, ...extra };
}

const snap = (journey: JourneySnapshot | null): GateSnapshot => ({
  phase: 'departed', origin: 'live', mapOrigin: 'live', viewer: 'walker', authority: null, source: HOME, destination: null, requestId: 'r-1', optedIn: 3,
  joined: true, expiresAt: T0 + 60_000, state: 'landed', countdownEndsAt: null, raid: null, checking: null, canStart: false, busy: null, farewell: null,
  asking: null, notice: null, canReconnect: false, journey, canTravel: journey === null, welcome: null,
});

describe('journey memo', () => {
  it('keeps only a well-formed, recent memo of the home gate', () => {
    const storage = store();
    writeJourneyMemo(storage, memo({ to: FERN }));
    expect(readJourneyMemo(storage, T0 + 1000)).toEqual(memo({ to: FERN }));
    expect(readJourneyMemo(storage, T0 + JOURNEY_MEMO_MS + 1)).toBeNull();
    // A memo dated in the future is not believed.
    expect(readJourneyMemo(storage, T0 - 120_000)).toBeNull();
    clearJourneyMemo(storage);
    expect(readJourneyMemo(storage, T0)).toBeNull();
  });

  it('reads anything edited or foreign as no memo at all', () => {
    const storage = store();
    for (const bad of ['{', '"x"', JSON.stringify({ ...memo(), version: 2 }), JSON.stringify({ ...memo(), home: { ...HOME, kingdomId: '0' } }),
      JSON.stringify({ ...memo(), home: { ...HOME, login: 'Not A Login' } }), JSON.stringify({ ...memo(), to: 'x' }), JSON.stringify({ ...memo(), at: 'now' })]) {
      storage.setItem(JOURNEY_MEMO_KEY, bad);
      expect(readJourneyMemo(storage, T0)).toBeNull();
    }
    expect(readJourneyMemo(null, T0)).toBeNull();
  });

  it('asks the home gate only while the person walks somewhere else', () => {
    const here = { kingdomId: FERN, name: 'Fernhollow', login: '' };
    expect(gateForPage(here, memo())).toBe(HOME);
    expect(gateForPage(here, null)).toBe(here);
    expect(gateForPage(HOME, memo())).toBe(HOME);
  });
});

describe('walking on', () => {
  it('walks in through the ordinary door, keeping only the mock stack’s simulated source', () => {
    expect(walkPath(FERN, '')).toBe(`/?walk=1&kingdom=${FERN}`);
    expect(walkPath(FERN, '?walk=1&kingdom=129634568&source=simulated')).toBe(`/?walk=1&kingdom=${FERN}&source=simulated`);
    expect(walkPath(FERN, '?source=live&debug=1')).toBe(`/?walk=1&kingdom=${FERN}`);
  });

  it('draws the road only once a place is held, and steps through only on the authority’s commit', () => {
    expect(journeyScene(snap(null), HOME.kingdomId)).toEqual({ kind: 'none' });
    expect(journeyScene(snap(trip('asking')), HOME.kingdomId)).toEqual({ kind: 'none' });
    expect(journeyScene(snap(trip('reserved')), HOME.kingdomId)).toMatchObject({ kind: 'road', stage: 'rise' });
    expect(journeyScene(snap(trip('preparing')), HOME.kingdomId)).toMatchObject({ kind: 'road', stage: 'road' });
    expect(journeyScene(snap(trip('ready')), HOME.kingdomId)).toMatchObject({ kind: 'road', stage: 'drawing' });
    expect(journeyScene(snap(trip('committing')), HOME.kingdomId)).toMatchObject({ kind: 'road', stage: 'drawing' });
    expect(journeyScene(snap(trip('unknown')), HOME.kingdomId)).toMatchObject({ kind: 'road', stage: 'drawing' });
    expect(journeyScene(snap(trip('committed')), HOME.kingdomId)).toMatchObject({ kind: 'through', to: FERN, home: false });
  });

  it('never moves a page that already shows where its person stands, or a journey that ended', () => {
    expect(journeyScene(snap(trip('committed')), FERN)).toEqual({ kind: 'none' });
    for (const state of ['cancelled', 'expired', 'denied'] as const) expect(journeyScene(snap(trip(state)), HOME.kingdomId)).toEqual({ kind: 'none' });
    expect(journeyScene(snap(trip('reserved', { refusal: 'full' })), HOME.kingdomId)).toEqual({ kind: 'none' });
  });

  it('walks home on a committed return', () => {
    const home = trip('committed', { kind: 'return', from: FERN, to: HOME.kingdomId, role: 'citizen' });
    expect(journeyScene(snap(home), FERN)).toMatchObject({ kind: 'through', to: HOME.kingdomId, home: true });
    expect(journeyScene(snap(home), HOME.kingdomId)).toEqual({ kind: 'none' });
  });

  it('never cuts the rise and the road short, however fast the authority answers', () => {
    expect(stepThroughAt(T0, T0 + 300)).toBe(T0 + RISE_MS + ROAD_MS);
    expect(stepThroughAt(T0, T0 + 10_000)).toBe(T0 + 10_000);
    // A journey restored straight into its commit still shows a rise.
    expect(stepThroughAt(null, T0)).toBe(T0 + RISE_MS);
  });

  it('opens on the drawing only right after stepping through into this kingdom', () => {
    expect(arrivingHere(memo({ to: FERN }), FERN, T0 + 5_000)).toBe(true);
    expect(arrivingHere(memo({ to: FERN }), FERN, T0 + ARRIVAL_FRESH_MS + 1)).toBe(false);
    expect(arrivingHere(memo({ to: FERN }), HOME.kingdomId, T0 + 5_000)).toBe(false);
    expect(arrivingHere(memo(), FERN, T0)).toBe(false);
    expect(arrivingHere(null, FERN, T0)).toBe(false);
  });
});

describe('which surface carries the road', () => {
  const from = '154972160' as KingdomId, to = '4363967' as KingdomId;
  it('rides the Atlas only when it is drawn and placed both ends', () => {
    expect(mapCarriesJourney(true, new Map([[from, true], [to, true]]), { from, to })).toBe(true);
  });
  it('keeps the parchment for a map still loading, an end off the map, or an end not yet looked up', () => {
    expect(mapCarriesJourney(false, new Map([[from, true], [to, true]]), { from, to })).toBe(false);
    expect(mapCarriesJourney(true, new Map([[from, true], [to, false]]), { from, to })).toBe(false);
    expect(mapCarriesJourney(true, new Map([[from, true]]), { from, to })).toBe(false);
  });
});
