import { describe, expect, it } from 'vitest';
import { seedHash, type KingdomLandInterface } from '@chatdom/world';
import { soulAt } from '../../../../packages/world/src/soul';
import { foundedSoulBinding } from './founded-binding';

function land({ approach = [1, 2, 3], id = 'forge:hearth:v1', assetId = 'civic-forge-hearth-hearth', kind = 'civic' }: {
  approach?: readonly [number, number, number] | null; id?: string; assetId?: string; kind?: string;
} = {}): KingdomLandInterface {
  return { scene: { plan: { config: { seed: 'kingdom' } }, placements: [{ id, assetHash: 'hash' }],
    assets: [{ assetHash: 'hash', blueprint: { id: assetId, kind } }] }, forge: { approach } } as unknown as KingdomLandInterface;
}

describe('founded soul binding', () => {
  it('uses the installed forge and physically supported approach without inventing other places', () => {
    const binding = foundedSoulBinding(land(), 'meadow', 60);
    expect(binding.config).toMatchObject({ seed: seedHash('kingdom'), biome: 'meadow', utcOffsetMinutes: 60,
      topology: { routes: { smith: [[1, 2, 3]] }, lamps: [] } });
    const frame = soulAt({ ...binding.config, population: 0 }, Date.UTC(2026, 4, 1, 9));
    expect(frame.keepers).toMatchObject([{ role: 'smith', position: [1, 2, 3], visible: true }]);
    expect(frame.shipBell).toBe(false);
  });
  it.each([
    { approach: null }, { id: 'home:1' }, { assetId: 'civic-forge-hearth-other' }, { kind: 'home' },
  ])('omits a forge without both authentic installed geometry and supported access: %o', options => {
    expect(foundedSoulBinding(land(options), 'meadow').config.topology.routes).toEqual({});
  });
});

