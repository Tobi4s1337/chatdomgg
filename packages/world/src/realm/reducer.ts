import type { RealmCapability, RealmDecision, RealmDecisionContext, RealmDomainCommand, RealmFact, RealmForgeReservation, RealmPrivateState, RealmPublicMessage } from '@chatdom/shared/realm';
import { ForgeDraftSchema, type KingdomId } from '@chatdom/shared';

const capability: Record<RealmDomainCommand['type'], RealmCapability> = {
  'stream.observe': 'presence', 'citizen.rights': 'moderation', 'home.installAllocated': 'allocation',
  'home.replaceApproved': 'publication', 'coal.creditQualifiedNight': 'presence',
  'presence.confirmInterval': 'presence',
  'forge.reserve': 'forge', 'forge.release': 'forge', 'forge.commitApproved': 'forge',
};
const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined;
const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));

export function createRealmState(kingdomId: KingdomId, origin: 'live' | 'simulated'): RealmPrivateState {
  return { version: 1, kingdomId, origin, sequence: 0, stream: { sessionId: null, startedAt: 0, liveUntil: 0 }, rights: {}, homes: {}, coals: {}, reservations: {}, forgeOutcomes: {}, attachments: {}, creditedNights: {}, qualification: {} };
}

/** Pure intent -> facts. Only a fenced room may commit these proposals; clients never submit internal commands. */
export function decideRealm(s: RealmPrivateState, c: RealmDomainCommand, ctx: RealmDecisionContext): RealmDecision {
  const reject = (reason: 'cold' | 'held' | 'conflict' | 'forbidden'): RealmDecision => ({ kind: 'rejected', reason });
  const same: RealmDecision = { kind: 'unchanged', reason: 'duplicate' };
  if (!ctx.current || !Number.isSafeInteger(ctx.now) || ctx.now < 0) return reject('cold');
  if ((ctx.receivedAt ?? ctx.now) > ctx.now) return reject('conflict');
  if (ctx.capability !== capability[c.type]) return reject('forbidden');
  switch (c.type) {
    case 'stream.observe': {
      // A trusted source loss can shorten the existing night without inventing an offline event.
      const shortening = c.sessionId !== null && c.sessionId === s.stream.sessionId && c.startedAt === s.stream.startedAt
        && c.liveUntil >= s.stream.startedAt && c.liveUntil < s.stream.liveUntil;
      if (!Number.isSafeInteger(c.liveUntil) || c.liveUntil < 0 || (c.sessionId === null && c.liveUntil !== 0)
        || (c.sessionId !== null && c.liveUntil <= ctx.now && !shortening)) return reject('conflict');
      if (!Number.isSafeInteger(c.startedAt) || c.startedAt < 0 || c.startedAt > ctx.now
        || (c.sessionId !== null && c.sessionId === s.stream.sessionId && c.startedAt !== s.stream.startedAt)) return reject('conflict');
      break;
    }
    case 'citizen.rights': {
      if (!Number.isSafeInteger(c.rights.revision) || c.rights.revision <= (own(s.rights, c.personId)?.revision ?? -1)) return reject('conflict');
      break;
    }
    case 'home.installAllocated':
      if (!c.home.allocationReceipt || !c.home.attribution.approvalId || !/^[a-f0-9]{64}$/.test(c.home.digest)
        || Object.values(s.homes).some(h => h.id === c.home.id || h.ownerId === c.home.ownerId || h.slot === c.home.slot)) return reject('conflict');
      break;
    case 'home.replaceApproved': {
      const h = own(s.homes, c.homeId);
      const rights = h ? own(s.rights, h.ownerId) : undefined;
      if (!rights?.build || rights.blocked) return reject('forbidden');
      if (!h || h.revision !== c.expectedRevision || c.home.revision === h.revision || !c.approvalReceipt
        || c.home.id !== h.id || c.home.ownerId !== h.ownerId || c.home.slot !== h.slot
        || c.home.allocationReceipt !== h.allocationReceipt || c.home.layoutRevision !== h.layoutRevision
        || !/^[a-f0-9]{64}$/.test(c.home.digest)) return reject('conflict');
      const existing = Object.values(h.attachments), fitted: Record<string,string> = {};
      if(c.attachments.length!==existing.length || new Set(c.attachments.map(a=>a.id)).size!==existing.length) return reject('conflict');
      for(const item of c.attachments){
        if(!existing.includes(item.id))return reject('conflict');
        if(item.placement){
          if(item.placement.hostId!==c.home.blueprint.id || fitted[item.placement.socketId])return reject('conflict');
          fitted[item.placement.socketId]=item.id;
        }
      }
      if(Object.keys(c.home.attachments).length!==Object.keys(fitted).length||Object.entries(fitted).some(([slot,id])=>own(c.home.attachments,slot)!==id))return reject('conflict');
      break;
    }
    case 'coal.creditQualifiedNight':
      if (!c.qualificationReceipt || !c.streamSessionId) return reject('forbidden');
      if (!Object.values(s.homes).some(home=>home.ownerId===c.personId)) return reject('forbidden');
      if (own(s.creditedNights, `${c.personId}:${c.streamSessionId}`)) return same;
      if ((own(s.qualification, `${c.personId}:${c.streamSessionId}`)?.coveredMs ?? 0) < 600_000) return reject('held');
      break;
    case 'presence.confirmInterval':
      if (!c.evidenceReceipt || !Number.isSafeInteger(c.from) || !Number.isSafeInteger(c.through)
        || c.from < s.stream.startedAt || c.through <= c.from || c.through > ctx.now
        || c.through > s.stream.liveUntil || c.streamSessionId !== s.stream.sessionId) return reject('conflict');
      break;
    case 'forge.reserve': {
      const r = c.record, a = r.attempt, reservation = r.reservation;
      if (own(s.forgeOutcomes,a.key))return same;
      if (Object.values(s.attachments).some(v => v.forgeKey === a.key)) return same;
      const prior = own(s.reservations, a.key);
      if (prior) return prior.attempt.attemptId === a.attemptId ? same : reject('held');
      if (!validReservation(s, r, ctx.now) || reservation.expiresAt <= ctx.now) return reject('cold');
      const active = Object.values(s.reservations).filter(v => v.reservation.expiresAt > ctx.now);
      if (active.some(v => v.reservation.personId === reservation.personId)
        || active.length >= ctx.anvilCapacity || (own(s.coals, reservation.personId) ?? 0) < 1) return reject('held');
      break;
    }
    case 'forge.release': {
      const r = own(s.reservations, c.attempt.key);
      if (!r || r.attempt.attemptId !== c.attempt.attemptId) return same;
      break;
    }
    case 'forge.commitApproved': {
      if (Object.values(s.attachments).some(v => v.forgeKey === c.attempt.key)) return same;
      const r = own(s.reservations, c.attempt.key);
      if (!r || r.attempt.attemptId !== c.attempt.attemptId || r.reservation.reservationId !== c.reservationId) return reject('conflict');
      if (!validReservation(s, r, ctx.now) || r.reservation.expiresAt <= ctx.now) return reject('cold');
      const h = own(s.homes, r.homeId)!;
      if (!ForgeDraftSchema.safeParse(c.attachment.draft).success) return reject('conflict');
      if (h.revision !== c.expectedRevision || h.digest !== c.expectedHomeDigest
        || !c.approvalReceipt || !c.creation.words.trim() || c.creation.words.length > 240
        || c.attachment.kingdomId !== s.kingdomId || c.attachment.provenance.source !== s.origin || own(s.attachments, c.attachment.id)
        || c.attachment.slot !== h.slot || c.attachment.hostId !== h.blueprint.id || c.attachment.family !== h.family
        || c.attachment.provenance.makerName !== h.attribution.makerName || c.attachment.provenance.kingdomName !== h.attribution.kingdomName
        || (own(s.coals, h.ownerId) ?? 0) < 1
        || Object.values(s.attachments).some(v => v.attachment.provenance.designId === c.attachment.provenance.designId)) return reject('conflict');
      break;
    }
  }
  const fact: RealmFact = { version: 1, kingdomId: s.kingdomId, writerEpoch: ctx.writerEpoch, seq: s.sequence + 1,
    occurredAt: ctx.occurredAt ?? ctx.now, receivedAt: ctx.receivedAt ?? ctx.now, committedAt: ctx.now,
    origin: s.origin, type: 'realm.transaction', actor: ctx.actor ?? null, cause: ctx.cause ?? { kind: 'intent', id: ctx.commandId }, body: c };
  const state = applyRealmFact(s, fact);
  return { kind: 'accepted', fact, state, public: projectRealmFact(state, fact) };
}

function validReservation(s: RealmPrivateState, r: RealmForgeReservation, now: number): boolean {
  const h = own(s.homes, r.homeId), rights = own(s.rights, r.reservation.personId), v = r.reservation;
  return !!(h && rights && rights.forge && !rights.blocked && rights.revision === r.rightsRevision
    && rights.safetyIdentifier === v.safetyIdentifier && h.ownerId === v.personId && v.kingdomId === s.kingdomId
    && h.revision === v.revision && h.digest === r.homeDigest && h.slot === v.slot && h.family === v.family
    && h.blueprint.id === v.home.id && h.attribution.approvalId === v.attribution.approvalId
    && s.stream.sessionId !== null && s.stream.sessionId === r.streamSessionId && s.stream.liveUntil > now);
}

/** Replay committed facts only; gaps/cross-kingdom facts fail loudly. No clocks or external services. */
export function applyRealmFact(s: RealmPrivateState, f: RealmFact): RealmPrivateState {
  if (f.version !== 1 || f.kingdomId !== s.kingdomId || f.seq !== s.sequence + 1 || f.origin !== s.origin) throw new Error('Realm fact continuity mismatch');
  const c = f.body, next = { ...s, sequence: f.seq };
  switch (c.type) {
    case 'stream.observe': return { ...next, stream: { sessionId: c.sessionId, startedAt: c.startedAt, liveUntil: c.liveUntil } };
    case 'citizen.rights': return { ...next, rights: { ...s.rights, [c.personId]: c.rights } };
    case 'home.installAllocated': return { ...next, homes: { ...s.homes, [c.home.id]: c.home } };
    case 'home.replaceApproved': {
      const attachments = {...s.attachments};
      for(const disposition of c.attachments){
        const prior=attachments[disposition.id]!;
        const p=disposition.placement;
        attachments[disposition.id]={...prior,attached:p!==null,attachment:p?{...prior.attachment,hostId:p.hostId,hostFingerprint:p.hostFingerprint,socketId:p.socketId,origin:[p.origin[0],p.origin[1],p.origin[2]]}:prior.attachment};
      }
      return { ...next, homes: { ...s.homes, [c.homeId]: c.home }, attachments };
    }
    case 'coal.creditQualifiedNight': return { ...next, coals: { ...s.coals, [c.personId]: Math.min(3, (own(s.coals, c.personId) ?? 0) + 1) }, creditedNights: { ...s.creditedNights, [`${c.personId}:${c.streamSessionId}`]: true } };
    case 'presence.confirmInterval': {
      const key = `${c.personId}:${c.streamSessionId}`, prior = own(s.qualification, key);
      if ((prior?.coveredMs ?? 0) >= 600_000) return next;
      const merged: [number, number][] = [];
      const intervals = [...(prior?.intervals ?? []), [c.from, c.through] as const].sort((a, b) => a[0] - b[0]);
      for (const interval of intervals) {
        const last = merged.at(-1);
        if (last && last[1] >= interval[0]) last[1] = Math.max(last[1], interval[1]);
        else merged.push([interval[0], interval[1]]);
      }
      const coveredMs = merged.reduce((total, [from, through]) => total + through - from, 0);
      return { ...next, qualification: { ...s.qualification, [key]: { intervals: coveredMs >= 600_000 ? [] : merged, coveredMs } } };
    }
    case 'forge.reserve': return { ...next, reservations: { ...s.reservations, [c.record.attempt.key]: c.record } };
    case 'forge.release': return { ...next, reservations: without(s.reservations, c.attempt.key),forgeOutcomes:{...s.forgeOutcomes,[c.attempt.key]:{attemptId:c.attempt.attemptId,status:'released'}} };
    case 'forge.commitApproved': {
      const r = own(s.reservations, c.attempt.key)!;
      const h = own(s.homes, r.homeId)!;
      const v=c.attachment;
      // Explicit public projection: private extra fields can never leak through an object spread.
      const attachment = { version:1 as const,id:v.id,runId:v.runId,kingdomId:v.kingdomId,slot:v.slot,hostId:v.hostId,
        hostFingerprint:v.hostFingerprint,socketId:v.socketId,origin:[v.origin[0],v.origin[1],v.origin[2]] as const,
        kitId:v.kitId,kitRevision:v.kitRevision,family:v.family,draft:ForgeDraftSchema.parse(v.draft),committedAt:f.committedAt,
        provenance:{source:v.provenance.source,makerName:v.provenance.makerName,kingdomName:v.provenance.kingdomName,designId:v.provenance.designId,firstForgedAt:f.committedAt}};
      const previousId = own(h.attachments, attachment.socketId), previous = previousId ? own(s.attachments, previousId) : undefined;
      return { ...next,
        coals: { ...s.coals, [h.ownerId]: own(s.coals, h.ownerId)! - 1 },
        reservations: without(s.reservations, c.attempt.key),
        forgeOutcomes:{...s.forgeOutcomes,[c.attempt.key]:{attemptId:c.attempt.attemptId,status:'committed'}},
        homes: { ...s.homes, [h.id]: { ...h, revision: `r${f.seq}`, attachments: { ...h.attachments, [attachment.socketId]: attachment.id } } },
        attachments: { ...s.attachments, ...(previous && previousId ? { [previousId]: { ...previous, attached: false } } : {}),
          [attachment.id]: { forgeKey: c.attempt.key, ownerId: h.ownerId, homeId: h.id, attached: true, attachment, creation: c.creation, approvalReceipt: c.approvalReceipt } },
      };
    }
  }
}

/** Public allowlist. A raw fact includes private ownership/words; it is never a broadcast payload. */
export function projectRealmFact(s: RealmPrivateState, f: RealmFact): readonly RealmPublicMessage[] {
  const c = f.body;
  if (c.type === 'forge.commitApproved') return [{ type: 'forge', event: { type: 'committed', activityId: c.attempt.attemptId, attachment: s.attachments[c.attachment.id]!.attachment } }];
  if (c.type === 'home.replaceApproved') return [{ type: 'home', plotId: c.homeId, revision: c.home.revision, assetHash: c.home.digest,attachments:Object.values(c.home.attachments).map(id=>s.attachments[id]!.attachment) }];
  return [];
}
