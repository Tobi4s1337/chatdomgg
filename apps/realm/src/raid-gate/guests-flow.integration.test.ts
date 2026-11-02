import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, parseRaidGuestVisualMark, starterCitizenLook, type PresenceInput } from '@chatdom/shared';
import { REALM_AUTH_ROUTES, REALM_FOUNDED_ROUTES, REALM_NO_HOME_SLOT, WALK_BODY, RealmFoundedManifestSchema,
  RealmSessionReplySchema, RealmTicketReplySchema, type RealmJoin } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { compileFoundedScene } from '@chatdom/world/founded-collision';
import { decodeFoundedScene } from '@chatdom/world/founded-scene';
import { createFoundedInteractionRegistry, interactionTargetId } from '@chatdom/world/interactions';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import { createRealmAuthHttp } from '../../../api/src/realm-auth/http';
import { createRealmAuthService } from '../../../api/src/realm-auth/service';
import { createSimulatedOidcProvider } from '../../../api/src/realm-auth/simulated-provider';
import { readRealmAuthConfig } from '../../../api/src/realm-auth/config';
import { dockPrincipal } from '../../../api/src/dock/auth';
import { handleRaidGuest } from '../../../api/src/raid-gate/guests-http';
import { raidWelcomePath, RAID_GUEST_PREFIX, RaidGuestBeginReplySchema, RaidGuestReadReplySchema,
  type RaidGuestRoomReceipt } from '../../../api/src/raid-gate/guest-contracts';
import { RaidObservationSchema } from '../../../api/src/raid-gate/observations';
import { connectRealm, type RealmClient } from '../../../web/src/realm/client';
import { giftRouteOf } from '../../../web/src/kingdom/moments/anchors';
import { TenureEvidenceVerifier } from '../allocation';
import { createDurableRealmBoot } from '../bootstrap/durable';
import { createRealmCitizens } from '../evening/citizens';
import { createRealmPool, migrateRealmSchema } from '../persistence';
import { foundedSpawnAnchors } from '../founded/anchors';
import { createRaidGuestRuntime } from './guest-runtime';
import { createRaidGuestSpawn } from './guest-spawn';
import { RaidGuestAuthority } from './guests';
import { RaidObservationLedger } from './observations';

/** SIMULATED OIDC signs real RS256 tokens, checked by the production verifier. All data lives in our random schema. */
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
  async ticket(kingdomId: string): Promise<RealmJoin> {
    const response = await this.request(REALM_AUTH_ROUTES.ticket, { method: 'POST', csrf: await this.csrf(), body: { version: 1, kingdomId, protocol: 1 } });
    expect(response.status).toBe(200); return RealmTicketReplySchema.parse(await response.json()).join;
  }
  async begin(kingdomId: string, raidId: string) {
    const response = await this.request(`${RAID_GUEST_PREFIX}/${kingdomId}`, { method: 'POST', csrf: await this.csrf(), body: { version: 1, raidId } });
    expect(response.status).toBe(200); return RaidGuestBeginReplySchema.parse(await response.json());
  }
  async guest(kingdomId: string) {
    const response = await this.request(`${RAID_GUEST_PREFIX}/${kingdomId}`);
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
async function waitFor(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 8_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('actual OIDC to founded-room raid guest flow (SIMULATED)', () => {
  it('records only actual admitted guests, leaves their homes unallocated, and qualifies verified source chat before ordinary settlement', async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    const schema = `realm_test_guest_flow_${randomBytes(6).toString('hex')}`;
    const pool = createRealmPool({ connectionString, schema });
    const directory = await mkdtemp(join(tmpdir(), 'chatdom-guest-flow-'));
    const host = KingdomIdSchema.parse('900008201'), source = KingdomIdSchema.parse('900008101');
    const wrenId = PersonIdSchema.parse('990100001'), tamsinId = PersonIdSchema.parse('990100002');
    const homeId = PersonIdSchema.parse('990100003'), sourceId = PersonIdSchema.parse('990100004'), outsiderId = PersonIdSchema.parse('990100005');
    const expiredId = PersonIdSchema.parse('990100006');
    const authority = new RaidGuestAuthority({ pool, origin: 'simulated', clock: Date.now });
    const citizens = createRealmCitizens({ db: pool, origin: 'simulated', kingdomNames: new Map([[host, 'SIMULATED Host'], [source, 'SIMULATED Source']]) });
    const ordinaryObservations: PresenceInput[] = [], joins: RaidGuestRoomReceipt[] = [], leaves: RaidGuestRoomReceipt[] = [];
    const runtime = createRaidGuestRuntime({ origin: 'simulated', authority, citizens: async input => {
      ordinaryObservations.push(input); await citizens.observe(input);
    } });
    const boot = createDurableRealmBoot({ pool, origin: 'simulated', foundedDirectory: directory,
      verifier: new TenureEvidenceVerifier('simulated', randomBytes(32)), furnish: citizens.furnish,
      foundedAccess: target => target.origin === 'simulated', ingressCredentials: {},
      attach: kingdom => {
        const detach = runtime.attach(kingdom);
        const record = kingdom.onLifecycle((event, principal, _walker, at) => {
          if (event !== 'join' && event !== 'leave') return;
          const receipt: RaidGuestRoomReceipt = { version: 1, origin: principal.origin, kingdomId: principal.kingdomId,
            personId: principal.personId, entryId: principal.sessionId, at };
          (event === 'join' ? joins : leaves).push(receipt);
        });
        return () => { record(); detach(); };
      } });
    citizens.use(boot.allocation, boot.services);
    boot.ingress.moments.useSettler(runtime.guardSettler(citizens));
    Object.assign(boot.services, { prepareSpawn: createRaidGuestSpawn({ authority, current: kingdomId => {
      const held = boot.services.kingdoms.get(kingdomId), founded = boot.loader.current(kingdomId);
      return held?.current && founded ? { world: held.world, layoutRevision: held.layoutRevision,
        writerEpoch: held.writerEpoch, plan: founded.scene.plan } : undefined;
    } }) });
    let dispatch: (request: IncomingMessage, response: ServerResponse) => Promise<void> = async (_request, response) => { response.writeHead(503).end(); };
    const api = createServer((request, response) => { void dispatch(request, response).catch(() => { if (!response.headersSent) response.writeHead(500).end(); }); });
    const clients: RealmClient[] = [];
    const worldDeliveries: unknown[] = [];
    let shutdown: (() => Promise<void>) | undefined;
    try {
      expect(await migrateRealmSchema(pool, schema)).toContain('0011d_realm_raid_guests');
      await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
      const address = api.address(); if (!address || typeof address === 'string') throw new Error('No API address');
      const origin = `http://127.0.0.1:${address.port}`;
      const config = readRealmAuthConfig({ DATABASE_URL: connectionString, REALM_AUTH_MODE: 'simulated', REALM_DATABASE_SCHEMA: schema, REALM_PUBLIC_ORIGIN: origin });
      const oidc = await createSimulatedOidcProvider({ publicOrigin: origin, internalOrigin: origin, redirectUri: config.redirectUri });
      // OIDC belongs to the API workspace; resolve its installed verifier without adding a realm dependency.
      const { createRemoteJWKSet } = await import(createRequire(new URL('../../../api/package.json', import.meta.url)).resolve('jose'));
      const service = createRealmAuthService({ pool, provider: oidc.provider, keys: createRemoteJWKSet(new URL(oidc.provider.jwksUri)), redirectUri: config.redirectUri });
      await service.ready();
      const authRoutes = createRealmAuthHttp({ service, publicOrigin: origin, secureCookies: false, extra: oidc.handle });
      dispatch = async (request, response) => {
        if (await handleRaidGuest(request, response, { pool, config, authority })) return;
        if (!await authRoutes(request, response)) response.writeHead(404).end();
      };
      const plan = generateSettlementPlan({ seed: 'SIMULATED-guest-flow', tier: 'hamlet', firstYear: 2026, year: 2026 });
      expect(await boot.allocation.adoptLayout(host, plan)).toMatchObject({ status: 'founded' });
      expect(await boot.allocation.adoptLayout(source, plan)).toMatchObject({ status: 'founded' });
      const wren = new Browser(origin), tamsin = new Browser(origin), citizen = new Browser(origin), sourceCitizen = new Browser(origin), outsider = new Browser(origin), expiredVisitor = new Browser(origin);
      // Existing citizens and the outsider sign in through the real callback/JWKS verifier, never SQL claims.
      for (const [browser, personId] of [[citizen, homeId], [sourceCitizen, sourceId], [outsider, outsiderId], [expiredVisitor, expiredId]] as const) {
        await browser.signIn(personId, '/-/realm');
      }
      const chat = (personId: typeof wrenId, displayName: string, id: string): PresenceInput => ({ version: 1, id, origin: 'simulated', kingdomId: host,
        observedAt: Date.now(), kind: 'observe', source: 'chat', coverage: 'activity', people: [{ personId, disclosure: 'named', displayName }] });
      // A real installed home and a real non-void source deed predate this raid.
      await citizens.observe(chat(homeId, 'Oko', 'SIMULATED-home-before-raid'));
      const home = await boot.allocation.deedIn(host, homeId);
      expect(home?.status).toBe('installed');
      expect(await boot.allocation.allocate({ kingdomId: source, personId: sourceId, evidence: [] })).toMatchObject({ status: 'deed' });
      const ledger = new RaidObservationLedger({ pool, origin: 'simulated', clock: Date.now,
        moment: observation => boot.ingress.moments.acceptMoment(observation) });
      const at = Date.now();
      const observation = RaidObservationSchema.parse({ version: 1, id: 'SIMULATED-actual-room-raid', origin: 'simulated', direction: 'incoming', kingdomId: host,
        occurredAt: at, receivedAt: at, from: { kingdomId: source, login: 'source_channel', name: 'Source Channel' },
        to: { kingdomId: host, login: 'host_channel', name: 'Host Channel' }, viewers: 140 });
      const { raidId } = await ledger.record(observation);
      // Record a past invitation with this same authenticated cookie; its window has ended before the fresh entry.
      const historicalAt = at - 600_001;
      const historical = RaidObservationSchema.parse({ ...observation, id: 'SIMULATED-expired-invitation', occurredAt: historicalAt, receivedAt: historicalAt });
      const historicalRaid = await ledger.record(historical);
      const expiredSession = await dockPrincipal(pool, 'simulated', false, expiredVisitor.cookie());
      if (!expiredSession) throw new Error('Expected authenticated historical visitor');
      const historicalAuthority = new RaidGuestAuthority({ pool, origin: 'simulated', clock: () => historicalAt + 1 });
      expect(await historicalAuthority.begin({ version: 1, origin: 'simulated', kingdomId: host,
        ...expiredSession.principal, raidId: historicalRaid.raidId })).toMatchObject({ status: 'pending' });
      // New raiders complete real sign-in back to the precise canonical welcome link.
      const welcome = raidWelcomePath(host, raidId);
      await wren.signIn(wrenId, welcome); await tamsin.signIn(tamsinId, welcome);
      expect(await wren.begin(host, raidId)).toMatchObject({ status: 'pending' });
      expect(await tamsin.begin(host, raidId)).toMatchObject({ status: 'pending' });
      expect(await citizen.begin(host, raidId)).toMatchObject({ status: 'refused', reason: 'citizen_here' });
      const wrenTicket = await wren.ticket(host), tamsinTicket = await tamsin.ticket(host);
      expect((await authority.history(wrenId)).items).toEqual([]);
      expect((await authority.history(tamsinId)).items).toEqual([]);
      expect(await wren.guest(host)).toBeNull(); expect(await tamsin.guest(host)).toBeNull();
      expect((await pool.query('select 1 from realm_entries')).rowCount).toBe(0);
      expect((await pool.query('select 1 from realm_raid_guest_arrivals')).rowCount).toBe(0);

      const port = await freePort(), endpoint = `http://127.0.0.1:${port}`;
      const realm = boot.createServer(); shutdown = () => realm.server.gracefullyShutdown(false);
      expect((await boot.readiness.start()).ready).toBe(true);
      await realm.server.listen(port, '127.0.0.1');
      const manifestResponse = await fetch(`${endpoint}${REALM_FOUNDED_ROUTES.manifest.replace(':kingdomId', host)}`);
      expect(manifestResponse.status).toBe(200);
      const manifest = RealmFoundedManifestSchema.parse(await manifestResponse.json());
      const sceneResponse = await fetch(`${endpoint}${REALM_FOUNDED_ROUTES.scene.replace(':sceneHash', manifest.sceneHash)}`);
      expect(sceneResponse.status).toBe(200);
      const scene = await decodeFoundedScene(new Uint8Array(await sceneResponse.arrayBuffer()), manifest), collision = compileFoundedScene(scene);
      const walk = async (browser: Browser, ticket?: RealmJoin) => {
        const session = await browser.session(); if (session.status !== 'authenticated') throw new Error('Expected authenticated walker');
        const client = await connectRealm(endpoint, { kingdomId: host, resumeScope: session.resumeScope, ticket: async () => ticket ?? browser.ticket(host) }, collision);
        client.room.onMessage('world', delivery => { worldDeliveries.push(delivery); });
        clients.push(client); return client;
      };
      // An invented ticket cannot turn even a real pending intent into an arrival or stamp.
      const wrenAuth = await wren.session();
      if (wrenAuth.status !== 'authenticated') throw new Error('Expected authenticated guest');
      await expect(connectRealm(endpoint, { kingdomId: host, resumeScope: wrenAuth.resumeScope,
        ticket: async () => ({ ...wrenTicket, ticket: 'forged-ticket-never-issued-by-authority' }) }, collision)).rejects.toThrow();
      expect((await authority.history(wrenId)).items).toEqual([]);
      expect((await pool.query('select 1 from realm_raid_guest_arrivals')).rowCount).toBe(0);
      const wrenWalks = await walk(wren, wrenTicket), tamsinWalks = await walk(tamsin, tamsinTicket);
      await runtime.flush();
      const wrenPose = wrenWalks.room.state.walkers.get(wrenWalks.selfId)!;
      const tamsinPose = tamsinWalks.room.state.walkers.get(tamsinWalks.selfId)!;
      const caravanGate = giftRouteOf(scene.plan)?.inbound[0];
      expect(caravanGate).toBeDefined();
      for (const pose of [wrenPose, tamsinPose]) {
        expect(embeddedSolids(pose, collision)).toEqual([]);
        expect(supported(pose, collision)).toBe(true);
        expect(Math.hypot(pose.x - caravanGate![0], pose.z - caravanGate![2])).toBeLessThan(18);
        expect(Math.hypot(pose.x, pose.z)).toBeGreaterThan(18);
      }
      expect(Math.abs(wrenPose.x - tamsinPose.x) >= WALK_BODY.radius * 2 ||
        Math.abs(wrenPose.z - tamsinPose.z) >= WALK_BODY.radius * 2 ||
        Math.abs(wrenPose.y - tamsinPose.y) >= WALK_BODY.height).toBe(true);
      expect(joins.filter(receipt => receipt.personId === wrenId || receipt.personId === tamsinId)).toHaveLength(2);
      const wrenGuest = await wren.guest(host), tamsinGuest = await tamsin.guest(host);
      expect(wrenGuest).toMatchObject({ raidId, personId: wrenId, from: observation.from, to: observation.to });
      expect(tamsinGuest).toMatchObject({ raidId, personId: tamsinId, from: observation.from, to: observation.to });
      await waitFor(() => !!parseRaidGuestVisualMark(wrenPose.raidGuest, Date.now()) &&
        !!parseRaidGuestVisualMark(tamsinPose.raidGuest, Date.now()), 'committed guest marks');
      for (const pose of [wrenPose, tamsinPose]) {
        const mark = parseRaidGuestVisualMark(pose.raidGuest, Date.now());
        expect(mark).toMatchObject({ raidId, fromKingdomId: source, fromName: 'Source Channel' });
        expect(Object.keys(mark!).sort()).toEqual(['expiresAt', 'fromKingdomId', 'fromName', 'raidId']);
      }
      const publicWalkers = () => boot.services.kingdoms.get(host)!.currentWalkers().walkers;
      await waitFor(() => publicWalkers().some(walker => walker.id === wrenWalks.selfId && walker.raidGuest?.raidId === raidId),
        'committed guest mark in the public walker frame');
      expect(publicWalkers().find(walker => walker.id === wrenWalks.selfId)?.raidGuest).toEqual(parseRaidGuestVisualMark(wrenPose.raidGuest, Date.now()));
      expect(wrenWalks.room.state.walkers.get(wrenWalks.selfId)).toMatchObject({ name: 'Wren', look: starterCitizenLook(wrenId), homeSlot: REALM_NO_HOME_SLOT });
      expect(tamsinWalks.room.state.walkers.get(tamsinWalks.selfId)).toMatchObject({ name: 'Tamsin', look: starterCitizenLook(tamsinId), homeSlot: REALM_NO_HOME_SLOT });
      // Cookie sessions are private; the public room key and guest entry name the fresh authenticated entry instead.
      const wrenSession = await dockPrincipal(pool, 'simulated', false, wren.cookie());
      const tamsinSession = await dockPrincipal(pool, 'simulated', false, tamsin.cookie());
      expect(wrenSession?.principal.personId).toBe(wrenId); expect(tamsinSession?.principal.personId).toBe(tamsinId);
      const entries = await pool.query('select entry_id::text, session_id::text, person_id from realm_entries order by person_id');
      expect(entries.rows).toEqual([
        { entry_id: wrenWalks.selfId, session_id: wrenSession!.principal.sessionId, person_id: wrenId },
        { entry_id: tamsinWalks.selfId, session_id: tamsinSession!.principal.sessionId, person_id: tamsinId },
      ]);
      expect(wrenWalks.selfId).not.toBe(wrenSession!.principal.sessionId);
      expect(await authority.guest({ version: 1, origin: 'simulated', kingdomId: host, personId: wrenId, sessionId: tamsinSession!.principal.sessionId })).toBeNull();
      for (const personId of [wrenId, tamsinId]) {
        expect((await authority.history(personId)).items).toMatchObject([{ kind: 'visit', kingdomId: host, arrivedWith: { raidId } }]);
        expect(await boot.allocation.deedIn(host, personId)).toBeNull();
      }
      expect((await pool.query('select 1 from realm_raid_guest_stamps')).rowCount).toBe(2);

      const citizenWalks = await walk(citizen); await runtime.flush();
      expect(await citizen.guest(host)).toBeNull(); expect((await authority.history(homeId)).items).toEqual([]);
      expect(await boot.allocation.deedIn(host, homeId)).toMatchObject({ deedId: home!.deedId, status: 'installed' });
      const citizenWalker = citizenWalks.room.state.walkers.get(citizenWalks.selfId)!;
      expect(citizenWalker.name).toBe('Oko');
      expect(parseRaidGuestVisualMark(citizenWalker.raidGuest, Date.now())).toBeNull();
      const door = createFoundedInteractionRegistry(scene, collision).get(interactionTargetId.homeDoor(home!.plotId));
      if (door?.target.kind !== 'home-door') throw new Error('Installed citizen home has no real approach');
      expect(citizenWalker.x).toBeCloseTo(door.target.approach[0], 3);
      expect(citizenWalker.y).toBeCloseTo(door.target.approach[1], 2);
      expect(citizenWalker.z).toBeCloseTo(door.target.approach[2], 3);
      // Actual home-slot ownership is supplied by the retained authority, without guest attribution.
      expect(citizenWalker.homeSlot).toBe(home!.slot);

      // A signed-in person without a raid intent still gets a real market anchor, not a guest arrival.
      const outsiderWalks = await walk(outsider); await runtime.flush();
      const outsiderPose = outsiderWalks.room.state.walkers.get(outsiderWalks.selfId)!;
      expect(parseRaidGuestVisualMark(outsiderPose.raidGuest, Date.now())).toBeNull();
      await waitFor(() => publicWalkers().some(walker => walker.id === outsiderWalks.selfId), 'ordinary walker in public frame');
      expect(publicWalkers().find(walker => walker.id === outsiderWalks.selfId)?.raidGuest ?? null).toBeNull();
      expect(foundedSpawnAnchors(scene.plan, collision).some(([x, y, z]) =>
        Math.abs(x - outsiderPose.x) < .001 && Math.abs(y - outsiderPose.y) < .01 && Math.abs(z - outsiderPose.z) < .001)).toBe(true);
      expect(await outsider.guest(host)).toBeNull();
      expect((await authority.history(outsiderId)).items).toEqual([]);
      const expiredWalks = await walk(expiredVisitor); await runtime.flush();
      const expiredPose = expiredWalks.room.state.walkers.get(expiredWalks.selfId)!;
      expect(foundedSpawnAnchors(scene.plan, collision).some(([x, y, z]) =>
        Math.abs(x - expiredPose.x) < .001 && Math.abs(y - expiredPose.y) < .01 && Math.abs(z - expiredPose.z) < .001)).toBe(true);
      expect(parseRaidGuestVisualMark(expiredPose.raidGuest, Date.now())).toBeNull();
      expect(await expiredVisitor.guest(host)).toBeNull();
      expect((await authority.history(expiredId)).items).toEqual([]);

      const sourceChat = chat(sourceId, 'Bram', 'SIMULATED-source-chat');
      await runtime.observe(sourceChat); await runtime.observe(sourceChat);
      expect((await authority.history(sourceId)).items).toMatchObject([{ kind: 'raid', raidId, kingdomId: host }]);
      expect([...wrenWalks.room.state.walkers.values()].some(walker => walker.name === 'Bram')).toBe(false);
      expect(await boot.allocation.deedIn(host, sourceId)).toBeNull();
      expect(ordinaryObservations.some(input => input.kind === 'observe' && input.people.some(person => person.personId === sourceId))).toBe(false);
      await runtime.observe(chat(wrenId, 'Wren', 'SIMULATED-walked-guest-chat'));
      expect(await boot.allocation.deedIn(host, wrenId)).toBeNull();
      const outsiderChat = chat(outsiderId, 'Ilse', 'SIMULATED-outsider-chat');
      await runtime.observe(outsiderChat);
      expect(ordinaryObservations).toContainEqual(outsiderChat);
      expect((await authority.history(outsiderId)).items).toEqual([]);
      expect(await boot.allocation.deedIn(host, outsiderId)).toMatchObject({ status: 'installed' });
      await waitFor(() => worldDeliveries.length > 0, 'ordinary settlement’s real room publication');

      // A new authority reads persisted history; replay uses the unchanged real callback receipt, never a timer.
      const restarted = new RaidGuestAuthority({ pool, origin: 'simulated', clock: Date.now });
      const wrenReceipt = joins.find(receipt => receipt.personId === wrenId)!;
      expect(await authority.pendingEntry(wrenReceipt)).toMatchObject({ status: 'pending', raidId });
      expect(await authority.pendingEntry({ ...wrenReceipt, personId: tamsinId })).toMatchObject({ status: 'refused', reason: 'entry' });
      expect(await authority.pendingEntry({ ...wrenReceipt, kingdomId: source })).toMatchObject({ status: 'refused', reason: 'entry' });
      await expect(authority.pendingEntry({ ...wrenReceipt, origin: 'live' })).rejects.toThrow();
      expect(await authority.pendingEntry({ ...wrenReceipt, entryId: tamsinWalks.selfId })).toMatchObject({ status: 'refused', reason: 'entry' });
      const expiredAuthority = new RaidGuestAuthority({ pool, origin: 'simulated', clock: () => at + 600_001 });
      expect(await expiredAuthority.pendingEntry({ ...wrenReceipt, at: at + 600_001 })).toMatchObject({ status: 'refused', reason: 'expired' });
      expect(await restarted.arrived(wrenReceipt)).toMatchObject({ status: 'duplicate' });
      expect(await ledger.record(observation)).toMatchObject({ status: 'duplicate', raidId });
      expect((await restarted.history(wrenId)).items).toHaveLength(1);
      expect((await restarted.history(tamsinId)).items).toHaveLength(1);
      expect((await restarted.history(sourceId)).items).toHaveLength(1);
      expect((await pool.query('select 1 from realm_raid_guest_arrivals')).rowCount).toBe(2);
      expect((await pool.query('select 1 from realm_raid_guest_stamps')).rowCount).toBe(3);
      expect(runtime.health()).toMatchObject({ pending: 0, failures: 0, overflow: 0 });
      await wrenWalks.room.leave(); await waitFor(() => leaves.some(receipt => receipt.personId === wrenId), 'actual guest departure');
      await waitFor(() => !tamsinWalks.room.state.walkers.has(wrenWalks.selfId), 'departed guest removed from public room');
      await waitFor(() => !publicWalkers().some(walker => walker.id === wrenWalks.selfId), 'departed guest removed from public frame');
      await runtime.flush(); expect(await wren.guest(host)).toBeNull();
      expect((await restarted.history(wrenId)).items).toHaveLength(1);
    } finally {
      for (const client of clients) client.dispose();
      try { await shutdown?.(); }
      finally {
        await runtime.close(); await boot.stop();
        await new Promise<void>(resolve => api.listening ? api.close(() => resolve()) : resolve());
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
        await rm(directory, { recursive: true, force: true });
      }
    }
  }, 120_000);
});
