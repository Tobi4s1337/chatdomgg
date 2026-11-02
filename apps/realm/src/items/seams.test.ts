import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type ItemDefinition, type KingdomId, type PersonId } from '@chatdom/shared';
import type { Pool } from 'pg';
import { runnerImport } from 'vite';
import { createRealmPool } from '../persistence/database';
import { createRealmItems, itemCatalogue, registerItemDefinitions, type RealmItems } from './index';
import { createMemoryItemStore } from './memory';
import { createPostgresItemStore } from './postgres';
import type { ItemStore } from './store';

/*
 * pier SEAMS section 1, "How another lane writes into it", run as written. If this file needs changing, the recipe in
 * SEAMS.md changes with it.
 */

// gather's content folder defines its keepsakes as ItemDefinition[] ...
const PONG_RIBBON: ItemDefinition = { id: 'game:pong.ribbon', branch: 'kept', title: 'Pong ribbon',
  lore: 'Won across the tavern table, the bell still ringing.', stack: null, keepsake: true, model: 'game:pong.ribbon',
  places: ['shelf', 'bag', 'away'] };
const CAMPFIRE_NIGHT: ItemDefinition = { id: 'moment:campfire.night', branch: 'kept', title: 'Ember from the campfire',
  lore: 'Everyone who sat at the fire that night took one home.', stack: null, keepsake: true, model: 'moment:campfire.night',
  places: ['shelf', 'bag', 'away'] };

const id = () => BigInt(`0x${randomBytes(12).toString('hex')}`).toString();
let unregister: (() => void) | null = null;
afterEach(() => { unregister?.(); unregister = null; });

function recipe(store: () => ItemStore) {
  return () => {
    let items: RealmItems, kingdomId: KingdomId, juniper: PersonId, wren: PersonId, saoirse: PersonId;
    const at = Date.UTC(2026, 10, 2, 21, 4);
    const setup = () => {
      // ... and registers them with one import line in apps/realm/src/items/providers.ts, which runs this:
      unregister = registerItemDefinitions([PONG_RIBBON, CAMPFIRE_NIGHT]);
      // The process composes one service; another realm module receives it from the composition (realmItems()).
      items = createRealmItems({ store: store(), catalogue: itemCatalogue, clock: () => at });
      kingdomId = KingdomIdSchema.parse(id());
      [juniper, wren, saoirse] = [id(), id(), id()].map(value => PersonIdSchema.parse(value)) as [PersonId, PersonId, PersonId];
    };

    it('a game keepsake: granted once per winner, numbered, onto the shelf, with its story', async () => {
      setup();
      const win = { key: `game:pong:match-42:${juniper}`, ownerId: juniper, kingdomId, origin: 'live' as const, defId: PONG_RIBBON.id,
        story: { by: { personId: juniper, name: 'Juniper' }, kingdomId, where: 'the tavern', at, line: 'Won at Pong against Wren, 11 to 9.' },
        source: { kind: 'game' as const, ref: 'match-42' }, detail: { score: '11–9', opponent: 'Wren' } };
      const ribbon = await items.grant(win);
      expect(ribbon).toMatchObject({ defId: PONG_RIBBON.id, branch: 'kept', place: 'shelf', slot: 0, number: 1, storied: true, count: 1,
        story: { where: 'the tavern', line: 'Won at Pong against Wren, 11 to 9.' }, source: { kind: 'game', ref: 'match-42' } });
      // A retried request (a lost answer, a reconnect) never makes a second ribbon.
      expect(await items.grant(win)).toEqual(ribbon);
      expect(await items.list(juniper, kingdomId)).toHaveLength(1);
      // Reusing the key for a different fact is refused, not silently merged.
      await expect(items.grant({ ...win, detail: { score: '11–2', opponent: 'Wren' } })).rejects.toThrow();
      // The next match's ribbon is the next number in this kingdom.
      const next = await items.grant({ ...win, key: `game:pong:match-43:${wren}`, ownerId: wren, source: { kind: 'game', ref: 'match-43' },
        story: { ...win.story, by: { personId: wren, name: 'Wren' } } });
      expect(next.number).toBe(2);
      // A keepsake with a story can be put away, never let go.
      expect(await items.release(juniper, ribbon.id, 1, ribbon.revision)).toMatchObject({ ok: false });
      expect((await items.history(ribbon.id)).map(event => event.kind)).toEqual(['granted']);
    });

    it('a shared moment: the same dated keepsake to everyone who took part, exactly once each', async () => {
      setup();
      const night = { key: 'campfire:night:2026-11-02', kingdomId, origin: 'live' as const, defId: CAMPFIRE_NIGHT.id,
        people: [{ personId: juniper, name: 'Juniper' }, { personId: wren, name: 'Wren' }, { personId: saoirse, name: 'saoirse_k' }],
        story: { kingdomId, where: 'the campfire', at, line: 'Sat at the campfire on the night of 2 November.' },
        source: { kind: 'campfire' as const, ref: 'night-2026-11-02' } };
      // Two deliveries of the same moment at once (a retry racing the first) still give one copy each.
      const [first, again] = await Promise.all([items.grantShared(night), items.grantShared({ ...night, people: [...night.people].reverse() })]);
      expect(first.map(item => item.number)).toEqual([1, 1, 1]);
      expect(new Set([...first, ...again].map(item => item.id)).size).toBe(3);
      for (const person of night.people) {
        const theirs = await items.list(person.personId, kingdomId);
        expect(theirs).toHaveLength(1);
        expect(theirs[0]).toMatchObject({ number: 1, story: { by: { name: person.name }, line: night.story.line }, place: 'shelf' });
      }
      // Someone listed twice is still given one.
      const twice = await items.grantShared({ ...night, key: 'campfire:night:2026-11-03', people: [night.people[0]!, night.people[0]!],
        story: { ...night.story, line: 'Sat at the campfire on the night of 3 November.' }, source: { kind: 'campfire', ref: 'night-2026-11-03' } });
      expect(twice).toHaveLength(1);
      // The next night is the next number; the same key with different people is refused.
      expect(twice[0]!.number).toBe(2);
      await expect(items.grantShared({ ...night, people: night.people.slice(0, 2) })).rejects.toThrow();
    });
  };
}

describe('items SEAMS recipe, in memory', recipe(() => createMemoryItemStore()));

const enabled = process.env.REALM_DATABASE_TESTS === '1';
let pool: Pool;
describe.runIf(enabled)('items SEAMS recipe, on isolated Postgres', () => {
  beforeAll(async () => {
    if (process.env.REALM_DATABASE_SCHEMA !== 'pier' || !process.env.DATABASE_URL) throw new Error('Set REALM_DATABASE_SCHEMA=pier and DATABASE_URL for this suite.');
    pool = createRealmPool({ connectionString: process.env.DATABASE_URL, schema: 'pier' });
    const { module } = await runnerImport<typeof import('../persistence/migrate')>(resolve('apps/realm/src/persistence/migrate.ts'), { configFile: false });
    await module.migrateRealmSchema(pool, 'pier');
  });
  afterAll(async () => { if (pool) await pool.end(); });
  recipe(() => createPostgresItemStore({ pool }))();
});
