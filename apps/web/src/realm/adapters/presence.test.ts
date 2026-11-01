import { afterEach, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PRESENCE_LEASE_MS } from '@chatdom/shared';
import { observeRealm, type RealmObservedRoom } from './observer';
import { createRoomPresenceFeed } from './presence';

afterEach(() => vi.useRealTimers());
it('holds only the original presence lease while the stream warms known replacement streets', () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000);
  const kingdomId=KingdomIdSchema.parse('999000001'), handlers=new Map<string,(payload:never)=>void>();
  const room:RealmObservedRoom={onMessage(type,receive){handlers.set(type,receive);return()=>{handlers.delete(type);};},send(){}};
  const emit=(type:string,payload:unknown)=>handlers.get(type)?.(payload as never);
  const observer=observeRealm(room,{kingdomId,origin:'simulated',collisionRevision:1});
  const seen=vi.fn(), gone=vi.fn();
  createRoomPresenceFeed(observer,'simulated',Date.now,true).subscribe(seen,gone);
  emit('bootstrap',{version:1,kingdomId,writerEpoch:'writer',throughCursor:1,layoutRevision:'layout',collisionRevision:1,current:[{type:'presence',frame:{version:1,kingdomId,origin:'simulated',epoch:'epoch',sequence:1,asOf:1_000,streamLive:true,connection:'fresh',windows:[{slot:1,present:true,since:1_000,publicName:'Juniper'}]}}]});
  expect(seen).toHaveBeenCalledOnce(); expect(gone).not.toHaveBeenCalled();
  emit('revision',{collisionRevision:2});
  expect(gone).not.toHaveBeenCalled();
  vi.advanceTimersByTime(PRESENCE_LEASE_MS);
  expect(gone).toHaveBeenCalledOnce();
  observer.dispose();
});
