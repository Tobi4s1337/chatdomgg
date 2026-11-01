import { expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { VOXEL_FIXTURE } from '@chatdom/shared/world-fixtures';
import type { RealmFact, RealmOwnedHome } from '@chatdom/shared/realm';
import { createRealmState } from '@chatdom/world/realm';
import type { RealmCommitGuard } from '../persistence/postgres-repository';
import { verifyAllocation } from './guard';

it('binds the installed deed tier, refusing a fabricated floor or another receipt', async () => {
  const kingdomId = KingdomIdSchema.parse('900010001'), ownerId = PersonIdSchema.parse('900010002');
  const receipt = `deed:${'a'.repeat(64)}`;
  const home: RealmOwnedHome = { id: 'plot:7', ownerId, slot: 7, allocationReceipt: receipt, layoutRevision: 'layout:1',
    revision: 'home:1', digest: 'b'.repeat(64), family: 'hearth', blueprint: VOXEL_FIXTURE, attachments: {},
    attribution: { makerName: 'SIMULATED Juniper', kingdomName: 'SIMULATED test', approvalId: 'test:approval' } };
  const state = { ...createRealmState(kingdomId, 'simulated'), homes: { [home.id]: home } };
  const deed = { person_id: ownerId, kingdom_id: kingdomId, origin: 'simulated', layout_revision: home.layoutRevision,
    plot_id: home.id, slot: home.slot, status: 'installed', placement: JSON.stringify({ tier: 'cottage' }) };
  const tx = { query: async () => ({ rows: [deed] }) } as unknown as Parameters<RealmCommitGuard>[0];
  const fact: RealmFact = { version: 1, kingdomId, origin: 'simulated', seq: 1, writerEpoch: 'test:writer',
    occurredAt: 10, receivedAt: 10, committedAt: 10, actor: null, cause: { kind: 'intent', id: 'test:bind' },
    type: 'realm.transaction', body: { type: 'growth.bindHome', homeId: home.id, installedTier: 'cottage', evidenceReceipt: receipt } };
  expect(await verifyAllocation(tx, fact, state)).toBe('ok');
  expect(await verifyAllocation(tx, { ...fact, body: { ...fact.body as Extract<RealmFact['body'], { type: 'growth.bindHome' }>, installedTier: 'hall' } }, state)).toBe('conflict');
  expect(await verifyAllocation(tx, { ...fact, body: { ...fact.body as Extract<RealmFact['body'], { type: 'growth.bindHome' }>, evidenceReceipt: `deed:${'c'.repeat(64)}` } }, state)).toBe('conflict');
});
