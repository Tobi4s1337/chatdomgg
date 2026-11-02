import { randomBytes, randomUUID } from 'node:crypto';
import { fishingHash, KingdomIdSchema, PersonIdSchema, type FishSpecies, type FishingPierSite, type ItemDefinition, type KingdomId, type PersonId } from '@chatdom/shared';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import pg, { type Pool } from 'pg';
import { createRealmAuthenticator } from '../auth/authenticator';
import { PostgresOutboxStore } from '../outbox';
import { createDurableRealmServices, PostgresRealmRepository, REALM_DATABASE_LIMITS } from '../persistence';
import type { RealmChannelSender } from '../room-channels';
import { createFishingCasts } from './cast';
import { createFishingSpecies } from './species';
import { fishMountId } from '../../../../packages/content/src/keepsakes';

/** The suite owns these isolated connections; the host's other services are untouched. */
export function pierTestPool(connectionString: string, size: number): Pool {
  const limits = REALM_DATABASE_LIMITS;
  const pool = new pg.Pool({ connectionString, max: size, connectionTimeoutMillis: limits.connectMs,
    query_timeout: limits.queryMs, statement_timeout: limits.statementMs,
    idle_in_transaction_session_timeout: limits.idleInTransactionMs, options: '-c search_path=pier', application_name: 'chatdom-realm' });
  pool.on('error', () => {});
  return pool;
}
export const uniqueId = () => BigInt(`0x${randomBytes(12).toString('hex')}`).toString();
export const common: FishSpecies = { id: 'fish:test-perch', name: 'Perch', lore: 'A small fish.', riddle: 'A glint.', rarity: 'common', weight: 1,
  waters: ['lake'], biomes: ['meadow'], hours: ['dawn', 'day', 'dusk', 'night'], moods: ['clear', 'breeze', 'mist', 'rain'], minDepthM: 1,
  lengthMm: [100, 200], weightG: [100, 500], fight: 'steady' };
export const rare: FishSpecies = { ...common, id: 'fish:test-rare', name: 'Rare fish', rarity: 'rare' };
export const definition = (fish: FishSpecies): ItemDefinition => ({ id: fish.id, branch: 'gathered', title: fish.name, lore: fish.lore,
  stack: fish.rarity === 'rare' ? null : 99, keepsake: false, model: fish.id, places: ['bag', 'away'] });
/** Rare catches and kingdom firsts become numbered mounts, so a catch catalogue carries the mount too. */
export const mountDefinition = (fish: FishSpecies): ItemDefinition => ({ id: fishMountId(fish.id), branch: 'kept', title: `${fish.name}, mounted`,
  lore: fish.lore, stack: null, keepsake: true, model: fishMountId(fish.id), places: ['shelf', 'bag', 'away'] });
export const definitions = (...fish: FishSpecies[]): ItemDefinition[] => fish.flatMap(entry => [definition(entry), mountDefinition(entry)]);
const site: FishingPierSite = { version: 1, id: 'pier:lake', root: [0, 0, 0], turn: 0, deckY: 1, waterY: 0, walk: 20, water: 'lake', biome: 'unknown', depth: [] };
export async function retained(pool: Pool, kingdomId: KingdomId, origin: 'live' | 'simulated' = 'simulated') {
  const repository = new PostgresRealmRepository(pool, { origin });
  const services = createDurableRealmServices({ repository, outbox: new PostgresOutboxStore(pool),
    auth: { authenticate: async () => { throw new Error('No entry ticket in fixture.'); }, current: async () => false },
    kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: 'test', spawn: () => [0, 0, 6] }) });
  return services.retain(kingdomId);
}
export async function sender(pool: Pool, kingdomId: KingdomId, origin: 'live' | 'simulated' = 'simulated') {
  const personId = PersonIdSchema.parse(uniqueId()), sessionId = randomUUID(), entryId = randomUUID();
  await pool.query("INSERT INTO realm_persons(person_id,origin,identity_issuer,public_name,name_approval,name_approved_at) VALUES($1,$2,$3,$4,'test-approval',now())", [personId, origin, 'pier-test', 'Approved name']);
  await pool.query("INSERT INTO realm_sessions(session_id,handle_hash,person_id,origin,resume_scope,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')", [sessionId, randomBytes(32), personId, origin, randomUUID()]);
  await pool.query('INSERT INTO realm_entries(entry_id,session_id,person_id,kingdom_id,origin) VALUES($1,$2,$3,$4,$5)', [entryId, sessionId, personId, kingdomId, origin]);
  const principal = { personId, kingdomId, origin, sessionId: entryId, expiresAt: Date.now() + 3_600_000, publicName: 'Untrusted name', look: 'reference' };
  const auth = createRealmAuthenticator({ pool, origin });
  const from: RealmChannelSender = { principal, walkerId: entryId, pose: () => null, present: () => true, current: () => auth.current(principal, Date.now()) };
  return { from, personId, sessionId, entryId };
}
/** Real cast domain and fair controller; rod possession is an explicit fixture, not sign-in UI coverage. */
export function wonCast(kingdomId: KingdomId, personId: PersonId, species: FishSpecies = common) {
  let now = Date.now() - 60_000;
  const start = now, token = randomUUID(), id = randomUUID(), seed = 1;
  let current = true;
  const casts = createFishingCasts({ kingdomId, clock: () => now, species: createFishingSpecies([species]),
    seat: () => current ? { token, ownsRod: true, pose: { position: [0, 1, 23.4], yaw: 0, grounded: true, collisionRevision: 7 } } : null,
    installation: () => ({ site, biome: 'meadow', revision: 7, sample: () => ({ waterY: 0, groundY: -2 }) }), makeId: () => id, seed: () => seed });
  if (!casts.act(personId, { type: 'pier.draw', id: 'draw' }).ok) throw new Error('Draw failed.');
  now += 200;
  if (!casts.act(personId, { type: 'pier.release', id: 'release', castId: id, seq: 1 }).ok) throw new Error('Release failed.');
  const bite = start + 850 + 4000 + fishingHash(`wait:1:${seed}`) % 7001;
  now = bite;
  if (!casts.act(personId, { type: 'pier.strike', id: 'strike', castId: id, seq: 2 }).ok) throw new Error('Strike failed.');
  let seq = 2, held = true;
  for (let tick = 0; tick < 600 && casts.views()[0]?.phase === 'fighting'; tick++) {
    const fight = casts.views()[0]!.fight!, next = fight.phase === 'rest' && fight.tension < 6000;
    if (next !== held) { held = next; if (!casts.act(personId, { type: 'pier.reel', id: `edge-${seq}`, castId: id, seq: ++seq, on: held }).ok) throw new Error('Reel failed.'); }
    now = bite + (tick + 1) * 50; casts.tick();
  }
  if (!casts.candidate(personId)) throw new Error('Fair fight did not land.');
  return { casts, id, expire: () => { now += 5000; }, disconnect: () => { current = false; } };
}
export const freshKingdom = () => KingdomIdSchema.parse(uniqueId());
