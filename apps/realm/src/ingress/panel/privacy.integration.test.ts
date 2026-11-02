import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type KingdomId, type KingdomPresenceFrame, type PersonId, type PresenceInput } from '@chatdom/shared';
import type { RealmPublicMessage, RealmWalkerFrame } from '@chatdom/shared/realm';
import { generateSettlementPlan, type SettlementPlan } from '@chatdom/world';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { AllocationService, TenureEvidenceVerifier } from '../../allocation';
import { createRealmCitizens } from '../../evening/citizens';
import { createRealmCastle } from '../../evening/castle';
import { FileFoundedStore } from '../../founded';
import { PostgresOutboxStore } from '../../outbox';
import { createDurableRealmServices, createRealmPool, migrateRealmSchema, PostgresRealmRepository } from '../../persistence';
import { RealmIngress } from '../service';
import { RealmChatPrivacy } from './chat';
import { createQuietDisclosure, disclosedServices, redactMessage, redactWalkers, WALKER_NAMELESS } from './disclosure';
import { CONSENT_RENEWAL, ForgetGuard } from './privacy';
import { RealmPanelService } from './service';

const origin = 'simulated' as const;

it('redacts only quiet slots, keeps every light, and withholds every name when the preference cannot be read', () => {
  const frame: KingdomPresenceFrame = { version: 1, kingdomId: '42' as KingdomId, epoch: 'realm:42', sequence: 3, asOf: 10, origin, streamLive: true, connection: 'fresh',
    windows: [{ slot: 1, present: true, publicName: 'Wren', since: 1 }, { slot: 2, present: true, publicName: 'Juniper', since: 1 }] };
  const presence: RealmPublicMessage = { type: 'presence', frame };
  expect(redactMessage(presence, new Set([1]))).toMatchObject({ frame: { windows: [{ slot: 1, present: true, publicName: null }, { slot: 2, present: true, publicName: 'Juniper' }] } });
  expect(redactMessage(presence, 'all')).toMatchObject({ frame: { windows: [{ publicName: null, present: true }, { publicName: null, present: true }] } });
  expect(redactMessage(presence, new Set())).toBe(presence);
  const moment = { type: 'moment', current: false, fact: { kind: 'cheer', credit: { displayName: 'Wren', slot: 1 }, bits: 100, gifts: [{ credit: { displayName: 'Juniper', slot: 2 } }, { credit: { displayName: 'Rook', slot: null } }] } } as unknown as RealmPublicMessage;
  expect(redactMessage(moment, new Set([1]))).toMatchObject({ fact: { credit: null, gifts: [{ credit: { displayName: 'Juniper' } }, { credit: { displayName: 'Rook' } }] } });
  expect(redactMessage(moment, 'all')).toMatchObject({ fact: { credit: null, gifts: [{ credit: null }, { credit: null }] } });
});

it('never lets a quiet walker reach the stream with their name: unlabelled once the frame carries that, left out of the stream frame until then', () => {
  const walker = (id: string, name: string, homeSlot: number) => ({ id, name, look: 'look-1', homeSlot, x: 0, y: 0, z: 0, yaw: 0, distance: 0, speed: 0, placement: 0 });
  const frame = { sampledAt: 1, walkers: [walker('a', 'Wren', 1), walker('b', 'Juniper', 2)],
    seats: [{ targetId: 't1', walkerId: 'a', generation: 1, status: 'occupied' }, { targetId: 't2', walkerId: 'b', generation: 1, status: 'occupied' }] } as unknown as RealmWalkerFrame;
  expect(redactWalkers(frame, new Set(), true)).toBe(frame);
  expect(redactWalkers(frame, new Set(), false)).toBe(frame);
  expect(redactWalkers(frame, new Set([9]), false)).toBe(frame);
  expect(redactWalkers(frame, new Set([1]), true).walkers.map(item => item.name)).toEqual([null, 'Juniper']);
  expect(redactWalkers(frame, 'all', true).walkers.map(item => [item.name, item.x, item.homeSlot])).toEqual([[null, 0, 1], [null, 0, 2]]);
  // On a frame that requires a name, the quiet walker and their seat leave the stream's frame; nobody else changes.
  const left = redactWalkers(frame, new Set([1]), false);
  expect(left.walkers.map(item => item.name)).toEqual(['Juniper']);
  expect(left.seats?.map(seat => seat.walkerId)).toEqual(['b']);
  expect(redactWalkers(frame, 'all', false)).toMatchObject({ walkers: [], seats: [] });
  // Whatever today's shared frame carries, the default never sends a quiet walker's name.
  expect(JSON.stringify(redactWalkers(frame, new Set([1])))).not.toContain('Wren');
  expect(WALKER_NAMELESS ? redactWalkers(frame, new Set([1])).walkers.length : 1).toBe(WALKER_NAMELESS ? 2 : 1);
});

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('quiet and forget through the panel and chat doors', () => {
  const schema = `panel_window_test_${randomBytes(6).toString('hex')}`;
  const secret = randomBytes(32).toString('hex'), herald = randomBytes(32).toString('hex');
  const panelAuth = `Bearer ${secret}`, heraldAuth = `Bearer ${herald}`;
  const names = new Map<KingdomId, string>(), plans = new Map<KingdomId, SettlementPlan>();
  let db: ReturnType<typeof createRealmPool>;
  let services: ReturnType<typeof createDurableRealmServices>;
  let ingress: RealmIngress, panel: RealmPanelService, chat: RealmChatPrivacy, allocation: AllocationService;
  let guard: ForgetGuard, citizens: ReturnType<typeof createRealmCitizens>;
  let directory: string;
  let nextId = 961_000_000;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires the isolated development DATABASE_URL.');
    const url = new URL(process.env.DATABASE_URL);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5410') throw new Error('Panel database tests run only on development Postgres port 5410.');
    db = createRealmPool({ connectionString: url.toString(), schema });
    await migrateRealmSchema(db, schema);
    directory = await mkdtemp(join(tmpdir(), 'panel-privacy-'));
    const key = randomBytes(32);
    const castle = createRealmCastle({ origin, kingdomNames: names, safetyKey: key });
    citizens = createRealmCitizens({ db, origin, kingdomNames: names });
    guard = new ForgetGuard(db, origin);
    allocation = new AllocationService(db, { origin, verifier: new TenureEvidenceVerifier(origin, key), furnish: citizens.furnish });
    ingress = new RealmIngress(db, origin, { panel: secret, herald });
    services = createDurableRealmServices({ repository: new PostgresRealmRepository(db, { origin, guards: [castle.guard] }), outbox: new PostgresOutboxStore(db),
      auth: { authenticate: async () => { throw new Error('No socket authentication in this test'); }, current: async () => false },
      kingdom: kingdomId => ({ world: REFERENCE_WORLD, layoutRevision: plans.get(kingdomId)!.revision, spawn: () => [0, 0, 6] }),
      afterOpen: kingdom => citizens.recover(kingdom), attach: kingdom => ingress.attach(kingdom) });
    citizens.use(allocation, services); ingress.use(services);
    castle.use(allocation, new FileFoundedStore(directory));
    panel = new RealmPanelService({ db, origin, secret, allocation, citizens, services, projection: true, guard, castle: (kingdom, personId, name) => castle.observe(kingdom, personId, name) });
    chat = new RealmChatPrivacy({ db, origin, secret: herald, services, allocation, guard });
  });
  afterAll(async () => {
    await ingress?.stop();
    if (services) await Promise.all([...services.kingdoms.values()].map(kingdom => kingdom.dispose()));
    if (db) { try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); } }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  const person = () => PersonIdSchema.parse(String(++nextId));
  async function founded(): Promise<KingdomId> {
    const kingdomId = KingdomIdSchema.parse(String(++nextId));
    const plan = generateSettlementPlan({ seed: `privacy-${kingdomId}`, tier: 'hamlet', firstYear: 2026, year: 2026 });
    plans.set(kingdomId, plan); names.set(kingdomId, 'SIMULATED Privacy Kingdom');
    expect(await allocation.adoptLayout(kingdomId, plan)).toMatchObject({ status: 'founded' });
    return kingdomId;
  }
  async function observe(kingdomId: KingdomId, service: 'herald' | 'panel', input: Record<string, unknown>) {
    const now = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now);
    const id = `privacy-test-${randomBytes(8).toString('hex')}`;
    expect(await ingress.accept(`Bearer ${service === 'panel' ? secret : herald}`, { version: 1,
      observation: { version: 1, id, kingdomId, origin, observedAt: now, ...input } as PresenceInput })).toMatchObject({ http: 202, body: { status: 'accepted' } });
    await expect.poll(async () => Number((await db.query('SELECT count(*) AS n FROM realm_ingress_receipts WHERE kingdom_id = $1 AND source = $2 AND observation_id = $3', [kingdomId, service, id])).rows[0].n), { timeout: 4_000 }).toBe(1);
  }
  const live = (kingdomId: KingdomId) => observe(kingdomId, 'herald', { kind: 'stream', live: true, sessionId: `privacy-night-${kingdomId}` });
  const light = (kingdomId: KingdomId, personId: PersonId, name: string, source: 'panel' | 'chat' = 'panel') =>
    observe(kingdomId, source === 'panel' ? 'panel' : 'herald', { kind: 'observe', source, coverage: 'activity', people: [{ personId, disclosure: 'named', displayName: name }] });
  const claim = async (kingdomId: KingdomId, personId: PersonId, name: string) => (await panel.claim(panelAuth, { kingdomId, personId, name })).body;
  const lit = async (kingdomId: KingdomId, personId: PersonId) => (await panel.presence(panelAuth, { kingdomId, personId })).body;
  /** The committed public frame, exactly as the stream receives it before any read-time disclosure. */
  async function committed(kingdomId: KingdomId) {
    const hold = await services.retain(kingdomId);
    try {
      const checkpoint = await hold.kingdom.preparePublicCheckpoint();
      const message = checkpoint.current.find(item => item.type === 'presence') as Extract<RealmPublicMessage, { type: 'presence' }>;
      return { message, slots: Object.fromEntries(Object.values(hold.kingdom.privateState.homes).map(home => [home.ownerId, home.slot])) as Record<string, number> };
    } finally { await hold.release(); }
  }
  const windowOf = (frame: KingdomPresenceFrame, slot: number | undefined) => frame.windows.find(window => window.slot === slot);
  /** Inbox observations that carry this person's ID, however the JSON is spelled. Controls carry only the ID and are not counted. */
  const mentions = async (personId: PersonId) => Number((await db.query(`SELECT count(*) AS n FROM realm_ingress_inbox
    WHERE observation::jsonb ->> 'kind' = 'observe' AND strpos(observation, $1) > 0`, [personId])).rows[0].n);
  /** Inbox rows in these kingdoms whose text carries this name anywhere. */
  const named = async (name: string, kingdoms: readonly KingdomId[]) => Number((await db.query(`SELECT count(*) AS n FROM realm_ingress_inbox
    WHERE kingdom_id = ANY($2::text[]) AND strpos(observation, $1) > 0`, [name, kingdoms])).rows[0].n);

  it('quiet takes the name off the stream view, keeps the light, home and card, and is one preference for both doors', async () => {
    const kingdomId = await founded(), wren = person(), juniper = person();
    expect(await claim(kingdomId, wren, 'SIMULATED Wren')).toMatchObject({ status: 'deed' });
    expect(await claim(kingdomId, juniper, 'SIMULATED Juniper')).toMatchObject({ status: 'deed' });
    await live(kingdomId);
    await light(kingdomId, wren, 'SIMULATED Wren'); await light(kingdomId, juniper, 'SIMULATED Juniper', 'chat');
    expect(await panel.privacy(panelAuth, { kingdomId, personId: wren })).toMatchObject({ body: { quiet: false, projection: 'applied', forgetAvailable: true, renewal: CONSENT_RENEWAL ? 'applied' : 'pending' } });
    expect(await panel.quiet(panelAuth, { kingdomId, personId: wren, quiet: true })).toMatchObject({ http: 200, body: { status: 'quiet', quiet: true, projection: 'applied' } });

    const { message, slots } = await committed(kingdomId);
    // Exactly the path the public watch route reads through (composed in main.ts).
    const watched = disclosedServices(services, createQuietDisclosure({ db, origin }));
    const hold = await watched.retain(kingdomId), raw = await services.retain(kingdomId);
    const delivered: RealmPublicMessage[] = [];
    const unsubscribe = hold.kingdom.subscribe(delivery => delivered.push(delivery.message));
    try {
      const shownOf = (current: readonly RealmPublicMessage[]) => current.find(item => item.type === 'presence') as typeof message;
      const shown = shownOf(hold.kingdom.publicCheckpoint().current);
      expect(windowOf(shown.frame, slots[wren])).toMatchObject({ present: true, publicName: null });
      expect(windowOf(shown.frame, slots[juniper])).toMatchObject({ present: true, publicName: 'SIMULATED Juniper' });
      expect(windowOf(shownOf((await hold.kingdom.preparePublicCheckpoint()).current).frame, slots[wren])).toMatchObject({ publicName: null });
      // Everything else the route reads is the kingdom itself.
      expect(hold.kingdom.world).toBe(raw.kingdom.world);
      expect([hold.kingdom.kingdomId, hold.kingdom.current, hold.kingdom.layoutRevision]).toEqual([raw.kingdom.kingdomId, raw.kingdom.current, raw.kingdom.layoutRevision]);
      expect({ ...hold.kingdom.currentWalkers(), sampledAt: 0 }).toEqual({ ...raw.kingdom.currentWalkers(), sampledAt: 0 });
      const detach = [hold.kingdom.onClosed(() => {}), hold.kingdom.subscribeWalkers(() => {}), hold.kingdom.onWorldAdopted(() => {})];
      for (const off of detach) off();
      // A live frame committed while watching arrives without the quiet name too.
      await light(kingdomId, wren, 'SIMULATED Wren', 'chat');
      await expect.poll(() => delivered.filter(item => item.type === 'presence').length, { timeout: 4_000 }).toBeGreaterThan(0);
      for (const item of delivered) if (item.type === 'presence') expect(windowOf(item.frame, slots[wren])?.publicName ?? null).toBeNull();
      // The committed fact, the panel's own plate, the deed and the provider name are unchanged: quiet is a view.
      expect(windowOf(message.frame, slots[wren])).toMatchObject({ present: true, publicName: 'SIMULATED Wren' });
      expect(windowOf(shownOf(raw.kingdom.publicCheckpoint().current).frame, slots[wren])).toMatchObject({ publicName: 'SIMULATED Wren' });
      expect(await lit(kingdomId, wren)).toMatchObject({ lit: true });
      expect(await allocation.deedIn(kingdomId, wren)).toMatchObject({ status: 'installed' });
      expect((await db.query('SELECT public_name FROM realm_citizen_names WHERE person_id = $1', [wren])).rows).toEqual([{ public_name: 'SIMULATED Wren' }]);
      // The kingdom tab never names a quiet window either.
      const reading = (await panel.kingdom(panelAuth, { kingdomId })).body as { presence: KingdomPresenceFrame };
      expect(windowOf(reading.presence, slots[wren])).toMatchObject({ present: true, publicName: null });

      // The chat door reaches the same preference; the panel sees it at once and the stream within a second.
      expect(await chat.handle(heraldAuth, { version: 1, kingdomId, personId: wren, command: 'quiet-off' })).toMatchObject({ http: 200, body: { status: 'quiet', reply: expect.stringContaining('again') } });
      expect(await panel.privacy(panelAuth, { kingdomId: await founded(), personId: wren })).toMatchObject({ body: { quiet: false } });
      await expect.poll(() => windowOf(shownOf(hold.kingdom.publicCheckpoint().current).frame, slots[wren])?.publicName, { timeout: 1_500, interval: 50 }).toBe('SIMULATED Wren');
    } finally { unsubscribe(); await hold.release(); await raw.release(); }
  }, 30_000);

  it('forget erases the person across kingdoms, says what it erased, and leaves everyone else alone', async () => {
    const first = await founded(), second = await founded(), wren = person(), juniper = person();
    const unfounded = KingdomIdSchema.parse(String(++nextId));
    for (const kingdomId of [first, second]) {
      expect(await claim(kingdomId, wren, 'SIMULATED Wren')).toMatchObject({ status: 'deed' });
      await live(kingdomId); await light(kingdomId, wren, 'SIMULATED Wren');
    }
    expect(await claim(first, juniper, 'SIMULATED Juniper')).toMatchObject({ status: 'deed' });
    // One Herald batch names both people: forget must take out Wren's entry and keep Juniper's.
    await observe(first, 'herald', { kind: 'observe', source: 'chat', coverage: 'activity', people: [
      { personId: wren, disclosure: 'named', displayName: 'SIMULATED Wren' }, { personId: juniper, disclosure: 'named', displayName: 'SIMULATED Juniper' }] });
    await panel.quiet(panelAuth, { kingdomId: first, personId: wren, quiet: true });
    for (const who of [wren, juniper]) await panel.pledge(panelAuth, { kingdomId: unfounded, personId: who });
    const homeBefore = await allocation.deedIn(first, wren);
    expect(await lit(first, wren)).toMatchObject({ lit: true });
    expect(await mentions(wren)).toBeGreaterThan(0);

    expect(await panel.forget(panelAuth, { kingdomId: first, personId: wren })).toMatchObject({ http: 400 });
    const answer = await panel.forget(panelAuth, { kingdomId: first, personId: wren, confirm: true });
    expect(answer).toMatchObject({ http: 200, body: { status: 'forgotten', kingdoms: 2,
      erased: ['light', 'name', 'quiet', 'pledges', 'observations'], retained: expect.arrayContaining(['homes']) } });

    for (const kingdomId of [first, second]) {
      const { message, slots } = await committed(kingdomId);
      expect(windowOf(message.frame, slots[wren])).toMatchObject({ present: false, publicName: null });
      expect(await lit(kingdomId, wren)).toMatchObject({ lit: false, held: false });
    }
    expect(await mentions(wren)).toBe(0);
    expect((await db.query('SELECT person_id FROM realm_citizen_names WHERE person_id = ANY($1::text[])', [[wren, juniper]])).rows).toEqual([{ person_id: juniper }]);
    expect((await db.query('SELECT person_id FROM realm_panel_pledges WHERE kingdom_id = $1', [unfounded])).rows).toEqual([{ person_id: juniper }]);
    expect(await panel.privacy(panelAuth, { kingdomId: first, personId: wren })).toMatchObject({ body: { quiet: false } });
    // Juniper keeps their light, name and evidence; the shared batch still carries them.
    const { message, slots } = await committed(first);
    expect(windowOf(message.frame, slots[juniper])).toMatchObject({ present: true, publicName: 'SIMULATED Juniper' });
    expect(await mentions(juniper)).toBeGreaterThan(0);
    // The home stays Wren's, untouched.
    expect(await allocation.deedIn(first, wren)).toEqual(homeBefore);

    // A heartbeat already on its way, or a chat line, cannot relight or rename someone who asked to be forgotten,
    // and the inbox keeps nothing of them: each is stored and settled without their entry.
    await light(first, wren, 'SIMULATED Wren'); await light(first, wren, 'SIMULATED Wren', 'chat');
    expect(await lit(first, wren)).toMatchObject({ lit: false });
    expect(windowOf((await committed(first)).message.frame, slots[wren])).toMatchObject({ present: false, publicName: null });
    expect(await mentions(wren)).toBe(0);
    expect(await named('SIMULATED Wren', [first, second])).toBe(0);

    // Repeating is safe and says so plainly: there is nothing of theirs left in the inbox to erase.
    expect(await panel.forget(panelAuth, { kingdomId: second, personId: wren, confirm: true })).toMatchObject({ http: 200, body: { status: 'forgotten', erased: ['light'] } });
    expect(await mentions(wren)).toBe(0);
  }, 40_000);

  it('forget erases evidence still waiting for a writer and evidence racing the answer, and stores none after it', async () => {
    const kingdomId = await founded(), wren = person(), juniper = person();
    // No writer can open an unfounded kingdom, so its inbox rows stay waiting.
    const waiting = KingdomIdSchema.parse(String(++nextId));
    expect(await claim(kingdomId, wren, 'SIMULATED Wren')).toMatchObject({ status: 'deed' });
    await live(kingdomId); await light(kingdomId, wren, 'SIMULATED Wren');
    const now = async () => Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now);
    const send = async (target: KingdomId, service: 'herald' | 'panel', people: PersonId[]) => ingress.accept(`Bearer ${service === 'panel' ? secret : herald}`, { version: 1,
      observation: { version: 1, id: `privacy-race-${randomBytes(8).toString('hex')}`, kingdomId: target, origin, observedAt: await now(), kind: 'observe',
        source: service === 'panel' ? 'panel' : 'chat', coverage: 'activity',
        people: people.map(personId => ({ personId, disclosure: 'named', displayName: personId === wren ? 'SIMULATED Wren' : 'SIMULATED Juniper' })) } as PresenceInput });
    expect(await send(waiting, 'herald', [wren, juniper])).toMatchObject({ http: 202, body: { status: 'accepted' } });
    const pending = async () => (await db.query<{ observation: string }>('SELECT observation FROM realm_ingress_inbox WHERE kingdom_id = $1 AND settled_ms IS NULL', [waiting])).rows
      .map(row => (JSON.parse(row.observation) as { people: { personId: string }[] }).people.map(item => item.personId));
    expect(await pending()).toEqual([[wren, juniper]]);
    expect(await mentions(wren)).toBeGreaterThan(0);

    // Heartbeats and chat lines in flight while forget runs: whichever side of it they land, none keeps Wren.
    const racing = Array.from({ length: 6 }, (_, index) => send(kingdomId, index % 2 ? 'herald' : 'panel', [wren]));
    const answer = await panel.forget(panelAuth, { kingdomId, personId: wren, confirm: true });
    expect(answer).toMatchObject({ http: 200, body: { status: 'forgotten', erased: expect.arrayContaining(['light', 'observations']) } });
    for (const reply of await Promise.all(racing)) expect(reply).toMatchObject({ http: 202 });
    expect(await mentions(wren)).toBe(0);
    expect(await named('SIMULATED Wren', [kingdomId, waiting])).toBe(0);
    // The waiting row is still owed to its writer and still speaks for Juniper.
    expect(await pending()).toEqual([[juniper]]);
    expect(await mentions(juniper)).toBe(1);

    // After the answer, new evidence about Wren is stored without them, in a waiting kingdom and a written one alike.
    expect(await send(waiting, 'herald', [wren, juniper])).toMatchObject({ http: 202, body: { status: 'accepted' } });
    await light(kingdomId, wren, 'SIMULATED Wren', 'chat');
    expect(await mentions(wren)).toBe(0);
    expect(await named('SIMULATED Wren', [kingdomId, waiting])).toBe(0);
    expect(await pending()).toEqual([[juniper], [juniper]]);
    expect(await lit(kingdomId, wren)).toMatchObject({ lit: false, forgotten: true });
    // Nobody else is noted as forgotten.
    expect((await db.query('SELECT person_id FROM realm_panel_forgotten WHERE person_id = ANY($1::text[])', [[wren, juniper]])).rows).toEqual([{ person_id: wren }]);
  }, 40_000);

  /** A chat line exactly as main.ts composes it: first-chat settlement through the forget guard, then the inbox. */
  async function chatLine(kingdomId: KingdomId, people: readonly (readonly [PersonId, string])[]) {
    const now = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now);
    const observation = { version: 1, id: `privacy-chat-${randomBytes(8).toString('hex')}`, kingdomId, origin, observedAt: now, kind: 'observe', source: 'chat', coverage: 'activity',
      people: people.map(([personId, displayName]) => ({ personId, disclosure: 'named', displayName })) } as PresenceInput;
    await guard.run(observation, kept => citizens.observe(kept));
    expect(await ingress.accept(heraldAuth, { version: 1, observation })).toMatchObject({ http: 202, body: { status: 'accepted' } });
    await expect.poll(async () => Number((await db.query('SELECT count(*) AS n FROM realm_ingress_receipts WHERE kingdom_id = $1 AND observation_id = $2', [kingdomId, observation.id])).rows[0].n), { timeout: 4_000 }).toBe(1);
  }
  const nameRow = async (personId: PersonId) => (await db.query('SELECT public_name FROM realm_citizen_names WHERE person_id = $1', [personId])).rows;

  it('after forget, a kingdom they first come to keeps nothing of them, by any source, until they take their place there', async () => {
    const first = await founded(), fresh = await founded(), wren = person(), juniper = person();
    expect(await claim(first, wren, 'SIMULATED Wren')).toMatchObject({ status: 'deed' });
    await live(first); await light(first, wren, 'SIMULATED Wren');
    expect(await panel.forget(panelAuth, { kingdomId: first, personId: wren, confirm: true })).toMatchObject({ http: 200, body: { status: 'forgotten', kingdoms: 1 } });

    // A chat line in a kingdom that never knew Wren settles and names Juniper beside them, and keeps nothing of Wren.
    await live(fresh);
    await chatLine(fresh, [[wren, 'SIMULATED Wren'], [juniper, 'SIMULATED Juniper']]);
    await light(fresh, wren, 'SIMULATED Wren');
    const hold = await services.retain(fresh);
    try { expect(await guard.settler(citizens).settle(hold.kingdom, { personId: wren, name: 'SIMULATED Wren' }, { months: 3 })).toBeNull(); }
    finally { await hold.release(); }
    expect(await allocation.deedIn(fresh, wren)).toBeFalsy();
    expect(await allocation.deedIn(fresh, juniper)).toMatchObject({ status: 'installed' });
    expect(await nameRow(wren)).toEqual([]);
    expect(await nameRow(juniper)).toEqual([{ public_name: 'SIMULATED Juniper' }]);
    expect(await mentions(wren)).toBe(0);
    expect(await named('SIMULATED Wren', [first, fresh])).toBe(0);
    expect(await mentions(juniper)).toBeGreaterThan(0);
    // The panel hears the same: dark, forgotten, and here taking their place can light the window.
    expect(await lit(fresh, wren)).toMatchObject({ lit: false, forgotten: true, renewal: 'applied' });
    // A write from anywhere else, without the guard, still stores no name: the database keeps the note too.
    expect((await db.query(`INSERT INTO realm_citizen_names (person_id, origin, public_name, name_approval, observed_ms)
      VALUES ($1, $2, 'SIMULATED Wren', 'provider-display-name-v1', 1)`, [wren, origin])).rowCount).toBe(0);

    // Taking their place here is fresh consent for this kingdom only: home, name and light return within 5 s.
    expect(await claim(fresh, wren, 'SIMULATED Wren')).toMatchObject({ status: 'deed' });
    const start = performance.now();
    await light(fresh, wren, 'SIMULATED Wren');
    await expect.poll(async () => lit(fresh, wren), { timeout: 4_500, interval: 50 }).toMatchObject({ lit: true });
    expect(performance.now() - start).toBeLessThan(5_000);
    expect(await nameRow(wren)).toEqual([{ public_name: 'SIMULATED Wren' }]);
    expect(await named('SIMULATED Wren', [fresh])).toBeGreaterThan(0);
    // The kingdom where they asked to be forgotten still keeps nothing of them.
    await chatLine(first, [[wren, 'SIMULATED Wren']]);
    expect(await named('SIMULATED Wren', [first])).toBe(0);
    expect(await lit(first, wren)).toMatchObject({ lit: false, forgotten: true });
  }, 40_000);

  it('forget waits for a settlement already under way, then finds and darkens the home it made', async () => {
    const elsewhere = await founded(), rook = person();
    await live(elsewhere);
    const now = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now);
    const observation = { version: 1, id: `privacy-slow-${randomBytes(8).toString('hex')}`, kingdomId: elsewhere, origin, observedAt: now, kind: 'observe', source: 'chat', coverage: 'activity',
      people: [{ personId: rook, disclosure: 'named', displayName: 'SIMULATED Rook' }] } as PresenceInput;
    let release!: () => void, seen: PresenceInput | null = null;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const settling = guard.run(observation, async kept => { seen = kept; await gate; await citizens.observe(kept); });
    await expect.poll(() => seen, { timeout: 2_000 }).not.toBeNull();
    // It read the observation before forget began, so it still settles Rook; forget must wait for it.
    let answered = false;
    const forgetting = panel.forget(panelAuth, { kingdomId: elsewhere, personId: rook, confirm: true }).then(answer => { answered = true; return answer; });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(answered).toBe(false);
    release();
    await settling;
    expect(await forgetting).toMatchObject({ http: 200, body: { status: 'forgotten', kingdoms: 1, retained: expect.arrayContaining(['homes']) } });
    expect(await allocation.deedIn(elsewhere, rook)).toMatchObject({ status: 'installed' });
    expect(await nameRow(rook)).toEqual([]);
    await light(elsewhere, rook, 'SIMULATED Rook', 'chat');
    expect(await lit(elsewhere, rook)).toMatchObject({ lit: false, forgotten: true });
    expect(await mentions(rook)).toBe(0);
  }, 30_000);

  it.runIf(CONSENT_RENEWAL)('taking your place after forget brings you home and lights your window again, under your name', async () => {
    const kingdomId = await founded(), wren = person();
    const home = await claim(kingdomId, wren, 'SIMULATED Wren');
    expect(home).toMatchObject({ status: 'deed' });
    await live(kingdomId); await light(kingdomId, wren, 'SIMULATED Wren');
    expect(await panel.forget(panelAuth, { kingdomId, personId: wren, confirm: true })).toMatchObject({ http: 200, body: { status: 'forgotten', renewal: 'applied' } });
    expect(await lit(kingdomId, wren)).toMatchObject({ lit: false, forgotten: true, renewal: 'applied' });

    expect(await claim(kingdomId, wren, 'SIMULATED Wren')).toEqual(home);
    const start = performance.now();
    await light(kingdomId, wren, 'SIMULATED Wren');
    await expect.poll(async () => lit(kingdomId, wren), { timeout: 4_500, interval: 50 }).toMatchObject({ lit: true });
    expect(performance.now() - start).toBeLessThan(5_000);
    const { message, slots } = await committed(kingdomId);
    expect(windowOf(message.frame, slots[wren])).toMatchObject({ present: true, publicName: 'SIMULATED Wren' });
    expect((await db.query('SELECT public_name FROM realm_citizen_names WHERE person_id = $1', [wren])).rows).toEqual([{ public_name: 'SIMULATED Wren' }]);
    // Chat works for them again too, and the inbox keeps their evidence again.
    await light(kingdomId, wren, 'SIMULATED Wren', 'chat');
    expect(await lit(kingdomId, wren)).toMatchObject({ lit: true });
    expect(await mentions(wren)).toBeGreaterThan(0);
    expect(await named('SIMULATED Wren', [kingdomId])).toBeGreaterThan(0);
  }, 30_000);

  it.skipIf(CONSENT_RENEWAL)('until the shared presence rules carry renewed consent, taking your place after forget brings you home and says the window stays dark', async () => {
    const kingdomId = await founded(), wren = person();
    const home = await claim(kingdomId, wren, 'SIMULATED Wren');
    expect(home).toMatchObject({ status: 'deed' });
    await live(kingdomId); await light(kingdomId, wren, 'SIMULATED Wren');
    expect(await panel.privacy(panelAuth, { kingdomId, personId: wren })).toMatchObject({ body: { renewal: 'pending', forgetAvailable: true } });
    expect(await panel.forget(panelAuth, { kingdomId, personId: wren, confirm: true })).toMatchObject({ http: 200, body: { status: 'forgotten', renewal: 'pending' } });

    // The home is still theirs and the claim says so, without writing a control the shared rules cannot read.
    const controls = async () => Number((await db.query(`SELECT (SELECT count(*) FROM realm_ingress_receipts WHERE kingdom_id = $1 AND observation_id LIKE 'panel.renew.%') + (SELECT count(*) FROM realm_ingress_inbox WHERE kingdom_id = $1 AND observation_id LIKE 'panel.renew.%') AS n`, [kingdomId])).rows[0].n);
    expect(await claim(kingdomId, wren, 'SIMULATED Wren')).toEqual(home);
    expect(await controls()).toBe(0);
    // The forget hold stands: the panel's light and chat both stay dark and nameless, and the reply says why.
    await light(kingdomId, wren, 'SIMULATED Wren'); await light(kingdomId, wren, 'SIMULATED Wren', 'chat');
    expect(await lit(kingdomId, wren)).toMatchObject({ lit: false, held: false, forgotten: true, renewal: 'pending' });
    expect(await mentions(wren)).toBe(0);
    expect(await named('SIMULATED Wren', [kingdomId])).toBe(0);
    const { message, slots } = await committed(kingdomId);
    expect(windowOf(message.frame, slots[wren])).toMatchObject({ present: false, publicName: null });
  }, 30_000);

  it('forget never lifts a moderation hold, and taking your place cannot either', async () => {
    const kingdomId = await founded(), rook = person();
    expect(await claim(kingdomId, rook, 'SIMULATED Rook')).toMatchObject({ status: 'deed' });
    await live(kingdomId); await light(kingdomId, rook, 'SIMULATED Rook');
    await observe(kingdomId, 'herald', { kind: 'remove', personId: rook, reason: 'ban', until: null });
    expect(await lit(kingdomId, rook)).toMatchObject({ lit: false, held: true });
    expect(await panel.forget(panelAuth, { kingdomId, personId: rook, confirm: true })).toMatchObject({ http: 200, body: { status: 'forgotten', kingdoms: 0, erased: expect.arrayContaining(['name']) } });
    expect(await claim(kingdomId, rook, 'SIMULATED Rook')).toMatchObject({ status: 'held' });
    await light(kingdomId, rook, 'SIMULATED Rook');
    expect(await lit(kingdomId, rook)).toMatchObject({ lit: false, held: true });
  }, 30_000);

  it('the chat door takes only the Herald, only the speaker, and answers with a line it can post', async () => {
    const kingdomId = await founded(), wren = person();
    expect(await claim(kingdomId, wren, 'SIMULATED Wren')).toMatchObject({ status: 'deed' });
    expect(await chat.handle(panelAuth, { version: 1, kingdomId, personId: wren, command: 'forget' })).toMatchObject({ http: 401 });
    expect(await chat.handle('', { version: 1, kingdomId, personId: wren, command: 'quiet' })).toMatchObject({ http: 401 });
    expect(await chat.handle(heraldAuth, { version: 1, kingdomId, personId: wren, command: 'quiet', target: 'someone' })).toMatchObject({ http: 400 });
    expect(await chat.handle(heraldAuth, { version: 1, kingdomId, personId: 'Wren', command: 'quiet' })).toMatchObject({ http: 400 });
    expect(await chat.handle(heraldAuth, { version: 1, kingdomId, personId: wren, command: 'quiet' })).toMatchObject({ http: 200, body: { status: 'quiet' } });
    expect(await panel.privacy(panelAuth, { kingdomId, personId: wren })).toMatchObject({ body: { quiet: true } });
    const forgotten = await chat.handle(heraldAuth, { version: 1, kingdomId, personId: wren, command: 'forget' });
    expect(forgotten).toMatchObject({ http: 200, body: { status: 'forgotten', reply: expect.stringContaining('Forgotten') } });
    expect(forgotten.body).not.toHaveProperty('message');
    expect(JSON.stringify(forgotten.body)).not.toMatch(/@|SIMULATED Wren/);
    expect((await db.query('SELECT 1 FROM realm_citizen_names WHERE person_id = $1', [wren])).rowCount).toBe(0);
  }, 30_000);
});
