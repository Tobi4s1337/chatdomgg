import { ClientState, CloseCode, Room, ServerError, type Client } from '@colyseus/core';
import { KingdomIdSchema, encodeRaidGuestVisualMark, parseRaidGuestVisualMark } from '@chatdom/shared';
import { KingdomRoomState, WalkerSchema, WalkInputSchema, RealmJoinSchema, RealmIntentSchema, kingdomRoomId,
  sanitizeRealmWalkInput, WALK_BODY, type RealmPrincipal, type RealmReceipt } from '@chatdom/shared/realm';
import { stepPlayer, bodyStuck, embeddedSolids, supported } from '@chatdom/world/movement';
import type { RealmRoomHandle, RealmRoomServices } from './ports';
import { tavernReturnsFor } from './games/return';
import { attachCampfireRoom } from './campfire';
import { RealmSeats, RealmSeatRefusedError, REALM_SESSION_CHECK_MS } from './auth/seats';
import { RealmDistricts } from './limits/districts';
import { attachRealmRoomChannels } from './room-channels';

/** Colyseus's own join-time full-state send (pinned core 0.18.23), reused to rebaseline one decoder on a crossing. */
type FullStateSender = { sendFullState(client: Client): void };
import { REALM_ROOM_LIMITS as LIMITS, within } from './limits';
import type { RealmRoomObserver } from './diagnostics';
import { portalArrivalsFor } from './portals/arrivals';
import { DEFAULT_MONARCH_TITLE, isVerifiedMonarch, monarchCrownOf } from '@chatdom/shared/realm';

/** The yaw byte that faces a world (x, z) from a position, or undefined without a point (headings face (sin h, cos h)). */
function facingYaw(toward: readonly [number, number] | undefined, from: readonly [number, number, number]): number | undefined {
  if (!toward) return undefined;
  const dx = toward[0] - from[0], dz = toward[1] - from[2];
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 1e-3) return undefined;
  return ((Math.round(Math.atan2(dx, dz) / (Math.PI * 2) * 256) % 256) + 256) % 256;
}

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
    inputs = this.defineInput(WalkInputSchema, { bufferMaxSize: LIMITS.inputBuffer, sanitize: sanitizeRealmWalkInput });
    private handle!: RealmRoomHandle;
    private accepting = true;
    /** Colyseus starts patching before async onCreate has acquired and bound the authority. */
    private initialized = false;
    private recoveryRequests = new Map<string, number>();
    /** Shared district views: one per occupied district, each holding that district and its neighbour ring. */
    private districts = new RealmDistricts<WalkerSchema>();
    /** The latest client object per walker, including a dropped one: Colyseus copies its view onto the reconnecting socket. */
    private viewers = new Map<string, Client<{ auth: RealmPrincipal }>>();
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
      // Known before the open: after a slow open, Colyseus has refused a late room id ("can only be overridden upon room creation").
      this.roomId = kingdomRoomId(kingdomId);
      this.handle = await services.open(kingdomId);
      this.state.kingdomId = kingdomId; this.state.writerEpoch = this.handle.writerEpoch;
      this.state.origin = this.handle.origin; this.state.layoutRevision = this.handle.layoutRevision;
      this.state.collisionRevision = this.handle.world.revision; this.state.factSequence = this.handle.sequence;
      this.world = this.handle.world;
      if (typeof (this as unknown as Partial<FullStateSender>).sendFullState !== 'function') throw new Error('District handoff needs Colyseus full-state resync');
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
          p.placement = (p.placement + 1) % 0x1_0000_0000;
          this.inputs.get(id).clear(); return true;
        },
        presentWalker: (id, presentation) => {
          const walker = this.state.walkers.get(id);
          if (this.accepting && walker) { walker.homeSlot = presentation.homeSlot; walker.look = presentation.look; }
        },
        presentRaidGuest: (id, mark) => {
          const walker = this.state.walkers.get(id);
          if (this.accepting && walker) walker.raidGuest = encodeRaidGuestVisualMark(mark, Date.now());
        },
        allowWalking: (id, allowed) => { this.walking.set(id,allowed); if(!allowed)this.inputs.get(id).clear(); },
        adoptWorld: (world, layoutRevision, positions) => {
          // Revisions identify immutable geometry. Returning to previously approved exact bytes may reuse an
          // older identity; it still needs the same complete safe-pose validation as any other adoption.
          if(world.revision === this.world.revision) throw new Error('Collision adoption must change geometry identity');
          for(const [id,p] of this.state.walkers) {
            const position=positions.get(id); if(!position || !safePose(world,position)) throw new Error('Every walker needs a safe revision pose');
            // Validation is completed for every pose before publishing a new world below.
            void p;
          }
          this.recoveryRequests.clear();this.world=world;this.state.collisionRevision=world.revision;this.state.layoutRevision=layoutRevision;
          for(const [id,p] of this.state.walkers) { [p.x,p.y,p.z]=positions.get(id)!;p.vx=0;p.vy=0;p.vz=0;p.grounded=true;p.collisionRevision=world.revision;p.placement=(p.placement+1)%0x1_0000_0000;this.inputs.get(id).clear(); }
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
      this.unbind.push(attachRealmRoomChannels(services.channels ?? [], {
        kingdomId, origin: this.handle.origin, auth: services.auth, active: () => this.accepting,
        receive: (type, listener) => this.onMessage(type, listener), clients: () => this.clients,
        client: id => this.clients.getById(id), seat: person => this.control.get(person), held: id => this.seats.held(id),
        pose: id => { const p = this.state.walkers.get(id); return p ? { position: [p.x,p.y,p.z], yaw: p.yaw, grounded: p.grounded, collisionRevision: p.collisionRevision } : null; },
        world: () => this.world, end: (id, reason) => this.seats.end(id, reason),
      }).dispose);
      // The campfire (gather): its own messages; a seat's secrets go to that person's current session only.
      // A new title reaches the walking monarch at once; the crown stays only on the verified broadcaster's seat.
      if (services.monarch) this.unbind.push(services.monarch.watch(kingdomId, title => {
        const sid = this.control.get(kingdomId), walker = sid ? this.state.walkers.get(sid) : undefined;
        const principal = sid ? this.viewers.get(sid)?.auth : undefined;
        if (this.accepting && walker && principal && isVerifiedMonarch(principal)) walker.crown = title;
      }));
      this.unbind.push(attachCampfireRoom(services, kingdomId, { on: (type, handler) => this.onMessage(type, (client, raw) => { if (this.accepting && client.auth && this.control.get(client.auth.personId) === client.sessionId) handler(client.auth, raw); }),
        send: (person, type, message) => { const sid = this.control.get(person); if (this.accepting && sid) this.clients.getById(sid)?.send(type, message); },
        broadcast: (type, message) => { if (this.accepting) this.broadcast(type, message); },
        nameOf: person => { const sid = this.control.get(person); return sid ? this.state.walkers.get(sid)?.name ?? null : null; } }));
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
          if (input && input.placement === p.placement) stepPlayer(p, input, ctx.dt, this.world);
          if (bodyStuck(p,this.world) && this.recoveryRequests.get(sid)!==this.world.revision) {
            this.recoveryRequests.set(sid,this.world.revision); this.inputs.get(sid).clear();
            try{this.handle.recoverWalker(sid,this.world.revision);}catch{connected.leave(4003,'The kingdom could not find a safe place. Reconnect to continue.');}
          }
        }
      }, LIMITS.walkHz);
      // Connected and dropped seats alike: a revoked session cannot wait out its grace.
      this.clock.setInterval(()=>this.seats.check(),REALM_SESSION_CHECK_MS);
      this.initialized = true;
    }
    async onJoin(client: Client<{ auth: RealmPrincipal }>, options?: unknown) {
      const auth = client.auth;
      if (!this.accepting) throw new ServerError(503,'The kingdom writer is unavailable');
      if (!auth || auth.kingdomId !== this.state.kingdomId || auth.origin !== this.state.origin) throw new ServerError(403, 'Wrong kingdom entry');
      if (!await services.auth.current(auth,Date.now()) || !this.accepting) throw new ServerError(403,'Entry expired');
      // A second tab may arrive mid-jump or after a collision revision: carry only a safe standing pose.
      const carriedPose = () => {
        const previous = this.seats.seatOf(auth.personId), carried = previous ? this.state.walkers.get(previous) : undefined;
        return carried && carried.collisionRevision === this.world.revision
          && [carried.x, carried.y, carried.z].every(Number.isFinite)
          && !embeddedSolids(carried, this.world).length && supported(carried, this.world) ? carried : undefined;
      };
      let preparation: Awaited<ReturnType<NonNullable<RealmRoomServices['prepareSpawn']>>> = null;
      if (!carriedPose() && services.prepareSpawn) {
        const world = this.world, layoutRevision = this.state.layoutRevision, writerEpoch = this.state.writerEpoch;
        try { preparation = await services.prepareSpawn(auth, { world, layoutRevision, writerEpoch }); }
        catch { throw new ServerError(503, 'The kingdom gate could not admit you. Open the kingdom again to enter.'); }
        if (!await services.auth.current(auth, Date.now()) || auth.expiresAt <= Date.now() || client.auth !== auth
          || client.state === ClientState.LEAVING || client.state === ClientState.CLOSED || !this.accepting) throw new ServerError(403, 'Entry expired');
        if (this.world !== world || this.world.revision !== world.revision || this.state.layoutRevision !== layoutRevision
          || this.state.writerEpoch !== writerEpoch) throw new ServerError(503, 'The kingdom gate changed. Try entering again.');
      }
      // The verified broadcaster wears the crown and their chosen title (monarch/); nobody else ever does.
      let crown = '';
      if (isVerifiedMonarch(auth) && auth.kingdomId === this.state.kingdomId) {
        try { crown = services.monarch ? await services.monarch.title(auth.kingdomId) : DEFAULT_MONARCH_TITLE; } catch { crown = DEFAULT_MONARCH_TITLE; }
        if (!this.accepting || client.auth !== auth) throw new ServerError(403, 'Entry expired');
      }
      // No awaits below: re-read both this person's current seat and every actual walker before choosing a gap.
      const previous = this.seats.seatOf(auth.personId), resume = carriedPose();
      // Back through a door (play's: named on the join, bound to a leave at that door) or just out of the tavern
      // (gather's record of the leave): the server's own feet outside it, facing out, or the gate as always. Both
      // records are spent by this arrival, so neither stays open for a later one.
      const door = resume ? undefined : this.doorArrival(auth, options);
      const tavern = resume ? null : tavernReturnsFor(services)?.arrival(auth.kingdomId, auth.personId, this.world, Date.now(), this.state.walkers.values()) ?? null;
      const back = door ?? tavern;
      let position: readonly [number, number, number];
      if (resume) position = [resume.x, resume.y, resume.z];
      else if (back) position = back.feet;
      else if (preparation) {
        if (!Number.isFinite(preparation.expiresAt) || preparation.expiresAt <= Date.now() || !preparation.current()
          || preparation.positions.length > 128) throw new ServerError(503, 'The kingdom gate changed. Try entering again.');
        const free = preparation.positions.find(candidate => candidate.length === 3 && candidate.every(Number.isFinite)
          && !embeddedSolids({ x: candidate[0], y: candidate[1], z: candidate[2] }, this.world).length
          && supported({ x: candidate[0], y: candidate[1], z: candidate[2] }, this.world)
          && [...this.state.walkers].every(([id, p]) => id === previous || Math.abs(p.x - candidate[0]) >= WALK_BODY.radius * 2 + .05
            || Math.abs(p.z - candidate[2]) >= WALK_BODY.radius * 2 + .05 || Math.abs(p.y - candidate[1]) >= WALK_BODY.height));
        if (!free) throw new ServerError(503, 'The kingdom gate has no safe arrival yet');
        position = free;
      } else position = this.handle.spawn(auth);
      const body = {x:position[0],y:position[1],z:position[2]};
      if (!position.every(Number.isFinite) || embeddedSolids(body,this.world).length || !supported(body,this.world)) throw new ServerError(503,'The kingdom gate has no safe arrival yet');
      const admittedAt = Date.now();
      if (!this.accepting || auth.expiresAt <= admittedAt || client.auth !== auth
        || client.state === ClientState.LEAVING || client.state === ClientState.CLOSED) throw new ServerError(403, 'Entry expired');
      if (preparation && !resume && (preparation.expiresAt <= admittedAt || !preparation.current())) throw new ServerError(503, 'The kingdom gate changed. Try entering again.');
      const replacedPrincipal = previous ? this.viewers.get(previous)?.auth : undefined;
      const replaced = this.seats.seat(auth, client.sessionId);
      if (replaced) this.removeWalker(replaced, replacedPrincipal);
      const walker = new WalkerSchema({ name: auth.publicName, look: auth.look, district: '', x: position[0], y: position[1], z: position[2],
        vx: 0, vy: 0, vz: 0, grounded: resume?.grounded ?? true, yaw: resume?.yaw ?? back?.yaw ?? facingYaw(!resume && !back ? preparation?.faceToward : undefined, position) ?? 0, distance: resume?.distance ?? 0, collisionRevision: this.state.collisionRevision, crown });
      this.state.walkers.set(client.sessionId, walker);
      // Attached to state first, then shared: Colyseus sends this socket the full state of its view after the join.
      client.view = this.districts.enter(client.sessionId, walker);
      this.viewers.set(client.sessionId, client);
      this.control.set(auth.personId, client.sessionId);
      this.handle.lifecycle('join',auth,client.sessionId,admittedAt);
    }
    async onDrop(client: Client<{ auth: RealmPrincipal }>, code?: number) {
      observer.closed('drop', code);
      if(!client.auth||!this.accepting||!this.state.walkers.has(client.sessionId))return;
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
      // Colyseus copied the dropped socket's view; the walker may have crossed meanwhile, so hand over the current one.
      // The reconnected socket then receives the full state of that view, which the SDK reconciles against its decoder.
      const view = this.districts.viewOf(client.sessionId);
      if (view) client.view = view;
      this.viewers.set(client.sessionId, client);
      this.handle.lifecycle('reconnect',client.auth,client.sessionId,Date.now());
    }
    onLeave(client: Client<{ auth: RealmPrincipal }>, code?: number) {
      observer.closed('leave', code);
      // Only the person's own current walker leaving on purpose counts as walking out, from where it stood (a second tab
      // replacing it, a dropped socket whose grace ran out or a seat the server ended does not).
      const leaving = client.auth && code === CloseCode.CONSENTED && this.control.get(client.auth.personId) === client.sessionId ? this.state.walkers.get(client.sessionId) : undefined;
      if (client.auth && leaving) portalArrivalsFor(services)?.departed(this.handle.kingdomId, client.auth.personId, [leaving.x, leaving.y, leaving.z]);
      this.removeWalker(client.sessionId, client.auth);
    }
    private doorArrival(auth: RealmPrincipal, options: unknown) {
      const arrive = RealmJoinSchema.safeParse(options).data?.arrive, arrivals = portalArrivalsFor(services);
      if (!arrive || !arrivals) return undefined;
      const found = arrivals.arrival(this.handle.kingdomId, auth.personId, arrive.portal, this.world);
      if (!found) return undefined;
      const body = { x: found.feet[0], y: found.feet[1], z: found.feet[2] };
      return !embeddedSolids(body, this.world).length && supported(body, this.world) ? found : undefined;
    }
    private removeWalker(id: string, principal?: RealmPrincipal) {
      if (principal && this.state.walkers.has(id)) this.handle.lifecycle('leave',principal,id,Date.now());
      this.inputs.get(id).clear();
      this.walking.delete(id); this.recoveryRequests.delete(id);
      if (this.state.walkers.has(id)) { this.districts.leave(id); this.state.walkers.delete(id); }
      this.viewers.delete(id);
      if (principal && this.control.get(principal.personId) === id) this.control.delete(principal.personId);
      this.seats.left(id);
    }
    /**
     * District membership moves only here, right before Colyseus encodes the patch, so every queued view change is
     * encoded in that same patch. A crossing client takes the shared view of its new district and is rebaselined
     * with that view's full state: the SDK's resync decode drops the old district's walkers from this decoder only,
     * adds the new district's existing ones, and leaves every other client's shared view and decoder untouched.
     */
    onBeforePatch() {
      if (!this.initialized || !this.accepting) return;
      for (const crossing of this.districts.sweep()) {
        const client = this.viewers.get(crossing.id);
        if (!client) continue;
        client.view = crossing.view;
        // A joining or reconnecting socket gets this view's full state when it acknowledges the join.
        if (client.state === ClientState.JOINED) (this as unknown as FullStateSender).sendFullState(client);
      }
      const sampledAt = Date.now();
      this.handle.publishWalkers?.({
        version: 1, kingdomId: this.handle.kingdomId, origin: this.handle.origin, writerEpoch: this.handle.writerEpoch,
        layoutRevision: this.state.layoutRevision, collisionRevision: this.state.collisionRevision, sampledAt,
        walkers: [...this.state.walkers].map(([id, p]) => {
          const raidGuest = parseRaidGuestVisualMark(p.raidGuest, sampledAt);
          if (!raidGuest && p.raidGuest) p.raidGuest = '';
          const crown = monarchCrownOf(p.crown);
          return { id, name: p.name, look: p.look, homeSlot: p.homeSlot,
            x: p.x, y: p.y, z: p.z, yaw: p.yaw, distance: p.distance, speed: Math.hypot(p.vx, p.vz), placement: p.placement,
            ...(raidGuest ? { raidGuest } : {}), ...(crown ? { crown } : {}) };
        }),
      });
    }
    async onDispose() { this.initialized = false; this.accepting = false; this.districts.dispose(); this.seats?.dispose(); for (const unbind of this.unbind) unbind(); await this.handle?.dispose(); }
  };
}
