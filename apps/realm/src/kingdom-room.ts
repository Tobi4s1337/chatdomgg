import { Room, ServerError, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { KingdomIdSchema } from '@chatdom/shared';
import { KingdomRoomState, WalkerSchema, WalkInputSchema, RealmJoinSchema, RealmIntentSchema, kingdomRoomId,
  sanitizeWalkInput, type RealmPrincipal, type RealmReceipt } from '@chatdom/shared/realm';
import { stepPlayer, bodyStuck, embeddedSolids, supported } from '@chatdom/world/movement';
import type { RealmRoomHandle, RealmRoomServices } from './ports';
import { RealmSeats, RealmSeatRefusedError, REALM_SESSION_CHECK_MS } from './auth/seats';
import { REALM_ROOM_LIMITS as LIMITS, within } from './limits';
import type { RealmRoomObserver } from './diagnostics';

const UNOBSERVED: RealmRoomObserver = { inputDepth() {}, actionStarted() {}, actionRefused() {}, closed() {} };
/** Colyseus closes a sender past `maxMessagesPerSecond` (and the room ends invalid input) with this code. */
const PROTOCOL_CLOSE = 4002;
class ActionLate extends Error {}

/** Colyseus adapter only. Durable rules live in world; transports cannot award or publish. Every ceiling is in `limits/`. */
export function createKingdomRoom(services: RealmRoomServices, observer: RealmRoomObserver = UNOBSERVED) {
  return class KingdomRoom extends Room<{ state: KingdomRoomState; input: InstanceType<typeof WalkInputSchema>; client: Client<{ auth: RealmPrincipal }> }> {
    state = new KingdomRoomState();
    maxClients = LIMITS.maxClients;
    maxMessagesPerSecond = LIMITS.messagesPerSecond;
    patchRate = LIMITS.patchMs;
    inputs = this.defineInput(WalkInputSchema, { bufferMaxSize: LIMITS.inputBuffer, sanitize: sanitizeWalkInput });
    private handle!: RealmRoomHandle;
    private accepting = true;
    private recoveryRequests = new Map<string, number>();
    /** One court district in the reference; the server lane adds shared district groups and handoff. */
    private district = new StateView();
    private control = new Map<string, string>();
    private unbind: (() => void)[] = [];
    private walking = new Map<string, boolean>();
    private world!: RealmRoomHandle['world'];
    /** One seat per person; reconnects and session checks go through it (spec 34 R8). */
    private seats!: RealmSeats;
    /** Actions in flight per person across replacement walker sessions; bounded by `LIMITS.actionsPerWalker`. */
    private actions = new Map<string, number>();

    static async onAuth(_token: string, options: unknown) {
      const parsed = RealmJoinSchema.safeParse(options);
      if (!parsed.success) throw new ServerError(400, 'Invalid kingdom entry');
      return services.auth.authenticate(parsed.data);
    }
    async onCreate(options: { kingdomId: string }) {
      const kingdomId = KingdomIdSchema.parse(options.kingdomId);
      this.handle = await services.open(kingdomId);
      this.roomId = kingdomRoomId(kingdomId);
      this.state.kingdomId = kingdomId; this.state.writerEpoch = this.handle.writerEpoch;
      this.state.origin = this.handle.origin; this.state.layoutRevision = this.handle.layoutRevision;
      this.state.collisionRevision = this.handle.world.revision; this.state.factSequence = this.handle.sequence;
      this.world = this.handle.world;
      this.seats = new RealmSeats({ auth: services.auth, close: (id, code, reason) => this.clients.getById(id)?.leave(code, reason) });
      const readWalker = (id: string) => { const p = this.state.walkers.get(id); return p ? { x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,grounded:p.grounded,yaw:p.yaw,distance:p.distance,collisionRevision:p.collisionRevision } : null; };
      const safePose = (world: RealmRoomHandle['world'], position: readonly [number, number, number]) => {
        const body = { x: position[0], y: position[1], z: position[2] };
        return position.every(Number.isFinite) && embeddedSolids(body, world).length === 0 && supported(body, world);
      };
      this.unbind.push(this.handle.bindRoom({
        close: () => {
          if (!this.accepting) return;
          this.accepting = false;
          for (const [id, walker] of this.state.walkers) { this.inputs.get(id).clear(); walker.vx=0; walker.vy=0; walker.vz=0; }
          void this.disconnect(4003);
        },
        readWalker,
        placeWalker: (id, position, revision) => {
          const p = this.state.walkers.get(id);
          if (!this.accepting || !p || revision !== this.world.revision || !safePose(this.world, position)) return false;
          [p.x,p.y,p.z] = position; p.vx=0;p.vy=0;p.vz=0;p.grounded=true;
          this.inputs.get(id).clear(); return true;
        },
        allowWalking: (id, allowed) => { this.walking.set(id,allowed); if(!allowed)this.inputs.get(id).clear(); },
        adoptWorld: (world, layoutRevision, positions) => {
          if(world.revision <= this.world.revision) throw new Error('Collision revisions must advance');
          for(const [id,p] of this.state.walkers) {
            const position=positions.get(id); if(!position || !safePose(world,position)) throw new Error('Every walker needs a safe revision pose');
            // Validation is completed for every pose before publishing a new world below.
            void p;
          }
          this.recoveryRequests.clear();this.world=world;this.state.collisionRevision=world.revision;this.state.layoutRevision=layoutRevision;
          for(const [id,p] of this.state.walkers) { [p.x,p.y,p.z]=positions.get(id)!;p.vx=0;p.vy=0;p.vz=0;p.collisionRevision=world.revision;this.inputs.get(id).clear(); }
          this.broadcast('revision',{layoutRevision,collisionRevision:world.revision});
        },
      }));
      if(!this.accepting)throw new ServerError(503,'The kingdom writer is unavailable');
      this.onMessage('bootstrap', client => { if(this.accepting&&client.auth)client.send('bootstrap',this.handle.bootstrap(client.auth)); });
      this.unbind.push(this.handle.subscribe(delivery => {
        if (!this.accepting) return;
        // Delivery is at-least-once: a redelivered row never moves the public sequence backwards.
        this.state.factSequence = Math.max(this.state.factSequence, delivery.sequence);
        this.broadcast('world', delivery);
      }), this.handle.bindTransient(message => { if(this.accepting)this.broadcast('transient', message); }, (personId, message) => {
        if(!this.accepting)return;
        const sid = this.control.get(personId), client = sid ? this.clients.getById(sid) : undefined;
        client?.send('private', message);
      }));
      this.onMessage('intent', (client, raw) => {
        if(!this.accepting){client.leave(4003,'Kingdom connection ended; reconnect to check your work.');return;}
        const parsed = RealmIntentSchema.safeParse(raw);
        if (!parsed.success) { client.leave(PROTOCOL_CLOSE, 'Invalid intent'); return; }
        const id = parsed.data.id, sid = client.sessionId, person = client.auth?.personId;
        if (!person) { client.leave(PROTOCOL_CLOSE, 'Invalid entry'); return; }
        const inFlight = this.actions.get(person) ?? 0;
        const answer = (receipt: RealmReceipt) => { if (this.accepting && this.clients.getById(sid) === client) client.send('private', { type: 'receipt', receipt }); };
        // A finite cost per person: one action at a time. More are answered at once, never queued as promises.
        if (inFlight >= LIMITS.actionsPerWalker) {
          observer.actionRefused('busy');
          answer({ version: 1, id, status: 'held', message: 'Your previous request is still being confirmed. Wait for its receipt, then try again.' });
          return;
        }
        this.actions.set(person, inFlight + 1);
        observer.actionStarted(inFlight + 1);
        const work = (async (): Promise<RealmReceipt | null> => {
          const p = this.state.walkers.get(sid), auth = client.auth;
          if (!p || !auth || !await services.auth.current(auth, Date.now())) { this.seats.end(sid, 'session-ended'); return null; }
          if (!this.accepting || this.seats.held(sid)) return null;
          // The domain implementation serializes/commits; a socket never supplies actor or position.
          return this.handle.intent({ principal: auth, walkerId: sid,
            position: [p.x, p.y, p.z], collisionRevision: p.collisionRevision, current:()=>readWalker(sid) }, parsed.data);
        })();
        // The slot frees when the work itself settles, so a stalled store holds this person's next action instead of stacking it.
        void work.then(() => {}, () => {}).finally(() => {
          const left = (this.actions.get(person) ?? 1) - 1;
          if (left > 0) this.actions.set(person, left); else this.actions.delete(person);
        });
        void within(work, LIMITS.actionReplyMs, () => new ActionLate()).then(receipt => { if (receipt) answer(receipt); }, error => {
          if (error instanceof ActionLate) {
            observer.actionRefused('late');
            answer({ version: 1, id, status: 'unavailable', message: 'The kingdom has not confirmed this request yet. Reconnect to check its result before trying again.' });
          } else answer({ version: 1, id, status: 'unavailable', message: 'The kingdom could not confirm this request. Reconnect to check its result.' });
        });
      });
      this.setFixedTimestep(ctx => {
        if(!this.accepting)return;
        for (const [sid, p] of this.state.walkers) {
          const connected = this.clients.getById(sid);
          if (!connected?.auth || connected.auth.expiresAt <= Date.now()) { this.inputs.get(sid).clear(); p.vx = 0; p.vz = 0; if(connected)this.seats.end(sid,'session-ended');continue; }
          if(this.walking.get(sid)===false||this.seats.held(sid)){this.inputs.get(sid).clear();p.vx=0;p.vz=0;continue;}
          const queued = this.inputs.get(sid);
          observer.inputDepth(queued.size);
          const input = queued.next();
          // Default skip policy: empty ticks don't create movement that the acknowledged input never ran.
          if (input) stepPlayer(p, input, ctx.dt, this.world);
          if (bodyStuck(p,this.world) && this.recoveryRequests.get(sid)!==this.world.revision) {
            this.recoveryRequests.set(sid,this.world.revision); this.inputs.get(sid).clear();
            try{this.handle.recoverWalker(sid,this.world.revision);}catch{connected.leave(4003,'The kingdom could not find a safe place. Reconnect to continue.');}
          }
        }
      }, LIMITS.walkHz);
      // Connected and dropped seats alike: a revoked session cannot wait out its grace.
      this.clock.setInterval(()=>this.seats.check(),REALM_SESSION_CHECK_MS);
    }
    async onJoin(client: Client<{ auth: RealmPrincipal }>) {
      const auth = client.auth;
      if (!this.accepting) throw new ServerError(503,'The kingdom writer is unavailable');
      if (!auth || auth.kingdomId !== this.state.kingdomId || auth.origin !== this.state.origin) throw new ServerError(403, 'Wrong kingdom entry');
      if (!await services.auth.current(auth,Date.now()) || !this.accepting) throw new ServerError(403,'Entry expired');
      const previous = this.seats.seatOf(auth.personId), carried = previous ? this.state.walkers.get(previous) : undefined;
      // A second tab may arrive mid-jump or after a collision revision: carry only a safe standing pose.
      const resume = carried && carried.collisionRevision === this.world.revision
        && [carried.x, carried.y, carried.z].every(Number.isFinite)
        && !embeddedSolids(carried, this.world).length && supported(carried, this.world) ? carried : undefined;
      const position = resume ? [resume.x, resume.y, resume.z] as const : this.handle.spawn(auth), body = {x:position[0],y:position[1],z:position[2]};
      if (!position.every(Number.isFinite) || embeddedSolids(body,this.world).length || !supported(body,this.world)) throw new ServerError(503,'The kingdom gate has no safe arrival yet');
      this.seats.seat(auth, client.sessionId);
      const walker = new WalkerSchema({ name: auth.publicName, look: auth.look, district: 'court', x: position[0], y: position[1], z: position[2],
        vx: 0, vy: 0, vz: 0, grounded: resume?.grounded ?? true, yaw: resume?.yaw ?? 0, distance: resume?.distance ?? 0, collisionRevision: this.state.collisionRevision });
      this.state.walkers.set(client.sessionId, walker);
      this.district.add(walker);
      client.view = this.district;
      this.control.set(auth.personId, client.sessionId);
      this.handle.lifecycle('join',auth,client.sessionId,Date.now());
    }
    async onDrop(client: Client<{ auth: RealmPrincipal }>, code?: number) {
      observer.closed('drop', code);
      if(!client.auth||!this.accepting)return;
      this.handle.lifecycle('drop',client.auth,client.sessionId,Date.now());
      this.inputs.get(client.sessionId).clear();
      const p = this.state.walkers.get(client.sessionId); if (p) { p.vx = 0; p.vz = 0; }
      // No grace for a seat the server ended, a replaced seat or a spent session: Colyseus calls onLeave next.
      if (code === PROTOCOL_CLOSE) { this.seats.left(client.sessionId); return; }
      const seconds = this.seats.dropped(client.sessionId);
      if (!seconds) return;
      const reconnection = this.allowReconnection(client, seconds);
      // A room that is disposing, or a client that never finished joining, gets a plain rejected promise instead.
      this.seats.awaiting(client.sessionId, () => { if (typeof reconnection.reject === 'function') reconnection.reject(new Error('seat ended')); });
      try {
        await reconnection;
      } catch { /* Colyseus invokes onLeave when the grace expires or the seat ends. */ }
    }
    async onReconnect(client: Client<{ auth: RealmPrincipal }>) {
      if (!this.accepting || !client.auth) throw new ServerError(403,'Entry expired');
      try {
        await this.seats.reconnected(client.sessionId);
      } catch (error) {
        throw new ServerError(error instanceof RealmSeatRefusedError ? error.code : 4410, error instanceof RealmSeatRefusedError ? error.message : 'This seat has ended. Walk in again to continue.');
      }
      if (!this.accepting) throw new ServerError(403,'Entry expired');
      this.handle.lifecycle('reconnect',client.auth,client.sessionId,Date.now());
    }
    onLeave(client: Client<{ auth: RealmPrincipal }>, code?: number) {
      observer.closed('leave', code);
      if(client.auth)this.handle.lifecycle('leave',client.auth,client.sessionId,Date.now());
      this.walking.delete(client.sessionId);this.recoveryRequests.delete(client.sessionId);
      const p = this.state.walkers.get(client.sessionId);
      if (p) { this.district.remove(p); this.state.walkers.delete(client.sessionId); }
      if (client.auth && this.control.get(client.auth.personId) === client.sessionId) this.control.delete(client.auth.personId);
      this.seats.left(client.sessionId);
    }
    async onDispose() { this.seats?.dispose(); for (const unbind of this.unbind) unbind(); await this.handle?.dispose(); }
  };
}
