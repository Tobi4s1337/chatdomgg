import { Room, ServerError, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { KingdomIdSchema } from '@chatdom/shared';
import { KingdomRoomState, WalkerSchema, WalkInputSchema, RealmJoinSchema, RealmIntentSchema, kingdomRoomId,
  WALK_HZ, REALM_PATCH_MS, REALM_MESSAGE_LIMIT, sanitizeWalkInput, type RealmPrincipal } from '@chatdom/shared/realm';
import { stepPlayer } from '@chatdom/world/movement';
import type { RealmRoomHandle, RealmRoomServices } from './ports';

/** Colyseus adapter only. Durable rules live in world; transports cannot award or publish. */
export function createKingdomRoom(services: RealmRoomServices) {
  return class KingdomRoom extends Room<{ state: KingdomRoomState; input: InstanceType<typeof WalkInputSchema>; client: Client<{ auth: RealmPrincipal }> }> {
    state = new KingdomRoomState();
    maxClients = 300;
    maxMessagesPerSecond = REALM_MESSAGE_LIMIT;
    patchRate = REALM_PATCH_MS;
    inputs = this.defineInput(WalkInputSchema, { bufferMaxSize: 8, sanitize: sanitizeWalkInput });
    private handle!: RealmRoomHandle;
    /** One court district in the reference; the server lane adds shared district groups and handoff. */
    private district = new StateView();
    private control = new Map<string, string>();
    private unbind: (() => void)[] = [];
    private walking = new Map<string, boolean>();
    private world!: RealmRoomHandle['world'];
    private authChecks = new Set<string>();

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
      const readWalker = (id: string) => { const p = this.state.walkers.get(id); return p ? { x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,grounded:p.grounded,yaw:p.yaw,distance:p.distance,collisionRevision:p.collisionRevision } : null; };
      this.unbind.push(this.handle.bindRoom({
        readWalker,
        placeWalker: (id, position, revision) => {
          const p = this.state.walkers.get(id);
          if (!p || revision !== this.world.revision || position.some(n => !Number.isFinite(n))) return false;
          [p.x,p.y,p.z] = position; p.vx=0;p.vy=0;p.vz=0;
          this.inputs.get(id).clear(); return true;
        },
        allowWalking: (id, allowed) => { this.walking.set(id,allowed); if(!allowed)this.inputs.get(id).clear(); },
        adoptWorld: (world, layoutRevision, positions) => {
          if(world.revision <= this.world.revision) throw new Error('Collision revisions must advance');
          for(const [id,p] of this.state.walkers) {
            const position=positions.get(id); if(!position || position.some(n=>!Number.isFinite(n))) throw new Error('Every walker needs a safe revision pose');
            // Validation is completed for every pose before publishing a new world below.
            void p;
          }
          this.world=world;this.state.collisionRevision=world.revision;this.state.layoutRevision=layoutRevision;
          for(const [id,p] of this.state.walkers) { [p.x,p.y,p.z]=positions.get(id)!;p.vx=0;p.vy=0;p.vz=0;p.collisionRevision=world.revision;this.inputs.get(id).clear(); }
          this.broadcast('revision',{layoutRevision,collisionRevision:world.revision});
        },
      }));
      this.onMessage('bootstrap', client => { if(client.auth)client.send('bootstrap',this.handle.bootstrap(client.auth)); });
      this.unbind.push(this.handle.subscribe(delivery => {
        this.state.factSequence = delivery.sequence;
        this.broadcast('world', delivery);
      }), this.handle.bindTransient(message => this.broadcast('transient', message), (personId, message) => {
        const sid = this.control.get(personId), client = sid ? this.clients.getById(sid) : undefined;
        client?.send('private', message);
      }));
      this.onMessage('intent', async (client, raw) => {
        const parsed = RealmIntentSchema.safeParse(raw);
        if (!parsed.success) { client.leave(4002, 'Invalid intent'); return; }
        try {
        const p = this.state.walkers.get(client.sessionId), auth = client.auth;
        if (!p || !auth || !await services.auth.current(auth, Date.now())) { client.leave(4003, 'Entry expired'); return; }
        // The domain implementation serializes/commits; a socket never supplies actor or position.
        const receipt = await this.handle.intent({ principal: auth, walkerId: client.sessionId,
          position: [p.x, p.y, p.z], collisionRevision: p.collisionRevision, current:()=>readWalker(client.sessionId) }, parsed.data);
        client.send('private', { type: 'receipt', receipt });
        } catch {
          client.send('private',{type:'receipt',receipt:{version:1,id:parsed.data.id,status:'unavailable',message:'The kingdom could not confirm this request. Reconnect to check its result.'}});
        }
      });
      this.setFixedTimestep(ctx => {
        for (const [sid, p] of this.state.walkers) {
          const connected = this.clients.getById(sid);
          if (!connected?.auth || connected.auth.expiresAt <= Date.now()) { this.inputs.get(sid).clear(); p.vx = 0; p.vz = 0; if(connected)connected.leave(4003,'Entry expired');continue; }
          if(this.walking.get(sid)===false){this.inputs.get(sid).clear();p.vx=0;p.vz=0;continue;}
          const input = this.inputs.get(sid).next();
          // Default skip policy: empty ticks don't create movement that the acknowledged input never ran.
          if (input) stepPlayer(p, input, ctx.dt, this.world);
        }
      }, WALK_HZ);
      this.clock.setInterval(()=>{
        for(const client of this.clients){
          if(!client.auth||this.authChecks.has(client.sessionId))continue;
          this.authChecks.add(client.sessionId);
          const timeout=this.clock.setTimeout(()=>client.leave(4003,'Entry unavailable'),3000);
          void services.auth.current(client.auth,Date.now()).then(current=>{if(!current)client.leave(4003,'Entry expired');},()=>client.leave(4003,'Entry unavailable')).finally(()=>{timeout.clear();this.authChecks.delete(client.sessionId);});
        }
      },1000);
    }
    async onJoin(client: Client<{ auth: RealmPrincipal }>) {
      const auth = client.auth;
      if (!auth || auth.kingdomId !== this.state.kingdomId || auth.origin !== this.state.origin) throw new ServerError(403, 'Wrong kingdom entry');
      if (!await services.auth.current(auth,Date.now()))throw new ServerError(403,'Entry expired');
      if (this.control.has(auth.personId)) throw new ServerError(409, 'This citizen already walks here');
      const position = this.handle.spawn(auth);
      const walker = new WalkerSchema({ name: auth.publicName, look: auth.look, district: 'court', x: position[0], y: position[1], z: position[2],
        vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: this.state.collisionRevision });
      this.state.walkers.set(client.sessionId, walker);
      this.district.add(walker);
      client.view = this.district;
      this.control.set(auth.personId, client.sessionId);
      this.handle.lifecycle('join',auth,client.sessionId,Date.now());
    }
    async onDrop(client: Client<{ auth: RealmPrincipal }>) {
      if(!client.auth)return;
      this.handle.lifecycle('drop',client.auth,client.sessionId,Date.now());
      this.inputs.get(client.sessionId).clear();
      const p = this.state.walkers.get(client.sessionId); if (p) { p.vx = 0; p.vz = 0; }
      if(client.auth.expiresAt<=Date.now())return;
      try {
        await this.allowReconnection(client, 30);
      } catch { /* Colyseus invokes onLeave when the reconnect grace expires. */ }
    }
    async onReconnect(client: Client<{ auth: RealmPrincipal }>) {
      if(!client.auth||!await services.auth.current(client.auth,Date.now()))throw new ServerError(403,'Entry expired');
      this.handle.lifecycle('reconnect',client.auth,client.sessionId,Date.now());
    }
    onLeave(client: Client<{ auth: RealmPrincipal }>) {
      if(client.auth)this.handle.lifecycle('leave',client.auth,client.sessionId,Date.now());
      this.walking.delete(client.sessionId);
      const p = this.state.walkers.get(client.sessionId);
      if (p) { this.district.remove(p); this.state.walkers.delete(client.sessionId); }
      if (client.auth && this.control.get(client.auth.personId) === client.sessionId) this.control.delete(client.auth.personId);
    }
    async onDispose() { for (const unbind of this.unbind) unbind(); await this.handle?.dispose(); }
  };
}
