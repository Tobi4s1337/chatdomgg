import type { ItemRecord, KingdomId, PersonId } from '@chatdom/shared';

/** Records shaped exactly as the realm writes them, for the bag's tests. */
export const OWNER = '41277301' as PersonId;
const KINGDOM = '512730019' as KingdomId;

export function record(id: string, patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    version: 1, id, defId: 'fish:copper-perch', branch: 'gathered', ownerId: OWNER, kingdomId: KINGDOM, origin: 'live',
    place: 'bag', slot: null, count: 1, storied: false, number: null,
    story: { by: { personId: OWNER, name: 'Juniper' }, kingdomId: KINGDOM, where: 'Willowmere pier', at: Date.UTC(2026, 10, 2, 17, 10), line: 'Caught at dusk in clear water.' },
    source: { kind: 'fishing', ref: `catch-${id}` }, detail: { weightG: 412 }, createdAt: Date.UTC(2026, 10, 2, 17, 10), revision: 0, ...patch,
  };
}

