import { describe, expect, it } from 'vitest';
import { grandSketchRecipe } from '../../../../packages/world/src/grand/sketch';
import { HoldingError, type DoorHolding } from '../../../web/src/atlas/data/holding';
import { grandSeedForHolding } from '../../../web/src/grand/holding-world';
import { ATLAS_WORLD_TTL_MS, atlasTrustedWorld } from './atlas-world';

const holding = (id: string, name: string, average: number, game: string | null): DoorHolding => ({
  version: 1, id, login: name.toLowerCase(), name, freshUntil: 0, tier: 'town', average,
  game: game ? { id: null, name: game } : null, realm: { kind: 'family', family: 'shooters', name: 'Shooters' },
  region: { language: 'en', name: 'English' }, x: 1, y: 2,
  survey: { preview: 'p1', revision: 'r1', asOf: 1, windowHours: 168 },
});

describe('the world a channel’s own Atlas facts give, read by the realm', () => {
  it('is exactly the recipe an honest page makes from the same holding', async () => {
    const facts = holding('63920635', 'The_AGGman', 410, 'Hunt: Showdown 1896');
    const trusted = atlasTrustedWorld({ base: 'http://atlas.invalid/map-data', read: async () => facts });
    expect(await trusted('63920635')).toEqual(grandSketchRecipe(grandSeedForHolding(facts)));
  });

  it('gives no world for a missing, withheld or mismatched holding and no answer when the Atlas is away', async () => {
    const answers: Record<string, () => Promise<DoorHolding>> = {
      '1': async () => { throw new HoldingError('missing', 'gone'); },
      '2': async () => { throw new HoldingError('withheld', 'hidden'); },
      '3': async () => holding('4', 'Someone', 3, null),
      '5': async () => { throw new HoldingError('unavailable', 'away'); },
      '6': async () => { throw new TypeError('fetch failed'); },
    };
    const trusted = atlasTrustedWorld({ base: 'http://atlas.invalid', read: id => answers[id]!() });
    expect(await trusted('1')).toBeNull();
    expect(await trusted('2')).toBeNull();
    expect(await trusted('3')).toBeNull();
    expect(await trusted('5')).toBeUndefined();
    expect(await trusted('6')).toBeUndefined();
  });

  it('keeps an answer for a while, rereads after, and never keeps “cannot tell”', async () => {
    let clock = 0, reads = 0, away = true;
    const trusted = atlasTrustedWorld({ base: 'http://atlas.invalid', now: () => clock, read: async id => {
      reads++;
      if (away) throw new HoldingError('unavailable', 'away');
      return holding(id, 'MashaD4', 90, 'Just Chatting');
    } });
    expect(await trusted('154972160')).toBeUndefined();
    away = false;
    const first = await trusted('154972160');
    expect(first?.seed.name).toBe('MashaD4');
    expect(await trusted('154972160')).toBe(first);
    expect(reads).toBe(2);
    clock += ATLAS_WORLD_TTL_MS;
    await trusted('154972160');
    expect(reads).toBe(3);
  });
});
