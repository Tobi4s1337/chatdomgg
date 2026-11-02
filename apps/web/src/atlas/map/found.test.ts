// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dabHashOf, type ChannelFace } from '../data/directory';
import { parseFoundedKingdoms } from '../data/kingdoms';
import { FOUND_LIMIT, FOUND_SESSION_KEY, foundable, foundIds, foundMarks, FoundRegistry, readFoundSession, writeFoundSession, type FoundGate } from './found';

const face = (id: string, extra: Partial<ChannelFace> = {}): ChannelFace => ({
  id, login: `chan${id}`, name: `Chan${id}`, freshUntil: Date.UTC(2026, 10, 3), place: 'waiting', ordinal: null, tier: null, region: 0, realm: 4, ...extra,
});
const tobias = face('129634568', { login: 'tobi4s_', name: 'tobi4s_' });
const TOBIAS_PLACE = { x: -11.2, y: 355.6 };
const open: FoundGate = { byId: new Set<string>(), isWithheld: () => false };
const door = parseFoundedKingdoms({ mode: 'live', kingdoms: [{ kingdomId: '129634568', name: 'Willowmere', login: 'tobi4s_' }] });

describe('a found channel', () => {
  it('is drawn at its pencil place as a pencil flag with its own name', () => {
    const found = new FoundRegistry();
    expect(found.add(face('777'), { x: 4, y: -9 })).toBe(true);
    expect(foundMarks(found.list(), open, new Map())).toEqual([{ id: '777', kind: 'waiting', label: 'Chan777', x: 4, y: -9, hash: dabHashOf('777') }]);
  });

  it('is drawn as its founded kingdom, arms on a hamlet with the kingdom’s name, where the door names it', () => {
    const found = new FoundRegistry();
    found.add(tobias, TOBIAS_PLACE);
    const [mark] = foundMarks(found.list(), open, door);
    expect(mark).toEqual({ id: '129634568', kind: 'kingdom', label: 'Willowmere', x: -11.2, y: 355.6, hash: dabHashOf('129634568') });
  });

  it('is a kingdom only under the login the register gave, and never from a simulated door', () => {
    const found = new FoundRegistry();
    found.add(face('129634568', { login: 'someone_else', name: 'Someone' }), TOBIAS_PLACE);
    expect(foundMarks(found.list(), open, door)[0]!.kind).toBe('waiting');
    const simulated = parseFoundedKingdoms({ mode: 'simulated', kingdoms: [{ kingdomId: '129634568', name: 'Willowmere', login: 'tobi4s_' }] });
    const again = new FoundRegistry();
    again.add(tobias, TOBIAS_PLACE);
    expect(foundMarks(again.list(), open, simulated)[0]!.kind).toBe('waiting');
  });

  it('stands at the same place however often it is found, and several are drawn at once', () => {
    const found = new FoundRegistry();
    found.add(tobias, TOBIAS_PLACE);
    found.add(face('5'), { x: 1, y: 2 });
    found.add(tobias, TOBIAS_PLACE);
    const marks = foundMarks(found.list(), open, door);
    expect(marks.map(mark => mark.id)).toEqual(['5', '129634568']);
    expect(marks.find(mark => mark.id === '129634568')).toMatchObject(TOBIAS_PLACE);
  });

  it('is never drawn while withheld (the operator’s list or its own hide), and comes back when shown again', () => {
    const found = new FoundRegistry();
    found.add(tobias, TOBIAS_PLACE);
    found.add(face('5'), { x: 1, y: 2 });
    const hidden = new Set(['129634568']);
    const gate: FoundGate = { byId: new Set(), isWithheld: (id) => hidden.has(id) };
    expect(foundMarks(found.list(), gate, door).map(mark => mark.id)).toEqual(['5']);
    hidden.clear();
    expect(foundMarks(found.list(), gate, door).map(mark => mark.id)).toEqual(['129634568', '5']);
  });

  it('gives way to its holding once the world holds it, so it is never drawn twice', () => {
    const found = new FoundRegistry();
    found.add(face('5'), { x: 1, y: 2 });
    expect(foundMarks(found.list(), { byId: new Set(['5']), isWithheld: () => false }, door)).toEqual([]);
  });

  it('is only ever a named waiting channel at a finite place: never a holding, an unseen channel or a guess', () => {
    expect(foundable(face('5'), { x: 1, y: 2 })).toBe(true);
    expect(foundable(face('5', { place: 'mapped' }), { x: 1, y: 2 })).toBe(false);
    expect(foundable(face('5', { place: 'unseen' }), { x: 1, y: 2 })).toBe(false);
    expect(foundable(face('5'), undefined)).toBe(false);
    expect(foundable(face('5'), { x: Number.NaN, y: 2 })).toBe(false);
    expect(foundable(face('5x'), { x: 1, y: 2 })).toBe(false);
    const found = new FoundRegistry();
    expect(found.add(face('5', { place: 'mapped' }), { x: 1, y: 2 })).toBe(false);
    expect(found.size).toBe(0);
  });

  it('keeps at most the limit, the oldest giving way', () => {
    const found = new FoundRegistry();
    for (let i = 1; i <= FOUND_LIMIT + 3; i++) found.add(face(String(i)), { x: i, y: i });
    expect(found.size).toBe(FOUND_LIMIT);
    expect(found.ids()[0]).toBe('4');
    expect(found.ids().at(-1)).toBe(String(FOUND_LIMIT + 3));
  });

  it('drops what a predicate refuses and changes its version only on a change', () => {
    const found = new FoundRegistry();
    found.add(face('1'), { x: 1, y: 1 });
    found.add(face('2'), { x: 2, y: 2 });
    const before = found.version;
    expect(found.keep(() => true)).toBe(false);
    expect(found.version).toBe(before);
    expect(found.keep(entry => entry.face.id !== '1')).toBe(true);
    expect(found.ids()).toEqual(['2']);
    expect(found.version).toBe(before + 1);
    expect(found.add(face('2'), { x: 2, y: 2 })).toBe(false);
  });
});

describe('found channels across a reload', () => {
  const memory = () => {
    const items = new Map<string, string>();
    return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key), items };
  };

  it('keeps only IDs in the session, for the same map alone', () => {
    const storage = memory();
    writeFoundSession(storage, 'pv-a', ['129634568', '5']);
    expect(JSON.parse(storage.items.get(FOUND_SESSION_KEY)!)).toEqual({ mapId: 'pv-a', ids: ['129634568', '5'] });
    expect(readFoundSession(storage, 'pv-a')).toEqual(['129634568', '5']);
    expect(readFoundSession(storage, 'pv-b')).toEqual([]);
    writeFoundSession(storage, 'pv-a', []);
    expect(storage.items.has(FOUND_SESSION_KEY)).toBe(false);
  });

  it('never trusts a damaged or forged value', () => {
    const storage = memory();
    storage.setItem(FOUND_SESSION_KEY, '{not json');
    expect(readFoundSession(storage, 'pv-a')).toEqual([]);
    expect(readFoundSession(null, 'pv-a')).toEqual([]);
    expect(foundIds(['1', 2, '../x', '1', 'abc', '3'])).toEqual(['1', '3']);
    expect(foundIds('1')).toEqual([]);
    expect(foundIds(Array.from({ length: 40 }, (_, i) => String(i + 1)), 12)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 29)));
  });
});
