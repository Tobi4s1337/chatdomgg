import type { PersonId } from '@chatdom/shared';
import type { PresenceBinding } from './presence';

/** Stable private presentation mapping. Caller persists new bindings before publishing; this grants no deed. */
export function assignPresenceSlot(bindings:readonly PresenceBinding[],personId:PersonId,available:readonly number[]):{bindings:readonly PresenceBinding[];slot:number|null} {
  if(new Set(bindings.map(b=>b.slot)).size!==bindings.length||new Set(bindings.map(b=>b.personId)).size!==bindings.length) throw new Error('Existing presence bindings are not unique');
  const slots=[...available].sort((a,b)=>a-b);
  if(slots.some(s=>!Number.isInteger(s)||s<0||s>65534)||new Set(slots).size!==slots.length) throw new Error('Invalid presentation slots');
  const existing=bindings.find(b=>b.personId===personId);if(existing)return {bindings,slot:existing.slot};
  const used=new Set(bindings.map(b=>b.slot)),slot=slots.find(s=>!used.has(s));
  if(slot===undefined)return {bindings,slot:null};
  return {bindings:[...bindings,{personId,slot}],slot};
}
