// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DOOR_KEY, doorHolding, handOffHolding, takeHandOff, waitingDoorHolding } from './holding';
import type { CardReply } from './directory';
import type { StorageLike } from './load';
import type { Settler } from './model';
import type { PreviewWorld } from './preview';

const world = {
  id: 'pv-test', revision: 'obs-test', asOf: 1_793_453_897_230,
  window: { firstObservationAt: 0, lastObservationAt: 0, hours: 45.89, sweeps: 0, gapCount: 0 },
  games: [{ name: 'VALORANT', gameId: '516575' }],
  families: [{ id: 'shooters', name: 'Shooters' }],
  realms: [{ kind: 'family', family: 0, name: 'Shooters' }, { kind: 'isle', family: -1, name: 'Polski' }],
  regions: [{ language: 'en', name: 'English', englishName: 'English' }, { language: 'pl', name: 'Polski', englishName: 'Polish' }],
} as unknown as PreviewWorld;

const settler = (over: Partial<Settler> = {}): Settler => ({
  index: 0, ordinal: 0, id: '71092938', login: 'example', name: 'Example', freshUntil: 1_793_540_000_000, withheld: false,
  tier: 'town', tierRank: 2, x: 12, y: -4, average: 312.4, game: 'VALORANT', region: 0, realm: 0, realmName: 'Shooters', ...over,
});

const memory = (): StorageLike & { items: Map<string, string> } => {
  const items = new Map<string, string>();
  return { items, getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); }, removeItem: key => { items.delete(key); } };
};

describe('the door into a holding', () => {
  it('reads the holding as the Atlas shows it, with the survey it comes from', () => {
    expect(doorHolding(settler(), world)).toEqual({
      version: 1, id: '71092938', login: 'example', name: 'Example', freshUntil: 1_793_540_000_000, tier: 'town', average: 312.4,
      game: { id: '516575', name: 'VALORANT' },
      realm: { kind: 'family', family: 'shooters', name: 'Shooters' },
      region: { language: 'en', name: 'English' }, x: 12, y: -4,
      survey: { preview: 'pv-test', revision: 'obs-test', asOf: 1_793_453_897_230, windowHours: 45.89 },
    });
    expect(doorHolding(settler({ realm: 1, region: 1, realmName: 'Polski', game: null }), world)).toMatchObject({
      game: null, realm: { kind: 'isle', family: null, name: 'Polski' }, region: { language: 'pl', name: 'Polish' } });
  });

  it('has no door for a withheld or unnamed holding', () => {
    expect(doorHolding(settler({ withheld: true }), world)).toBeNull();
    expect(doorHolding(settler({ name: null }), world)).toBeNull();
    expect(doorHolding(settler({ login: null }), world)).toBeNull();
  });

  it('opens a public waiting channel without inventing coordinates or category observations', () => {
    const card = { preview: world.id, revision: world.revision, average: 7,
      channel: { id: '71092938', login: 'example', name: 'Example', freshUntil: Date.now() + 60_000, place: 'waiting', region: 0, realm: 0 },
      stream: { game: 'VALORANT' },
    } as unknown as CardReply;
    expect(waitingDoorHolding(card, world)).toMatchObject({ tier: null, x: null, y: null, game: null, average: 7, realm: { family: 'shooters' } });
    expect(waitingDoorHolding({ ...card, average: null }, world)).toBeNull();
    expect(waitingDoorHolding({ ...card, channel: { ...card.channel, name: null, login: null, freshUntil: null } }, world)).toBeNull();
    expect(waitingDoorHolding({ ...card, channel: { ...card.channel, place: 'unseen' } }, world)).toBeNull();
    expect(waitingDoorHolding({ ...card, revision: 'another-survey' }, world)).toBeNull();
  });

  it('hands the holding to the kingdom page only for that channel and only while its name is fresh', () => {
    const storage = memory();
    const holding = doorHolding(settler(), world)!;
    handOffHolding(storage, holding);
    expect(storage.items.has(DOOR_KEY)).toBe(true);
    expect(takeHandOff(storage, '71092938', 1_793_539_999_000)).toEqual(holding);
    expect(takeHandOff(storage, '55501231', 1_793_539_999_000)).toBeNull();
    expect(takeHandOff(storage, '71092938', 1_793_540_000_000)).toBeNull();
    storage.setItem(DOOR_KEY, '{not json');
    expect(takeHandOff(storage, '71092938', 0)).toBeNull();
    expect(takeHandOff(null, '71092938', 0)).toBeNull();
  });
});
