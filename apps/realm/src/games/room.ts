import { randomUUID } from 'node:crypto';
import { Room, ServerError, type Client } from '@colyseus/core';
import { KingdomIdSchema, GATHER_HZ, GatherPongInputSchema, GatherStartSchema, GatherMoveSchema, TavernRoomState } from '@chatdom/shared';
import { RealmJoinSchema, RealmIntentSchema, WalkInputSchema, WalkerSchema, sanitizeRealmWalkInput,
  type RealmPrincipal, type PlayerState } from '@chatdom/shared/realm';
import { stepPlayer, embeddedSolids, supported } from '@chatdom/world/movement';
import { RealmSeats, RealmSeatRefusedError, REALM_SESSION_CHECK_MS, REALM_RECONNECT_GRACE_MS } from '../auth/seats';
import { createInteractionAuthority, composeInteractionHosts, type InteractionAuthority } from '../interactions';
import type { RealmRoomServices } from '../ports';
import { GatherTables, TAVERN_TABLES } from './tables';
import { gatherStoreFor } from './store';
import { createTavernInterior, TAVERN_ENTRY } from './interior';

/** Its own world and physical seats. The generic portal controller supplies a fresh session entry ticket. */
export function createTavernRoom(services: RealmRoomServices) {
  return class TavernRoom extends Room<{ state: InstanceType<typeof TavernRoomState>; input: InstanceType<typeof WalkInputSchema>; client: Client<{ auth: RealmPrincipal }> }> {
    state = new TavernRoomState();
    maxClients = 128;
    maxMessagesPerSecond = 90;
    patchRate = 1000 / GATHER_HZ;
    private readonly interior = createTavernInterior();
    private tables!: GatherTables;
    private seats!: RealmSeats;
    private authority!: InteractionAuthority;
    private readonly owner = new Map<string, string>();
    private readonly walking = new Map<string, boolean>();
    private readonly actions = new Set<string>();
    private accepting = true;
    private tableSignature = '';
    private tableSentAt = 0;
    readonly inputs = this.defineInput(WalkInputSchema, { bufferMaxSize: 30, sanitize: sanitizeRealmWalkInput });

    static async onAuth(_token: string, raw: unknown) {
      const join = RealmJoinSchema.safeParse(raw);
      if (!join.success) throw new ServerError(400, 'Invalid tavern entry');
      return services.auth.authenticate(join.data);
    }
    async onCreate(options: { kingdomId: string }) {
      const kingdom = KingdomIdSchema.parse(options.kingdomId);
      this.roomId = `t:${kingdom}`;
      this.state.kingdomId = kingdom; this.state.writerEpoch = randomUUID();
      this.tables = new GatherTables(TAVERN_TABLES, { kingdom, store: gatherStoreFor(services) });
      await this.tables.restore(Date.now());
      this.state.collisionRevision = this.interior.world.revision;
      this.seats = new RealmSeats({ auth: services.auth, close: (id, code, reason) => this.clients.getById(id)?.leave(code, reason) });
      const readWalker = (id: string): PlayerState | null => this.state.walkers.get(id) ?? null;
      this.authority = createInteractionAuthority({ writerEpoch: this.state.writerEpoch, clock: Date.now,
        reconnectGraceMs: REALM_RECONNECT_GRACE_MS, world: () => this.interior.world, registry: () => this.interior.registry,
        rights: { current: (principal, now) => services.auth.current(principal, now), permitted: () => this.accepting },
        homes: { ownedPlotId: () => null }, zones: { zoneOf: () => 'tavern:main' },
        hosts: composeInteractionHosts({ tavern: this.tables.host }),
      });
      this.authority.bindRoom({ readWalker,
        placeWalker: (id, position, revision) => {
          const walker = this.state.walkers.get(id), body = { x: position[0], y: position[1], z: position[2] };
          if (!this.accepting || !walker || revision !== this.interior.world.revision || embeddedSolids(body, this.interior.world).length || !supported(body, this.interior.world)) return false;
          [walker.x, walker.y, walker.z] = position; walker.vx = 0; walker.vy = 0; walker.vz = 0;
          walker.placement = (walker.placement + 1) >>> 0; this.inputs.get(id).clear(); return true;
        },
        allowWalking: (id, allowed) => { this.walking.set(id, allowed); if (!allowed) this.inputs.get(id).clear(); },
      });
      this.authority.bindDelivery({ transient: message => this.broadcast('transient', message), owner: (person, message) => {
        const id = this.owner.get(person); if (id) this.clients.getById(id)?.send('private', message);
      } });
      this.onMessage('bootstrap', client => { if (this.current(client)) this.bootstrap(client); });
      this.onMessage('start', async (client, raw) => {
        const request = GatherStartSchema.safeParse(raw);
        if (!request.success || !this.current(client)) return;
        const accepted = await this.tables.start(client.auth!.personId, request.data, Date.now());
        if (this.current(client)) client.send('receipt', { id: request.data.id, accepted });
      });
      this.onMessage('move', async (client, raw) => {
        const request = GatherMoveSchema.safeParse(raw);
        if (!request.success || !this.current(client)) return;
        const accepted = await this.tables.move(client.auth!.personId, request.data, Date.now());
        if (this.current(client)) client.send('receipt', { id: request.data.id, accepted });
      });
      this.onMessage('paddle', (client, raw) => {
        const input = GatherPongInputSchema.safeParse(raw);
        if (input.success && this.current(client)) this.tables.input(client.auth!.personId, input.data);
      });
      this.onMessage('intent', (client, raw) => {
        const intent = RealmIntentSchema.safeParse(raw), auth = client.auth;
        if (!intent.success || intent.data.type !== 'interact' || !auth || !this.current(client) || this.actions.has(client.sessionId)) return;
        const walker = readWalker(client.sessionId); if (!walker) return;
        this.actions.add(client.sessionId);
        void this.authority.intent({ principal: auth, walkerId: client.sessionId,
          position: [walker.x, walker.y, walker.z], collisionRevision: walker.collisionRevision, current: () => readWalker(client.sessionId) }, intent.data)
          .then(receipt => { if (this.current(client)) client.send('private', { type: 'receipt', receipt }); }, () => {
            if (this.current(client)) client.send('private', { type: 'receipt', receipt: { version: 1, id: intent.data.id,
              status: 'unavailable', message: 'The chair could not be confirmed. Try again shortly.' } });
          }).finally(() => this.actions.delete(client.sessionId));
      });
      this.setFixedTimestep(ctx => {
        if (!this.accepting) return;
        for (const [id, walker] of this.state.walkers) {
          const client = this.clients.getById(id);
          if (client?.auth) this.tables.name(client.auth.personId, client.auth.publicName);
          if (!client || !this.current(client) || this.walking.get(id) === false) { this.inputs.get(id).clear(); walker.vx = 0; walker.vz = 0; continue; }
          const input = this.inputs.get(id).next();
          if (input && input.placement === walker.placement) stepPlayer(walker, input, ctx.dt, this.interior.world);
        }
        this.authority.expire(Date.now()); this.tables.tick(Date.now());
        const frame = this.tables.view(Date.now());
        const signature = frame.tables.map(table => `${table.revision}:${table.status}:${table.pong?.tick}:${table.pong?.phase}`).join('|');
        if (signature !== this.tableSignature || frame.at - this.tableSentAt >= 1000) {
          this.tableSignature = signature; this.tableSentAt = frame.at;
          for (const client of this.clients) if (this.current(client)) {
            client.send('tables', frame); client.send('self', this.tables.self(client.auth!.personId));
          }
        }
      }, GATHER_HZ);
      this.clock.setInterval(() => this.seats.check(), REALM_SESSION_CHECK_MS);
    }
    private current(client: Client<{ auth: RealmPrincipal }>): boolean {
      return this.accepting && !!client.auth && client.auth.expiresAt > Date.now() && !this.seats.held(client.sessionId)
        && this.owner.get(client.auth.personId) === client.sessionId;
    }
    private bootstrap(client: Client<{ auth: RealmPrincipal }>) {
      client.send('interior', { revision: this.interior.world.revision, layoutRevision: this.interior.registry.layoutRevision,
        boxes: this.interior.boxes, targets: this.interior.registry.targets(), entry: TAVERN_ENTRY });
      client.send('tables', this.tables.view(Date.now())); client.send('self', this.tables.self(client.auth!.personId));
      client.send('transient', this.authority.seats());
      client.send('private', { type: 'interaction', requestId: null, writerEpoch: this.state.writerEpoch, state: this.authority.selfState(client.auth!.sessionId) });
    }
    async onJoin(client: Client<{ auth: RealmPrincipal }>) {
      const auth = client.auth;
      if (!auth || auth.kingdomId !== this.state.kingdomId || !await services.auth.current(auth, Date.now()) || !this.accepting) throw new ServerError(403, 'The tavern entry has ended');
      const previous = this.seats.seatOf(auth.personId), carried = previous ? this.state.walkers.get(previous) : undefined;
      const position = carried ? [carried.x, carried.y, carried.z] as const : TAVERN_ENTRY.feet;
      const replaced = this.seats.seat(auth, client.sessionId);
      if (replaced) this.remove(replaced);
      this.owner.set(auth.personId, client.sessionId); this.state.origin = auth.origin;
      this.state.walkers.set(client.sessionId, new WalkerSchema({ name: auth.publicName, look: auth.look, district: 'tavern',
        x: position[0], y: position[1], z: position[2], vx: 0, vy: 0, vz: 0, grounded: true, yaw: carried?.yaw ?? TAVERN_ENTRY.yaw,
        distance: carried?.distance ?? 0, collisionRevision: this.interior.world.revision }));
      this.authority.lifecycle('join', auth, client.sessionId, Date.now());
      this.tables.name(auth.personId, auth.publicName); this.bootstrap(client);
    }
    async onDrop(client: Client<{ auth: RealmPrincipal }>) {
      if (!client.auth || !this.accepting) return;
      this.authority.lifecycle('drop', client.auth, client.sessionId, Date.now()); this.inputs.get(client.sessionId).clear();
      const seconds = this.seats.dropped(client.sessionId); if (!seconds) return;
      const reconnect = this.allowReconnection(client, seconds);
      this.seats.awaiting(client.sessionId, () => { if (typeof reconnect.reject === 'function') reconnect.reject(new Error('seat ended')); });
      try { await reconnect; } catch { /* physical lease expires through onLeave */ }
    }
    async onReconnect(client: Client<{ auth: RealmPrincipal }>) {
      if (!client.auth || !this.accepting) throw new ServerError(403, 'The tavern entry has ended');
      try { await this.seats.reconnected(client.sessionId); }
      catch (error) { throw new ServerError(error instanceof RealmSeatRefusedError ? error.code : 4410, 'This tavern seat has ended. Walk in again.'); }
      this.authority.lifecycle('reconnect', client.auth, client.sessionId, Date.now()); this.bootstrap(client);
    }
    onLeave(client: Client<{ auth: RealmPrincipal }>) {
      if (client.auth && this.state.walkers.has(client.sessionId)) this.authority.lifecycle('leave', client.auth, client.sessionId, Date.now());
      this.remove(client.sessionId);
      if (client.auth && this.owner.get(client.auth.personId) === client.sessionId) this.owner.delete(client.auth.personId);
    }
    private remove(id: string) {
      this.inputs.get(id).clear(); this.walking.delete(id); this.actions.delete(id); this.state.walkers.delete(id); this.seats.left(id);
    }
    async onDispose() { this.accepting = false; const drained = this.tables?.close(); this.authority?.dispose(); this.seats?.dispose(); await drained; }
  };
}
