import { describe, expect, it } from 'vitest';
import { Encoder, Decoder } from '@colyseus/schema';
import { RealmIntentSchema, RealmJoinSchema, kingdomRoomId } from './messages';
import { KingdomRoomState, WalkerSchema } from './schema';
import { sanitizeWalkInput } from './movement';

describe('realm wire boundary v1', () => {
  it('preserves large string kingdom IDs, denies claimed authority and transmits only the public schema', () => {
    expect(kingdomRoomId('9007199254740993123')).toBe('k:9007199254740993123');
    expect(() => kingdomRoomId('tobi4s_')).toThrow();
    const join = { kingdomId:'129634568',ticket:'opaque-session-ticket',protocol:1 };
    expect(RealmJoinSchema.safeParse(join).success).toBe(true);
    expect(RealmJoinSchema.safeParse({...join,personId:'123'}).success).toBe(false);
    expect(RealmIntentSchema.safeParse({version:1,id:'wish:1',type:'forge.wish',words:'a sleeping dragon'}).success).toBe(true);
    expect(RealmIntentSchema.safeParse({version:1,id:'wish:1',type:'forge.wish',words:'dragon',ownerId:'123',coal:3}).success).toBe(false);
    const state=new KingdomRoomState({kingdomId:join.kingdomId,writerEpoch:'epoch:1',origin:'simulated',layoutRevision:'layout:1',collisionRevision:1,factSequence:0});
    state.walkers.set('opaque-walker',new WalkerSchema({name:'Juniper',look:'hearth',district:'court',x:2,y:0,z:4,vx:0,vy:0,vz:0,grounded:true,yaw:128,distance:0,collisionRevision:1}));
    const copy=new KingdomRoomState();new Decoder(copy).decode(new Encoder(state).encodeAll());
    const json=JSON.stringify(copy.toJSON());
    expect(json).not.toMatch(/personId|coal|words|ticket|reservation|safetyIdentifier/);
    expect(copy.kingdomId).toBe(join.kingdomId);
    const bad={moveX:127,moveZ:-128,buttons:255,yaw:Infinity,collisionRevision:NaN};sanitizeWalkInput(bad);
    expect(bad).toEqual({moveX:127,moveZ:-127,buttons:3,yaw:0,collisionRevision:0});
  });
});
