import { Client, type Room } from '@colyseus/sdk';
import { Predict } from '@colyseus/sdk/predict';
import { KingdomRoomState, PLAYER_FIELDS, RealmJoinSchema, kingdomRoomId, sanitizeWalkInput, type RealmJoin, type WalkInput } from '@chatdom/shared/realm';
import { stepPlayer } from '@chatdom/world/movement';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import type { CollisionWorld } from '@chatdom/shared/realm';

export interface RealmWalkerPose { readonly id: string; readonly name: string; readonly look: string; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly distance: number; readonly speed: number; readonly self: boolean }
export interface RealmClient {
  readonly selfId: string; readonly room: Room<KingdomRoomState>;
  /** Call once per animation frame, before any render reads. Jump is a rising edge, latched until a send. */
  tick(now: number, input: WalkInput): readonly RealmWalkerPose[];
  dispose(): void;
}
export async function connectRealm(endpoint: string, join: RealmJoin, world: CollisionWorld, storage?: Storage): Promise<RealmClient> {
  const network = new Client(endpoint);
  const key = `chatdom:realm:${endpoint}:${join.kingdomId}:${join.ticket}`;
  let room: Room<KingdomRoomState>;
  const saved = storage?.getItem(key);
  try {
    room = saved ? await network.reconnect<KingdomRoomState>(saved, KingdomRoomState) : await network.joinOrCreate<KingdomRoomState>('kingdom', join, KingdomRoomState);
  } catch (error) {
    if (!saved) throw error;
    storage?.removeItem(key);
    room = await network.joinOrCreate<KingdomRoomState>('kingdom', join, KingdomRoomState);
  }
  if (room.roomId !== kingdomRoomId(join.kingdomId)) { void room.leave(); throw new Error('The gate opened into the wrong kingdom'); }
  const remember = () => storage?.setItem(key, room.reconnectionToken);
  remember();
  room.onReconnect(() => queueMicrotask(remember));
  if (!room.state.walkers.get(room.sessionId)) await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (room.state.walkers.get(room.sessionId)) { clearTimeout(timeout); room.onStateChange.remove(check); resolve(); }
    };
    const timeout = setTimeout(() => { room.onStateChange.remove(check); reject(new Error('The kingdom did not place your citizen')); }, 15_000);
    room.onStateChange(check);
  });
  if (room.state.collisionRevision !== world.revision) { void room.leave(); throw new Error('The kingdom terrain revision is unavailable'); }
  const predict = Predict.get(room, { name: 'walkers', mode: 'lerp', delay: 250 });
  predict.attachAll('walkers', { mode: 'lerp', fields: ['x', 'y', 'z', 'distance'], snap: 4 });
  const input = room.input<WalkInput>({ mode: 'reliable' });
  const self = room.state.walkers.get(room.sessionId)!;
  const reconciler = predict.reconciler(self, {
    input, fields: [...PLAYER_FIELDS], smoothMs: 80,
    step: (ctx, state, command) => stepPlayer(state, command, ctx.dt, world),
  });
  let jumpPending = false, jumpDown = false, disposed = false;
  return {
    selfId: room.sessionId, room,
    tick(now, sample) {
      if (disposed) return [];
      const down = (sample.buttons & 2) !== 0;
      if (down && !jumpDown) jumpPending = true;
      jumpDown = down;
      const steps = predict.tick(now);
      for (let n = 0; n < steps; n++) {
        Object.assign(input.data, sample, { buttons: (sample.buttons & 1) | (jumpPending ? 2 : 0) });
        sanitizeWalkInput(input.data); input.send(); jumpPending = false;
      }
      return [...room.state.walkers].map(([id, p]) => ({ id, name: p.name, look: p.look,
        x: predict.value(p, 'x'), y: predict.value(p, 'y'), z: predict.value(p, 'z'), yaw: predict.value(p, 'yaw'),
        distance: predict.value(p, 'distance'), speed: Math.hypot(predict.value(p, 'vx'), predict.value(p, 'vz')), self: id === room.sessionId }));
    },
    dispose() { disposed = true; reconciler.dispose(); predict.dispose(); storage?.removeItem(key); void room.leave(); },
  };
}

/** Reference credentials are scoped to the tab. Production entry consumes a verified API ticket instead. */
export async function connectReferenceRealm(endpoint = `${location.protocol}//${location.hostname}:5191`): Promise<RealmClient> {
  const storageKey = `chatdom:reference-entry:${endpoint}`;
  const saved = sessionStorage.getItem(storageKey);
  let join = saved ? RealmJoinSchema.safeParse(JSON.parse(saved)).data : undefined;
  if (!join) {
    const response = await fetch(`${endpoint}/reference/session`, { method: 'POST' });
    if (!response.ok) throw new Error('The reference gate could not issue an entry');
    join = RealmJoinSchema.parse(await response.json()); sessionStorage.setItem(storageKey, JSON.stringify(join));
  }
  return connectRealm(endpoint, join, REFERENCE_WORLD, sessionStorage);
}
