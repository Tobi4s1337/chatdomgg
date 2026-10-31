import { KingdomIdSchema, PersonIdSchema, type PersonId, type Vec3 } from '@chatdom/shared';
import type { PlayerState, RealmInteractionAction, RealmPrincipal, RealmPrivateMessage, RealmReceipt, RealmTransientMessage } from '@chatdom/shared/realm';
import { createInteractionAuthority, type InteractionAuthority } from '../../../../realm/src/interactions';
import { bodyClear, createInteractionRegistry, supported, type InteractionRegistry } from '../../../../../packages/world/src/interactions';
import type { InteractionInbound } from '../ports';
import { COURT_PLACEMENT, benchWorld } from './court';

/**
 * The bench's SIMULATED room: in-page walkers, a room clock, a fixed network delay and two simulated people,
 * around the real `createInteractionAuthority`. Every answer the prompt shows is that authority's answer.
 */
export interface BenchPerson {
  readonly personId: PersonId; readonly principal: RealmPrincipal; readonly walkerId: string; readonly name: string;
  readonly body: PlayerState;
  send(targetId: string, action: RealmInteractionAction, id: string, delayMs: number): void;
}
export interface BenchRoom {
  readonly authority: InteractionAuthority;
  readonly registry: InteractionRegistry;
  readonly world: ReturnType<typeof benchWorld>;
  readonly writerEpoch: string;
  readonly people: readonly BenchPerson[];
  readonly you: BenchPerson;
  readonly wren: BenchPerson;
  /** Inbound for the local session, after the simulated delay. */
  listen(inbound: (message: InteractionInbound) => void): void;
  /** Try to walk the local body; the bench refuses steps into solids or off support (it is not the movement engine). */
  move(person: BenchPerson, to: Vec3): boolean;
  walking(person: BenchPerson): boolean;
  dispose(): void;
}

const KINGDOM = KingdomIdSchema.parse('7100');
export function createBenchRoom(options: { readonly latencyMs: number; readonly you: Vec3; readonly wren: Vec3 }): BenchRoom {
  const writerEpoch = 'bench-simulated-1';
  const world = benchWorld(1);
  const registry = createInteractionRegistry({ layoutRevision: 'bench-court-1', world, placements: [COURT_PLACEMENT] });
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, run: () => void) => { const timer = setTimeout(() => { timers.delete(timer); run(); }, ms); timers.add(timer); };
  const clock = () => performance.now();
  const authority = createInteractionAuthority({
    writerEpoch, clock, reconnectGraceMs: 20_000, world: () => world, registry: () => registry,
    rights: { current: async () => true, permitted: () => true },
    homes: { ownedPlotId: () => null },
  });
  const walkers = new Map<string, PlayerState>();
  const allowed = new Map<string, boolean>();
  authority.bindRoom({
    readWalker: id => walkers.get(id) ?? null,
    placeWalker: (id, position, revision) => {
      const body = walkers.get(id);
      if (!body || revision !== world.revision) return false;
      [body.x, body.y, body.z] = position; body.vx = body.vy = body.vz = 0; return true;
    },
    allowWalking: (id, value) => { allowed.set(id, value); },
  });
  let inbound: ((message: InteractionInbound) => void) | null = null;
  const half = () => options.latencyMs / 2;
  const people: BenchPerson[] = [];
  const toYou = (message: InteractionInbound) => later(half(), () => inbound?.(message));
  authority.bindDelivery({
    transient: (message: RealmTransientMessage) => { if (message.type === 'seats') toYou(message); },
    owner: (personId, message: RealmPrivateMessage) => { if (personId === people[0]?.personId && message.type === 'interaction') toYou(message); },
  });

  function person(twitch: string, name: string, at: Vec3, index: number): BenchPerson {
    const personId = PersonIdSchema.parse(twitch);
    const principal: RealmPrincipal = { personId, kingdomId: KINGDOM, sessionId: `bench-session-${index}`, expiresAt: Number.MAX_SAFE_INTEGER, origin: 'simulated', publicName: name, look: 'default' };
    const walkerId = `bench-walker-${index}`;
    const body: PlayerState = { x: at[0], y: at[1], z: at[2], vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: world.revision };
    walkers.set(walkerId, body);
    const entry: BenchPerson = {
      personId, principal, walkerId, name, body,
      send(targetId, action, id, delayMs) {
        later(delayMs, () => {
          void authority.intent({ principal, walkerId, position: [body.x, body.y, body.z], collisionRevision: body.collisionRevision, current: () => walkers.get(walkerId) ?? null },
            { version: 1, type: 'interact', id, targetId, action }).then((receipt: RealmReceipt) => { if (entry === people[0]) toYou({ type: 'receipt', receipt }); });
        });
      },
    };
    people.push(entry);
    authority.lifecycle('join', principal, walkerId, clock());
    return entry;
  }
  // Join order matters only for the bench's labels; delivery for the local session starts once `listen` is bound.
  const you = person('7101', 'You', options.you, 1);
  const wren = person('7102', 'Wren', options.wren, 2);
  return {
    authority, registry, world, writerEpoch, people, you, wren,
    listen(next) { inbound = next; next(authority.seats()); next({ type: 'interaction', requestId: null, writerEpoch, state: authority.selfState(you.principal.sessionId) }); },
    move(entry, to) {
      if (allowed.get(entry.walkerId) === false || !bodyClear(world, to) || !supported(world, to)) return false;
      entry.body.distance += Math.hypot(to[0] - entry.body.x, to[2] - entry.body.z);
      [entry.body.x, entry.body.y, entry.body.z] = to; return true;
    },
    walking: entry => allowed.get(entry.walkerId) !== false,
    dispose() { for (const timer of timers) clearTimeout(timer); timers.clear(); authority.dispose(); inbound = null; },
  };
}
