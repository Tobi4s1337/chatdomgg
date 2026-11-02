import { createServer as createNetServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, RealmHomePlaceReplySchema, type KingdomId, type PersonId } from '@chatdom/shared';
import { DISPLAY_NAME_APPROVAL } from '../../../api/src/realm-auth/presentation';
import type { AllocationOutcome, Deed } from '../allocation';
import { referenceServices } from '../reference';
import { createRealmServer } from '../server';
import { mountLookRoutes } from './http';
import { MemoryLookRepository } from './memory-repository';
import { createHomePlaces, placeRefusal, type HomePlaces } from './place';
import type { LookSessions } from './ports';
import { csrfFor, readCookie } from './session';
import { LookStore } from './store';

const WREN = PersonIdSchema.parse('990300201'), KINGDOM = KingdomIdSchema.parse('990300002');
const MONARCH = PersonIdSchema.parse(String(KINGDOM));

/*
 * "Take your place" composes the panel's claim for a signed-in person: their approved sign-in name, the retained
 * writer, `citizens.settle`, then the allocator's own idempotent answer. Allocation and settlement are the real
 * services' ports here; their own behaviour is covered next to them.
 */
function rig(options: { name?: string | null; approval?: string; founded?: boolean; blocked?: boolean; outcome?: AllocationOutcome; installed?: boolean } = {}) {
  const deed = { deedId: 'd1', receipt: 'r', personId: WREN, kingdomId: KINGDOM, origin: 'simulated', layoutRevision: 'rev', plotId: 'plot-4', slot: 4,
    placement: { street: 'Lantern Row', ordinal: 3 }, tenure: {}, status: options.installed === false ? 'pending' : 'installed', installedSequence: 7 } as unknown as Deed;
  const name = options.name === undefined ? 'MarigoldWren' : options.name;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM realm_persons')) return { rows: name === null ? [] : [{ public_name: name, name_approval: options.approval ?? DISPLAY_NAME_APPROVAL }] };
    if (sql.includes('FROM realm_ingress_checkpoints')) return { rows: [] };
    if (sql.includes('realm_panel_withheld')) return { rows: [{ withheld: false }] };
    throw new Error(`Unexpected SIMULATED query: ${sql}`);
  });
  const kingdom = { kingdomId: KINGDOM, origin: 'simulated', current: true, databaseNow: () => Date.now(),
    privateState: { rights: options.blocked ? { [WREN]: { blocked: true } } : {} } };
  const release = vi.fn(async () => {});
  const services = { retain: vi.fn(async () => ({ kingdom, release })) };
  let fresh = true;
  const allocation = {
    currentLayout: vi.fn(async () => (options.founded === false ? null : { revision: 'rev', foundedAt: 1, adoptedAt: 1 })),
    allocate: vi.fn(async (): Promise<AllocationOutcome> => options.outcome ?? { status: 'deed', deed, fresh: false }),
    deedIn: vi.fn(async () => deed),
  };
  const citizens = { settle: vi.fn(async () => { const answer = { fresh }; fresh = false; return options.outcome && options.outcome.status !== 'deed' ? null : answer; }) };
  const places = createHomePlaces({ db: { query } as never, origin: 'simulated', services: services as never, allocation: allocation as never, citizens: citizens as never });
  return { places, citizens, allocation, services, release };
}

describe('taking your place', () => {
  it('settles the signed-in person under their approved name and answers with the street; asking again is the same home', async () => {
    const { places, citizens, release } = rig();
    const first = await places.take(WREN, KINGDOM);
    expect(first).toEqual({ status: 200, reply: { version: 1, ok: true, fresh: true,
      home: { kingdomId: KINGDOM, plotId: 'plot-4', street: 'Lantern Row', place: 'Number 4 on Lantern Row' } } });
    expect(RealmHomePlaceReplySchema.parse(first.reply)).toEqual(first.reply);
    expect(citizens.settle).toHaveBeenCalledWith(expect.objectContaining({ kingdomId: KINGDOM }), { personId: WREN, name: 'MarigoldWren' }, {});
    expect(release).toHaveBeenCalledTimes(1);
    const again = await places.take(WREN, KINGDOM);
    expect(again.reply).toMatchObject({ ok: true, fresh: false, home: { street: 'Lantern Row' } });
  });

  it('never gives the monarch a street home in their own kingdom', async () => {
    const { places, citizens, services } = rig();
    expect(await places.take(MONARCH, KINGDOM as KingdomId)).toEqual(placeRefusal('castle'));
    expect(services.retain).not.toHaveBeenCalled();
    expect(citizens.settle).not.toHaveBeenCalled();
  });

  it('refuses cleanly without an approved name, in an unfounded kingdom, or for someone held', async () => {
    for (const setup of [{ name: null }, { approval: 'something-else' }, { name: 'Wren‮' }]) {
      const { places, citizens } = rig(setup);
      expect((await places.take(WREN, KINGDOM)).reply).toMatchObject({ ok: false, code: 'unnamed' });
      expect(citizens.settle).not.toHaveBeenCalled();
    }
    const unfounded = rig({ founded: false });
    expect(await unfounded.places.take(WREN, KINGDOM)).toEqual(placeRefusal('unfounded'));
    expect(unfounded.services.retain).not.toHaveBeenCalled();
    const held = rig({ blocked: true });
    expect(await held.places.take(WREN, KINGDOM)).toEqual({ status: 409, reply: placeRefusal('held').reply });
    expect(held.citizens.settle).not.toHaveBeenCalled();
    expect(held.release).toHaveBeenCalled();
  });

  it('says so when the kingdom is full or the person already keeps three homes', async () => {
    const full = rig({ outcome: { status: 'guest', reason: 'kingdom-full' } });
    expect(await full.places.take(WREN, KINGDOM)).toMatchObject({ status: 409, reply: { ok: false, code: 'kingdom-full' } });
    const three = rig({ outcome: { status: 'guest', reason: 'three-homes' } });
    expect(await three.places.take(WREN, KINGDOM)).toMatchObject({ status: 409, reply: { ok: false, code: 'three-homes' } });
  });

  it('never calls a counted but uninstalled deed a home, and turns trouble into unavailable', async () => {
    const pending = rig({ installed: false });
    expect(await pending.places.take(WREN, KINGDOM)).toEqual(placeRefusal('unavailable'));
    const broken = rig();
    broken.citizens.settle.mockRejectedValueOnce(new Error('SIMULATED install pending'));
    expect(await broken.places.take(WREN, KINGDOM)).toEqual(placeRefusal('unavailable'));
    expect(broken.release).toHaveBeenCalled();
  });

  it('lets one claim per person and kingdom run at a time', async () => {
    const { places, services } = rig();
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    const retain = services.retain.getMockImplementation()!;
    services.retain.mockImplementationOnce(async (...args: Parameters<typeof retain>) => { await gate; return retain(...args); });
    const first = places.take(WREN, KINGDOM);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(await places.take(WREN, KINGDOM)).toEqual(placeRefusal('busy'));
    open();
    expect((await first).status).toBe(200);
  });
});

describe('the take-your-place route', () => {
  const handle = 'handle-wren-SIMULATED-0123456789', cookie = `chatdom_session=${handle}`, csrf = csrfFor(handle);
  const sessions: LookSessions = { async resolve(header) {
    return readCookie(header, 'chatdom_session') === handle ? { personId: WREN, csrfToken: csrf } : null;
  } };
  const asked: [PersonId, KingdomId][] = [];
  const places: HomePlaces = { async take(personId, kingdomId) {
    asked.push([personId, kingdomId]);
    return { status: 200, reply: { version: 1, ok: true, fresh: true, home: { kingdomId, plotId: 'plot-4', street: 'Lantern Row', place: 'Number 4 on Lantern Row' } } };
  } };
  const store = new LookStore({ repository: new MemoryLookRepository(), origin: 'simulated', records: { entitlements: async () => ({ kind: 'unknown' }) } });
  const { server, transport } = createRealmServer(referenceServices());
  let origin = '';
  const post = (query: string, headers: Record<string, string> = { cookie, 'x-csrf-token': csrf }) =>
    fetch(`${origin}/api/realm/looks/place${query}`, { method: 'POST', headers });

  beforeAll(async () => {
    mountLookRoutes(transport.app, { store, sessions, places });
    const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address(); if (!address || typeof address === 'string') throw new Error('No test port');
    await new Promise<void>(resolve => probe.close(() => resolve()));
    await server.listen(address.port, '127.0.0.1');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await server.gracefullyShutdown(false); });

  it('takes the place for the session person only, with its CSRF token, never cached', async () => {
    const response = await post(`?kingdom=${KINGDOM}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(RealmHomePlaceReplySchema.parse(await response.json())).toMatchObject({ ok: true, home: { street: 'Lantern Row' } });
    expect(asked).toEqual([[WREN, KINGDOM]]);
  });

  it('refuses no session, a missing or wrong CSRF token and a malformed kingdom before asking', async () => {
    asked.length = 0;
    const cases: [Promise<Response>, number, string][] = [
      [post(`?kingdom=${KINGDOM}`, {}), 401, 'unauthenticated'],
      [post(`?kingdom=${KINGDOM}`, { cookie }), 403, 'forbidden'],
      [post(`?kingdom=${KINGDOM}`, { cookie, 'x-csrf-token': csrfFor('another-handle-SIMULATED-000000') }), 403, 'forbidden'],
      [post('?kingdom=not-a-kingdom'), 400, 'malformed'],
      [post(''), 400, 'malformed'],
    ];
    for (const [pending, status, code] of cases) {
      const response = await pending;
      expect(response.status).toBe(status);
      expect(RealmHomePlaceReplySchema.parse(await response.json())).toMatchObject({ ok: false, code });
    }
    expect(asked).toEqual([]);
  });
});
