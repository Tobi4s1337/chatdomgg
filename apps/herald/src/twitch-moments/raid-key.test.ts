import { describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import { RealmMomentObservationSchema } from '@chatdom/shared/realm';
import { applySpectacle } from '../../../realm/src/moments/spectacles';
import { raidIdForEvent } from '../../../realm/src/raid-gate/observations';
import { providerToken } from './credit';
import { createMemoryMomentRecords } from './memory';
import { momentRepository } from './records';

describe('one witnessed public raid identity', () => {
  it('joins the actual spectacle body to durable evidence without putting the provider ID in its raid key', async () => {
    const kingdomId = KingdomIdSchema.parse('129634568'), now = 1_800_000_000_000;
    const memory = createMemoryMomentRecords({ now: () => now });
    for (const id of ['private-event:incoming-1', 'X'.repeat(120)]) {
      const observation = RealmMomentObservationSchema.parse({ version: 1, origin: 'simulated', kingdomId,
        id, occurredAt: now, receivedAt: now, notice: { kind: 'raid',
          from: { kingdomId: '12826', login: 'mashad4', name: 'MashaD4' }, viewers: 140 } });
      const result = await memory.port.transact(kingdomId, tx => applySpectacle(observation, {
        kingdomId, repository: momentRepository(tx), directory: { resolve: async () => null }, founded: async () => false,
      }));
      expect(result.outcome).toBe('applied');
      if (result.outcome !== 'applied') throw new Error('Expected a raid spectacle');
      expect(result.facts[0]?.body).toMatchObject({ kind: 'raid', key: raidIdForEvent(id), raidKey: raidIdForEvent(id) });
      expect(result.facts[0]?.body).not.toHaveProperty('eventId');
      expect(JSON.stringify(result.facts[0]?.body)).not.toContain(id);
    }
  });

  it('retains other provider token families and keeps raid identity case sensitive', () => {
    expect(providerToken('cheer', 'Example:receipt-1')).toBe('cheer.Example:receipt-1');
    expect(providerToken(null, 'Example:receipt-1')).toBe('Example:receipt-1');
    expect(providerToken('raid', 'Receipt')).not.toBe(providerToken('raid', 'receipt'));
    expect(providerToken('raid', 'Receipt')).toBe(raidIdForEvent('Receipt'));
  });
});
