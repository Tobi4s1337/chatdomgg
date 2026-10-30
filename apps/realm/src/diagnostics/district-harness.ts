import { randomUUID } from 'node:crypto';
import { matchMaker, Protocol, ProtocolModifier, ServerError } from '@colyseus/core';
import { Encoder, type StateView } from '@colyseus/schema';
import { Client, type Room } from '@colyseus/sdk';
import { KingdomIdSchema, PersonIdSchema, type KingdomId } from '@chatdom/shared';
import { KingdomRoomState, RealmJoinSchema, kingdomRoomId, type CollisionWorld, type RealmJoin, type RealmPrincipal, type SolidBox,
  type WalkInput } from '@chatdom/shared/realm';
import { createRealmServer } from '../server';
import type { RealmRoomEffects, RealmRoomServices } from '../ports';
import { REALM_DISTRICT_GRID, type DistrictEntity, type RealmDistricts } from '../limits/districts';

/**
 * Spec 34 R10 harness: the production kingdom room and transport (`createRealmServer`), real SDK decoders, and one
 * walker crossing a district edge while the others stay put. Shared by `districts.test.ts` and
 * `apps/realm/scripts/districts.mjs`. Test support only; the server entry never imports it.
 *
 * Everyone here is SIMULATED: an open practice field with no owners, no Twitch identities and no durable writes.
 */

/** A SIMULATED open field, 20 districts across, walled at its edge so unknown space stays solid. */
const EDGE = REALM_DISTRICT_GRID.cellMetres * 10;
const FIELD_BLOCKS: readonly SolidBox[] = [
  { min: [-EDGE, -1, -EDGE], max: [EDGE, 0, EDGE] },
  { min: [-EDGE, 0, -EDGE], max: [-EDGE + 2, 6, EDGE] }, { min: [EDGE - 2, 0, -EDGE], max: [EDGE, 6, EDGE] },
  { min: [-EDGE, 0, -EDGE], max: [EDGE, 6, -EDGE + 2] }, { min: [-EDGE, 0, EDGE - 2], max: [EDGE, 6, EDGE] },
];
export const DISTRICT_FIELD: CollisionWorld = {
  revision: 1,
  query: bounds => FIELD_BLOCKS.filter(b => b.min.every((n, axis) => n <= bounds.max[axis]! && b.max[axis]! >= bounds.min[axis]!)),
};

/** SIMULATED entry for the field: each ticket names its walker and where it arrives. Nothing is stored or owned. */
export function fieldServices(kingdomId: KingdomId): RealmRoomServices & { issue(name: string, at: readonly [number, number]): RealmJoin } {
  const tickets = new Map<string, RealmPrincipal>(), sessions = new Map<string, RealmPrincipal>(), arrivals = new Map<string, readonly [number, number, number]>();
  let counter = 0, open = false;
  return {
    issue(name, at) {
      const ticket = randomUUID(), principal: RealmPrincipal = { personId: PersonIdSchema.parse(String(980_000_000 + ++counter)), kingdomId,
        sessionId: randomUUID(), expiresAt: Date.now() + 60 * 60 * 1000, origin: 'simulated', publicName: name, look: 'reference' };
      tickets.set(ticket, principal); sessions.set(principal.sessionId, principal); arrivals.set(principal.sessionId, [at[0], 0, at[1]]);
      return RealmJoinSchema.parse({ ticket, kingdomId, protocol: 1 });
    },
    auth: {
      async authenticate(join) {
        const principal = tickets.get(join.ticket);
        if (!principal || join.kingdomId !== kingdomId) throw new ServerError(403, 'SIMULATED field entry expired');
        tickets.delete(join.ticket);
        return principal;
      },
      async current(principal, now) { const stored = sessions.get(principal.sessionId); return !!stored && stored.personId === principal.personId && stored.expiresAt > now; },
    },
    async open(id) {
      if (id !== kingdomId || open) throw new ServerError(409, 'The kingdom writer is already held');
      open = true;
      const writerEpoch = randomUUID(), rooms = new Set<RealmRoomEffects>();
      return { kingdomId, origin: 'simulated', writerEpoch, layoutRevision: 'district-field-v1', world: DISTRICT_FIELD, sequence: 0,
        spawn: principal => arrivals.get(principal.sessionId) ?? [0, 0, 0],
        intent: async (_context, intent) => ({ version: 1, id: intent.id, status: 'unavailable', message: 'The SIMULATED field only hosts walking.' }),
        bootstrap: () => ({ version: 1, kingdomId, writerEpoch, throughSequence: 0, throughCursor: 0, layoutRevision: 'district-field-v1', collisionRevision: 1, current: [] }),
        recoverWalker: (walkerId, revision) => [...rooms].some(effects => effects.placeWalker(walkerId, [0, 0, 0], revision)),
        bindRoom: effects => { rooms.add(effects); return () => { rooms.delete(effects); }; }, lifecycle: () => {},
        subscribe: () => () => {}, bindTransient: () => () => {}, dispose: async () => { open = false; },
      };
    },
  };
}

type Role = 'stayer' | 'neighbour' | 'crosser' | 'behind' | 'arrival' | 'ahead';
const S = REALM_DISTRICT_GRID.cellMetres;
/**
 * Six walkers along one row of districts. The crosser starts 4 m inside district 0:0 and walks east into 1:0.
 * `behind` (-1:0) is only in its old interest, `ahead` (2:0) only in its new one; stayer and neighbour share 0:0.
 */
const CAST: readonly { role: Role; at: readonly [number, number] }[] = [
  { role: 'stayer', at: [.2 * S, .2 * S] }, { role: 'neighbour', at: [.3 * S, .6 * S] }, { role: 'crosser', at: [S - 4, .2 * S] },
  { role: 'behind', at: [-.6 * S, .2 * S] }, { role: 'arrival', at: [1.3 * S, .4 * S] }, { role: 'ahead', at: [2.3 * S, .2 * S] },
];

interface Decoder { readonly role: Role; readonly room: Room<KingdomRoomState>; readonly added: string[]; readonly removed: string[]; keys: Set<string> }
interface ServerRoom {
  readonly clients: { getById(id: string): { view?: StateView; raw: (data: Uint8Array, ...rest: unknown[]) => unknown } | undefined } & Iterable<{ sessionId: string; raw: (data: Uint8Array, ...rest: unknown[]) => unknown }>;
  readonly state: KingdomRoomState;
  readonly districts: RealmDistricts<DistrictEntity>;
  broadcastPatch(): boolean;
}

/** Encoded bodies and socket frames for one window, kept apart: a shared body does not make a socket free. */
export interface DistrictCosts {
  readonly patches: number;
  /** Schema bodies the encoder produced (one per distinct view object per patch). */
  readonly bodies: number; readonly bodyBytes: number; readonly bodiesPerPatchMax: number;
  /** Frames written to sockets: every predicted socket gets its own TIMED copy of its view's body, or a heartbeat. */
  readonly frames: number; readonly frameBytes: number; readonly framesPerPatchMax: number;
  /** The 8-byte TIMED prefix (server clock + input ack) each socket frame carries, and the 9-byte quiet-tick heartbeats. */
  readonly timedPrefixBytes: number; readonly heartbeats: number;
  /** Full-state frames (join, reconnect or district handoff), by role. */
  readonly fullStates: Partial<Record<Role, { readonly frames: number; readonly bytes: number }>>;
}

export interface DistrictCrossingReport {
  readonly origin: 'SIMULATED';
  readonly grid: typeof REALM_DISTRICT_GRID;
  readonly sockets: number;
  readonly crossing: { readonly from: string; readonly to: string; readonly walkedMetres: number; readonly ms: number };
  readonly views: { readonly before: number; readonly after: number; readonly widestView: number };
  readonly identity: { readonly stayerRetained: boolean; readonly stayerShared: boolean; readonly behindRetained: boolean; readonly arrivalShared: boolean; readonly crosserLeftOld: boolean };
  /** Every decoder's additions and removals after everyone joined, by role. */
  readonly decoders: Record<Role, { readonly added: Role[]; readonly removed: Role[]; readonly holds: Role[] }>;
  readonly costs: { readonly crossing: DistrictCosts; readonly steady: DistrictCosts };
  /** Broken expectations; empty when districts filter, hand off and share as spec 34 R10 requires. */
  readonly violations: string[];
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(what: string, test: () => boolean, ms = 8_000) {
  if (!await within(test, ms)) throw new Error(`Timed out waiting for ${what}`);
}
/** Waits for `test`; false when it never held, so the checks below can say which decoder is wrong. */
async function within(test: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (!test()) { if (Date.now() > end) return false; await pause(20); }
  return true;
}

/** Counts encoder bodies (all rooms in this process) and the given room's socket frames until `stop()`. */
function probe(room: ServerRoom, roleOf: (sessionId: string) => Role | undefined) {
  const encodeView = Encoder.prototype.encodeView, broadcast = room.broadcastPatch;
  const code = (byte: number) => byte & ~(ProtocolModifier.TIMED | ProtocolModifier.UNRELIABLE);
  let patches = 0, bodies = 0, bodyBytes = 0, frames = 0, frameBytes = 0, timedPrefixBytes = 0, heartbeats = 0, bodiesPerPatchMax = 0, framesPerPatchMax = 0, patchBodies = 0, patchFrames = 0;
  const fullStates: Partial<Record<Role, { frames: number; bytes: number }>> = {};
  Encoder.prototype.encodeView = function (this: Encoder, ...args: Parameters<Encoder['encodeView']>) {
    const body = encodeView.apply(this, args); bodies++; patchBodies++; bodyBytes += body.byteLength; return body;
  };
  room.broadcastPatch = function (this: ServerRoom) {
    patchBodies = 0; patchFrames = 0;
    const changed = broadcast.call(this);
    patches++; bodiesPerPatchMax = Math.max(bodiesPerPatchMax, patchBodies); framesPerPatchMax = Math.max(framesPerPatchMax, patchFrames);
    return changed;
  };
  const restores: (() => void)[] = [];
  for (const client of room.clients) {
    const raw = client.raw, role = roleOf(client.sessionId);
    client.raw = (data: Uint8Array, ...rest: unknown[]) => {
      const kind = code(data[0]!), timed = (data[0]! & ProtocolModifier.TIMED) !== 0;
      if (kind === Protocol.ROOM_STATE_PATCH) {
        frames++; patchFrames++; frameBytes += data.byteLength;
        if (timed) timedPrefixBytes += 8;
        if (timed && data.byteLength === 9) heartbeats++;
      } else if (kind === Protocol.ROOM_STATE && role) {
        const seen = fullStates[role] ??= { frames: 0, bytes: 0 };
        seen.frames++; seen.bytes += data.byteLength;
      }
      return raw.call(client, data, ...rest);
    };
    restores.push(() => { client.raw = raw; });
  }
  return {
    stop(): DistrictCosts {
      Encoder.prototype.encodeView = encodeView; room.broadcastPatch = broadcast;
      for (const restore of restores) restore();
      return { patches, bodies, bodyBytes, bodiesPerPatchMax, frames, frameBytes, framesPerPatchMax, timedPrefixBytes, heartbeats, fullStates };
    },
  };
}

/** One walker sends reliable inputs at the walking rate, like the browser, until `done()` or the deadline. */
async function walk(room: Room<KingdomRoomState>, move: { moveX: number; moveZ: number }, done: () => boolean, ms: number) {
  const input = room.input<WalkInput>({ mode: 'reliable' }), end = Date.now() + ms;
  while (!done() && Date.now() < end) {
    Object.assign(input.data, { moveX: move.moveX, moveZ: move.moveZ, buttons: 0, yaw: 0, collisionRevision: DISTRICT_FIELD.revision });
    input.send();
    await pause(1000 / 30);
  }
}

export async function runDistrictCrossing(input: { readonly port: number; readonly kingdomId?: string }): Promise<DistrictCrossingReport> {
  const kingdomId = KingdomIdSchema.parse(input.kingdomId ?? '999000710');
  const services = fieldServices(kingdomId), { server } = createRealmServer(services);
  await server.listen(input.port, '127.0.0.1');
  const sdk = new Client(`http://127.0.0.1:${input.port}`), decoders: Decoder[] = [];
  try {
    for (const { role, at } of CAST) {
      const room = await sdk.joinOrCreate<KingdomRoomState>('kingdom', services.issue(`SIMULATED ${role}`, at), KingdomRoomState);
      const decoder: Decoder = { role, room, added: [], removed: [], keys: new Set() };
      room.onStateChange(state => {
        const now = new Set(state.walkers.keys());
        for (const key of now) if (!decoder.keys.has(key)) decoder.added.push(key);
        for (const key of decoder.keys) if (!now.has(key)) decoder.removed.push(key);
        decoder.keys = now;
      });
      decoders.push(decoder);
    }
    const server$ = matchMaker.getLocalRoomById(kingdomRoomId(kingdomId)) as unknown as ServerRoom | undefined;
    if (!server$) throw new Error('The kingdom room is not hosted in this process');
    const by = (role: Role) => decoders.find(d => d.role === role)!, id = (role: Role) => by(role).room.sessionId;
    const roleOf = (sessionId: string) => decoders.find(d => d.room.sessionId === sessionId)?.role;
    const districts = server$.districts, viewOf = (role: Role) => server$.clients.getById(id(role))?.view;
    const holds = (decoder: Decoder) => new Set(districts.visibleTo(decoder.room.sessionId));
    const settled = () => decoders.every(d => { const want = holds(d); return want.size === d.keys.size && [...want].every(key => d.keys.has(key)); });
    await until('every decoder to hold its district interest', settled);
    // Joins are history; from here on each decoder records only what the crossing changes.
    for (const d of decoders) { d.added.length = 0; d.removed.length = 0; }

    const before = { stayer: viewOf('stayer'), behind: viewOf('behind'), crosser: viewOf('crosser'), views: districts.stats().views };
    const from = districts.districtOf(id('crosser'))!, startX = server$.state.walkers.get(id('crosser'))!.x;
    const crossingCosts = probe(server$, roleOf), started = Date.now();
    await walk(by('crosser').room, { moveX: 127, moveZ: 0 }, () => districts.districtOf(id('crosser')) !== from, 8_000);
    const ms = Date.now() - started, to = districts.districtOf(id('crosser'))!;
    // A decoder left stale by the handoff never settles; the per-decoder checks below name it.
    await within(settled, 3_000);
    await pause(3 * 200);
    const crossing = crossingCosts.stop();

    // Steady window: everyone walks south inside their own district; bodies and socket frames are counted apart.
    const steadyCosts = probe(server$, roleOf);
    await Promise.all(decoders.map(d => walk(d.room, { moveX: 0, moveZ: 127 }, () => false, 1_000)));
    await pause(3 * 200);
    const steady = steadyCosts.stop();

    const violations: string[] = [];
    const roles = (keys: Iterable<string>) => [...keys].map(key => roleOf(key) ?? 'unknown' as Role).sort();
    const expect = (ok: boolean, message: string) => { if (!ok) violations.push(message); };
    const report = (d: Decoder) => ({ added: roles(d.added), removed: roles(d.removed), holds: roles(d.keys) });
    const result = Object.fromEntries(decoders.map(d => [d.role, report(d)])) as DistrictCrossingReport['decoders'];

    expect(from === '0:0' && to === '1:0', `crosser should walk 0:0 → 1:0, walked ${from} → ${to}`);
    expect(result.crosser.removed.join() === 'behind', `crossing decoder should drop only behind, dropped [${result.crosser.removed}]`);
    expect(result.crosser.added.join() === 'ahead', `crossing decoder should gain only ahead, gained [${result.crosser.added}]`);
    expect(result.stayer.removed.length === 0 && result.neighbour.removed.length === 0, 'walkers left behind in 0:0 lost an entity');
    expect(result.stayer.holds.includes('behind') && result.neighbour.holds.includes('behind'), 'the left-behind decoders no longer hold behind');
    expect(result.behind.removed.join() === 'crosser', `behind (-1:0) should see only the crosser leave its interest, saw [${result.behind.removed}]`);
    expect(result.ahead.added.join() === 'crosser', `ahead (2:0) should see only the crosser arrive, saw [${result.ahead.added}]`);
    expect(result.arrival.added.length === 0 && result.arrival.removed.length === 0, 'the arrival district decoder changed although nobody entered or left its interest');
    // Arriving state is complete: every decoder holds exactly its interest, with the server's field values.
    for (const d of decoders) {
      const want = holds(d);
      expect(want.size === d.keys.size && [...want].every(key => d.keys.has(key)), `${d.role} decoder does not hold exactly its district interest`);
      for (const key of d.keys) {
        const mine = d.room.state.walkers.get(key), truth = server$.state.walkers.get(key);
        expect(!!mine && !!truth && mine.name === truth.name && mine.look === truth.look && mine.district === truth.district
          && Math.abs(mine.x - truth.x) < 1e-9 && Math.abs(mine.z - truth.z) < 1e-9 && mine.distance === truth.distance,
        `${d.role} decoder holds a stale ${roleOf(key)}`);
      }
    }
    const identity = {
      stayerRetained: viewOf('stayer') === before.stayer, stayerShared: viewOf('stayer') === viewOf('neighbour'),
      behindRetained: viewOf('behind') === before.behind, arrivalShared: viewOf('crosser') === viewOf('arrival'), crosserLeftOld: viewOf('crosser') !== before.crosser,
    };
    for (const [name, ok] of Object.entries(identity)) expect(ok, `view identity: ${name} failed`);
    expect(Object.keys(crossing.fullStates).join() === 'crosser' && crossing.fullStates.crosser?.frames === 1,
      `only the crossing socket should be rebaselined once, got ${JSON.stringify(crossing.fullStates)}`);
    const stats = districts.stats();
    expect(before.views === 4 && stats.views === 4, `four districts are occupied before and after, views ${before.views} → ${stats.views}`);
    expect(steady.bodiesPerPatchMax <= stats.views, `a patch encoded ${steady.bodiesPerPatchMax} bodies for ${stats.views} shared views`);
    expect(steady.framesPerPatchMax === decoders.length, `every socket should get its own timed frame per patch, saw ${steady.framesPerPatchMax}`);

    return { origin: 'SIMULATED', grid: REALM_DISTRICT_GRID, sockets: decoders.length,
      crossing: { from, to, walkedMetres: Number((server$.state.walkers.get(id('crosser'))!.x - startX).toFixed(3)), ms },
      views: { before: before.views, after: stats.views, widestView: stats.widestView }, identity, decoders: result,
      costs: { crossing, steady }, violations };
  } finally {
    await Promise.all(decoders.map(d => d.room.leave().catch(() => {})));
    await server.gracefullyShutdown(false);
  }
}
