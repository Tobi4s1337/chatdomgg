import { describe, expect, it } from 'vitest';
import { Encoder, Decoder } from '@colyseus/schema';
import { RealmIntentSchema, RealmJoinSchema, kingdomRoomId } from './messages';
import { KingdomRoomState, WalkerSchema, WalkInputSchema } from './schema';
import { sanitizeWalkInput, sanitizeRealmWalkInput } from './movement';
import { RealmSessionReplySchema } from './auth';
import { ForgeRunRequestSchema } from '../forge';
import { REALM_CASTLE_SLOT, REALM_NO_HOME_SLOT, castleHostId } from './hosts';
import { RealmWalkerFrameSchema } from './watch';
import { PersonIdSchema } from '../identity';
import { CITIZEN_STARTER_LOOKS, starterCitizenLook } from '../citizen-look';
import { StyleIdSchema, type VoxelBlueprint } from '../voxel';

describe('realm wire boundary v1', () => {
  it('patches only a public street link and free look without disclosing identity or granting browser authority', () => {
    const privatePerson = PersonIdSchema.parse('9007199254740993123');
    const look = starterCitizenLook(privatePerson);
    expect(CITIZEN_STARTER_LOOKS).toContain(look);
    const original = new WalkerSchema({ name: 'SIMULATED Wren', look, district: 'court',
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: 1 });
    const copy = new WalkerSchema(), encoder = new Encoder(original), decoder = new Decoder(copy);
    decoder.decode(encoder.encodeAll());
    expect(copy.homeSlot).toBe(REALM_NO_HOME_SLOT);
    encoder.discardChanges(); original.homeSlot = 42; decoder.decode(encoder.encode());
    expect(copy.homeSlot).toBe(42); expect(copy.look).toBe(look);
    const frame = { version: 1, kingdomId: '129634568', origin: 'simulated', writerEpoch: 'epoch:1',
      layoutRevision: 'layout:1', collisionRevision: 1, sampledAt: 1_000,
      walkers: [{ id: 'opaque:walker', name: copy.name, look: copy.look, homeSlot: copy.homeSlot,
        x: 0, y: 0, z: 0, yaw: 0, distance: 0, speed: 0, placement: 0 }] };
    expect(RealmWalkerFrameSchema.safeParse(frame).success).toBe(true);
    const seat = { targetId: 'fire:market:seat:west', walkerId: 'opaque:walker', generation: 1, status: 'occupied' };
    expect(RealmWalkerFrameSchema.safeParse({ ...frame, seats: [seat] }).success).toBe(true);
    expect(RealmWalkerFrameSchema.safeParse({ ...frame, seats: [{ ...seat, personId: privatePerson }] }).success).toBe(false);
    expect(RealmWalkerFrameSchema.safeParse({ ...frame, seats: [seat, { ...seat, targetId: 'fire:market:seat:east' }] }).success).toBe(false);
    expect(JSON.stringify(frame)).not.toContain(privatePerson);
    expect(RealmWalkerFrameSchema.safeParse({ ...frame, walkers: [{ ...frame.walkers[0], personId: privatePerson }] }).success).toBe(false);
    expect(RealmWalkerFrameSchema.safeParse({ ...frame, walkers: Array(301).fill(frame.walkers[0]) }).success).toBe(false);
    expect(RealmIntentSchema.safeParse({ version: 1, id: 'claim:1', type: 'walker.present', homeSlot: 42, look }).success).toBe(false);
  });
  it('bounds the native keep explicitly without widening street hosts or browser authority', () => {
    const home: VoxelBlueprint = { version: 1, id: 'actual-native-keep', styleId: StyleIdSchema.parse('tide'),
      kind: 'civic', lattice: 'build', size: [256, 248, 256], boxes: [], windows: [] };
    const request = { words: 'a chimney shaped like a sleeping dragon', family: 'tide', home };
    expect(ForgeRunRequestSchema.safeParse(request).success).toBe(false);
    expect(ForgeRunRequestSchema.safeParse({ ...request, hostProfile: 'castle-keep' }).success).toBe(true);
    expect(ForgeRunRequestSchema.safeParse({ ...request, hostProfile: 'castle-keep', home: { ...home, size: [257, 248, 256] } }).success).toBe(false);
    expect(REALM_CASTLE_SLOT).toBe(65534); expect(castleHostId('keep-1')).toBe('castle:keep-1');
    expect(RealmIntentSchema.safeParse({ version: 1, id: 'wish:1', type: 'forge.wish', words: 'dragon', hostProfile: 'castle-keep' }).success).toBe(false);
    expect(RealmIntentSchema.safeParse({ version: 1, id: 'install:1', type: 'castle.installNative', castle: home }).success).toBe(false);
  });
  it('preserves large string kingdom IDs, denies claimed authority and transmits only the public schema', () => {
    expect(kingdomRoomId('9007199254740993123')).toBe('k:9007199254740993123');
    expect(() => kingdomRoomId('tobi4s_')).toThrow();
    const join = { kingdomId:'129634568',ticket:'opaque-session-ticket',protocol:1 };
    expect(RealmJoinSchema.safeParse(join).success).toBe(true);
    expect(RealmJoinSchema.safeParse({...join,personId:'123'}).success).toBe(false);
    const session={version:1,status:'authenticated',expiresAt:1000,resumeScope:'opaque-browser-scope',csrfToken:'a'.repeat(32)};
    expect(RealmSessionReplySchema.safeParse(session).success).toBe(true);
    expect(RealmSessionReplySchema.safeParse({...session,personId:'123'}).success).toBe(false);
    expect(RealmIntentSchema.safeParse({version:1,id:'wish:1',type:'forge.wish',words:'a sleeping dragon'}).success).toBe(true);
    expect(RealmIntentSchema.safeParse({version:1,id:'wish:1',type:'forge.wish',words:'dragon',ownerId:'123',coal:3}).success).toBe(false);
    const state=new KingdomRoomState({kingdomId:join.kingdomId,writerEpoch:'epoch:1',origin:'simulated',layoutRevision:'layout:1',collisionRevision:1,factSequence:0});
    state.walkers.set('opaque-walker',new WalkerSchema({name:'Juniper',look:'hearth',district:'court',x:2,y:0,z:4,vx:0,vy:0,vz:0,grounded:true,yaw:128,distance:0,collisionRevision:1,placement:7}));
    const copy=new KingdomRoomState();new Decoder(copy).decode(new Encoder(state).encodeAll());
    const json=JSON.stringify(copy.toJSON());
    expect(json).not.toMatch(/personId|coal|words|ticket|reservation|safetyIdentifier/);
    expect(copy.kingdomId).toBe(join.kingdomId);
    const original = new WalkerSchema({name:'Juniper',look:'hearth',district:'court',x:2,y:0,z:4,vx:0,vy:0,vz:0,grounded:true,yaw:128,distance:0,collisionRevision:1,placement:7});
    const walker = new WalkerSchema(), encoder = new Encoder(original), decoder = new Decoder(walker);
    decoder.decode(encoder.encodeAll()); expect(walker.placement).toBe(7);
    encoder.discardChanges(); original.placement=8; decoder.decode(encoder.encode());
    expect(walker.placement).toBe(8); expect(walker.x).toBe(2); // Placement-only patch at identical coordinates.
    const command = new WalkInputSchema({ moveX:127, moveZ:0, buttons:0, yaw:64, collisionRevision:1, placement:7 });
    const wire = new WalkInputSchema(); new Decoder(wire).decode(new Encoder(command).encodeAll());
    expect(wire.placement).toBe(7);
    wire.placement=NaN; sanitizeRealmWalkInput(wire); expect(wire.placement).toBe(0);
    const bad={moveX:127,moveZ:-128,buttons:255,yaw:Infinity,collisionRevision:NaN};sanitizeWalkInput(bad);
    expect(bad).toEqual({moveX:127,moveZ:-127,buttons:3,yaw:0,collisionRevision:0});
  });
});
