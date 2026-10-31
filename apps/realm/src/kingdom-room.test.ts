import { afterAll, expect, it } from 'vitest';
import { createServer as createNetServer } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import { KingdomRoomState, RealmJoinSchema, type WalkInput } from '@chatdom/shared/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { connectRealm, type RealmClient } from '../../web/src/realm/client';
import { createRealmServer } from './server';
import { REFERENCE_KINGDOM, referenceServices } from './reference';
import { REALM_ROOM_LIMITS } from './limits';
import type { RealmRoomServices } from './ports';

const rooms:Room<KingdomRoomState>[]=[];
const adapters:RealmClient[]=[];
let shutdown:(()=>Promise<void>)|undefined;
afterAll(async()=>{for(const adapter of adapters)adapter.dispose();await Promise.all(rooms.map(r=>r.leave().catch(()=>{})));await shutdown?.();});
const waitFor=async(predicate:()=>boolean)=>{
  const end=Date.now()+8000;
  while(!predicate()){if(Date.now()>end)throw new Error('Room state did not arrive');await new Promise(r=>setTimeout(r,25));}
};
it('holds patch publication while authority opens slowly, then joins through the real transport',async()=>{
  const probe=createNetServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const address=probe.address();if(!address||typeof address==='string')throw new Error('No test port');
  await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const base=referenceServices();
  let release!:()=>void,opening=false,published=0;
  const openingGate=new Promise<void>(resolve=>{release=resolve;});
  const services:RealmRoomServices={auth:base.auth,open:async id=>{
    opening=true;await openingGate;
    const handle=await base.open(id);
    return {...handle,publishWalkers:()=>{published++;}};
  }};
  const {server}=createRealmServer(services);
  let room:Room<KingdomRoomState>|undefined;
  await server.listen(address.port,'127.0.0.1');
  const joining=new Client(`http://127.0.0.1:${address.port}`).joinOrCreate<KingdomRoomState>('kingdom',base.issue(),KingdomRoomState);
  try{
    await waitFor(()=>opening);
    // Several actual patch timers fire while onCreate is still waiting for its authority.
    await new Promise(resolve=>setTimeout(resolve,REALM_ROOM_LIMITS.patchMs*4));
    expect(published).toBe(0);
    release();room=await joining;
    await waitFor(()=>!!room!.state.walkers.get(room!.sessionId)&&published>0);
    expect(room.roomId).toBe('k:999000001');
  }finally{
    release();
    const joined=room??await joining.catch(()=>undefined);
    await joined?.leave();await server.gracefullyShutdown(false);
  }
});
it('three real SDK clients share movement and reload without reusing a single-use entry ticket',async()=>{
  const probe=createNetServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const address=probe.address();if(!address||typeof address==='string')throw new Error('No test port');
  const port=address.port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const services=referenceServices(),{server}=createRealmServer(services);
  shutdown=()=>server.gracefullyShutdown(false);
  await server.listen(port,'127.0.0.1');
  const endpoint=`http://127.0.0.1:${port}`, client=new Client(endpoint);
  const values=new Map<string,string>();
  const storage:Storage={get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);},removeItem:key=>{values.delete(key);},clear:()=>values.clear()};
  let issued=0;
  const entry={kingdomId:REFERENCE_KINGDOM,resumeScope:'reference-session-scope',ticket:async()=>{issued++;return RealmJoinSchema.parse(services.issue());}};
  const first=await connectRealm(endpoint,entry,REFERENCE_WORLD,storage);adapters.push(first);
  const joined=[first.room,...await Promise.all(Array.from({length:2},()=>client.joinOrCreate<KingdomRoomState>('kingdom',services.issue(),KingdomRoomState)))];
  rooms.push(...joined);
  await waitFor(()=>joined.every(r=>r.state.walkers.size===3));
  expect(new Set(joined.map(r=>r.roomId))).toEqual(new Set(['k:999000001']));
  const a=joined[0]!,id=a.sessionId,x=a.state.walkers.get(id)!.x;
  const input=a.input<WalkInput>({mode:'reliable'});
  for(let n=0;n<12;n++){Object.assign(input.data,{moveX:127,moveZ:0,buttons:0,yaw:64,collisionRevision:1});input.send();await new Promise(r=>setTimeout(r,34));}
  // The first two grounded ticks ramp through 4/3 and 8/3 m/s, then cruise at 4 m/s.
  await waitFor(()=>joined.every(r=>Math.abs((r.state.walkers.get(id)?.x??-100)-(x+44/30))<.001));
  const positions=joined.map(r=>r.state.walkers.get(id)!.x);expect(Math.max(...positions)-Math.min(...positions)).toBeLessThan(.01);
  a.reconnection.enabled=false;
  await a.leave(false);
  const resumed=await connectRealm(endpoint,entry,REFERENCE_WORLD,storage);adapters.push(resumed);
  const recovered=resumed.room;rooms.push(recovered);
  await waitFor(()=>recovered.state.walkers.size===3);
  expect(recovered.sessionId).toBe(id);expect(recovered.state.walkers.get(id)!.x).toBeCloseTo(positions[0]!,5);
  expect(issued).toBe(1);
  let snapshot=false;recovered.onMessage('bootstrap',()=>{snapshot=true;});recovered.send('bootstrap');await waitFor(()=>snapshot);
  // A stale saved reconnect must acquire a new one-use ticket, never replay the original join.
  const key=storage.key(0)!, expiredToken=recovered.reconnectionToken;
  resumed.dispose();await waitFor(()=>joined.slice(1).every(r=>r.state.walkers.size===2));
  storage.setItem(key,expiredToken);
  const fresh=await connectRealm(endpoint,entry,REFERENCE_WORLD,storage);adapters.push(fresh);rooms.push(fresh.room);
  await waitFor(()=>fresh.room.state.walkers.size===3);
  expect(issued).toBe(2);expect(fresh.selfId).not.toBe(id);
  // Changing the API session's opaque scope cannot resume the previous session's walker.
  const next=await connectRealm(endpoint,{...entry,resumeScope:'another-reference-session'},REFERENCE_WORLD,storage);adapters.push(next);rooms.push(next.room);
  expect(issued).toBe(3);expect(next.selfId).not.toBe(fresh.selfId);
},25000);
