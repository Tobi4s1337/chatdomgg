import { execFile } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, parseRaidChatFrame, parseRaidGuestVisualMark, starterCitizenLook } from '@chatdom/shared';
import { REALM_AUTH_ROUTES, REALM_FOUNDED_ROUTES, REALM_NO_HOME_SLOT, WALK_BODY, RealmFoundedManifestSchema,
  RealmSessionReplySchema, RealmTicketReplySchema, type RealmJoin } from '@chatdom/shared/realm';
import type { TwitchMomentFact } from '@chatdom/shared/twitch-moments';
import { generateSettlementPlan } from '@chatdom/world';
import { compileFoundedScene } from '@chatdom/world/founded-collision';
import { decodeFoundedScene } from '@chatdom/world/founded-scene';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import { createRealmAuthHttp } from '../../../api/src/realm-auth/http';
import { createRealmAuthService } from '../../../api/src/realm-auth/service';
import { createSimulatedOidcProvider } from '../../../api/src/realm-auth/simulated-provider';
import { readRealmAuthConfig } from '../../../api/src/realm-auth/config';
import { handleRaidGuest } from '../../../api/src/raid-gate/guests-http';
import { parseRaidWelcomePath, raidWelcomePath, RAID_GUEST_PREFIX, RaidGuestBeginReplySchema, RaidGuestReadReplySchema,
  type RaidGuestRoomReceipt } from '../../../api/src/raid-gate/guest-contracts';
import { RAID_OBSERVATION_ROUTE } from '../../../api/src/raid-gate/observations';
import { startMockDoor } from '../../../herald/src/mock/door';
import { createMockRaidCrier } from '../../../herald/src/mock/crier';
import { RealmDelivery } from '../../../herald/src/realm-delivery/delivery';
import { connectRealm, type RealmClient } from '../../../web/src/realm/client';
import { observeRealm, observedRoom, type RealmObserver } from '../../../web/src/realm/adapters/observer';
import { giftRouteOf } from '../../../web/src/kingdom/moments/anchors';
import { raiderArms } from '../../../web/src/twitch-moments/raid-art';
import { TenureEvidenceVerifier } from '../allocation';
import { createDurableRealmBoot } from '../bootstrap/durable';
import { createRealmCitizens } from '../evening/citizens';
import { mountEveningRoutes } from '../evening/http';
import { createRealmPool, migrateRealmSchema } from '../persistence';
import { FileForgeApprovals, ForgeWriteGate } from '../wiring';
import { RaidCrierAuthority } from './crier';
import { mountRaidCrierRoutes } from './crier-http';
import { createRaidGuestRuntime } from './guest-runtime';
import { createRaidGuestSpawn } from './guest-spawn';
import { RaidGuestAuthority } from './guests';
import { mountRaidShowRoutes } from './http';
import { RaidChatBridge } from './raid-chat-bridge';
import { mountRaidChatRead } from './raid-chat-http';
import { RaidChatPresentation } from './raid-chat-presentation';

/**
 * RS10 mock run, one flow: a signed Twitch CLI raid into tobi4s_ (SIMULATED) travels Herald's door and durable outbox
 * into the raid show mounted on the actual realm listener, as `main.ts` composes it. Its beat reaches the kingdom scene,
 * the recording crier speaks once, two SIMULATED OIDC raiders walk in by that exact welcome link, one of them chats
 * through Herald and lights a raid lantern, and a realm restart plus an exact EventSub redelivery change nothing.
 */
const exec = promisify(execFile);
const kingdomId = KingdomIdSchema.parse('129634568');
const raiderId = KingdomIdSchema.parse('412000777');
const wrenId = PersonIdSchema.parse('990100001'), tamsinId = PersonIdSchema.parse('990100002'), okoId = PersonIdSchema.parse('990100003');
const serviceSecret = 'simulated-service-secret-0000000000000000', doorSecret = 'simulated-eventsub-secret';

class Browser {
  readonly cookies = new Map<string, string>();
  constructor(readonly origin: string) {}
  cookie() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '); }
  async request(path: string, init: { method?: string; body?: unknown; csrf?: string; form?: URLSearchParams } = {}) {
    const headers: Record<string, string> = { cookie: this.cookie() };
    if (init.csrf) headers['x-csrf-token'] = init.csrf;
    if (init.method === 'POST') headers.origin = this.origin;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.form) headers['content-type'] = 'application/x-www-form-urlencoded';
    const response = await fetch(new URL(path, this.origin), { method: init.method ?? 'GET', headers, redirect: 'manual',
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : init.form ? { body: init.form.toString() } : {}) });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0] ?? '', at = pair.indexOf('='), name = pair.slice(0, at), value = pair.slice(at + 1);
      if (/Max-Age=0/iu.test(line)) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    return response;
  }
  async signIn(person: string, returnTo: string) {
    const start = await this.request(`${REALM_AUTH_ROUTES.start}?returnTo=${encodeURIComponent(returnTo)}`);
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get('location')!);
    expect(await (await this.request(authorize.pathname + authorize.search)).text()).toContain('SIMULATED');
    const form = new URLSearchParams(authorize.searchParams); form.set('person', person); form.set('decision', 'allow');
    const approve = await this.request(authorize.pathname.replace(/authorize$/u, 'approve'), { method: 'POST', form });
    expect(approve.status).toBe(302);
    const callback = new URL(approve.headers.get('location')!);
    const back = await this.request(callback.pathname + callback.search);
    expect(back.status).toBe(303); expect(back.headers.get('location')).toBe(returnTo);
    expect((await this.session()).status).toBe('authenticated');
  }
  async session() { return RealmSessionReplySchema.parse(await (await this.request(REALM_AUTH_ROUTES.session)).json()); }
  async csrf() { const session = await this.session(); if (session.status !== 'authenticated') throw new Error('Expected checked OIDC session'); return session.csrfToken; }
  async ticket(kingdom: string): Promise<RealmJoin> {
    const response = await this.request(REALM_AUTH_ROUTES.ticket, { method: 'POST', csrf: await this.csrf(), body: { version: 1, kingdomId: kingdom, protocol: 1 } });
    expect(response.status).toBe(200); return RealmTicketReplySchema.parse(await response.json()).join;
  }
  async begin(kingdom: string, raidId: string) {
    const response = await this.request(`${RAID_GUEST_PREFIX}/${kingdom}`, { method: 'POST', csrf: await this.csrf(), body: { version: 1, raidId } });
    expect(response.status).toBe(200); return RaidGuestBeginReplySchema.parse(await response.json());
  }
  async guest(kingdom: string) {
    const response = await this.request(`${RAID_GUEST_PREFIX}/${kingdom}`);
    expect(response.status).toBe(200); return RaidGuestReadReplySchema.parse(await response.json()).guest;
  }
}

async function freePort(): Promise<number> {
  const probe = createPortProbe();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No ephemeral test port');
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function waitFor(predicate: () => boolean | Promise<boolean>, label: string, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No HTTP listener');
  return `http://127.0.0.1:${address.port}`;
}
async function closeServer(server: ReturnType<typeof createServer>) {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('RS10 incoming raid show, CLI to caravan lantern (SIMULATED)', () => {
  it('carries one CLI raid from Herald to the scene, crier, walked-in guests and lantern, and keeps it across restart and redelivery', async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    const schema = `realm_test_${randomBytes(6).toString('hex')}`;
    const pool = createRealmPool({ connectionString, schema });
    const directory = await mkdtemp(join(tmpdir(), 'chatdom-incoming-show-'));
    const outbox = join(directory, 'outbox'), founded = join(directory, 'founded'), cli = join(directory, 'cli');
    const evidenceKey = randomBytes(32);
    let apiOrigin = '';

    /** The realm exactly as `main.ts` composes the raid gate around the durable boot, on one listener. */
    async function openRealm() {
      const port = await freePort(), endpoint = `http://127.0.0.1:${port}`;
      const authority = new RaidGuestAuthority({ pool, origin: 'simulated', clock: Date.now });
      const citizens = createRealmCitizens({ db: pool, origin: 'simulated', kingdomNames: new Map([[kingdomId, 'SIMULATED tobi4s_']]) });
      const raidChat = new RaidChatPresentation({ origin: 'simulated' }), gate = new ForgeWriteGate();
      const joins: RaidGuestRoomReceipt[] = [];
      const runtime = createRaidGuestRuntime({ origin: 'simulated', authority, citizens: input => citizens.observe(input),
        chatPresented: (input, result) => raidChat.observe(input, result) });
      const boot = createDurableRealmBoot({ pool, origin: 'simulated', foundedDirectory: founded,
        verifier: new TenureEvidenceVerifier('simulated', evidenceKey), furnish: citizens.furnish,
        foundedAccess: target => target.origin === 'simulated', ingressCredentials: { herald: serviceSecret },
        repositoryOptions: gate.install({ origin: 'simulated' }),
        attach: kingdom => {
          const detach = runtime.attach(kingdom);
          const record = kingdom.onLifecycle((event, principal, _walker, at) => {
            if (event === 'join') joins.push({ version: 1, origin: principal.origin, kingdomId: principal.kingdomId,
              personId: principal.personId, entryId: principal.sessionId, at });
          });
          return () => { record(); detach(); };
        } });
      const current = (id: string) => boot.services.kingdoms.get(KingdomIdSchema.parse(id))?.current === true;
      Object.assign(boot.services, { prepareSpawn: createRaidGuestSpawn({ authority, current: id => {
        const held = boot.services.kingdoms.get(id), scene = boot.loader.current(id);
        return held?.current && scene ? { world: held.world, layoutRevision: held.layoutRevision,
          writerEpoch: held.writerEpoch, plan: scene.scene.plan } : undefined;
      } }) });
      citizens.use(boot.allocation, boot.services);
      boot.ingress.moments.useSettler(runtime.guardSettler(citizens));
      const bridge = new RaidChatBridge({ origin: 'simulated', ingress: boot.ingress, gate, raidChat, current,
        approvals: new FileForgeApprovals(join(directory, 'forge-approvals')), beforeObservation: input => runtime.observe(input) });
      bridge.use(boot.services);
      let reader: ReturnType<typeof mountRaidChatRead> | undefined;
      const realm = boot.createServer({ mountIngress: app => {
        mountEveningRoutes(app, bridge); reader = mountRaidChatRead(app, { origin: 'simulated', presentation: raidChat, current });
      } });
      const show = mountRaidShowRoutes(realm.transport.app, { pool, origin: 'simulated', clock: Date.now, recoverEveryMs: 0,
        credentials: { herald: serviceSecret }, moment: observation => boot.ingress.moments.acceptMoment(observation) });
      const crier = mountRaidCrierRoutes(realm.transport.app, { origin: 'simulated', credentials: { herald: serviceSecret }, recoverEveryMs: 0,
        authority: new RaidCrierAuthority({ pool, origin: 'simulated', clock: Date.now, publicOrigin: apiOrigin }) });
      let closed = false;
      const close = async () => {
        if (closed) return; closed = true;
        reader?.close();
        try { await realm.server.gracefullyShutdown(false); }
        finally { await show.close(); await crier.close(); await bridge.stop(); await runtime.close(); await boot.stop(); }
      };
      try {
        expect((await boot.readiness.start()).ready).toBe(true);
        await realm.server.listen(port, '127.0.0.1');
      } catch (error) { await close(); throw error; }
      return { endpoint, boot, show, runtime, authority, joins, close };
    }

    /** Herald's mock run: door, durable realm outbox and recording-only crier, with raid replies kept for the record. */
    const raidReplies: unknown[] = [];
    const recordingFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url).pathname === RAID_OBSERVATION_ROUTE) raidReplies.push(await response.clone().json());
      return response;
    };
    async function openHerald(realmUrl: string) {
      const realm = await RealmDelivery.open({ url: realmUrl, secret: serviceSecret, directory: outbox, origin: 'simulated', fetch: recordingFetch });
      const mock = createMockRaidCrier({ kingdomId, realm });
      const door = await startMockDoor({ kingdomId, secret: doorSecret, realm, port: 0, crier: () => mock.health() });
      let closed = false;
      return { realm, mock, door, async close() {
        if (closed) return; closed = true;
        await mock.worker.close(); await door.stop(); await realm.flush(); await realm.close();
      } };
    }

    // The CLI's exact signed delivery is kept on its way to the door, so it can be redelivered byte for byte.
    const captured: { headers: Record<string, string>; body: string }[] = [];
    let doorUrl = '';
    const capture = createServer((request, response) => { void (async () => {
      const body = await readBody(request);
      const headers = Object.fromEntries(Object.entries(request.headers)
        .filter((entry): entry is [string, string] => entry[0].startsWith('twitch-eventsub-') && typeof entry[1] === 'string'));
      captured.push({ headers, body });
      const answer = await fetch(doorUrl, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body });
      response.writeHead(answer.status); response.end(Buffer.from(await answer.arrayBuffer()));
    })().catch(() => { if (!response.headersSent) response.writeHead(502); response.end(); }); });

    let dispatch: (request: IncomingMessage, response: ServerResponse) => Promise<void> = async (_request, response) => { response.writeHead(503).end(); };
    const api = createServer((request, response) => { void dispatch(request, response).catch(() => { if (!response.headersSent) response.writeHead(500).end(); }); });
    const clients: RealmClient[] = [];
    let observer: RealmObserver | undefined;
    let realm: Awaited<ReturnType<typeof openRealm>> | undefined;
    let herald: Awaited<ReturnType<typeof openHerald>> | undefined;
    try {
      expect(await migrateRealmSchema(pool, schema)).toEqual(expect.arrayContaining(['0011b_realm_raid_observations', '0011c_realm_raid_crier', '0011d_realm_raid_guests']));
      apiOrigin = await listen(api);
      const config = readRealmAuthConfig({ DATABASE_URL: connectionString, REALM_AUTH_MODE: 'simulated', REALM_DATABASE_SCHEMA: schema, REALM_PUBLIC_ORIGIN: apiOrigin });
      const oidc = await createSimulatedOidcProvider({ publicOrigin: apiOrigin, internalOrigin: apiOrigin, redirectUri: config.redirectUri });
      // OIDC belongs to the API workspace; resolve its installed verifier without adding a realm dependency.
      const { createRemoteJWKSet } = await import(createRequire(new URL('../../../api/package.json', import.meta.url)).resolve('jose'));
      const service = createRealmAuthService({ pool, provider: oidc.provider, keys: createRemoteJWKSet(new URL(oidc.provider.jwksUri)), redirectUri: config.redirectUri });
      await service.ready();
      const authRoutes = createRealmAuthHttp({ service, publicOrigin: apiOrigin, secureCookies: false, extra: oidc.handle });
      const guestAuthority = new RaidGuestAuthority({ pool, origin: 'simulated', clock: Date.now });
      dispatch = async (request, response) => {
        if (await handleRaidGuest(request, response, { pool, config, authority: guestAuthority })) return;
        if (!await authRoutes(request, response)) response.writeHead(404).end();
      };

      // tobi4s_'s founded kingdom, its realm, and Herald's mock door in front of it.
      realm = await openRealm();
      const plan = generateSettlementPlan({ seed: 'SIMULATED-tobi4s-incoming-show', tier: 'hamlet', firstYear: 2026, year: 2026 });
      expect(await realm.boot.allocation.adoptLayout(kingdomId, plan)).toMatchObject({ status: 'founded' });
      herald = await openHerald(realm.endpoint);
      doorUrl = `http://127.0.0.1:${herald.door.port}/eventsub`;
      const captureUrl = await listen(capture);
      const manifest = RealmFoundedManifestSchema.parse(await (await fetch(`${realm.endpoint}${REALM_FOUNDED_ROUTES.manifest.replace(':kingdomId', kingdomId)}`)).json());
      const sceneResponse = await fetch(`${realm.endpoint}${REALM_FOUNDED_ROUTES.scene.replace(':sceneHash', manifest.sceneHash)}`);
      expect(sceneResponse.status).toBe(200);
      const scene = await decodeFoundedScene(new Uint8Array(await sceneResponse.arrayBuffer()), manifest), collision = compileFoundedScene(scene);
      const walk = async (browser: Browser, ticket?: RealmJoin) => {
        const session = await browser.session(); if (session.status !== 'authenticated') throw new Error('Expected authenticated walker');
        const client = await connectRealm(realm!.endpoint, { kingdomId, resumeScope: session.resumeScope, ticket: async () => ticket ?? browser.ticket(kingdomId) }, collision);
        // Walkers receive the public stream too; only Oko's scene observer reads it here.
        client.room.onMessage('world', () => {});
        clients.push(client); return client;
      };

      // A viewer already in town watches through the web scene's own observer, so the raid arrives as a live beat.
      const oko = new Browser(apiOrigin);
      await oko.signIn(okoId, '/-/realm');
      const okoWalks = await walk(oko);
      const sceneMoments: TwitchMomentFact[] = [];
      observer = observeRealm(observedRoom(okoWalks.room), { kingdomId, origin: 'simulated',
        collisionRevision: manifest.collisionRevision, layoutRevision: manifest.layoutRevision });
      observer.subscribe({ moment: fact => { sceneMoments.push(fact); } });
      await waitFor(() => observer!.current().status === 'ready', 'scene observer checkpoint');

      // 1. A real Twitch CLI raid, signed with the door secret, reaches the realm only through Herald's durable outbox.
      await exec('/root/.local/bin/twitch', ['event', 'trigger', 'channel.raid', '-F', `${captureUrl}/eventsub`, '-s', doorSecret,
        '-t', kingdomId, '-f', raiderId], { timeout: 20_000, env: { ...process.env, XDG_CONFIG_HOME: cli, TWITCH_DISABLE_UPDATE_CHECKS: 'true' } });
      expect(captured).toHaveLength(1);
      await herald.realm.flush();
      const observed = await pool.query('select observation, raid_id, event_id from realm_raid_observations');
      expect(observed.rows, JSON.stringify({ door: herald.door.ingest.health().counters, outbox: herald.realm.health() })).toHaveLength(1);
      const row = observed.rows[0] as { observation: string; raid_id: string; event_id: string };
      const observation = JSON.parse(row.observation) as { id: string; from: { kingdomId: string; login: string; name: string }; viewers: number };
      const raidId = row.raid_id;
      expect(row.event_id).toBe(captured[0]!.headers['twitch-eventsub-message-id']);
      expect(observation).toMatchObject({ origin: 'simulated', direction: 'incoming', kingdomId, from: { kingdomId: raiderId }, to: { kingdomId } });
      expect(observation.from.login).toBe(observation.from.login.toLowerCase());
      expect(observation.viewers).toBeGreaterThanOrEqual(3);
      expect(raidReplies).toEqual([{ version: 1, status: 'accepted' }]);
      expect(herald.door.ingest.health().counters).toMatchObject({ raids: 1, raidRefused: 0 });

      // The show's beat goes to the realm's moment ingress, and the kingdom scene receives the caravan.
      await realm.show.ledger.recover();
      expect((await pool.query('select beat_state from realm_raid_observation_effects')).rows).toEqual([{ beat_state: 'complete' }]);
      await waitFor(() => sceneMoments.some(fact => fact.body.kind === 'raid'), 'raid beat in the kingdom scene');
      const beat = sceneMoments.find(fact => fact.body.kind === 'raid')!;
      expect(beat).toMatchObject({ kingdomId, origin: 'simulated', body: { kind: 'raid', key: raidId, raidKey: raidId,
        from: { kingdomId: raiderId, displayName: observation.from.name }, viewers: observation.viewers, founded: false } });

      // 2. The recording crier says exactly one welcome, naming the raider and the canonical welcome path.
      await herald.mock.worker.poll();
      const transport = herald.mock.transport;
      expect(transport.records).toHaveLength(1);
      const line = transport.records[0]!.text;
      expect(line).toContain(observation.from.name);
      expect(line).toContain(raidWelcomePath(kingdomId, raidId));
      expect((await pool.query('select state from realm_raid_crier_jobs')).rows).toEqual([{ state: 'sent' }]);
      expect((await (await fetch(`http://127.0.0.1:${herald.door.port}/health`)).json()).crier.recorded).toEqual(transport.records);
      const link = new URL(/https?:\/\/\S+/u.exec(line)![0]);
      expect(link.origin).toBe(apiOrigin);
      expect(parseRaidWelcomePath(link.pathname)).toEqual({ kingdomId, raidId });

      // 3. Two raiders sign in back to that exact link, begin with its raid key, and walk into the actual room.
      const wren = new Browser(apiOrigin), tamsin = new Browser(apiOrigin);
      await wren.signIn(wrenId, link.pathname); await tamsin.signIn(tamsinId, link.pathname);
      const invitation = parseRaidWelcomePath(link.pathname)!;
      expect(await wren.begin(invitation.kingdomId, invitation.raidId)).toMatchObject({ status: 'pending',
        invitation: { raidId, kingdomId, from: observation.from } });
      expect(await tamsin.begin(invitation.kingdomId, invitation.raidId)).toMatchObject({ status: 'pending' });
      const wrenWalks = await walk(wren, await wren.ticket(kingdomId)), tamsinWalks = await walk(tamsin, await tamsin.ticket(kingdomId));
      await realm.runtime.flush();
      expect(realm.joins.filter(receipt => receipt.personId === wrenId || receipt.personId === tamsinId)).toHaveLength(2);
      const wrenPose = wrenWalks.room.state.walkers.get(wrenWalks.selfId)!, tamsinPose = tamsinWalks.room.state.walkers.get(tamsinWalks.selfId)!;
      const caravanGate = giftRouteOf(scene.plan)?.inbound[0];
      expect(caravanGate).toBeDefined();
      for (const pose of [wrenPose, tamsinPose]) {
        expect(embeddedSolids(pose, collision)).toEqual([]);
        expect(supported(pose, collision)).toBe(true);
        expect(Math.hypot(pose.x - caravanGate![0], pose.z - caravanGate![2])).toBeLessThan(18);
        expect(Math.hypot(pose.x, pose.z)).toBeGreaterThan(18);
      }
      expect(Math.abs(wrenPose.x - tamsinPose.x) >= WALK_BODY.radius * 2 || Math.abs(wrenPose.z - tamsinPose.z) >= WALK_BODY.radius * 2
        || Math.abs(wrenPose.y - tamsinPose.y) >= WALK_BODY.height).toBe(true);
      await waitFor(() => !!parseRaidGuestVisualMark(wrenPose.raidGuest, Date.now()) && !!parseRaidGuestVisualMark(tamsinPose.raidGuest, Date.now()),
        'committed guest marks');
      for (const pose of [wrenPose, tamsinPose]) {
        const mark = parseRaidGuestVisualMark(pose.raidGuest, Date.now())!;
        expect(mark).toMatchObject({ raidId, fromKingdomId: raiderId, fromName: observation.from.name });
        // The tabard wears the same Atlas arms the caravan's banners fly.
        expect(raiderArms(mark.fromKingdomId)).not.toBeNull();
        expect(raiderArms(mark.fromKingdomId)).toEqual(raiderArms(beat.body.kind === 'raid' ? beat.body.from.kingdomId : ''));
      }
      expect(parseRaidGuestVisualMark(okoWalks.room.state.walkers.get(okoWalks.selfId)!.raidGuest, Date.now())).toBeNull();
      expect(wrenWalks.room.state.walkers.get(wrenWalks.selfId)).toMatchObject({ name: 'Wren', look: starterCitizenLook(wrenId), homeSlot: REALM_NO_HOME_SLOT });
      expect(tamsinWalks.room.state.walkers.get(tamsinWalks.selfId)).toMatchObject({ name: 'Tamsin', look: starterCitizenLook(tamsinId), homeSlot: REALM_NO_HOME_SLOT });
      expect(await wren.guest(kingdomId)).toMatchObject({ raidId, personId: wrenId, from: observation.from });
      expect(await tamsin.guest(kingdomId)).toMatchObject({ raidId, personId: tamsinId, from: observation.from });
      for (const personId of [wrenId, tamsinId]) {
        expect((await realm.authority.history(personId)).items).toMatchObject([{ kind: 'visit', kingdomId, arrivedWith: { raidId } }]);
        expect(await realm.boot.allocation.deedIn(kingdomId, personId)).toBeNull();
      }

      // 4. Wren chats on Twitch: a signed chat notification through the same door, Herald's presence and speech to the realm.
      const chatId = `SIMULATED-wren-${randomBytes(4).toString('hex')}`, stamp = new Date().toISOString(), messageId = `chat-${chatId}`;
      const chatBody = JSON.stringify({ subscription: { type: 'channel.chat.message', version: '1' }, event: { broadcaster_user_id: kingdomId,
        chatter_user_id: wrenId, chatter_user_name: 'Wren', chatter_user_login: 'wren', message_id: chatId,
        message: { text: 'SIMULATED greetings from the caravan' }, source_broadcaster_user_id: null } });
      const chatSent = await fetch(doorUrl, { method: 'POST', body: chatBody, headers: { 'content-type': 'application/json',
        'Twitch-Eventsub-Message-Id': messageId, 'Twitch-Eventsub-Message-Timestamp': stamp, 'Twitch-Eventsub-Message-Type': 'notification',
        'Twitch-Eventsub-Message-Signature': `sha256=${createHmac('sha256', doorSecret).update(messageId + stamp + chatBody).digest('hex')}` } });
      expect(chatSent.status).toBe(204);
      const frame = async () => {
        const response = await fetch(`${realm!.endpoint}/realm/raid-chat/${kingdomId}`);
        expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
        const value = parseRaidChatFrame(await response.json(), Date.now()); expect(value).not.toBeNull(); return value!;
      };
      await waitFor(async () => { await herald!.realm.flush(); return (await frame()).lights.length > 0; }, 'raid lantern in the public frame');
      const lit = await frame();
      expect(lit.lights).toHaveLength(1);
      expect(lit.lights[0]).toMatchObject({ kingdomId, origin: 'simulated', raid: { raidId, fromKingdomId: raiderId, fromName: observation.from.name } });
      expect(herald.realm.health().counters.transientSent).toBeGreaterThanOrEqual(1);
      expect(await realm.boot.allocation.deedIn(kingdomId, wrenId)).toBeNull();
      expect((await realm.authority.history(wrenId)).items).toHaveLength(1);
      expect((await pool.query('select basis, raid_id from realm_raid_guest_chat')).rows).toEqual([{ basis: 'guest', raid_id: raidId }]);

      const roadsBefore = await (await fetch(`${realm.endpoint}/realm/raid-roads`)).json();
      const pennantsBefore = await (await fetch(`${realm.endpoint}/realm/raid-pennants/${kingdomId}`)).json();
      expect(roadsBefore.items).toHaveLength(1); expect(roadsBefore.items[0]).toMatchObject({ id: raidId, fromKingdomId: raiderId, toKingdomId: kingdomId });
      expect(pennantsBefore).toMatchObject({ version: 1, origin: 'simulated', kingdomId,
        items: [{ raidId, from: observation.from, occurredAt: expect.any(Number) }] });
      const raidMoments = async () => (await pool.query(`select message from realm_outbox where kind = 'moment'`)).rows
        .map(entry => (typeof entry.message === 'string' ? JSON.parse(entry.message) : entry.message) as { fact: TwitchMomentFact })
        .filter(message => message.fact.body.kind === 'raid');
      expect(await raidMoments()).toHaveLength(1);

      // 5. Herald and the realm restart against the same schema and outbox; nothing is shown or said twice.
      observer.dispose(); observer = undefined;
      for (const client of clients.splice(0)) client.dispose();
      await herald.close(); await realm.close();
      realm = await openRealm();
      expect(await (await fetch(`${realm.endpoint}/realm/raid-roads`)).json()).toEqual(roadsBefore);
      const pennantsAfter = await (await fetch(`${realm.endpoint}/realm/raid-pennants/${kingdomId}`)).json();
      expect(pennantsAfter).toMatchObject({ version: 1, origin: 'simulated', kingdomId, items: pennantsBefore.items });
      expect(pennantsAfter.asOf).toBeGreaterThanOrEqual(pennantsBefore.asOf);
      herald = await openHerald(realm.endpoint);
      doorUrl = `http://127.0.0.1:${herald.door.port}/eventsub`;
      await herald.mock.worker.poll();
      expect(herald.mock.transport.records).toHaveLength(0);
      expect(transport.records).toHaveLength(1);

      // The same signed EventSub message, redelivered to the fresh door, is a duplicate at the realm ledger.
      const again = await fetch(doorUrl, { method: 'POST', body: captured[0]!.body, headers: { ...captured[0]!.headers, 'content-type': 'application/json' } });
      expect(again.status).toBe(204);
      await herald.realm.flush();
      expect(herald.door.ingest.health().counters).toMatchObject({ raids: 1, raidRefused: 0 });
      expect(herald.realm.health()).toMatchObject({ raids: 0, fault: null });
      expect(raidReplies).toEqual([{ version: 1, status: 'accepted' }, { version: 1, status: 'duplicate' }]);
      expect((await pool.query('select observation, raid_id, event_id from realm_raid_observations')).rows).toEqual(observed.rows);
      expect((await pool.query('select beat_state from realm_raid_observation_effects')).rows).toEqual([{ beat_state: 'complete' }]);
      expect((await pool.query('select state from realm_raid_crier_jobs')).rows).toEqual([{ state: 'sent' }]);
      expect(await raidMoments()).toHaveLength(1);
      await herald.mock.worker.poll();
      expect(herald.mock.transport.records).toHaveLength(0);
      expect(await (await fetch(`${realm.endpoint}/realm/raid-roads`)).json()).toEqual(roadsBefore);
      expect((await (await fetch(`${realm.endpoint}/realm/raid-pennants/${kingdomId}`)).json()).items).toEqual(pennantsBefore.items);
    } finally {
      observer?.dispose();
      for (const client of clients) client.dispose();
      try { await herald?.close(); }
      finally {
        try { await realm?.close(); }
        finally {
          await closeServer(capture); await closeServer(api);
          await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
          await rm(directory, { recursive: true, force: true });
        }
      }
    }
  }, 300_000);
});
