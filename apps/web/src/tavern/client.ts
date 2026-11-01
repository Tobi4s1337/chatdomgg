import { Predict } from '@colyseus/sdk/predict';
import type { Room } from '@colyseus/sdk';
import { GatherFrameSchema, GatherInteriorSchema, GatherSelfSchema, TavernRoomState,
  type GatherFrame, type GatherInterior, type GatherSelf, type PongView, type GatherMove } from '@chatdom/shared';
import { PLAYER_FIELDS, RealmJoinSchema, sanitizeRealmWalkInput,
  type CollisionWorld, type PlayerState, type RealmWalkInput, type WalkInput } from '@chatdom/shared/realm';
import { stepPlayer } from '@chatdom/world/movement';
import { createRealmNetwork } from '../realm/transport';
import type { RealmEntry, RealmWalkerPose } from '../realm/client';
import type { WalkRealm } from '../walk';
import { PongPresentation } from '../games/pong';

export interface TavernClient extends WalkRealm {
  readonly room: Room<InstanceType<typeof TavernRoomState>>;
  readonly interior: GatherInterior;
  readonly world: CollisionWorld;
  readonly self: GatherSelf;
  readonly tables: GatherFrame;
  readonly connected: boolean;
  readonly predicted: Readonly<PlayerState>;
  readonly presentations: ReadonlyMap<string, PongPresentation>;
  subscribe(listener: () => void): () => void;
  start(table: string): void;
  aim(value: number, now: number): void;
  move(action: 'drop' | 'roll' | 'hold', column?: number): void;
  serverNow(): number;
  gameFrame(now: number): GatherFrame;
  dispose(): void;
}

/** Same entry session as walking, fresh destination ticket, and a distinct reconnect partition. */
export async function connectTavern(endpoint: string, entry: RealmEntry, storage?: Storage): Promise<TavernClient> {
  if (entry.resumeScope.length < 16 || entry.resumeScope.length > 128) throw new Error('The tavern entry session is unavailable.');
  const network = createRealmNetwork(endpoint), key = `chatdom:tavern:v1:${JSON.stringify([endpoint, entry.kingdomId, entry.resumeScope])}`;
  const fresh = async () => {
    const join = RealmJoinSchema.parse(await entry.ticket());
    if (join.kingdomId !== entry.kingdomId) throw new Error('The entry belongs to another kingdom.');
    return network.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', join, TavernRoomState);
  };
  const saved = storage?.getItem(key);
  let room: Room<InstanceType<typeof TavernRoomState>>;
  try { room = saved ? await network.reconnect<InstanceType<typeof TavernRoomState>>(saved, TavernRoomState) : await fresh(); }
  catch (error) { if (!saved) throw error; storage?.removeItem(key); room = await fresh(); }
  if (room.roomId !== `t:${entry.kingdomId}`) { void room.leave(); throw new Error('The door opened into another tavern.'); }
  const listeners = new Set<() => void>(), offs: (() => void)[] = [];
  let disposed = false, connected = true, interior: GatherInterior | null = null;
  let tables: GatherFrame = { at: 0, tables: [] }, self: GatherSelf = { table: null, seat: null }, frameReceivedAt = performance.now();
  const presentations = new Map<string, PongPresentation>();
  const notify = () => { for (const listener of listeners) listener(); };
  const receive = (frame: GatherFrame) => {
    tables = frame;
    frameReceivedAt = performance.now();
    for (const table of frame.tables) {
      if (!table.pong) { presentations.delete(table.table); continue; }
      let presentation = presentations.get(table.table);
      if (!presentation) presentations.set(table.table, presentation = new PongPresentation());
      presentation.setSeat(self.table === table.table ? self.seat : null);
      presentation.receive(table.pong, performance.now());
    }
    notify();
  };
  let failure: (() => void) | undefined;
  const protocolFailure = () => { connected = false; failure?.(); notify(); void room.leave(); };
  offs.push(room.onMessage('interior', raw => {
    const parsed = GatherInteriorSchema.safeParse(raw);
    if (!parsed.success) { protocolFailure(); return; }
    interior = parsed.data;
  }), room.onMessage('tables', raw => {
    const parsed = GatherFrameSchema.safeParse(raw);
    if (parsed.success) receive(parsed.data); else protocolFailure();
  }), room.onMessage('self', raw => {
    const parsed = GatherSelfSchema.safeParse(raw);
    if (parsed.success) {
      self = parsed.data;
      for (const [table, presentation] of presentations) presentation.setSeat(self.table === table ? self.seat : null);
      notify();
    } else protocolFailure();
  }), room.onMessage('receipt', () => {}));
  // These are consumed by the interaction binding after scene admission; bootstrap repeats them when it mounts.
  const earlyPrivate = room.onMessage('private', () => {}), earlyTransient = room.onMessage('transient', () => {});
  offs.push(earlyPrivate, earlyTransient);
  room.send('bootstrap');
  try {
    await new Promise<void>((resolve, reject) => {
      const stop = () => { clearTimeout(timer); room.onStateChange.remove(check); off(); failure = undefined; };
      const check = () => {
        if (interior && tables.tables.length && room.state.walkers.get(room.sessionId)) { stop(); resolve(); }
      };
      const off = (() => { listeners.add(check); return () => listeners.delete(check); })();
      failure = () => { stop(); reject(new Error('The tavern sent an unavailable room.')); };
      const timer = setTimeout(() => { stop(); reject(new Error('The tavern could not place your walker.')); }, 15_000);
      room.onStateChange(check); check();
    });
  } catch (error) { offs.forEach(off => off()); void room.leave(); throw error; }
  const installed = interior!;
  if (room.state.kingdomId !== entry.kingdomId || room.state.collisionRevision !== installed.revision) {
    offs.forEach(off => off()); void room.leave(); throw new Error('The tavern floor is unavailable.');
  }
  const world: CollisionWorld = { revision: installed.revision,
    query: bounds => installed.boxes.filter(box => box.min.every((n, axis) => n <= bounds.max[axis]!) && box.max.every((n, axis) => n >= bounds.min[axis]!)) };
  const predict = Predict.get(room, { name: 'tavern-walkers', mode: 'lerp', delay: 120 });
  predict.attachAll('walkers', { mode: 'lerp', fields: ['x', 'y', 'z', 'distance'], snap: 4 });
  const input = room.input<RealmWalkInput>({ mode: 'reliable' }), walker = room.state.walkers.get(room.sessionId)!;
  const reconciler = predict.reconciler(walker, { input, fields: [...PLAYER_FIELDS], smoothMs: 80,
    step: (ctx, state, command) => {
      if (command.placement === walker.placement && command.collisionRevision === world.revision) stepPlayer(state, command, ctx.dt, world);
    } });
  const predicted = reconciler.state as Readonly<PlayerState>;
  let placement = walker.placement, jumpDown = false, jump = false, lastSend = -Infinity, sequence = -1, match: string | null = null;
  const peerPlacements = new WeakMap([...room.state.walkers.values()].map(peer => [peer, peer.placement]));
  const clearInput = () => { jumpDown = false; jump = false; };
  const remember = () => { if (!disposed) storage?.setItem(key, room.reconnectionToken); };
  const dropped = () => { connected = false; clearInput(); notify(); };
  const rejoined = () => { connected = true; remember(); clearInput(); room.send('bootstrap'); notify(); };
  room.onDrop(dropped); room.onLeave(dropped); room.onReconnect(rejoined); remember();
  let request = 0;
  return {
    selfId: room.sessionId, room, interior: installed, world, predicted, presentations,
    get connected() { return !disposed && connected; }, get self() { return self; }, get tables() { return tables; },
    clearInput,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    tick(now, sample: WalkInput): readonly RealmWalkerPose[] {
      if (disposed || !connected || room.state.collisionRevision !== world.revision) return [];
      if (placement !== walker.placement) { placement = walker.placement; reconciler.reset(); clearInput(); }
      for (const peer of room.state.walkers.values()) if (peer !== walker && peerPlacements.get(peer) !== peer.placement) {
        predict.attach(peer, { mode: 'lerp', fields: ['x', 'y', 'z', 'distance'], snap: 4 }); peerPlacements.set(peer, peer.placement);
      }
      const down = (sample.buttons & 2) !== 0; if (down && !jumpDown) jump = true; jumpDown = down;
      const steps = predict.tick(now);
      for (let n = 0; n < steps; n++) {
        Object.assign(input.data, sample, { buttons: (sample.buttons & 1) | (jump ? 2 : 0), collisionRevision: world.revision, placement });
        sanitizeRealmWalkInput(input.data); input.send(); jump = false;
      }
      return [...room.state.walkers].map(([id, peer]) => ({ id, name: peer.name, look: peer.look, homeSlot: peer.homeSlot,
        x: predict.value(peer, 'x'), y: predict.value(peer, 'y'), z: predict.value(peer, 'z'),
        yaw: id === room.sessionId ? predicted.yaw : peer.yaw, distance: predict.value(peer, 'distance'),
        speed: Math.hypot(predict.value(peer, 'vx'), predict.value(peer, 'vz')), self: id === room.sessionId }));
    },
    start(table) {
      const state = tables.tables.find(t => t.table === table);
      if (connected && state && self.table === table) room.send('start', { table, revision: state.revision, id: `start-${++request}-${Math.round(performance.now())}` });
    },
    aim(value, now) {
      const presentation = self.table ? presentations.get(self.table) : undefined, phase = presentation?.latest?.phase;
      if (phase === 'serve' || phase === 'rally') presentation?.aim(value, now);
    },
    move(action, column) {
      const table = tables.tables.find(t => t.table === self.table), game = table?.stones ?? table?.dice;
      if (!connected || !table || !game || game.phase !== 'playing' || table.status === 'saving') return;
      const common = { id: crypto.randomUUID(), table: table.table, match: game.match, revision: game.revision };
      const command: GatherMove = action === 'drop' ? { ...common, action, column: column ?? -1 } : { ...common, action };
      room.send('move', command);
    },
    serverNow() { return tables.at + performance.now() - frameReceivedAt; },
    gameFrame(now) {
      const own = self.table ? tables.tables.find(t => t.table === self.table)?.pong : undefined;
      const presentation = self.table ? presentations.get(self.table) : undefined;
      if (connected && own && presentation && self.seat !== null && (own.phase === 'rally' || own.phase === 'serve') && now - lastSend >= 1000 / 30) {
        if (match !== own.match) { match = own.match; sequence = -1; }
        sequence = Math.max(sequence, own.acknowledged[self.seat]) + 1; lastSend = now;
        room.send('paddle', { match, sequence, paddle: presentation.aimPosition });
      }
      return { at: tables.at, tables: tables.tables.map(table => ({ ...table, pong: presentations.get(table.table)?.sample(now) ?? table.pong as PongView | null })) };
    },
    dispose() {
      if (disposed) return; disposed = true; connected = false;
      offs.forEach(off => off()); room.onDrop.remove(dropped); room.onLeave.remove(dropped); room.onReconnect.remove(rejoined);
      listeners.clear(); reconciler.dispose(); predict.dispose(); storage?.removeItem(key); void room.leave();
    },
  };
}
