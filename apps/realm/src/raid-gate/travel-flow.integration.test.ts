import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, parseRaidGuestVisualMark, RaidPartyReplySchema, type KingdomId } from '@chatdom/shared';
import { REALM_FOUNDED_ROUTES, RealmFoundedManifestSchema, type CollisionWorld } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { compileFoundedScene } from '@chatdom/world/founded-collision';
import { decodeFoundedScene } from '@chatdom/world/founded-scene';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import { bindRaidGate, type RaidGateBinding } from '../../../api/src/raid-gate/bind';
import { readGateReply, type GateReply, type TravelView } from '../../../api/src/raid-gate/contracts';
import { RaidObservationSchema } from '../../../api/src/raid-gate/observations';
import { RAID_AUTHORITY_ROUTE, RaidAuthorityRequestSchema } from '../../../api/src/raid-gate/raid-authority-contracts';
import { createRealmRoomsClient } from '../../../api/src/raid-gate/realm-rooms';
import type { RealmAuthConfig } from '../../../api/src/realm-auth/config';
import { SIMULATED_OIDC_PATH } from '../../../api/src/realm-auth/simulated-provider';
import { connectRealm, type RealmClient } from '../../../web/src/realm/client';
import { createRealmPool, migrateRealmSchema } from '../persistence';
import { REALM_SEAT_ENDINGS } from '../auth/seats';
import { incomingRaidGateOf } from './guest-spawn';
import { closeServer, listen, openShowAuth, openShowRealm, readBody, ShowBrowser, SHOW_SERVICE_SECRET, waitFor } from './incoming-show-harness';
import { RaidObservationLedger } from './observations';

/**
 * Spec 23's integration on real Postgres and the realm's actual rooms (RS11). The monarch presses Start once through
 * Herald's private route (a recording stand-in; nothing reaches Twitch), a walker who stands in the source room joins
 * the march, the realm lands the witnessed outgoing raid, and the walker rides out through the API's coordinator, whose
 * room transport is the realm's private door. Readiness retains the destination's writer and finds a place at its
 * gate; the commit fences the walker's source seat, and the room ends it before the commit is acknowledged. That answer
 * is lost on the way back and the API restarts; recovery reconciles the one commit. The destination's room admits the
 * marcher at its gate under the source's crest, and the walker comes home the same way. Waiting land holds nothing.
 * A random schema, dropped afterwards. Nothing here is live.
 *   REALM_DATABASE_TESTS=1 node --env-file=<checkout>/.env node_modules/vitest/vitest.mjs run --no-fsModuleCache apps/realm/src/raid-gate/travel-flow.integration.test.ts
 */
const SOURCE = KingdomIdSchema.parse('990100101');
const TARGET = KingdomIdSchema.parse('990100201');
const WAITING = KingdomIdSchema.parse('990100301');
const WREN = PersonIdSchema.parse('990100001');
const HERALD_SECRET = randomBytes(24).toString('hex');

async function recordingHerald() {
  const writes: string[] = [];
  const server = createServer((request, response) => { void (async () => {
    if (request.url !== RAID_AUTHORITY_ROUTE || request.headers.authorization !== `Bearer ${HERALD_SECRET}`) { response.writeHead(401).end(); return; }
    const parsed = RaidAuthorityRequestSchema.safeParse(JSON.parse(await readBody(request)));
    if (!parsed.success) { response.writeHead(400).end(); return; }
    const body = parsed.data;
    const reply = (value: unknown) => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    if (body.op === 'standing') return reply({ version: 1, origin: body.origin, kingdomId: body.kingdomId, grant: 'granted', consent: 'enabled' });
    if (body.op === 'live') return reply({ version: 1, origin: body.origin, live: Object.fromEntries(body.kingdomIds.map(id => [id, true])) });
    if (body.op !== 'reconcile') writes.push(`${body.op} ${body.write.key}`);
    reply({ version: 1, origin: body.origin, key: body.write.key, outcome: body.op === 'cancel' ? { kind: 'rejected', code: 'nothing-pending' } : { kind: 'accepted', createdAt: Date.now() } });
  })().catch(() => { if (!response.headersSent) response.writeHead(500).end(); }); });
  return { writes, url: await listen(server), close: () => closeServer(server) };
}

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('The Raid Gate rides out through the realm\'s actual rooms (Postgres, SIMULATED)', () => {
  it('fences the source seat, commits once across a lost answer and a restart, arrives at the gate under the crest and returns', async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    const schema = `realm_test_${randomBytes(6).toString('hex')}`;
    const pool = createRealmPool({ connectionString, schema });
    const directory = await mkdtemp(join(tmpdir(), 'chatdom-travel-flow-'));
    let apiOrigin = '';
    let dispatch: (request: IncomingMessage, response: ServerResponse) => Promise<void> = async (_request, response) => { response.writeHead(503).end(); };
    const api = createServer((request, response) => { void dispatch(request, response).catch(() => { if (!response.headersSent) response.writeHead(500).end(); }); });
    const clients: RealmClient[] = [];
    const bindings: RaidGateBinding[] = [];
    let realm: Awaited<ReturnType<typeof openShowRealm>> | undefined;
    let herald: Awaited<ReturnType<typeof recordingHerald>> | undefined;
    try {
      expect(await migrateRealmSchema(pool, schema)).toContain('0011e_realm_raid_rooms');
      apiOrigin = await listen(api);
      dispatch = await openShowAuth({ pool, connectionString, schema, apiOrigin });
      herald = await recordingHerald();
      realm = await openShowRealm({ pool, kingdomId: SOURCE, kingdomName: 'SIMULATED Source', directory, evidenceKey: randomBytes(32), publicOrigin: () => apiOrigin });
      const { boot, endpoint } = realm;
      for (const [kingdomId, seed] of [[SOURCE, 'SIMULATED-travel-source'], [TARGET, 'SIMULATED-travel-target']] as const) {
        expect(await boot.allocation.adoptLayout(kingdomId, generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2026, year: 2026 }))).toMatchObject({ status: 'founded' });
      }
      const collisions = new Map<KingdomId, { world: CollisionWorld; gate: readonly number[] }>();
      for (const kingdomId of [SOURCE, TARGET]) {
        const manifest = RealmFoundedManifestSchema.parse(await (await fetch(`${endpoint}${REALM_FOUNDED_ROUTES.manifest.replace(':kingdomId', kingdomId)}`)).json());
        const bytes = new Uint8Array(await (await fetch(`${endpoint}${REALM_FOUNDED_ROUTES.scene.replace(':sceneHash', manifest.sceneHash)}`)).arrayBuffer());
        const scene = await decodeFoundedScene(bytes, manifest);
        collisions.set(kingdomId, { world: compileFoundedScene(scene), gate: incomingRaidGateOf(scene.plan)! });
      }

      const monarch = new ShowBrowser(apiOrigin), wren = new ShowBrowser(apiOrigin);
      await monarch.signIn(SOURCE, '/-/realm'); await wren.signIn(WREN, '/-/realm');
      const walk = async (browser: ShowBrowser, kingdomId: KingdomId) => {
        const session = await browser.session(); if (session.status !== 'authenticated') throw new Error('Expected a signed-in walker');
        const client = await connectRealm(endpoint, { kingdomId, resumeScope: session.resumeScope, ticket: () => browser.ticket(kingdomId) }, collisions.get(kingdomId)!.world);
        const ended: { code?: number } = {};
        client.room.onLeave(code => { ended.code = code; });
        clients.push(client); return { client, ended };
      };
      const atSource = await walk(wren, SOURCE);
      await waitFor(() => realm!.runtime.walkerOf(SOURCE, WREN) === atSource.client.selfId, 'Wren standing in the source room');

      const config = { mode: 'simulated', publicOrigin: apiOrigin, secureCookies: false, internalSecret: SHOW_SERVICE_SECRET } as RealmAuthConfig;
      let offset = 0, loseCommit = false;
      const bind = () => {
        const binding = bindRaidGate({ pool, config, issuer: `${apiOrigin}${SIMULATED_OIDC_PATH}`, clock: () => Date.now() + offset,
          env: { HERALD_RAID_GATE_URL: herald!.url, HERALD_RAID_GATE_SECRET: HERALD_SECRET, RAID_GATE_RECOVER_MS: '0', REALM_TRAVEL_URL: endpoint },
          // The commit happens in the realm; its answer is lost on the way back once.
          rooms: transport => ({ ...transport, async commit(ref, signal) {
            const outcome = await transport.commit(ref, signal);
            if (loseCommit) { loseCommit = false; throw new Error('The commit answer was lost on the way back.'); }
            return outcome;
          } }) });
        bindings.push(binding);
        expect(binding.bound.rooms).toBe(true);
        return binding;
      };
      const as = (binding: RaidGateBinding, browser: ShowBrowser) => async (command: unknown): Promise<GateReply> => {
        const response = await binding.service.http.handle(new Request(`${apiOrigin}/api/raid-gate/${SOURCE}`, {
          method: 'POST', body: JSON.stringify(command), headers: { cookie: browser.cookie(), 'content-type': 'application/json', origin: apiOrigin },
        }));
        const reply = readGateReply(await response.json());
        if (!reply) throw new Error(`The gate sent a reply its own reader refuses (${response.status}).`);
        return reply;
      };
      const travel = (reply: GateReply): TravelView => {
        if (reply.kind !== 'travel') throw new Error(`Expected a journey, got ${JSON.stringify(reply)}`);
        return reply.value;
      };
      const party = async () => RaidPartyReplySchema.parse(await (await fetch(`${endpoint}/realm/raid-party/${SOURCE}`)).json());
      /** The public frame is read at most once per 750 ms per kingdom: wait for the phase the records now say. */
      const partyIn = async (phase: string) => {
        await waitFor(async () => (await party()).party?.phase === phase, `the party frame in ${phase}`, 5_000);
        return (await party()).party;
      };
      const ticketRow = async (ticket: string) => (await pool.query('select state, role, source_released from realm_raid_room_tickets where ticket = $1', [ticket])).rows[0];
      const ready = async (call: (command: unknown) => Promise<GateReply>, ticket: string) => {
        let view = travel(await call({ op: 'prepare', ticket }));
        for (let step = 0; view.state !== 'ready' && step < 20; step++) {
          await new Promise(resolve => setTimeout(resolve, 250));
          view = travel(await call({ op: 'prepare', ticket }));
        }
        expect(view.state).toBe('ready');
      };

      // Without the realm's door the API binds no travel at all: unavailable, never a pretend move.
      expect(bindRaidGate({ pool, config: { ...config, internalSecret: undefined }, issuer: `${apiOrigin}${SIMULATED_OIDC_PATH}`, env: { RAID_GATE_RECOVER_MS: '0' } }).bound.rooms).toBe(false);
      // Waiting land has no room: the realm's door refuses before anything is held.
      const door = createRealmRoomsClient({ url: endpoint, secret: SHOW_SERVICE_SECRET, origin: 'simulated' });
      expect(await door.checkAdmission(WREN, WAITING, AbortSignal.timeout(5_000))).toEqual({ kind: 'denied' });
      expect(await door.checkAdmission(WREN, TARGET, AbortSignal.timeout(5_000))).toEqual({ kind: 'admitted' });
      await expect(createRealmRoomsClient({ url: endpoint, secret: 'x'.repeat(40), origin: 'simulated' }).checkAdmission(WREN, TARGET, AbortSignal.timeout(5_000))).rejects.toThrow(/401/u);

      const first = bind();
      const king = as(first, monarch), rider = as(first, wren);
      const preview = await king({ op: 'preview', requestId: 'ride.one', target: TARGET });
      if (preview.kind !== 'preview') throw new Error(`Expected a preview, got ${JSON.stringify(preview)}`);
      expect(await king({ op: 'join', requestId: 'ride.one' })).toMatchObject({ kind: 'party', value: { joined: true } });
      expect(await rider({ op: 'join', requestId: 'ride.one' })).toMatchObject({ kind: 'party', value: { joined: true, optedIn: 2 } });
      // The gathering names Wren's actual walker in the source room, so the party layer draws that body once.
      expect((await party()).party).toMatchObject({ phase: 'gather', marchers: [{ name: expect.any(String), leader: true, walker: null }, { leader: false, walker: atSource.client.selfId }], more: 0 });

      expect(await king({ op: 'start', requestId: 'ride.one', previewToken: preview.value.token })).toMatchObject({ kind: 'action', value: { state: 'pending' } });
      expect(await partyIn('countdown')).toMatchObject({ phase: 'countdown', countdownEndsAt: expect.any(Number) });
      // Nobody leaves before Twitch's word.
      expect(await rider({ op: 'reserve', requestId: 'wren.ride', target: TARGET, reason: { kind: 'raid', requestId: 'ride.one', raidId: 'raid.none' } })).toMatchObject({ kind: 'denied' });

      // The realm witnesses Twitch's outgoing raid and lands it.
      const at = Date.now();
      const ledger = new RaidObservationLedger({ pool, origin: 'simulated', clock: Date.now, moment: async () => ({ http: 202, body: { status: 'accepted' } }) });
      expect(await ledger.record(RaidObservationSchema.parse({ version: 1, id: `ride-event-${randomBytes(4).toString('hex')}`, origin: 'simulated',
        kingdomId: SOURCE, direction: 'outgoing', occurredAt: at, receivedAt: at,
        from: { kingdomId: SOURCE, login: 'source_channel', name: 'Source Channel' }, to: { kingdomId: TARGET, login: 'target_channel', name: 'Target Channel' }, viewers: 9 })))
        .toMatchObject({ status: 'accepted', gate: { kind: 'landed', requestId: 'ride.one' } });
      const action = await rider({ op: 'read-action', requestId: 'ride.one' });
      if (action.kind !== 'action' || !action.value.raid) throw new Error(`Expected a landed raid, got ${JSON.stringify(action)}`);
      const raidId = action.value.raid.id;
      expect(await partyIn('setout')).toMatchObject({ phase: 'setout', raidId, destination: { kingdomId: TARGET, land: 'founded' } });

      // Reserve, ready (the destination's writer is retained and a gate place found), commit: the answer is lost.
      const reserved = travel(await rider({ op: 'reserve', requestId: 'wren.ride', target: TARGET, reason: { kind: 'raid', requestId: 'ride.one', raidId } }));
      expect(reserved).toMatchObject({ state: 'reserved', from: SOURCE, to: TARGET });
      expect(travel(await rider({ op: 'reserve', requestId: 'wren.ride', target: TARGET, reason: { kind: 'raid', requestId: 'ride.one', raidId } })).ticket).toBe(reserved.ticket);
      await ready(rider, reserved.ticket);
      loseCommit = true;
      const lost = travel(await rider({ op: 'commit', ticket: reserved.ticket }));
      expect(['committing', 'unknown']).toContain(lost.state);
      // The realm ended Wren's source seat before it acknowledged: nobody stands in two rooms.
      expect(atSource.ended.code).toBe(REALM_SEAT_ENDINGS['session-ended'].code);
      expect(realm.runtime.walkerOf(SOURCE, WREN)).toBeNull();
      expect(await ticketRow(reserved.ticket)).toMatchObject({ state: 'committed', role: 'visitor', source_released: false });

      // The API restarts; past the commit's own answer window, recovery reconciles the one commit through the door.
      first.service.close();
      offset += 25_000;
      const second = bind();
      await second.service.recover(); await second.service.recover();
      const home = as(second, wren);
      expect(travel(await home({ op: 'whereabouts' }))).toMatchObject({ ticket: reserved.ticket, state: 'committed', role: 'visitor', to: TARGET, arrivalId: `arrival.${reserved.ticket}` });
      expect(await ticketRow(reserved.ticket)).toMatchObject({ state: 'committed', source_released: true });
      expect((await pool.query('select kingdom_id, generation from realm_raid_room_members where person_id = $1', [WREN])).rows).toEqual([{ kingdom_id: TARGET, generation: '1' }]);
      expect((await pool.query("select count(*)::int as n from realm_raid_room_tickets where person_id = $1 and state = 'committed'", [WREN])).rows[0].n).toBe(1);

      // The destination's actual room admits Wren at its gate, wearing the source's crest from the witnessed raid.
      const atTarget = await walk(wren, TARGET);
      const pose = atTarget.client.room.state.walkers.get(atTarget.client.selfId)!;
      const target = collisions.get(TARGET)!;
      expect(embeddedSolids(pose, target.world)).toEqual([]);
      expect(supported(pose, target.world)).toBe(true);
      expect(Math.hypot(pose.x - target.gate[0]!, pose.z - target.gate[2]!)).toBeLessThan(18);
      await waitFor(() => !!parseRaidGuestVisualMark(pose.raidGuest, Date.now()), 'the marcher\'s crest', 10_000);
      expect(parseRaidGuestVisualMark(pose.raidGuest, Date.now())).toMatchObject({ raidId, fromKingdomId: SOURCE, fromName: 'Source Channel' });
      // A fresh entry into the source after the commit is ordinary: the fence only ends seats taken before it.
      const back = await walk(wren, SOURCE);
      await new Promise(resolve => setTimeout(resolve, 2_500));
      expect(back.ended.code).toBeUndefined();
      await back.client.room.leave();
      await waitFor(() => realm!.runtime.walkerOf(SOURCE, WREN) === null, 'Wren leaving the source again');

      // Coming home is another journey through the same door; the destination seat ends first, and it works once.
      const returning = travel(await home({ op: 'reserve', requestId: 'wren.home', target: SOURCE, reason: { kind: 'return', arrivalId: `arrival.${reserved.ticket}` } }));
      await ready(home, returning.ticket);
      expect(travel(await home({ op: 'commit', ticket: returning.ticket }))).toMatchObject({ state: 'committed', to: SOURCE });
      expect(atTarget.ended.code).toBe(REALM_SEAT_ENDINGS['session-ended'].code);
      expect((await pool.query('select kingdom_id, generation from realm_raid_room_members where person_id = $1', [WREN])).rows).toEqual([{ kingdom_id: SOURCE, generation: '2' }]);
      expect(await home({ op: 'reserve', requestId: 'wren.home.twice', target: SOURCE, reason: { kind: 'return', arrivalId: `arrival.${reserved.ticket}` } })).toMatchObject({ kind: 'denied' });
      expect(await realm.roomTravel.marchMark(WREN, TARGET, Date.now())).toBeNull();
      // One Twitch write in all.
      expect(herald.writes).toEqual(['start ride.one/start']);
    } finally {
      for (const client of clients) await client.room.leave().catch(() => undefined);
      for (const binding of bindings) binding.service.close();
      await realm?.close(); await herald?.close(); await closeServer(api);
      await pool.query(`drop schema if exists "${schema}" cascade`).catch(() => undefined);
      await pool.end(); await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
