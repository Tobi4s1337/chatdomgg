import { createHash } from 'node:crypto';
import { PRESENCE_LEASE_MS, STREAM_LEASE_MS, type PersonId, type PresenceInput, type PresenceSource } from '@chatdom/shared';
import type { RealmCapability, RealmDomainCommand, RealmIngressCheckpoint, RealmIngressTransition, RealmPrivateState } from '@chatdom/shared/realm';
import { applyPresence, createPresenceState, projectPresence, type PresenceBinding } from '@chatdom/world';
import { decideRealm } from '@chatdom/world/realm';
import { REALM_BASE_ANVILS } from '../persistence/postgres-repository';
import { decodeIngressCheckpoint, encodeIngressCheckpoint, presencePerson, type EvidenceRun } from './codec';

/** A qualified stream night is this much evidenced presence (Tech.md, ChatDom.md: ten minutes, not ten samples). */
export const QUALIFIED_NIGHT_MS = 600_000;
/** The public crowd's ordering epoch. Frame sequence is the durable checkpoint revision, so it never repeats. */
export const presenceEpoch = (kingdomId: string) => `realm:${kingdomId}`;

export type IngressService = 'herald' | 'panel' | 'walker';
export interface PresenceTransitionInput {
  readonly service: IngressService;
  readonly observation: PresenceInput;
  /** Evidence runs survive only under the writer that observed them. */
  readonly writerEpoch: string;
}

type Planned = RealmIngressTransition['commands'][number];

/**
 * The private checkpoint transition the repository runs inside its fenced ingress transaction (spec 34 R7).
 *
 * The world presence reducer decides who is present; this adds what the realm must remember from it. Two real
 * observations of the same person by the same source, no more than one presence lease apart and inside the current
 * stream night, close one evidenced interval. Nothing else does: no sample counting, no open interval carried across a
 * gap, a complete roster that omits someone, a moderation hold, the stream going offline or a writer restart. The
 * reducer unions those intervals, so overlap from several sources or a retried observation never adds time. Once a
 * person's union reaches ten minutes and they hold a home here, the same transaction credits that night's coal.
 *
 * Every command is simulated against the reducer first and only proposed if it would be accepted, so the repository's
 * authoritative run records facts rather than a trail of predictable refusals. The function is pure: same state,
 * checkpoint, time and observation give the same commands, IDs, bytes and frame.
 */
export function presenceTransition({ service, observation, writerEpoch }: PresenceTransitionInput) {
  return (state: RealmPrivateState, checkpoint: RealmIngressCheckpoint | null, now: number): RealmIngressTransition => {
    const prior = checkpoint ? decodeIngressCheckpoint(checkpoint, state.kingdomId, state.origin) : null;
    const before = prior?.presence ?? createPresenceState(state.kingdomId, state.origin);
    const at = Math.max(now, before.asOf);
    const presence = applyPresence(before, observation, at);
    const receipt = `${service}:${observation.id}`;
    const runs = new Map<string, EvidenceRun>();
    if (prior && prior.writerEpoch === writerEpoch) for (const run of prior.runs) runs.set(runKey(run.source, run.personId), run);

    let s = state;
    const commands: Planned[] = [];
    const propose = (command: RealmDomainCommand, commandId: string, capability: RealmCapability = 'presence') => {
      const decision = decideRealm(s, command, { now, writerEpoch, commandId, capability, current: true, anvilCapacity: REALM_BASE_ANVILS,
        occurredAt: observation.observedAt, receivedAt: now, actor: null, cause: { kind: 'external', source: service, id: observation.id } });
      if (decision.kind !== 'accepted') return false;
      s = decision.state;
      commands.push({ command, capability, commandId });
      return true;
    };

    if (observation.kind === 'stream' && presence.stream && presence.stream.observedAt === observation.observedAt && presence !== before) {
      if (observation.live) {
        const sessionId = presence.stream.sessionId!;
        const startedAt = s.stream.sessionId === sessionId ? s.stream.startedAt : presence.stream.startedAt;
        const liveUntil = observation.observedAt + STREAM_LEASE_MS;
        if (s.stream.sessionId !== sessionId || liveUntil > s.stream.liveUntil) {
          propose({ type: 'stream.observe', sessionId, startedAt, liveUntil }, commandId('stream', receipt));
        }
      } else {
        if (s.stream.sessionId !== null) propose({ type: 'stream.observe', sessionId: null, startedAt: observation.observedAt, liveUntil: 0 }, commandId('stream', receipt));
        runs.clear();
      }
    }

    const touched = new Set<PersonId>();
    if (observation.kind === 'remove') for (const key of [...runs.keys()]) if (runs.get(key)!.personId === observation.personId) runs.delete(key);
    if (observation.kind === 'observe') {
      const source = observation.source, t = observation.observedAt;
      if (observation.coverage === 'complete') {
        const seen = new Set(observation.people.map(p => p.personId));
        for (const [key, run] of runs) if (run.source === source && !seen.has(run.personId)) runs.delete(key);
      }
      const night = s.stream.sessionId;
      for (const { personId } of observation.people) {
        const key = runKey(source, personId), run = runs.get(key);
        // Only an observation the presence reducer actually took counts (not held, restricted, reordered or expired).
        const taken = presencePerson(presence, personId)?.sourceTimes[source] === t;
        if (!taken || night === null || t < s.stream.startedAt || t > s.stream.liveUntil) { if (night === null) runs.delete(key); continue; }
        if (run && run.last >= t) continue;
        touched.add(personId);
        if (run && run.sessionId === night && t - run.last <= PRESENCE_LEASE_MS) {
          const covered = s.qualification[`${personId}:${night}`]?.coveredMs ?? 0;
          if (covered < QUALIFIED_NIGHT_MS) propose({ type: 'presence.confirmInterval', personId, streamSessionId: night, from: run.last, through: t, evidenceReceipt: receipt },
            commandId('interval', `${receipt}|${personId}`));
        }
        runs.set(key, { source, personId, sessionId: night, last: t });
      }
    }
    for (const personId of [...touched].sort()) {
      const night = s.stream.sessionId, key = `${personId}:${night}`;
      if (night === null || s.creditedNights[key] || (s.qualification[key]?.coveredMs ?? 0) < QUALIFIED_NIGHT_MS) continue;
      if (!Object.values(s.homes).some(home => home.ownerId === personId)) continue;
      propose({ type: 'coal.creditQualifiedNight', personId, streamSessionId: night, qualificationReceipt: receipt }, commandId('night', key));
    }

    // Lit windows are owned homes. A visual slot is never a deed; it only shows a deed that already exists.
    const bindings: PresenceBinding[] = Object.values(s.homes).map(home => ({ personId: home.ownerId, slot: home.slot })).sort((a, b) => a.slot - b.slot);
    const revision = (checkpoint?.revision ?? 0) + 1;
    return {
      checkpoint: { version: 1, revision, codec: 'presence-v1', data: encodeIngressCheckpoint({ presence, writerEpoch, runs: [...runs.values()] }) },
      commands,
      presence: projectPresence(presence, bindings, at, revision, presenceEpoch(state.kingdomId)),
    };
  };
}

const runKey = (source: PresenceSource, personId: string) => `${source}\u0000${personId}`;
/** Stable, bounded command IDs: a retried observation proposes the same IDs and hits the stored outcome. */
const commandId = (kind: string, key: string) => `${kind}:${createHash('sha256').update(key).digest('hex').slice(0, 40)}`;
