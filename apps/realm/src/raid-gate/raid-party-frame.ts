/**
 * The gate party's public frame, built from the gate's own records (RS11). Pure and free of Node: the realm's reader
 * builds it from Postgres rows, and the private road bench builds it from the same application's memory records, so
 * the stream, a walker and the bench are told one thing by one rule.
 */
import { PersonIdSchema, RAID_PARTY_DRAWN, RaidPartyPublicFrameSchema, starterCitizenLook,
  type KingdomId, type PersonId, type RaidPartyMarcher, type RaidPartyPublicFrame } from '@chatdom/shared';
import { GATE_LIMITS } from '../../../api/src/raid-gate/contracts';
import type { PartyMemberRecord, RaidActionRecord } from '../../../api/src/raid-gate/repository';

/** How long the witnessed set-out stays on the gate: the column walks out and the road takes it. */
export const RAID_PARTY_SETOUT_MS = 45_000;
/** A dispatched start Twitch has not answered for this long is told as "checking", never as gathering. */
const DISPATCH_QUIET_MS = 30_000;
const NAME = /^[^\p{Cc}\p{Cf}\p{Cs}]{1,64}$/u;
const LOGIN = /^[a-z0-9_]{1,64}$/u;
const RAID_ID = /^raid\.[a-f0-9]{64}$/u;
const WALKER = /^[A-Za-z0-9_-]{1,64}$/u;

type Phase = RaidPartyPublicFrame['phase'];
export type RaidPartyFace = { login: string | null; name: string | null };

/** The phase a viewer is told, or null when this action is no party at all. Mirrors the gate application's view. */
export function partyPhase(action: RaidActionRecord, now: number): Phase | null {
  switch (action.state) {
    case 'prepared': return action.endReason === null && now < action.previewExpiresAt ? 'gather' : null;
    case 'dispatching': return now < action.observedAt + DISPATCH_QUIET_MS ? 'gather' : now < action.observedAt + GATE_LIMITS.unknownHoldMs ? 'checking' : null;
    case 'pending': {
      const ends = action.acceptedAt! + GATE_LIMITS.twitchCountdownMs;
      if (now < ends) return 'countdown';
      return now < ends + GATE_LIMITS.observationGraceMs + GATE_LIMITS.unknownHoldMs ? 'checking' : null;
    }
    case 'unknown': return now < action.observedAt + GATE_LIMITS.unknownHoldMs ? 'checking' : null;
    case 'landed': return now < action.observedAt + RAID_PARTY_SETOUT_MS && action.raid !== null && RAID_ID.test(action.raid.id) ? 'setout' : null;
    default: return null;
  }
}

export interface RaidPartyFrameInput {
  readonly origin: 'live' | 'simulated';
  readonly kingdomId: KingdomId;
  readonly now: number;
  readonly action: RaidActionRecord;
  /** The action's member records with each person's public name (null when the realm holds none). */
  readonly members: readonly { readonly record: PartyMemberRecord; readonly name: string | null }[];
  readonly faces: { readonly source: RaidPartyFace; readonly destination: RaidPartyFace };
  /** Stable per request and person, `marcher.<24 hex>`; never the person ID itself. */
  readonly key: (requestId: string, personId: PersonId) => string;
  /** The marcher's current public walker ID in this kingdom's room, when they walk here. */
  readonly walkers?: (kingdomId: KingdomId, personId: PersonId) => string | null;
}

/** The public frame for this action now, or null when it is no party (wrong kingdom or origin, ended, too old). */
export function buildRaidPartyFrame(input: RaidPartyFrameInput): RaidPartyPublicFrame | null {
  const { action, kingdomId, origin, now } = input;
  if (action.from !== kingdomId || action.origin !== origin) return null;
  const phase = partyPhase(action, now);
  if (!phase) return null;
  const joined = input.members.flatMap(({ record, name }) => {
    if (!record.joined || record.requestId !== action.requestId || record.kingdomId !== kingdomId || record.joinedAt === null) return [];
    return [{ personId: record.personId, joinedAt: record.joinedAt, name: name !== null && NAME.test(name) ? name : 'Citizen' }];
  }).sort((a, b) => Number(b.personId === action.actorId) - Number(a.personId === action.actorId)
    || a.joinedAt - b.joinedAt || (a.personId < b.personId ? -1 : 1));
  const seen = new Set<string>();
  const marchers: RaidPartyMarcher[] = joined.slice(0, RAID_PARTY_DRAWN).map(person => {
    const walker = input.walkers?.(kingdomId, person.personId) ?? null;
    const drawn = walker && WALKER.test(walker) && !seen.has(walker) ? walker : null;
    if (drawn) seen.add(drawn);
    return { key: input.key(action.requestId, person.personId), name: person.name,
      look: starterCitizenLook(PersonIdSchema.parse(person.personId)), walker: drawn,
      leader: person.personId === action.actorId, joinedAt: Math.min(person.joinedAt, now) };
  });
  const face = (value: RaidPartyFace): RaidPartyFace => ({
    login: value.login !== null && LOGIN.test(value.login) ? value.login : null,
    name: value.name !== null && NAME.test(value.name) ? value.name : null,
  });
  const frame: RaidPartyPublicFrame = {
    version: 1, origin, kingdomId, asOf: now, phase,
    source: face(input.faces.source),
    destination: { kingdomId: action.to, ...face(input.faces.destination), land: action.target.founded ? 'founded' : 'waiting' },
    countdownEndsAt: action.acceptedAt !== null && (phase === 'countdown' || phase === 'checking') ? action.acceptedAt + GATE_LIMITS.twitchCountdownMs : null,
    departedAt: phase === 'setout' ? action.raid!.occurredAt : null,
    raidId: phase === 'setout' ? action.raid!.id : null,
    marchers,
    more: marchers.length === RAID_PARTY_DRAWN ? joined.length - RAID_PARTY_DRAWN : 0,
  };
  return RaidPartyPublicFrameSchema.parse(frame);
}
