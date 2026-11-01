import { expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { VOXEL_FIXTURE } from '@chatdom/shared/world-fixtures';
import type { CommittedForgeAttachment, RealmOwnedHome, RealmPublicMessage } from '@chatdom/shared/realm';
import { createRealmState } from '@chatdom/world/realm';
import { createGrowthState, projectGrowthScene } from '@chatdom/world/growth';
import { PublicProjection } from './projection';

it('publishes a first forge, replaces its socket, and keeps a later private build behind its public row', () => {
  const kingdomId = KingdomIdSchema.parse('999000002');
  const home: RealmOwnedHome = { id: 'plot:1', ownerId: PersonIdSchema.parse('990000002'), slot: 0, allocationReceipt: 'private', layoutRevision: 'court',
    revision: 'home:1', digest: 'a'.repeat(64), family: 'hearth', blueprint: VOXEL_FIXTURE,
    attribution: { makerName: 'Juniper', kingdomName: 'Emberwick', approvalId: 'names:1' }, attachments: {} };
  const state = { ...createRealmState(kingdomId, 'simulated'), sequence: 1, homes: { [home.id]: home } };
  const projection = new PublicProjection({ homes: [], cursor: 0, presence: null, sequence: 0 });
  projection.rememberHomes(state);
  const attachment: CommittedForgeAttachment = { version: 1, id: 'run:1', runId: 'run:1', kingdomId, slot: 0, hostId: VOXEL_FIXTURE.id,
    hostFingerprint: 'fingerprint', socketId: 'chimney', origin: [0, 24, 0], kitId: 'hearth', kitRevision: 1, family: 'hearth',
    draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' }, title: 'A sleeping dragon', plaque: 'Warm dreams' },
    committedAt: 2, provenance: { source: 'simulated', makerName: 'Juniper', kingdomName: 'Emberwick', designId: 'design:1', firstForgedAt: 2 } };
  const forge = (id: number, item: CommittedForgeAttachment) => ({ id, sequence: id, eventId: `forge:${id}`, plotId: home.id,
    message: { type: 'forge', event: { type: 'committed', activityId: item.runId, attachment: item } } as RealmPublicMessage });
  expect(projection.current()).toEqual([]);
  projection.adopt([forge(2, attachment)]);
  expect(projection.current()).toEqual([{ type: 'home', plotId: home.id, revision: 'r2', assetHash: home.digest, attachments: [attachment] }]);
  const replacement = { ...attachment, id: 'run:2', runId: 'run:2' };
  projection.adopt([forge(3, replacement)]);
  expect(projection.current()).toMatchObject([{ revision: 'r3', attachments: [replacement] }]);

  projection.rememberHomes({ ...state, sequence: 4, homes: { [home.id]: { ...home, revision: 'home:4', digest: 'b'.repeat(64) } } });
  expect(projection.current()).toMatchObject([{ revision: 'r3', assetHash: home.digest, attachments: [replacement] }]);
  const published: RealmPublicMessage = { type: 'home', plotId: home.id, revision: 'home:4', assetHash: 'b'.repeat(64), attachments: [] };
  projection.adopt([{ id: 4, sequence: 4, eventId: 'home:4', plotId: home.id, message: published }]);
  projection.adopt([forge(3, replacement)]); // Redelivery cannot undo the later build.
  expect(projection.current()).toEqual([published]);
  expect(projection.cursor).toBe(4);
});

it('restores growth only through the delivered prefix and removes ceremonies from every bootstrap', () => {
  const kingdomId = KingdomIdSchema.parse('999000003');
  const steady = { ...projectGrowthScene(createGrowthState(kingdomId, 'simulated')), sequence: 7, asOf: 100 };
  const grown = { ...steady, sequence: 9, asOf: 200, civic: { ...steady.civic, tavern: 2 },
    beats: [{ kind: 'civic-levelled' as const, sourceSeq: 9, at: 200, place: 'tavern' as const, from: 1, to: 2 }] };
  const projection = new PublicProjection({ homes: [], presence: null, growth: { type: 'growth', frame: steady }, cursor: 10, sequence: 7 });
  const row = { id: 11, sequence: 9, eventId: 'growth:9', plotId: null, message: { type: 'growth' as const, frame: grown } };
  // A pending private/outbox milestone cannot appear before delivery adopts its committed row.
  expect(projection.current()).toEqual([{ type: 'growth', frame: steady }]);
  projection.adopt([row]);
  expect(row.message.frame.beats).toHaveLength(1); // Live delivery retains the exact committed ceremony.
  expect(projection.current()).toEqual([{ type: 'growth', frame: { ...grown, beats: [] } }]);
  projection.adopt([{ ...row, id: 10, sequence: 7, message: { type: 'growth', frame: steady } }, row]);
  expect(projection.current()).toEqual([{ type: 'growth', frame: { ...grown, beats: [] } }]);
  const restarted = new PublicProjection({ homes: [], presence: null, growth: row.message, cursor: row.id, sequence: row.sequence });
  expect(restarted.current()).toEqual(projection.current());
});
