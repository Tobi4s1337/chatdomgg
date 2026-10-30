import { afterAll, expect, it } from 'vitest';
import { createServer as createNetServer } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import { KingdomRoomState, type WalkInput } from '@chatdom/shared/realm';
import { createRealmServer } from './server';
import { referenceServices } from './reference';

const rooms:Room<KingdomRoomState>[]=[];
let shutdown:(()=>Promise<void>)|undefined;
afterAll(async()=>{await Promise.all(rooms.map(r=>r.leave().catch(()=>{})));await shutdown?.();});
const waitFor=async(predicate:()=>boolean)=>{
  const end=Date.now()+8000;
  while(!predicate()){if(Date.now()>end)throw new Error('Room state did not arrive');await new Promise(r=>setTimeout(r,25));}
};
it('three real SDK clients share a k: room and authoritative movement, then reload with its colon-bearing token',async()=>{
  const probe=createNetServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const address=probe.address();if(!address||typeof address==='string')throw new Error('No test port');
  const port=address.port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const services=referenceServices(),{server}=createRealmServer(services);
  shutdown=()=>server.gracefullyShutdown(false);
  await server.listen(port,'127.0.0.1');
  const client=new Client(`http://127.0.0.1:${port}`);
  const joined=await Promise.all(Array.from({length:3},()=>client.joinOrCreate<KingdomRoomState>('kingdom',services.issue(),KingdomRoomState)));
  rooms.push(...joined);
  await waitFor(()=>joined.every(r=>r.state.walkers.size===3));
  expect(new Set(joined.map(r=>r.roomId))).toEqual(new Set(['k:999000001']));
  const a=joined[0]!,id=a.sessionId,x=a.state.walkers.get(id)!.x;
  const input=a.input<WalkInput>({mode:'reliable'});
  for(let n=0;n<12;n++){Object.assign(input.data,{moveX:127,moveZ:0,buttons:0,yaw:64,collisionRevision:1});input.send();await new Promise(r=>setTimeout(r,34));}
  await waitFor(()=>joined.every(r=>Math.abs((r.state.walkers.get(id)?.x??-100)-(x+12*4/30))<.001));
  const positions=joined.map(r=>r.state.walkers.get(id)!.x);expect(Math.max(...positions)-Math.min(...positions)).toBeLessThan(.01);
  const token=a.reconnectionToken;a.reconnection.enabled=false;
  await a.leave(false);
  const recovered=await client.reconnect<KingdomRoomState>(token,KingdomRoomState);rooms.push(recovered);
  await waitFor(()=>recovered.state.walkers.size===3);
  expect(recovered.sessionId).toBe(id);expect(recovered.state.walkers.get(id)!.x).toBeCloseTo(positions[0]!,5);
  let snapshot=false;recovered.onMessage('bootstrap',()=>{snapshot=true;});recovered.send('bootstrap');await waitFor(()=>snapshot);
},25000);
