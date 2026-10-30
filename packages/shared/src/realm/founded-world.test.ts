import { expect, it } from 'vitest';
import { KingdomIdSchema } from '../identity';
import { RealmFoundedManifestSchema } from './founded-world';

it('accepts an exact public geometry receipt and refuses private state or an unrepresentable collision revision', () => {
  const receipt = { version: 1, kingdomId: KingdomIdSchema.parse('999000001'), origin: 'simulated',
    layoutRevision: 'settlement:adopted-3', collisionRevision: 7, sceneHash: 'a'.repeat(64) } as const;
  expect(RealmFoundedManifestSchema.parse(receipt)).toEqual(receipt);
  expect(RealmFoundedManifestSchema.safeParse({ ...receipt, ownerId: '990000001', words: 'private creation input' }).success).toBe(false);
  expect(RealmFoundedManifestSchema.safeParse({ ...receipt, collisionRevision: 0x100000000 }).success).toBe(false);
  expect(RealmFoundedManifestSchema.safeParse({ ...receipt, sceneHash: 'a seed is not an asset digest' }).success).toBe(false);
});
