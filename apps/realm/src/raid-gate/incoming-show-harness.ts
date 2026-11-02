import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import { REALM_AUTH_ROUTES, RealmSessionReplySchema, RealmTicketReplySchema, type RealmJoin } from '@chatdom/shared/realm';
import { createRealmAuthHttp } from '../../../api/src/realm-auth/http';
import { createRealmAuthService } from '../../../api/src/realm-auth/service';
import { createSimulatedOidcProvider } from '../../../api/src/realm-auth/simulated-provider';
import { readRealmAuthConfig } from '../../../api/src/realm-auth/config';
import { handleRaidGuest } from '../../../api/src/raid-gate/guests-http';
import { RAID_GUEST_PREFIX, RaidGuestBeginReplySchema, RaidGuestReadReplySchema, type RaidGuestRoomReceipt } from '../../../api/src/raid-gate/guest-contracts';
import { RAID_OBSERVATION_ROUTE } from '../../../api/src/raid-gate/observations';
import { startMockDoor } from '../../../herald/src/mock/door';
import { createMockRaidCrier } from '../../../herald/src/mock/crier';
import { RealmDelivery } from '../../../herald/src/realm-delivery/delivery';
import { TenureEvidenceVerifier } from '../allocation';
import { createDurableRealmBoot, mountEntryRoutes, mountRealmWatchRoutes } from '../bootstrap';
import { createRealmCitizens } from '../evening/citizens';
import { mountEveningRoutes } from '../evening/http';
import type { createRealmPool } from '../persistence';
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
 * The RS10 mock stack, shared by the composed flow test and the staged stream capture. Everything here is SIMULATED:
 * isolated schema, a simulated OIDC provider, Herald's mock door and a recording-only crier. Nothing reaches Twitch.
 */
type Pool = ReturnType<typeof createRealmPool>;
export const SHOW_SERVICE_SECRET = 'simulated-service-secret-0000000000000000';
export const SHOW_DOOR_SECRET = 'simulated-eventsub-secret';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** A cookie jar that walks the simulated provider the way a raider's browser does. */
export class ShowBrowser {
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
    check(start.status === 302, `sign-in start answered ${start.status}`);
    const authorize = new URL(start.headers.get('location')!);
    check((await (await this.request(authorize.pathname + authorize.search)).text()).includes('SIMULATED'), 'the provider page must say SIMULATED');
    const form = new URLSearchParams(authorize.searchParams); form.set('person', person); form.set('decision', 'allow');
    const approve = await this.request(authorize.pathname.replace(/authorize$/u, 'approve'), { method: 'POST', form });
    check(approve.status === 302, `approval answered ${approve.status}`);
    const callback = new URL(approve.headers.get('location')!);
    const back = await this.request(callback.pathname + callback.search);
    check(back.status === 303 && back.headers.get('location') === returnTo, 'sign-in must return to the exact welcome link');
    check((await this.session()).status === 'authenticated', 'sign-in did not authenticate');
  }
  async session() { return RealmSessionReplySchema.parse(await (await this.request(REALM_AUTH_ROUTES.session)).json()); }
  async csrf() { const session = await this.session(); if (session.status !== 'authenticated') throw new Error('Expected checked OIDC session'); return session.csrfToken; }
  async ticket(kingdom: string): Promise<RealmJoin> {
    const response = await this.request(REALM_AUTH_ROUTES.ticket, { method: 'POST', csrf: await this.csrf(), body: { version: 1, kingdomId: kingdom, protocol: 1 } });
    check(response.status === 200, `ticket answered ${response.status}`); return RealmTicketReplySchema.parse(await response.json()).join;
  }
  async begin(kingdom: string, raidId: string) {
    const response = await this.request(`${RAID_GUEST_PREFIX}/${kingdom}`, { method: 'POST', csrf: await this.csrf(), body: { version: 1, raidId } });
    check(response.status === 200, `guest begin answered ${response.status}`); return RaidGuestBeginReplySchema.parse(await response.json());
  }
  async guest(kingdom: string) {
    const response = await this.request(`${RAID_GUEST_PREFIX}/${kingdom}`);
    check(response.status === 200, `guest read answered ${response.status}`); return RaidGuestReadReplySchema.parse(await response.json()).guest;
  }
}

export async function freePort(): Promise<number> {
  const probe = createPortProbe();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No ephemeral test port');
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return address.port;
}
export async function waitFor(predicate: () => boolean | Promise<boolean>, label: string, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
export async function listen(server: ReturnType<typeof createServer>, port = 0): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No HTTP listener');
  return `http://127.0.0.1:${address.port}`;
}
export async function closeServer(server: ReturnType<typeof createServer>) {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** The realm exactly as `main.ts` composes the raid gate around the durable boot, on one listener. */
export async function openShowRealm(input: { pool: Pool; kingdomId: KingdomId; kingdomName: string; directory: string;
  evidenceKey: Uint8Array; publicOrigin: () => string; port?: number }) {
  const { pool, directory } = input;
  const port = input.port ?? await freePort(), endpoint = `http://127.0.0.1:${port}`;
  const authority = new RaidGuestAuthority({ pool, origin: 'simulated', clock: Date.now });
  const names = new Map([[input.kingdomId, input.kingdomName]]);
  const citizens = createRealmCitizens({ db: pool, origin: 'simulated', kingdomNames: names });
  const raidChat = new RaidChatPresentation({ origin: 'simulated' }), gate = new ForgeWriteGate();
  const joins: RaidGuestRoomReceipt[] = [];
  const runtime = createRaidGuestRuntime({ origin: 'simulated', authority, citizens: value => citizens.observe(value),
    chatPresented: (value, result) => raidChat.observe(value, result) });
  const boot = createDurableRealmBoot({ pool, origin: 'simulated', foundedDirectory: join(directory, 'founded'),
    verifier: new TenureEvidenceVerifier('simulated', input.evidenceKey), furnish: citizens.furnish,
    foundedAccess: target => target.origin === 'simulated', ingressCredentials: { herald: SHOW_SERVICE_SECRET },
    repositoryOptions: gate.install({ origin: 'simulated' }),
    attach: kingdom => {
      const detach = runtime.attach(kingdom);
      const clearRaidChat = () => raidChat.clear(kingdom.kingdomId), detachRaidChat = kingdom.onClosed(clearRaidChat);
      const record = kingdom.onLifecycle((event, principal, _walker, at) => {
        if (event === 'join') joins.push({ version: 1, origin: principal.origin, kingdomId: principal.kingdomId,
          personId: principal.personId, entryId: principal.sessionId, at });
      });
      return () => { clearRaidChat(); detachRaidChat(); record(); detach(); };
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
    approvals: new FileForgeApprovals(join(directory, 'forge-approvals')), beforeObservation: value => runtime.observe(value) });
  bridge.use(boot.services);
  let reader: ReturnType<typeof mountRaidChatRead> | undefined;
  const realm = boot.createServer({ mountIngress: app => {
    mountEveningRoutes(app, bridge); reader = mountRaidChatRead(app, { origin: 'simulated', presentation: raidChat, current });
  } });
  const show = mountRaidShowRoutes(realm.transport.app, { pool, origin: 'simulated', clock: Date.now, recoverEveryMs: 0,
    credentials: { herald: SHOW_SERVICE_SECRET }, moment: observation => boot.ingress.moments.acceptMoment(observation) });
  const crier = mountRaidCrierRoutes(realm.transport.app, { origin: 'simulated', credentials: { herald: SHOW_SERVICE_SECRET }, recoverEveryMs: 0,
    authority: new RaidCrierAuthority({ pool, origin: 'simulated', clock: Date.now, publicOrigin: input.publicOrigin() }) });
  // The public entry and spectator watch, as main.ts mounts them, so the stream view can open this kingdom.
  mountEntryRoutes(realm.transport.app, boot.founded, 'simulated', names);
  mountRealmWatchRoutes(realm.transport.app, boot);
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    reader?.close();
    try { await realm.server.gracefullyShutdown(false); }
    finally { await show.close(); await crier.close(); await bridge.stop(); await runtime.close(); await boot.stop(); }
  };
  try {
    check((await boot.readiness.start()).ready, 'the realm did not become ready');
    await realm.server.listen(port, '127.0.0.1');
  } catch (error) { await close(); throw error; }
  return { endpoint, boot, show, runtime, authority, joins, close };
}

/** Herald's mock run: door, durable realm outbox and recording-only crier, with raid replies kept for the record. */
export async function openShowHerald(input: { kingdomId: KingdomId; realmUrl: string; outbox: string; raidReplies: unknown[] }) {
  const recordingFetch: typeof fetch = async (target, init) => {
    const response = await fetch(target, init);
    const url = target instanceof Request ? target.url : String(target);
    if (new URL(url).pathname === RAID_OBSERVATION_ROUTE) input.raidReplies.push(await response.clone().json());
    return response;
  };
  const realm = await RealmDelivery.open({ url: input.realmUrl, secret: SHOW_SERVICE_SECRET, directory: input.outbox, origin: 'simulated', fetch: recordingFetch });
  const mock = createMockRaidCrier({ kingdomId: input.kingdomId, realm });
  const door = await startMockDoor({ kingdomId: input.kingdomId, secret: SHOW_DOOR_SECRET, realm, port: 0, crier: () => mock.health() });
  let closed = false;
  return { realm, mock, door, async close() {
    if (closed) return; closed = true;
    await mock.worker.close(); await door.stop(); await realm.flush(); await realm.close();
  } };
}

/** The API's realm sign-in and raid-guest handlers over the simulated OIDC provider, on the given listener. */
export async function openShowAuth(input: { pool: Pool; connectionString: string; schema: string; apiOrigin: string; publicOrigin?: string }) {
  // A browser reaches the API through the web preview's proxy, so its public origin may differ from the listener.
  const publicOrigin = input.publicOrigin ?? input.apiOrigin;
  const config = readRealmAuthConfig({ DATABASE_URL: input.connectionString, REALM_AUTH_MODE: 'simulated', REALM_DATABASE_SCHEMA: input.schema, REALM_PUBLIC_ORIGIN: publicOrigin });
  const oidc = await createSimulatedOidcProvider({ publicOrigin, internalOrigin: input.apiOrigin, redirectUri: config.redirectUri });
  // OIDC belongs to the API workspace; resolve its installed verifier without adding a realm dependency.
  const { createRemoteJWKSet } = await import(createRequire(new URL('../../../api/package.json', import.meta.url)).resolve('jose'));
  const service = createRealmAuthService({ pool: input.pool, provider: oidc.provider, keys: createRemoteJWKSet(new URL(oidc.provider.jwksUri)), redirectUri: config.redirectUri });
  await service.ready();
  const authRoutes = createRealmAuthHttp({ service, publicOrigin, secureCookies: false, extra: oidc.handle });
  const guestAuthority = new RaidGuestAuthority({ pool: input.pool, origin: 'simulated', clock: Date.now });
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (await handleRaidGuest(request, response, { pool: input.pool, config, authority: guestAuthority })) return;
    if (!await authRoutes(request, response)) response.writeHead(404).end();
  };
}
