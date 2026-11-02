import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runnerImport } from 'vite';
import type { Pool } from 'pg';
import { fishingHash, type FishingChannelReply } from '@chatdom/shared';
import { generateSettlementPlan } from '@chatdom/world';
import { compileFoundedScene } from '@chatdom/world/founded-collision';
import { createRealmState } from '@chatdom/world/realm';
import { FISH_ITEM_DEFINITIONS, FISH_SPECIES } from '../../../../packages/content/src/fish';
import { FISH_MOUNT_DEFINITIONS } from '../../../../packages/content/src/keepsakes';
import { WILLOW_ROD_DEFINITION } from '../../../../packages/content/src/pier/rod';
import { assembleFoundedScene } from '../founded/scene';
import { PostgresOutboxStore } from '../outbox';
import { createDurableRealmServices, PostgresRealmRepository } from '../persistence';
import { createItemCatalogue, createRealmItems } from '../items';
import { createPostgresItemStore } from '../items/postgres';
import type { RealmChannelRoom, RealmChannelPose } from '../room-channels';
import { createDurableFishingChannel } from './durable';
import { fishingInstallationFromScene } from './installation';
import { pierLocalToWorld } from './site';
import { createFishingSpecies } from './species';
import { freshKingdom, pierTestPool, sender } from './catch-test-fixtures';

let pool: Pool;
describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('durable fishing room on isolated Postgres', () => {
  beforeAll(async () => {
    if (process.env.REALM_DATABASE_SCHEMA !== 'pier' || !process.env.DATABASE_URL) throw new Error('Set REALM_DATABASE_SCHEMA=pier and DATABASE_URL for this suite.');
    const url = new URL(process.env.DATABASE_URL);
    if (url.hostname !== '127.0.0.1' || url.port !== '5410') throw new Error('Pier tests require Postgres at 127.0.0.1:5410.');
    pool = pierTestPool(process.env.DATABASE_URL, 1);
    expect((await pool.query('SELECT current_schema() AS schema')).rows[0]?.schema).toBe('pier');
    const { module } = await runnerImport<typeof import('../persistence/migrate')>(resolve('apps/realm/src/persistence/migrate.ts'), { configFile: false });
    await module.migrateRealmSchema(pool, 'pier');
  });
  afterAll(async () => { if (pool) await pool.end(); });

  it('takes and fishes a real rod, persists the catch, then recovers privately after a writer restart', async () => {
    const kingdomId = freshKingdom();
    // Assemble before retaining: the real durable writer uses the same compiled world as the channel.
    const plan = generateSettlementPlan({ seed: 'founded-scene-test', tier: 'hamlet', firstYear: 2025, year: 2026 });
    const scene = (await assembleFoundedScene({ kingdomId, plan, state: createRealmState(kingdomId, 'simulated'), collisionRevision: 7 })).scene;
    const world = compileFoundedScene(scene), installation = fishingInstallationFromScene(scene, 7, 'meadow');
    expect(installation).not.toBeNull(); if (!installation) throw new Error('No supported pier');
    const services = createDurableRealmServices({ repository: new PostgresRealmRepository(pool, { origin: 'simulated' }), outbox: new PostgresOutboxStore(pool),
      auth: { authenticate: async () => { throw new Error('No ticket'); }, current: async () => false },
      kingdom: () => ({ world, layoutRevision: 'founded-test', spawn: () => installation.rack }) });
    let hold = await services.retain(kingdomId);
    const owner = await sender(pool, kingdomId), observer = await sender(pool, kingdomId);
    const store = createPostgresItemStore({ pool }), catalogue = createItemCatalogue([...FISH_ITEM_DEFINITIONS, ...FISH_MOUNT_DEFINITIONS, WILLOW_ROD_DEFINITION]);
    const items = createRealmItems({ store, catalogue, clock: Date.now });
    let now = Date.now(), visible = true, pose: RealmChannelPose = { position: installation.rack, yaw: 0, grounded: true, collisionRevision: 7 };
    const from = { ...owner.from, pose: () => pose }, other = observer.from;
    const publicMessages: FishingChannelReply[] = [], privateMessages: { person: string; message: FishingChannelReply }[] = [];
    const timers = new Map<number, () => void>(); let serial = 0, listener!: Parameters<RealmChannelRoom['onMessage']>[0];
    const room: RealmChannelRoom = { kingdomId, origin: 'simulated', onMessage(fn) { listener = fn; },
      broadcast(message) { publicMessages.push(message as FishingChannelReply); }, toPerson(person, message) { privateMessages.push({ person, message: message as FishingChannelReply }); },
      person: person => person === owner.personId ? from : person === observer.personId ? other : null, world: () => world };
    const channel = () => createDurableFishingChannel({ pool, origin: 'simulated', store, items, catalogue,
      species: createFishingSpecies(FISH_SPECIES), readiness: { held: () => null }, authority: () => hold.kingdom,
      scene: () => scene, visible: () => visible, biome: () => 'meadow', where: () => 'Willowmere pier', clock: () => now, seed: () => 1,
      makeId: () => randomUUID(), schedule(callback) { const id = ++serial; timers.set(id, callback); return () => { timers.delete(id); }; } });
    let close = channel().attach(room);
    const act = async (request: unknown) => { await listener(from, request); };
    const fire = async (time: number) => { now = time; const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); await new Promise(resolve => setTimeout(resolve, 5)); };
    const last = () => privateMessages.at(-1)?.message;
    const sync = async () => { for (let attempt = 0; attempt < 100; attempt++) { await act({ type: 'pier.sync', id: `sync-${++serial}` }); const result = last(); if (result?.type === 'pier.state') return result; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('No state after pending room work'); };
    try {
      visible = false;
      await act({ type: 'pier.take', id: 'hidden-take' }); expect(last()).toMatchObject({ type: 'pier.refused' });
      await act({ type: 'pier.draw', id: 'hidden-draw' }); expect(last()).toMatchObject({ type: 'pier.refused' });
      visible = true;
      await act({ type: 'pier.take', id: 'take' });
      const taken = last(); expect(taken).toMatchObject({ type: 'pier.state', self: { rod: { defId: 'tool:rod.willow', place: 'hotbar' } } });
      if (taken?.type !== 'pier.state' || !taken.self.rod) throw new Error('No rod');
      const rod = taken.self.rod;
      visible = false; await act({ type: 'pier.draw', id: 'hidden-equipped-draw' }); expect(last()).toMatchObject({ type: 'pier.refused' }); visible = true;
      const site = installation.site;
      pose = { position: pierLocalToWorld(site, [10, 0, (site.walk + 3.4) / .125]), yaw: site.turn * 64, grounded: true, collisionRevision: 7 };
      await act({ type: 'pier.draw', id: 'draw' }); const draw = last();
      expect(draw).toMatchObject({ type: 'pier.action', cast: { phase: 'drawing' } });
      if (draw?.type !== 'pier.action' || !draw.cast) throw new Error('No cast');
      const castId = draw.cast.id, start = now;
      now += 200; await act({ type: 'pier.release', id: 'release', castId, seq: 1 });
      expect(last()).toMatchObject({ type: 'pier.action', cast: { phase: 'flying' } });
      // Fire frequently enough to refresh the authenticated rod fact without skipping its expiry.
      const bite = start + 850 + 4000 + fishingHash('wait:1:1') % 7001;
      for (let time = start + 250; time < bite; time += 250) await fire(time);
      await fire(bite); await act({ type: 'pier.strike', id: 'strike', castId, seq: 2 });
      expect(last()).toMatchObject({ type: 'pier.action', cast: { phase: 'fighting' } });
      let seq = 2, held = true;
      for (let tick = 0; tick < 600; tick++) {
        const state = await sync(), cast = state.self.cast;
        if (!cast || cast.phase === 'landing') break;
        expect(cast.phase).toBe('fighting');
        const fight = cast.fight!; const next = fight.phase === 'rest' && fight.tension < 6000;
        if (next !== held) { held = next; await act({ type: 'pier.reel', id: `reel-${seq}`, castId, seq: ++seq, on: held }); }
        await fire(bite + (tick + 1) * 50);
      }
      for (let attempt = 0; attempt < 100 && !privateMessages.some(x => x.message.type === 'pier.kept'); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      const kept = privateMessages.find(x => x.message.type === 'pier.kept')?.message;
      expect(kept).toMatchObject({ type: 'pier.kept', castId, replayed: false, personalFirst: true, kingdomFirst: true });
      if (kept?.type !== 'pier.kept') throw new Error('Catch did not commit');
      expect((await pool.query('SELECT item_id FROM realm_fishing_catches WHERE kingdom_id=$1 AND id=$2', [kingdomId, castId])).rows).toEqual([{ item_id: kept.item.id }]);
      expect((await items.get(kept.item.id))?.ownerId).toBe(owner.personId);
      expect(publicMessages.filter(x => x.type === 'pier.caught')).toHaveLength(1);
      const publicJson = JSON.stringify(publicMessages);
      for (const secret of [owner.personId, rod.id, kept.item.id, 'personId', 'castSeed', 'fightSeed', 'inputs', 'biteClosesAt']) expect(publicJson).not.toContain(secret);
      // A second cast loses authority as soon as the real item is put away.
      await act({ type: 'pier.draw', id: 'second-draw' });
      const second = last(); expect(second).toMatchObject({ type: 'pier.action', cast: { phase: 'drawing' } });
      if (second?.type !== 'pier.action' || !second.cast) throw new Error('No second cast');
      expect(await items.move(owner.personId, rod.id, { place: 'away', slot: null }, rod.revision)).toMatchObject({ ok: true });
      await new Promise(resolve => setTimeout(resolve, 20));
      await act({ type: 'pier.keep', id: 'stale-keep', castId: second.cast.id });
      expect(last()).toMatchObject({ type: 'pier.refused', id: 'stale-keep' });
      expect((await pool.query('SELECT 1 FROM realm_fishing_catches WHERE kingdom_id=$1 AND id=$2', [kingdomId, second.cast.id])).rowCount).toBe(0);
      await act({ type: 'pier.draw', id: 'stale-draw' }); expect(last()).toMatchObject({ type: 'pier.refused' });
      close(); await hold.release(); hold = await services.retain(kingdomId); close = channel().attach(room);
      const before = publicMessages.length;
      expect((await sync()).self.cast).toBeNull();
      await act({ type: 'pier.keep', id: 'recover', castId });
      expect(last()).toMatchObject({ type: 'pier.kept', id: 'recover', castId, replayed: true, item: { id: kept.item.id } });
      expect(publicMessages.slice(before).filter(x => x.type === 'pier.caught')).toHaveLength(0);
      expect(privateMessages.filter(x => x.person === observer.personId)).toHaveLength(0);
    } finally { close(); await hold.release(); }
  }, 120_000);
});
