import {expect,it} from 'vitest';
import {PersonIdSchema} from '@chatdom/shared';
import {assignPresenceSlot} from './presence-slots';
it('assigns only supplied slots, preserves a returning person and reports capacity',()=>{
 const a=PersonIdSchema.parse('1'),b=PersonIdSchema.parse('2');
 const first=assignPresenceSlot([],a,[1024]);expect(first.slot).toBe(1024);
 expect(assignPresenceSlot(first.bindings,a,[1024,2048]).bindings).toBe(first.bindings);
 expect(assignPresenceSlot(first.bindings,b,[1024]).slot).toBeNull();
 expect(assignPresenceSlot(first.bindings,b,[1024,2048]).slot).toBe(2048);
});
