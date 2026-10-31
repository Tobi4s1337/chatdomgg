import { expect, it } from 'vitest';
import { PersonIdSchema } from '@chatdom/shared';
import { REALM_CASTLE_SLOT, type RealmOwnedCastle } from '@chatdom/shared/realm';
import { VOXEL_FIXTURE, WORLD_FIXTURE_KINGDOM as kingdomId, WORLD_FIXTURE_PERSON as personId } from '@chatdom/shared/world-fixtures';
import type { RealmCapability, RealmDomainCommand, RealmFact, RealmForgeReservation, ForgeAttachment } from '@chatdom/shared/realm';
import { applyRealmFact, createRealmState, decideRealm } from './reducer';

it('one owned, qualified night reserves and spends once; replay preserves private provenance and displaced work', () => {
  let state=createRealmState(kingdomId,'live');let now=1000;
  const facts:RealmFact[]=[];
  const decide=(command:RealmDomainCommand,capability:RealmCapability)=>decideRealm(state,command,{now,writerEpoch:'writer:1',commandId:`cmd:${state.sequence+1}`,capability,current:true,anvilCapacity:2});
  const commit=(command:RealmDomainCommand,capability:RealmCapability)=>{
    const result=decide(command,capability);expect(result.kind).toBe('accepted');
    if(result.kind!=='accepted')throw new Error('Expected accepted');state=result.state;facts.push(result.fact);return result;
  };
  const home={id:'plot:1',ownerId:personId,slot:0,allocationReceipt:'allocation:1',layoutRevision:'founded:1',revision:'home:1',digest:'a'.repeat(64),family:'hearth' as const,blueprint:VOXEL_FIXTURE,attribution:{makerName:'Juniper',kingdomName:'Emberwick',approvalId:'names:1'},attachments:{}};
  expect(decide({type:'home.installAllocated',home},'forge').kind).toBe('rejected');
  commit({type:'home.installAllocated',home},'allocation');
  commit({type:'citizen.rights',personId,rights:{revision:1,forge:true,build:true,blocked:false,safetyIdentifier:'opaque-safety'}},'moderation');
  commit({type:'stream.observe',sessionId:'night:1',startedAt:1000,liveUntil:2_000_000},'presence');
  const credit={type:'coal.creditQualifiedNight' as const,personId,streamSessionId:'night:1',qualificationReceipt:'qualified:1'};
  expect(decide(credit,'presence').kind).toBe('rejected');
  now=601000;
  // Out-of-order overlapping source evidence is a union, not a count of samples or duplicate minutes.
  for(const [from,through] of [[301000,601000],[1000,301000],[2000,500000]])commit({type:'presence.confirmInterval',personId,streamSessionId:'night:1',from:from!,through:through!,evidenceReceipt:`interval:${from}`},'presence');
  expect(state.qualification[`${personId}:night:1`]?.coveredMs).toBe(600000);
  commit(credit,'presence');expect(decide(credit,'presence').kind).toBe('unchanged');
  const record:RealmForgeReservation={attempt:{key:'wish:1',attemptId:'attempt:1'},homeId:home.id,homeDigest:home.digest,streamSessionId:'night:1',rightsRevision:1,
    reservation:{reservationId:'reserve:1',kingdomId,personId,slot:0,revision:home.revision,family:'hearth',home:home.blueprint,safetyIdentifier:'opaque-safety',expiresAt:1_000_000,attribution:home.attribution}};
  commit({type:'forge.reserve',record},'forge');expect(state.coals[personId]).toBe(1);
  expect(decide({type:'forge.reserve',record:{...record,attempt:{...record.attempt,attemptId:'other'}}},'forge')).toMatchObject({kind:'rejected',reason:'held'});
  const attachment:ForgeAttachment={version:1,id:'run:1',runId:'run:1',kingdomId,slot:0,hostId:home.blueprint.id,hostFingerprint:'fingerprint',socketId:'chimney',origin:[0,24,0],kitId:'hearth',kitRevision:1,family:'hearth',draft:{plan:{version:2,kind:'chimney',motif:'sleeping-dragon',finish:'native',accent:'none'},title:'A sleeping dragon',plaque:'Warm dreams'},provenance:{source:'live',makerName:'Juniper',kingdomName:'Emberwick',designId:'design:1'}};
  const command:RealmDomainCommand={type:'forge.commitApproved',attempt:record.attempt,reservationId:'reserve:1',expectedRevision:home.revision,expectedHomeDigest:home.digest,attachment:Object.assign(attachment,{words:'PRIVATE EXTRA'}),creation:{words:'PRIVATE WISH'},approvalReceipt:'judges:1'};
  expect(decide({...command,expectedHomeDigest:'b'.repeat(64)},'forge').kind).toBe('rejected');
  const result=commit(command,'forge');expect(state.coals[personId]).toBe(0);
  expect(JSON.stringify(result.public)).not.toMatch(/PRIVATE|personId|safetyIdentifier/);
  expect(decide(command,'forge').kind).toBe('unchanged');
  expect(decide({type:'forge.release',attempt:record.attempt},'forge').kind).toBe('unchanged');
  expect(state.attachments['run:1']?.creation.words).toBe('PRIVATE WISH');
  commit({type:'home.replaceApproved',homeId:home.id,expectedRevision:state.homes[home.id]!.revision,home:{...home,revision:'house:2',digest:'c'.repeat(64)},approvalReceipt:'build:2',attachments:[{id:'run:1',placement:null}]},'publication');
  expect(state.attachments['run:1']?.attached).toBe(false);
  expect(facts.reduce(applyRealmFact,createRealmState(kingdomId,'live'))).toEqual(state);
  const legacy = createRealmState(kingdomId, 'live'); Reflect.deleteProperty(legacy, 'castle');
  expect(facts.reduce(applyRealmFact, legacy)).toEqual(state);
  expect(()=>applyRealmFact(createRealmState(kingdomId,'live'),facts.at(-1)!)).toThrow('continuity');
});


it('the monarch earns the same evidenced coal and forges on their singleton castle without a street deed', () => {
  let state = createRealmState(kingdomId, 'live'), now = 1_000;
  const monarch = PersonIdSchema.parse(kingdomId), facts: RealmFact[] = [];
  const decide = (command: RealmDomainCommand, capability: RealmCapability) => decideRealm(state, command,
    { now, writerEpoch: 'castle-writer', commandId: `castle:${state.sequence + 1}`, capability, current: true, anvilCapacity: 2 });
  const commit = (command: RealmDomainCommand, capability: RealmCapability) => {
    const result = decide(command, capability);
    expect(result.kind).toBe('accepted');
    if (result.kind !== 'accepted') throw new Error('Expected accepted castle command');
    state = result.state; facts.push(result.fact); return result;
  };
  const castle: RealmOwnedCastle = { id: 'castle:keep:1', moduleId: 'keep:1', ownerId: monarch, slot: REALM_CASTLE_SLOT,
    layoutRevision: 'founded:1', revision: 'keep:1', digest: 'a'.repeat(64), family: 'hearth', blueprint: { ...VOXEL_FIXTURE, id: 'fixture:keep', kind: 'civic' },
    attribution: { makerName: 'Tobias', kingdomName: 'Emberwick', approvalId: 'names:castle' }, attachments: {} };
  expect(state.castle).toBeNull();
  expect(decide({ type: 'castle.installNative', castle: { ...castle, ownerId: personId } }, 'allocation')).toMatchObject({ kind: 'rejected', reason: 'conflict' });
  expect(decide({ type: 'castle.installNative', castle: { ...castle, id: 'plot:fake' } }, 'allocation').kind).toBe('rejected');
  expect(decide({ type: 'home.installAllocated', home: { ...castle, allocationReceipt: 'fake-deed' } }, 'allocation').kind).toBe('rejected');
  expect(decide({ type: 'home.installAllocated', home: { ...castle, slot: 7, allocationReceipt: 'fake-deed' } }, 'allocation').kind).toBe('rejected');
  expect(decide({ type: 'castle.installNative', castle: Object.assign({}, castle, { allocationReceipt: 'fake-deed' }) }, 'allocation').kind).toBe('rejected');
  const installed = commit({ type: 'castle.installNative', castle: Object.assign({}, castle, { privateExtra: 'PRIVATE OWNER' }) }, 'allocation');
  expect(installed.public).toEqual([{ type: 'castle', moduleId: 'keep:1', revision: 'keep:1', assetHash: castle.digest, attachments: [] }]);
  expect(decide({ type: 'castle.installNative', castle }, 'allocation').kind).toBe('rejected');
  expect(state.homes).toEqual({}); expect(state.coals[monarch]).toBeUndefined();
  commit({ type: 'citizen.rights', personId: monarch, rights: { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: 'opaque-monarch-safety' } }, 'moderation');
  commit({ type: 'stream.observe', sessionId: 'night:castle', startedAt: now, liveUntil: 2_000_000 }, 'presence');
  const credit: RealmDomainCommand = { type: 'coal.creditQualifiedNight', personId: monarch, streamSessionId: 'night:castle', qualificationReceipt: 'observed:castle' };
  const record: RealmForgeReservation = { attempt: { key: 'wish:castle', attemptId: 'attempt:castle' }, homeId: castle.id,
    homeDigest: castle.digest, rightsRevision: 1, streamSessionId: 'night:castle', reservation: { reservationId: 'reserved:castle',
      kingdomId, personId: monarch, slot: REALM_CASTLE_SLOT, revision: castle.revision, family: castle.family, hostProfile: 'castle-keep',
      home: castle.blueprint, safetyIdentifier: 'opaque-monarch-safety', expiresAt: 1_000_000, attribution: castle.attribution } };
  expect(decide(credit, 'presence')).toMatchObject({ kind: 'rejected', reason: 'held' });
  expect(decide({ type: 'forge.reserve', record }, 'forge')).toMatchObject({ kind: 'rejected', reason: 'held' });
  now = 600_999;
  commit({ type: 'presence.confirmInterval', personId: monarch, streamSessionId: 'night:castle', from: 1_000, through: now, evidenceReceipt: 'actual:1' }, 'presence');
  expect(decide(credit, 'presence')).toMatchObject({ kind: 'rejected', reason: 'held' });
  now++;
  commit({ type: 'presence.confirmInterval', personId: monarch, streamSessionId: 'night:castle', from: 600_000, through: now, evidenceReceipt: 'actual:2' }, 'presence');
  expect(state.qualification[`${monarch}:night:castle`]?.coveredMs).toBe(600_000);
  commit(credit, 'presence');
  expect(state.coals[monarch]).toBe(1); expect(decide(credit, 'presence').kind).toBe('unchanged');
  expect(decide({ type: 'forge.reserve', record: { ...record, reservation: { ...record.reservation, hostProfile: 'street-home' } } }, 'forge').kind).toBe('rejected');
  commit({ type: 'forge.reserve', record }, 'forge');
  const attachment: ForgeAttachment = { version: 1, id: 'run:castle', runId: 'run:castle', kingdomId, slot: REALM_CASTLE_SLOT,
    hostId: castle.blueprint.id, hostProfile: 'castle-keep', hostFingerprint: 'keep-fingerprint', socketId: 'roof-chimney', origin: [100, 170, 100],
    kitId: 'hearth-native', kitRevision: 1, family: castle.family,
    draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' }, title: 'The sleeping dragon', plaque: 'Warm dreams over the keep.' },
    provenance: { source: 'live', makerName: 'Tobias', kingdomName: 'Emberwick', designId: 'design:castle' } };
  const command: RealmDomainCommand = { type: 'forge.commitApproved', attempt: record.attempt, reservationId: record.reservation.reservationId,
    expectedRevision: castle.revision, expectedHomeDigest: castle.digest, attachment: Object.assign({}, attachment, { privateExtra: 'PRIVATE WORDS' }),
    creation: { words: 'PRIVATE WISH' }, approvalReceipt: 'actual-dual-judge-receipt' };
  expect(decide({ ...command, attachment: { ...attachment, hostProfile: 'street-home' } }, 'forge').kind).toBe('rejected');
  const result = commit(command, 'forge');
  expect(state.homes).toEqual({}); expect(state.coals[monarch]).toBe(0);
  expect(state.castle).toMatchObject({ id: castle.id, attachments: { 'roof-chimney': 'run:castle' } });
  expect(state.castle?.revision).not.toBe(castle.revision);
  expect(state.attachments['run:castle']?.attachment.hostProfile).toBe('castle-keep');
  expect(JSON.stringify(result.public)).not.toMatch(/PRIVATE|ownerId|personId|safetyIdentifier|approvalReceipt/);
  expect(decide(command, 'forge').kind).toBe('unchanged');
  expect(facts.reduce(applyRealmFact, createRealmState(kingdomId, 'live'))).toEqual(state);
  const legacy = createRealmState(kingdomId, 'live'); Reflect.deleteProperty(legacy, 'castle');
  expect(applyRealmFact(legacy, facts[0]!).castle).toMatchObject(castle);
});
