import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import type { PoolClient } from 'pg';
import { jwtVerify } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { generateSettlementPlan } from '../../../../../packages/world/src/index';
import { REFERENCE_WORLD } from '../../../../../packages/world/src/realm/reference';
import { AllocationService, TenureEvidenceVerifier } from '../../../../realm/src/allocation';
import { createRealmCastle } from '../../../../realm/src/evening/castle';
import { createRealmCitizens } from '../../../../realm/src/evening/citizens';
import { FileFoundedStore } from '../../../../realm/src/founded';
import { RealmIngress } from '../../../../realm/src/ingress/service';
import { mountIngressRoute } from '../../../../realm/src/ingress/http';
import { RealmPanelGifts } from '../../../../realm/src/ingress/panel/gifts';
import { mountRealmPanelRoutes } from '../../../../realm/src/ingress/panel/http';
import { RealmPanelService } from '../../../../realm/src/ingress/panel/service';
import { RealmPanelSettings } from '../../../../realm/src/ingress/panel/settings';
import { PostgresOutboxStore } from '../../../../realm/src/outbox';
import { createDurableRealmServices, createRealmPool, migrateRealmSchema, PostgresRealmRepository } from '../../../../realm/src/persistence';
import { RealmTransport } from '../../../../realm/src/server';
import { createPanelAuthority } from '../../public/panel/reading';
import { createTwitchUsers } from '../../public/panel/twitch-users';
import { createPanelHttp } from '../http';
import { PanelPictures } from '../pictures';
import { createPanelGifts } from './index';
import { createPanelBroadcaster } from '../broadcast';
import { createPanelConfigurationPublisher } from '../configuration-publisher';
// @ts-expect-error The shared capture guard is a Node-only JavaScript utility.
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';
// The development-only Helper is JavaScript and is never part of the Extension build.
// @ts-expect-error The operator intentionally has no production TypeScript declaration.
import { HELPER_URL, helperSource, sign, signTransactionReceipt } from '../../../../panel/harness/helper.mjs';

const enabled = process.env.REALM_DATABASE_TESTS === '1' && process.env.PANEL_BROWSER_TESTS === '1';
const origin = 'simulated' as const;
const extensionId = 'panelbrowser';
const kingdomId = KingdomIdSchema.parse('978100001');
const giver = PersonIdSchema.parse('978100002'), witness = PersonIdSchema.parse('978100003');
const newcomer = PersonIdSchema.parse('978100004');
const ownerId = '978100099';
const names = new Map([[giver, 'Wren'], [witness, 'Moss'], [newcomer, 'Fern']]);
const product = { sku: 'kitesa', cost: { amount: 100, type: 'bits' } };
const otherBand = { sku: 'kitesb', cost: { amount: 300, type: 'bits' } };
const switchGift = { sku: 'bellb', cost: { amount: 300, type: 'bits' } };

interface Harness {
  readonly bitsRequests: number;
  readonly pendingSku: string | null;
  setIdentity(identity: 'shared' | 'logged-out' | 'unshared'): void;
  transactionComplete(event: { transactionReceipt: string; product: typeof product }): boolean;
  transactionCancelled(): boolean;
  publish(topic: string, message: string): void;
}
type HarnessWindow = Window & { __panelHarness: Harness };

/** Probe only the lane's temporary range; every actual listener still binds strictly. */
async function availablePorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  for (let port = 5170; port <= 5186 && ports.length < count; port++) {
    const probe = createServer();
    const free = await new Promise<boolean>(done => {
      probe.once('error', () => done(false));
      probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => done(true));
    });
    if (free) { ports.push(port); await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done())); }
  }
  if (ports.length !== count) throw new Error('Three free panel test ports in 5170–5186 are required.');
  return ports;
}
async function listen(server: Server, port: number) {
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen({ port, host: '127.0.0.1', exclusive: true }, done); });
}
async function close(server: Server | undefined) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
}

// This is a lane-stack proof with a test-only atomic dispatch, not production world/stream effects or Hosted Test.
describe.runIf(enabled)('two real panels give a gift through the isolated lane stack', () => {
  const schema = `panel_window_test_${randomBytes(6).toString('hex')}`;
  const extensionSecret = randomBytes(32).toString('base64');
  const panelSecret = randomBytes(32).toString('hex'), heraldSecret = randomBytes(32).toString('hex');
  const clientSecret = randomBytes(32).toString('hex'), providerToken = randomBytes(32).toString('hex');
  let db: ReturnType<typeof createRealmPool> | undefined;
  let services: ReturnType<typeof createDurableRealmServices> | undefined;
  let ingress: RealmIngress | undefined;
  let realm: RealmTransport | undefined;
  let realmListening = false;
  let api: Server | undefined, vite: ViteDevServer | undefined, browser: Browser | undefined;
  let panelHttp: ReturnType<typeof createPanelHttp> | undefined;
  let directory: string | undefined;
  let releaseCapture: (() => Promise<void>) | undefined;
  let apiOrigin: string, panelOrigin: string, realmOrigin: string;
  let giftLedger: RealmPanelGifts;
  let broadcaster: ReturnType<typeof createPanelBroadcaster> | undefined;
  let publisher: ReturnType<typeof createPanelConfigurationPublisher> | undefined;
  let configurationContent: string | undefined;
  let configurationPuts = 0, configurationGets = 0;
  let releaseConfigurationGet: (() => void) | undefined;
  let configurationGetGate: Promise<void> | undefined;
  let composeApi: (broadcast?: ReturnType<typeof createPanelBroadcaster>) => ReturnType<typeof createPanelHttp>;
  let realmCall: (path: string, body: unknown) => Promise<Record<string, unknown>>;
  const openPages = new Set<Page>();
  const broadcasts: { at: number; message: string; factId: string | null }[] = [];
  const providerRows: Record<string, unknown>[] = [];
  const providerCalls: string[] = [];
  const polls = new Map<string, number>();
  const escapedRequests: string[] = [];
  const pageErrors: string[] = [];
  const requestUrls: string[] = [], consoleMessages: string[] = [];

  // The only remote boundary substituted here: canonical OAuth/Helix responses, including public user facts.
  const provider: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    providerCalls.push(`${url.origin}${url.pathname}`);
    const json = (body: unknown) => Response.json(body);
    if (url.origin === 'https://id.twitch.tv' && url.pathname === '/oauth2/token') {
      expect((init?.body as URLSearchParams).get('client_id')).toBe(extensionId);
      expect((init?.body as URLSearchParams).get('client_secret')).toBe(clientSecret);
      return json({ access_token: providerToken, expires_in: 3600, token_type: 'bearer' });
    }
    if (url.origin === 'https://id.twitch.tv' && url.pathname === '/oauth2/validate') {
      expect(init?.headers).toMatchObject({ Authorization: `OAuth ${providerToken}` });
      return json({ client_id: extensionId, expires_in: 3600 });
    }
    if (url.origin === 'https://api.twitch.tv' && url.pathname === '/helix/extensions/configurations') {
      const headers = new Headers(init?.headers);
      expect(headers.get('client-id')).toBe(extensionId);
      const { payload } = await jwtVerify(headers.get('authorization')!.slice(7), Buffer.from(extensionSecret, 'base64'), { algorithms: ['HS256'] });
      expect(payload).toMatchObject({ role: 'external', user_id: ownerId });
      expect(payload.user_id).not.toBe(kingdomId);
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { extension_id: string; broadcaster_id: string; segment: string; version: string; content: string };
        expect(body).toMatchObject({ extension_id: extensionId, broadcaster_id: kingdomId, segment: 'broadcaster', version: '1' });
        configurationContent = body.content; configurationPuts++;
        return new Response(null, { status: 204 });
      }
      expect(init?.method ?? 'GET').toBe('GET');
      expect(url.searchParams.get('extension_id')).toBe(extensionId);
      expect(url.searchParams.get('broadcaster_id')).toBe(kingdomId);
      expect(url.searchParams.getAll('segment')).toContain('broadcaster');
      configurationGets++;
      if (configurationContent !== undefined) await configurationGetGate;
      return json({ data: configurationContent === undefined ? [] : [{ segment: 'broadcaster', broadcaster_id: kingdomId, version: '1', content: configurationContent }] });
    }
    if (url.origin === 'https://api.twitch.tv' && url.pathname === '/helix/extensions/pubsub') {
      const headers = new Headers(init?.headers);
      expect(headers.get('client-id')).toBe(extensionId);
      const { payload } = await jwtVerify(headers.get('authorization')!.slice(7), Buffer.from(extensionSecret, 'base64'), { algorithms: ['HS256'] });
      expect(payload).toMatchObject({ role: 'external', user_id: ownerId, channel_id: kingdomId, pubsub_perms: { send: ['broadcast'] } });
      expect(payload.user_id === payload.channel_id).toBe(false);
      const body = JSON.parse(String(init?.body)) as { broadcaster_id: string; target: string[]; message: string };
      expect(body).toEqual({ broadcaster_id: kingdomId, target: ['broadcast'], message: JSON.stringify({ version: 1, type: 'panel.refresh' }) });
      const state = await realmCall('/internal/realm/panel/kingdom', { kingdomId });
      const gift = state.giftMoment as { id?: string } | null;
      broadcasts.push({ at: Date.now(), message: body.message, factId: gift?.id ?? null });
      await Promise.all([...openPages].filter(page => !page.isClosed()).map(page => page.evaluate(message => (window as unknown as HarnessWindow).__panelHarness.publish('broadcast', message), body.message)));
      return new Response(null, { status: 204 });
    }
    if (url.origin === 'https://api.twitch.tv') {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${providerToken}`, 'Client-Id': extensionId });
      if (url.pathname === '/helix/extensions/transactions') {
        expect(url.searchParams.get('extension_id')).toBe(extensionId);
        const id = url.searchParams.get('id');
        return json({ data: providerRows.filter(row => !id || row.id === id), pagination: {} });
      }
      if (url.pathname === '/helix/users') {
        const id = url.searchParams.get('id');
        const name = names.get(PersonIdSchema.parse(id));
        return json({ data: name ? [{ id, login: id === giver ? 'wren' : id === witness ? 'moss' : 'fern', display_name: name }] : [] });
      }
      if (url.pathname === '/helix/chat/color') return json({ data: [{ color: '#8a2be2' }] });
    }
    throw new Error('Unexpected provider request: external networking is disabled in this test.');
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('The browser lane test requires a development DATABASE_URL.');
    const databaseUrl = new URL(process.env.DATABASE_URL);
    if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.port !== '5410') throw new Error('The browser lane test only uses development Postgres port 5410.');
    releaseCapture = await acquireCaptureLock({ signal: AbortSignal.timeout(5 * 60_000) });
    const [realmPort, apiPort, panelPort] = await availablePorts(3);
    console.info(`Panel gift test services: realm ${realmPort}, API ${apiPort}, panel ${panelPort}`);
    realmOrigin = `http://127.0.0.1:${realmPort}`; apiOrigin = `http://127.0.0.1:${apiPort}`; panelOrigin = `http://127.0.0.1:${panelPort}`;
    db = createRealmPool({ connectionString: databaseUrl.toString(), schema });
    await migrateRealmSchema(db, schema);
    await db.query('CREATE TABLE test_panel_browser_dispatch (fact_id text PRIMARY KEY)');
    directory = await mkdtemp(join(tmpdir(), 'panel-browser-'));
    const key = randomBytes(32), kingdomNames = new Map([[kingdomId, 'Kitehaven']]);
    const plan = generateSettlementPlan({ seed: 'SIMULATED-panel-browser', tier: 'hamlet', firstYear: 2026, year: 2026 });
    const castle = createRealmCastle({ origin, kingdomNames, safetyKey: key });
    const citizens = createRealmCitizens({ db, origin, kingdomNames });
    const allocation = new AllocationService(db, { origin, verifier: new TenureEvidenceVerifier(origin, key), furnish: citizens.furnish });
    ingress = new RealmIngress(db, origin, { panel: panelSecret, herald: heraldSecret });
    services = createDurableRealmServices({ repository: new PostgresRealmRepository(db, { origin, guards: [castle.guard] }), outbox: new PostgresOutboxStore(db),
      auth: { authenticate: async () => { throw new Error('No socket authentication in this browser test.'); }, current: async () => false },
      kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: plan.revision, spawn: () => [0, 0, 6] }),
      afterOpen: kingdom => citizens.recover(kingdom), attach: kingdom => ingress!.attach(kingdom) });
    citizens.use(allocation, services); ingress.use(services); castle.use(allocation, new FileFoundedStore(directory));
    // No production effect is claimed: this explicit authority proves only atomic durable dispatch.
    giftLedger = new RealmPanelGifts({ db, services, origin, effectAuthority: {
      ready: async giftId => ['kites', 'bell'].includes(giftId) ? { version: 1 } : null,
      append: async (tx: Pick<PoolClient, 'query'>, _lease, fact) => { await tx.query('INSERT INTO test_panel_browser_dispatch (fact_id) VALUES ($1)', [fact.id]); },
    } });
    const panel = new RealmPanelService({ db, origin, secret: panelSecret, allocation, citizens, services, gifts: giftLedger, settings: new RealmPanelSettings({ db, services, origin }),
      castle: (kingdom, personId, name) => castle.observe(kingdom, personId, name) });
    expect(await allocation.adoptLayout(kingdomId, plan)).toMatchObject({ status: 'founded' });
    for (const personId of [giver, witness]) { const name = names.get(personId)!; expect(await panel.claim(`Bearer ${panelSecret}`, { kingdomId, personId, name })).toMatchObject({ http: 200, body: { status: 'deed' } }); }
    realm = new RealmTransport();
    // The installed transport ignores hostname. Adapt its public native listener only in this test,
    // preserving the transport's own socket registration and shutdown instead of touching private fields.
    const nativeListen = realm.app.listen.bind(realm.app);
    realm.app.listen = ((port: number, callback: (socket: unknown) => void) => nativeListen('127.0.0.1', port, callback)) as typeof realm.app.listen;
    mountRealmPanelRoutes(realm.app, panel); mountIngressRoute(realm.app, ingress);
    await new Promise<void>(done => { realm!.listen(realmPort!, '127.0.0.1', undefined, done); }); realmListening = true;
    expect((await fetch(`${realmOrigin}/internal/realm/panel/gifts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    await publishLive();
    const liveDeadline = Date.now() + 5000;
    for (;;) {
      const state = (await panel.kingdom(`Bearer ${panelSecret}`, { kingdomId })).body;
      if ('stream' in state && state.stream === 'live') break;
      if (Date.now() >= liveDeadline) throw new Error('The isolated live observation did not reach the kingdom.');
      await delay(50);
    }
    realmCall = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
      const reply = await fetch(new URL(path, realmOrigin), { method: 'POST', headers: { authorization: `Bearer ${panelSecret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!reply.ok) throw new Error('The isolated realm door refused a request.');
      return reply.json() as Promise<Record<string, unknown>>;
    };
    const users = createTwitchUsers({ clientId: extensionId, clientSecret }, provider);
    const realmDb = db, pictureDirectory = join(directory, 'pictures');
    composeApi = broadcast => createPanelHttp({ authority: createPanelAuthority({ pool: realmDb, origin, publicOrigin: panelOrigin, users, kingdomName: async id => kingdomNames.get(KingdomIdSchema.parse(id)) ?? null }),
      origin, extension: { clientId: extensionId, secret: extensionSecret }, extraOrigins: [panelOrigin] },
    { realmOrigin, panelSecret, painterSecret: null, pictures: new PanelPictures(pictureDirectory), users,
      gifts: createPanelGifts({ extensionId, extensionSecret, extensionClientSecret: clientSecret, realm: realmCall, fetch: provider }), ...(broadcast ? { broadcast } : {}), ...(publisher ? { configurationPublisher: publisher } : {}) });
    panelHttp = composeApi();
    api = createServer((request, response) => { void panelHttp!(request, response, new URL(request.url!, apiOrigin).pathname).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); }); });
    await listen(api, apiPort!);
    vite = await createViteServer({ configFile: resolve('apps/panel/vite.config.ts'),
      define: { 'import.meta.env.VITE_CHATDOM_ORIGIN': JSON.stringify(apiOrigin) },
      server: { host: '127.0.0.1', port: panelPort!, strictPort: true, hmr: false } });
    await vite.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--disable-webgl', '--no-sandbox'] });
  }, 6 * 60_000);

  afterEach(async () => {
    await Promise.all([...openPages].map(page => page.context().close()));
    openPages.clear();
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    const attempt = async (work: () => unknown) => { try { await work(); } catch (error) { failures.push(error); } };
    await attempt(() => browser?.close());
    await Promise.all([attempt(() => vite?.close()), attempt(() => close(api))]);
    await attempt(() => panelHttp?.dispose());
    releaseConfigurationGet?.();
    await attempt(() => publisher?.dispose());
    await attempt(() => broadcaster?.dispose());
    await attempt(() => { if (realmListening) realm?.shutdown(); });
    await attempt(() => ingress?.stop());
    if (services) await Promise.all([...services.kingdoms.values()].map(kingdom => attempt(() => kingdom.dispose())));
    if (db) {
      await attempt(() => db!.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
      await attempt(() => db!.end());
    }
    await attempt(() => directory ? rm(directory, { recursive: true, force: true }) : undefined);
    await attempt(() => releaseCapture?.());
    if (failures.length) throw new AggregateError(failures, 'The isolated browser stack could not finish every cleanup.');
  }, 30_000);

  async function publishLive() {
    const accepted = await fetch(`${realmOrigin}/internal/realm/ingress`, { method: 'POST', headers: { authorization: `Bearer ${heraldSecret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, observation: { version: 1, id: `SIMULATED-browser-live-${randomUUID()}`, kingdomId, origin, observedAt: Date.now(), kind: 'stream', live: true, sessionId: 'SIMULATED-browser-night' } }) });
    expect(accepted.status).toBe(202);
  }

  async function openPanel(personId: string, view = 'panel.html', role = 'viewer', pauseTimers = false, hangProducts = false): Promise<Page> {
    const context = await browser!.newContext({ viewport: { width: 318, height: 496 } });
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url === HELPER_URL) {
        await route.fulfill({ contentType: 'application/javascript', body: helperSource(extensionSecret, { channel: kingdomId, user: personId, client: extensionId, identity: 'shared', role, bits: true, products: [product, otherBand, switchGift] }) + (hangProducts ? '\nwindow.__stalledProducts = 0; window.Twitch.ext.bits.getProducts = () => { window.__stalledProducts++; return new Promise(() => {}); };' : '') });
      } else if (url.startsWith(`${panelOrigin}/`) || url.startsWith(`${apiOrigin}/`)) await route.continue();
      else { escapedRequests.push(new URL(url).origin); await route.abort(); }
    });
    const page = await context.newPage();
    openPages.add(page);
    if (pauseTimers) {
      // Freeze only this witness's clock-driven fallback; fetch, Helper callbacks and microtasks stay real.
      await page.clock.install({ time: new Date() });
      await page.clock.pauseAt(new Date());
    }
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => requestUrls.push(request.url()));
    page.on('console', message => consoleMessages.push(message.text()));
    page.on('response', response => { if (response.url() === `${apiOrigin}/api/panel/v1/kingdom` && response.ok()) polls.set(personId, (polls.get(personId) ?? 0) + 1); });
    await page.goto(`${panelOrigin}/${view}`);
    if (view === 'panel.html') {
      await page.getByRole('button', { name: 'Kingdom', exact: true }).waitFor();
      await expect.poll(() => page.locator('body').innerText()).toContain('Kitehaven');
    } else await expect.poll(() => page.locator('body').innerText()).toContain('Kingdom connected');
    return page;
  }
  async function counts() {
    const result: Record<string, number> = {};
    for (const table of ['realm_panel_gift_facts', 'realm_panel_gift_outbox', 'realm_panel_gift_transactions', 'test_panel_browser_dispatch']) {
      result[table] = Number((await db!.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
    }
    return result;
  }
  async function waitForSaved(page: Page) {
    await expect.poll(async () => {
      const status = await page.getByRole('status').innerText();
      if (status === 'Saved') return status;
      const retry = page.getByRole('button', { name: 'Check Twitch again', exact: true });
      if (await retry.isVisible() && await retry.isEnabled()) await retry.click();
      return status;
    }, { timeout: 45_000, interval: 1000 }).toBe('Saved');
  }
  async function focused(page: Page, selector: string) {
    await expect.poll(() => page.locator(selector).evaluate(node => node === document.activeElement)).toBe(true);
  }

  it('delivers one verified Helper gift to another open panel by real polling, replays once, and cancels without delivery', async () => {
    // Cold browser startup must not consume the realm's live observation lease.
    await publishLive();
    const first = await openPanel(giver), second = await openPanel(witness);
    const before = await counts();
    expect(Object.values(before)).toEqual([0, 0, 0, 0]);
    await first.getByRole('button', { name: 'Gifts', exact: true }).click();
    const use = first.locator('[data-gift-sku="kitesa"]');
    await use.waitFor();
    // Native keyboard focus provides the same origin the actual checkout focus handoff uses.
    await use.focus(); await use.click();
    await first.getByRole('heading', { name: 'Waiting for Twitch', exact: true }).waitFor();
    await focused(first, '.gift-request h2');
    await expect.poll(() => first.evaluate(() => (window as unknown as HarnessWindow).__panelHarness.bitsRequests)).toBe(1);
    expect(await first.evaluate(() => (window as unknown as HarnessWindow).__panelHarness.pendingSku)).toBe('kitesa');
    expect(await counts()).toEqual(before);
    const transactionId = `SIMULATED-browser-tx-${randomUUID()}`, occurredAt = Date.now();
    providerRows.push({ id: transactionId, timestamp: new Date(occurredAt).toISOString(), broadcaster_id: kingdomId, user_id: giver, user_name: names.get(giver),
      product_type: 'BITS_IN_EXTENSION', product_data: { domain: `twitch.ext.${extensionId}`, ...product, inDevelopment: true } });
    const receipt = signTransactionReceipt(extensionSecret, { extensionId, transactionId, userId: giver, sku: product.sku, bits: 100, occurredAt, inDevelopment: true }) as string;
    const secondPolls = polls.get(witness) ?? 0;
    expect(await first.evaluate(event => (window as unknown as HarnessWindow).__panelHarness.transactionComplete(event), { transactionReceipt: receipt, product })).toBe(true);
    await first.getByRole('heading', { name: 'Given to the kingdom', exact: true }).waitFor();
    await focused(first, '.gift-request h2');
    const committed = await giftLedger.latest(kingdomId);
    expect(committed).toMatchObject({ type: 'panel.gift', giftId: 'kites' });
    if (!committed) throw new Error('No committed gift fact.');
    await expect.poll(() => second.locator('.cw-moment').innerText(), { timeout: 12_000 }).toContain(committed.line);
    expect((polls.get(witness) ?? 0)).toBeGreaterThan(secondPolls);
    expect(await second.getByRole('button', { name: 'Kingdom', exact: true }).getAttribute('aria-current')).toBe('page');
    const one = { realm_panel_gift_facts: 1, realm_panel_gift_outbox: 1, realm_panel_gift_transactions: 1, test_panel_browser_dispatch: 1 };
    expect(await counts()).toEqual(one);
    expect((await db!.query(`SELECT f.id, o.fact_id AS outbox, d.fact_id AS dispatch FROM realm_panel_gift_facts f
      JOIN realm_panel_gift_outbox o ON o.fact_id = f.id JOIN test_panel_browser_dispatch d ON d.fact_id = f.id`)).rows)
      .toEqual([{ id: committed.id, outbox: committed.id, dispatch: committed.id }]);
    // A duplicate Helper event is rejected after consuming its pending checkout; direct API replays are also idempotent.
    expect(await first.evaluate(event => (window as unknown as HarnessWindow).__panelHarness.transactionComplete(event), { transactionReceipt: receipt, product })).toBe(false);
    const intentId = (await db!.query<{ intent_id: string }>('SELECT intent_id FROM realm_panel_gift_transactions WHERE transaction_id = $1', [transactionId])).rows[0]!.intent_id;
    const jwt = sign(extensionSecret, { channel_id: kingdomId, opaque_user_id: 'USIMULATEDbrowser', role: 'viewer', user_id: giver, exp: Math.floor(Date.now() / 1000) + 3600 });
    for (let i = 0; i < 2; i++) {
      const replay = await fetch(`${apiOrigin}/api/panel/v1/gift-receipt`, { method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', origin: panelOrigin }, body: JSON.stringify({ intentId, receipt }) });
      expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ status: 'delivered', fact: { id: committed.id } });
    }
    expect(await counts()).toEqual(one);
    await first.getByRole('button', { name: 'Back to gifts', exact: true }).click();
    await focused(first, '[data-gift-sku="kitesa"]');
    await use.click();
    await expect.poll(() => first.evaluate(() => (window as unknown as HarnessWindow).__panelHarness.bitsRequests)).toBe(2);
    await focused(first, '.gift-request h2');
    expect(await first.evaluate(() => (window as unknown as HarnessWindow).__panelHarness.transactionCancelled())).toBe(true);
    await first.getByRole('heading', { name: 'Window closed', exact: true }).waitFor();
    await focused(first, '.gift-request h2');
    await expect.poll(async () => Number((await db!.query("SELECT count(*) AS n FROM realm_panel_gift_intents WHERE state = 'cancelled'")).rows[0].n)).toBe(1);
    expect(await counts()).toEqual(one);
    await first.getByRole('button', { name: 'Back to gifts', exact: true }).click();
    await focused(first, '[data-gift-sku="kitesa"]');
    expect(await counts()).toEqual(one);
    for (const page of [first, second]) {
      const exposed = await page.evaluate(() => JSON.stringify({ dom: document.documentElement.outerHTML, local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
      for (const privateValue of [transactionId, receipt, jwt, extensionSecret, panelSecret, clientSecret, providerToken, giver, witness]) expect([exposed, ...requestUrls, ...consoleMessages, ...pageErrors].some(text => text.includes(privateValue))).toBe(false);
    }
    expect(providerCalls.filter(path => path.endsWith('/helix/extensions/transactions'))).toHaveLength(3);
    expect(escapedRequests).toEqual([]); expect(pageErrors.length).toBe(0);
  }, 60_000);

  it('rehearses read, join, light, broadcaster settings and a PubSub gift in two actual panels', async () => {
    await publishLive();
    panelHttp!.dispose();
    broadcaster = createPanelBroadcaster({ extensionId, extensionSecret, ownerId,
      read: channelId => realmCall('/internal/realm/panel/kingdom', { kingdomId: channelId }), fetch: provider });
    publisher = createPanelConfigurationPublisher({ extensionId, extensionSecret, ownerId, realm: realmCall, enabled: true, fetch: provider, pollMs: 100 });
    panelHttp = composeApi(broadcaster);
    publisher.start();
    broadcaster.start();
    const before = await counts();
    expect((await db!.query('SELECT 1 FROM realm_deeds WHERE kingdom_id = $1 AND person_id = $2', [kingdomId, newcomer])).rowCount).toBe(0);
    const first = await openPanel(newcomer);
    await first.getByRole('button', { name: 'You', exact: true }).click();
    await first.getByRole('button', { name: 'Take your place', exact: true }).click();
    await expect.poll(() => first.locator('[data-chatdom-panel]').getAttribute('data-light'), { timeout: 8000 }).toBe('lit');
    expect((await db!.query("SELECT 1 FROM realm_deeds WHERE kingdom_id = $1 AND person_id = $2 AND status = 'installed'", [kingdomId, newcomer])).rowCount).toBe(1);
    expect(Number((await db!.query(`SELECT count(*) AS n FROM realm_ingress_inbox i JOIN realm_ingress_receipts r USING (kingdom_id, source, observation_id)
      WHERE i.kingdom_id = $1 AND i.source = 'panel' AND i.observation::jsonb @> $2::jsonb AND r.status = 'committed'`,
    [kingdomId, JSON.stringify({ kind: 'observe', source: 'panel', people: [{ personId: newcomer }] })])).rows[0].n)).toBeGreaterThan(0);
    expect(await realmCall('/internal/realm/panel/presence', { kingdomId, personId: newcomer })).toMatchObject({ stream: 'live', lit: true });

    const config = await openPanel(kingdomId, 'config.html', 'broadcaster');
    await config.getByRole('switch', { name: 'Show you tab', exact: true }).click();
    await config.locator('label').filter({ has: config.locator('input[name="band-kites"][value="b"]') }).click();
    await config.locator('label').filter({ has: config.locator('input[name="band-bell"][value="b"]') }).click();
    // A routine reauthorization performs a fresh read without throwing away unsaved choices.
    let refreshReads = 0;
    config.on('response', response => { if (response.url() === `${apiOrigin}/api/panel/v1/configuration-sync` && response.ok()) refreshReads++; });
    await config.evaluate(() => (window as unknown as HarnessWindow).__panelHarness.setIdentity('shared'));
    await expect.poll(() => refreshReads).toBeGreaterThan(0);
    await expect.poll(() => config.getByRole('status').innerText()).toBe('Unsaved changes');
    expect(await config.getByRole('switch', { name: 'Show you tab', exact: true }).getAttribute('aria-checked')).toBe('false');
    expect(await config.locator('input[name="band-kites"][value="b"]').isChecked()).toBe(true);
    expect(await config.locator('input[name="band-bell"][value="b"]').isChecked()).toBe(true);
    // Losing and regaining identity starts a fresh form from the authoritative realm reading.
    const leavingRead = config.waitForResponse(response => response.url() === `${apiOrigin}/api/panel/v1/configuration-sync`);
    await config.evaluate(() => (window as unknown as HarnessWindow).__panelHarness.setIdentity('logged-out'));
    await leavingRead;
    const beforeReturn = refreshReads;
    await config.evaluate(() => (window as unknown as HarnessWindow).__panelHarness.setIdentity('shared'));
    await expect.poll(() => refreshReads).toBeGreaterThan(beforeReturn);
    await expect.poll(() => config.getByRole('switch', { name: 'Show you tab', exact: true }).getAttribute('aria-checked')).toBe('true');
    expect(await config.locator('input[name="band-kites"][value="a"]').isChecked()).toBe(true);
    expect(await config.locator('input[name="band-bell"][value="a"]').isChecked()).toBe(true);
    expect(await config.getByRole('button', { name: 'Save changes', exact: true }).isDisabled()).toBe(true);
    await config.getByRole('switch', { name: 'Show you tab', exact: true }).click();
    await config.locator('label').filter({ has: config.locator('input[name="band-kites"][value="b"]') }).click();
    await config.locator('label').filter({ has: config.locator('input[name="band-bell"][value="b"]') }).click();
    configurationGetGate = new Promise<void>(resolve => { releaseConfigurationGet = resolve; });
    const previousGets = configurationGets, previousPuts = configurationPuts;
    await config.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(() => configurationPuts, { timeout: 30_000 }).toBeGreaterThan(previousPuts);
    await expect.poll(() => configurationGets, { timeout: 30_000 }).toBeGreaterThan(previousGets + 1);
    expect(await config.getByRole('status').innerText()).not.toBe('Saved');
    releaseConfigurationGet?.(); configurationGetGate = undefined;
    await waitForSaved(config);
    const saved = await realmCall('/internal/realm/panel/settings', { kingdomId });
    expect(saved).toMatchObject({ version: 1, status: 'settings', connected: true, settings: { tabs: { kingdom: true, you: false, gifts: true }, gifts: expect.arrayContaining([{ giftId: 'kites', band: 'b' }]) } });
    expect(configurationPuts).toBeGreaterThan(0);
    expect(configurationGets).toBeGreaterThan(previousGets);
    expect(JSON.parse(configurationContent!)).toEqual(saved);
    await expect.poll(() => first.getByRole('button', { name: 'You', exact: true }).count()).toBe(0);

    const liveConfig = await openPanel(kingdomId, 'live_config.html', 'broadcaster', false, true);
    expect(await liveConfig.evaluate(() => (window as unknown as { __stalledProducts: number }).__stalledProducts)).toBeGreaterThan(0);
    await liveConfig.getByRole('button', { name: 'Hide panel gifts', exact: true }).click();
    await waitForSaved(liveConfig);
    expect(await realmCall('/internal/realm/panel/settings', { kingdomId })).toMatchObject({ settings: { hidden: true } });
    expect(await realmCall('/internal/realm/panel/gifts', { kingdomId, personId: newcomer })).toMatchObject({ offers: [] });
    await liveConfig.getByRole('button', { name: 'Resume gifts', exact: true }).click();
    await waitForSaved(liveConfig);
    expect(await realmCall('/internal/realm/panel/settings', { kingdomId })).toMatchObject({ settings: { hidden: false } });
    await first.getByRole('button', { name: 'Gifts', exact: true }).click();
    await first.locator('[data-gift-sku="kitesb"]').waitFor();
    expect(await first.locator('[data-gift-sku="kitesa"]').count()).toBe(0);

    // A paused witness clock prevents its five-second fallback from passing the PubSub assertion.
    polls.delete(witness);
    const second = await openPanel(witness, 'panel.html', 'viewer', true);
    await expect.poll(() => polls.get(witness) ?? 0).toBeGreaterThan(0);
    const baseline = polls.get(witness) ?? 0;
    await first.locator('[data-gift-sku="bellb"]').click();
    await expect.poll(() => first.evaluate(() => (window as unknown as HarnessWindow).__panelHarness.pendingSku)).toBe('bellb');
    const transactionId = `SIMULATED-switch-on-${randomUUID()}`, occurredAt = Date.now();
    providerRows.push({ id: transactionId, timestamp: new Date(occurredAt).toISOString(), broadcaster_id: kingdomId, user_id: newcomer, user_name: names.get(newcomer),
      product_type: 'BITS_IN_EXTENSION', product_data: { domain: `twitch.ext.${extensionId}`, ...switchGift, inDevelopment: true } });
    const receipt = signTransactionReceipt(extensionSecret, { extensionId, transactionId, userId: newcomer, sku: switchGift.sku, bits: 300, occurredAt, inDevelopment: true }) as string;
    const broadcastsBefore = broadcasts.length;
    expect(await first.evaluate(event => (window as unknown as HarnessWindow).__panelHarness.transactionComplete(event), { transactionReceipt: receipt, product: switchGift })).toBe(true);
    await first.getByRole('heading', { name: 'Given to the kingdom', exact: true }).waitFor({ timeout: 4000 });
    const committed = await giftLedger.latest(kingdomId);
    expect(committed).toMatchObject({ type: 'panel.gift', giftId: 'bell' });
    if (!committed) throw new Error('The switch-on gift did not commit.');
    await expect.poll(() => second.locator('.cw-moment').innerText(), { timeout: 3500, interval: 50 }).toContain(committed.line);
    const relay = broadcasts.slice(broadcastsBefore).find(item => item.factId === committed.id);
    expect(relay).toBeDefined();
    const relayLatency = Date.now() - relay!.at;
    expect(relayLatency).toBeLessThan(1000);
    console.info(`Local PubSub relay to witness moment: ${relayLatency}ms`);
    expect(broadcasts.length).toBeGreaterThan(broadcastsBefore);
    expect((polls.get(witness) ?? 0)).toBeGreaterThan(baseline);
    expect(await second.getByRole('button', { name: 'Kingdom', exact: true }).getAttribute('aria-current')).toBe('page');
    const after = await counts();
    for (const key of Object.keys(before)) expect(after[key]).toBe(before[key]! + 1);
    for (const page of [first, second, config, liveConfig]) {
      const exposed = await page.evaluate(() => JSON.stringify({ dom: document.documentElement.outerHTML, local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
      for (const privateValue of [transactionId, receipt, extensionSecret, panelSecret, clientSecret, providerToken, newcomer]) expect([exposed, ...requestUrls, ...consoleMessages, ...pageErrors].some(text => text.includes(privateValue))).toBe(false);
    }
    expect(escapedRequests).toEqual([]); expect(pageErrors.length).toBe(0);
  }, 180_000);

});
