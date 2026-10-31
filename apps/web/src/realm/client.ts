import { type Room } from '@colyseus/sdk';
import { Predict } from '@colyseus/sdk/predict';
import { KingdomRoomState, PLAYER_FIELDS, RealmJoinSchema, kingdomRoomId, sanitizeRealmWalkInput, type RealmJoin, type RealmWalkInput, type WalkInput } from '@chatdom/shared/realm';
import { stepPlayer } from '@chatdom/world/movement';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import type { CollisionWorld, PlayerState } from '@chatdom/shared/realm';
import { createRealmNetwork } from './transport';

export interface RealmWalkerPose { readonly id: string; readonly name: string; readonly look: string; readonly homeSlot: number; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly distance: number; readonly speed: number; readonly self: boolean }
export interface RealmEntry {
  readonly kingdomId: RealmJoin['kingdomId'];
  /** API session's opaque, stable browser partition. A different account/session uses a different scope. */
  readonly resumeScope: string;
  /** Called only for fresh entry, including after an expired reconnect. Never reuse a consumed ticket. */
  ticket(): Promise<RealmJoin>;
}
/**
 * The immutable collision revisions prediction may use. Realm wiring supplies the kingdom's producer; a single
 * `CollisionWorld` is a source that knows only its own revision.
 */
export interface RealmCollision {
  /**
   * Exactly this revision's immutable world, or null while it is not here yet (start fetching it then). Asked again
   * on later frames until it answers. Another revision's world is never used in its place.
   */
  world(revision: number): CollisionWorld | null;
}
export interface RealmClient {
  readonly selfId: string; readonly room: Room<KingdomRoomState>;
  /**
   * Call once per animation frame, before any render reads: it reconciles, stages exactly the fixed inputs
   * Predict says are due, then returns the render poses. Jump is a rising edge, latched until a send.
   * The client stamps each input with the room's current collision revision.
   */
  tick(now: number, input: WalkInput): readonly RealmWalkerPose[];
  /** The local walker's exact predicted state, every `PLAYER_FIELDS` field, unsmoothed. For logic, not drawing. */
  readonly predicted: Readonly<PlayerState>;
  /**
   * False while the room's current collision revision is not available here: the walker then holds its
   * prediction and is drawn where the room puts it, and never walks through solids it cannot see.
   */
  readonly predicting: boolean;
  /** Discard a jump sampled before blur, a menu or another input owner took over. */
  clearInput(): void;
  dispose(): void;
}
export async function connectRealm(endpoint: string, entry: RealmEntry, collision: CollisionWorld | RealmCollision, storage?: Storage): Promise<RealmClient> {
  const network = createRealmNetwork(endpoint);
  const expectedRoom = kingdomRoomId(entry.kingdomId);
  if (entry.resumeScope.length < 16 || entry.resumeScope.length > 128) throw new Error('The kingdom entry session is unavailable');
  const key = `chatdom:realm:v1:${JSON.stringify([endpoint, entry.kingdomId, entry.resumeScope])}`;
  const fresh = async () => {
    const join = RealmJoinSchema.parse(await entry.ticket());
    if (join.kingdomId !== entry.kingdomId) throw new Error('The ticket belongs to another kingdom');
    return network.joinOrCreate<KingdomRoomState>('kingdom', join, KingdomRoomState);
  };
  let room: Room<KingdomRoomState>;
  const saved = storage?.getItem(key);
  try {
    room = saved ? await network.reconnect<KingdomRoomState>(saved, KingdomRoomState) : await fresh();
  } catch (error) {
    if (!saved) throw error;
    storage?.removeItem(key);
    room = await fresh();
  }
  if (room.roomId !== expectedRoom) { storage?.removeItem(key); void room.leave(); throw new Error('The gate opened into the wrong kingdom'); }
  let disposed = false;
  const remember = () => { if (!disposed) storage?.setItem(key, room.reconnectionToken); };
  remember();
  room.onReconnect(() => queueMicrotask(remember));
  try {
  if (!room.state.walkers.get(room.sessionId)) await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (room.state.walkers.get(room.sessionId)) { clearTimeout(timeout); room.onStateChange.remove(check); resolve(); }
    };
    const timeout = setTimeout(() => { room.onStateChange.remove(check); reject(new Error('The kingdom did not place your citizen')); }, 15_000);
    room.onStateChange(check);
  });
  // A single fixed world can never become the room's revision later; a revision source may still deliver it.
  if ('query' in collision && room.state.collisionRevision !== collision.revision) throw new Error('The kingdom terrain revision is unavailable');
  } catch (error) { disposed = true; storage?.removeItem(key); void room.leave(); throw error; }
  // Movement, prediction and collision revisions (walk-controller): one shared step, Colyseus Predict, no own queue.
  const source: RealmCollision = 'query' in collision ? { world: revision => revision === collision.revision ? collision : null } : collision;
  const worlds = new Map<number, CollisionWorld>();
  const worldAt = (revision: number) => {
    let world = worlds.get(revision);
    if (world) return world;
    const offered = source.world(revision);
    // A world that is not exactly this revision is unknown space, and unknown space is never air.
    if (!offered || offered.revision !== revision) return null;
    worlds.set(revision, world = offered);
    return world;
  };
  const predict = Predict.get(room, { name: 'walkers', mode: 'lerp', delay: 250 });
  predict.attachAll('walkers', { mode: 'lerp', fields: ['x', 'y', 'z', 'distance'], snap: 4 });
  const input = room.input<RealmWalkInput>({ mode: 'reliable' });
  const self = room.state.walkers.get(room.sessionId)!;
  const reconciler = predict.reconciler(self, {
    // SDK snap measures every numeric replay field, including byte yaw and velocity: a small positional
    // correction must never pop the whole render pose because a different unit exceeded a metre threshold.
    // Explicit placement/revision changes below reset SDK anchors; ordinary corrections retain interpolation.
    input, fields: [...PLAYER_FIELDS], smoothMs: 80,
    // The room steps an input only on the walker's own revision; prediction does the same and holds where its
    // world has not arrived, so a replay never runs an input against solids it was not simulated with.
    step: (ctx, state, command) => {
      const world = command.placement === self.placement && command.collisionRevision === state.collisionRevision ? worldAt(command.collisionRevision) : null;
      if (world) stepPlayer(state, command, ctx.dt, world);
    },
  });
  const predicted = reconciler.state as unknown as Readonly<PlayerState>;
  let revision = self.collisionRevision, placement = self.placement, jumpPending = false, jumpDown = false;
  const peerContexts = new WeakMap([...room.state.walkers.values()].map(p => [p, { placement: p.placement, revision: p.collisionRevision }]));
  // Fetch a newly published revision as soon as the room announces it.
  const offRevision = room.onMessage('revision', (message: { collisionRevision?: unknown }) => {
    if (typeof message?.collisionRevision === 'number') worldAt(message.collisionRevision);
  });
  const dropped = () => { jumpPending = false; jumpDown = false; };
  room.onDrop(dropped);
  return {
    selfId: room.sessionId, room, predicted,
    clearInput: dropped,
    get predicting() { return !disposed && predicted.collisionRevision === room.state.collisionRevision && worldAt(predicted.collisionRevision) !== null; },
    tick(now, sample) {
      if (disposed) return [];
      if (self.collisionRevision !== revision || self.placement !== placement) {
        // A server-directed placement is discontinuous even across a thin wall under the distance snap threshold.
        // Reset the SDK's replay/render anchors before ticking or sending; don't reset its reliable input sequence.
        revision = self.collisionRevision;
        placement = self.placement;
        reconciler.reset(); jumpPending = false;
        for (const known of worlds.keys()) if (known < revision) worlds.delete(known);
      }
      for (const [id, p] of room.state.walkers) {
        if (id === room.sessionId) continue;
        const prior = peerContexts.get(p);
        if (!prior || prior.placement !== p.placement || prior.revision !== p.collisionRevision) {
          if (prior) {
            // Reattaching the SDK track clears its old snapshot ring. Neighbours also snap across a relocation.
            predict.attach(p, { mode: 'lerp', fields: ['x', 'y', 'z', 'distance'], snap: 4 });
          }
          peerContexts.set(p, { placement: p.placement, revision: p.collisionRevision });
        }
      }
      worldAt(room.state.collisionRevision);
      const down = (sample.buttons & 2) !== 0;
      if (down && !jumpDown) jumpPending = true;
      jumpDown = down;
      const steps = predict.tick(now);
      for (let n = 0; n < steps; n++) {
        Object.assign(input.data, sample, { buttons: (sample.buttons & 1) | (jumpPending ? 2 : 0), collisionRevision: room.state.collisionRevision, placement: self.placement });
        sanitizeRealmWalkInput(input.data); input.send(); jumpPending = false;
      }
      return [...room.state.walkers].filter(([, p]) => p.collisionRevision === room.state.collisionRevision).map(([id, p]) => ({ id, name: p.name, look: p.look, homeSlot: p.homeSlot,
        x: predict.value(p, 'x'), y: predict.value(p, 'y'), z: predict.value(p, 'z'),
        // A yaw byte wraps at 256; smoothing it would spin the citizen the long way round.
        yaw: id === room.sessionId ? predicted.yaw : p.yaw,
        distance: predict.value(p, 'distance'), speed: Math.hypot(predict.value(p, 'vx'), predict.value(p, 'vz')), self: id === room.sessionId }));
    },
    dispose() { if (disposed) return; disposed = true; offRevision(); room.onDrop.remove(dropped); reconciler.dispose(); predict.dispose(); storage?.removeItem(key); void room.leave(); },
  };
}

/** Only the reference's opaque partition survives reload. Tickets are single-use and never persisted. */
export async function connectReferenceRealm(endpoint = `${location.protocol}//${location.hostname}:5191`): Promise<RealmClient> {
  const storageKey = `chatdom:reference-scope:${endpoint}`;
  let resumeScope = sessionStorage.getItem(storageKey);
  if (!resumeScope || resumeScope.length < 16 || resumeScope.length > 128) {
    resumeScope = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(storageKey, resumeScope);
  }
  return connectRealm(endpoint, { kingdomId: '999000001' as RealmJoin['kingdomId'], resumeScope, ticket: async () => {
    const response = await fetch(`${endpoint}/reference/session`, { method: 'POST' });
    if (!response.ok) throw new Error('The reference gate could not issue an entry');
    return RealmJoinSchema.parse(await response.json());
  } }, REFERENCE_WORLD, sessionStorage);
}
