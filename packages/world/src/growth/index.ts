import { z } from 'zod';
import { EpochMsSchema, GrowthSceneFrameSchema, HomeTierSchema, KingdomIdSchema, PersonIdSchema, PositiveIntSchema, TokenSchema } from '@chatdom/shared';
import type { GrowthSceneBeat, GrowthSceneFrame, KingdomId, PersonId } from '@chatdom/shared';
import { GROWTH_CIVIC_PLACES, GROWTH_HOME_TIERS, GROWTH_POLICY_V1 } from './policy';
import type { GrowthCitizen, GrowthHomeStage, GrowthHomeView, GrowthMilestone, GrowthObservation, GrowthState, GrowthTransition } from './types';

export * from './types';
export * from './policy';

const base = { kingdomId: KingdomIdSchema, origin: z.enum(['live', 'simulated']), seq: PositiveIntSchema, at: EpochMsSchema };
const ObservationSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...base, type: z.literal('stream-observed'), sessionId: TokenSchema, startedAt: EpochMsSchema }),
  z.strictObject({ ...base, type: z.literal('presence-qualified'), personId: PersonIdSchema, sessionId: TokenSchema,
    source: z.literal('observed-presence'), coveredMs: z.number().int().min(GROWTH_POLICY_V1.qualifiedPresenceMs).max(Number.MAX_SAFE_INTEGER), evidenceReceipt: TokenSchema }),
  z.strictObject({ ...base, type: z.literal('home-bound'), personId: PersonIdSchema, plotId: TokenSchema, installedTier: HomeTierSchema.nullable() }),
]);

const emptyCitizen = (): GrowthCitizen => ({ qualifiedDays: 0, lastQualifiedOrdinal: null, streak: 0, bestStreak: 0, home: null });
const citizen = (s: GrowthState, id: PersonId): GrowthCitizen => Object.hasOwn(s.citizens, id) ? s.citizens[id]! : emptyCitizen();
const rank = (stage: GrowthHomeStage) => stage === 'tent' ? -1 : GROWTH_HOME_TIERS.indexOf(stage);
const earnedStage = (days: number): GrowthHomeStage => GROWTH_HOME_TIERS.filter(tier => days >= GROWTH_POLICY_V1.homeDays[tier]).at(-1) ?? 'tent';
const higher = (a: GrowthHomeStage, b: GrowthHomeStage): GrowthHomeStage => rank(a) >= rank(b) ? a : b;

export function createGrowthState(kingdomId: KingdomId, origin: 'live' | 'simulated'): GrowthState {
  KingdomIdSchema.parse(kingdomId);
  z.enum(['live', 'simulated']).parse(origin);
  return { version: 1, policyVersion: 1, kingdomId, origin, sequence: 0, asOf: 0, session: null, day: null, citizens: {},
    civic: { qualifiedDays: 0, personDays: 0, levels: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 } } };
}

/**
 * Pure projection of ordered committed evidence. The repository validates source authority and binds source
 * sequence to immutable payload. No local clock, random choice, money input, chat volume or sample-to-minute conversion.
 * A stream-day is the UTC date a session STARTED: a marathon stays one day; same-date reconnects cannot farm days.
 */
export function reduceGrowth(state: GrowthState, input: GrowthObservation): GrowthTransition {
  const event = ObservationSchema.parse(input);
  if (state.policyVersion !== GROWTH_POLICY_V1.version) throw new TypeError('Growth policy mismatch');
  if (event.kingdomId !== state.kingdomId || event.origin !== state.origin) throw new TypeError('Growth evidence origin or kingdom mismatch');
  if (event.seq <= state.sequence) return { state, milestones: [] };
  if (event.at < state.asOf) throw new RangeError('Growth requires committed observations in clock order');
  const next: GrowthState = { ...state, sequence: event.seq, asOf: event.at };
  if (event.type === 'stream-observed') {
    if (event.startedAt > event.at || (state.session?.id === event.sessionId && state.session.startedAt !== event.startedAt)) {
      throw new RangeError('Invalid stream start');
    }
    if (state.session && event.startedAt < state.session.startedAt) throw new RangeError('Cannot reopen an older stream');
    const index = Math.floor(event.startedAt / GROWTH_POLICY_V1.streamDayMs);
    return { state: { ...next, session: { id: event.sessionId, startedAt: event.startedAt },
      day: state.day?.index === index ? state.day : { index, ordinal: (state.day?.ordinal ?? 0) + 1, qualified: false } }, milestones: [] };
  }
  const prior = citizen(state, event.personId);
  if (event.type === 'home-bound') {
    if (prior.home && prior.home.plotId !== event.plotId) throw new TypeError('Growth cannot move an owned home');
    const stage = higher(higher(prior.home?.stage ?? 'tent', event.installedTier ?? 'tent'), earnedStage(prior.qualifiedDays));
    return { state: { ...next, citizens: { ...state.citizens, [event.personId]: { ...prior, home: { plotId: event.plotId, stage } } } }, milestones: [] };
  }
  if (!state.session || !state.day || state.session.id !== event.sessionId
    || state.session.startedAt + GROWTH_POLICY_V1.qualifiedPresenceMs > event.at) {
    throw new TypeError('Qualification requires its witnessed current stream');
  }
  if (prior.lastQualifiedOrdinal === state.day.ordinal) return { state: next, milestones: [] };
  const qualifiedDays = prior.qualifiedDays + 1;
  const streak = prior.lastQualifiedOrdinal === state.day.ordinal - 1 ? prior.streak + 1 : 1;
  const stage = higher(prior.home?.stage ?? 'tent', earnedStage(qualifiedDays));
  const updated: GrowthCitizen = { ...prior, qualifiedDays, lastQualifiedOrdinal: state.day.ordinal, streak,
    bestStreak: Math.max(prior.bestStreak, streak), home: prior.home ? { ...prior.home, stage } : null };
  const evidence = { sourceSeq: event.seq, at: event.at };
  const milestones: GrowthMilestone[] = [];
  if (prior.home && stage !== prior.home.stage && stage !== 'tent') milestones.push({ ...evidence, kind: 'home-grown',
    personId: event.personId, plotId: prior.home.plotId, from: prior.home.stage, to: stage, qualifiedDays });
  if (streak > prior.bestStreak && GROWTH_POLICY_V1.streakMilestones.includes(streak)) {
    milestones.push({ ...evidence, kind: 'streak-reached', personId: event.personId, days: streak });
  }
  const civicDays = state.civic.qualifiedDays + (state.day.qualified ? 0 : 1);
  const levels = { ...state.civic.levels };
  for (const place of GROWTH_CIVIC_PLACES) {
    const level = Math.max(levels[place], 1 + GROWTH_POLICY_V1.civicDays[place].filter(days => civicDays >= days).length);
    if (level > levels[place]) milestones.push({ ...evidence, kind: 'civic-levelled', place, from: levels[place], to: level });
    levels[place] = level;
  }
  return { state: { ...next, day: { ...state.day, qualified: true }, citizens: { ...state.citizens, [event.personId]: updated },
    civic: { qualifiedDays: civicDays, personDays: state.civic.personDays + 1, levels } }, milestones };
}

/** Caller applies existing citizen-card disclosure; the private projection grants no public identity. */
export function projectGrowthHome(state: GrowthState, personId: PersonId): GrowthHomeView | null {
  const record = citizen(state, personId);
  if (!record.home) return null;
  const next = GROWTH_HOME_TIERS[rank(record.home.stage) + 1];
  const requiredDays = next ? GROWTH_POLICY_V1.homeDays[next] : 0;
  // Today's absence has not missed a stream-day until a later witnessed stream-day begins.
  const currentStreak = record.lastQualifiedOrdinal !== null && state.day
    && record.lastQualifiedOrdinal >= state.day.ordinal - 1 ? record.streak : 0;
  return { plotId: record.home.plotId, stage: record.home.stage, qualifiedDays: record.qualifiedDays,
    qualifiedMinutes: record.qualifiedDays * GROWTH_POLICY_V1.qualifiedPresenceMs / 60_000,
    currentStreak, bestStreak: record.bestStreak,
    nextGoal: next ? { stage: next, requiredDays, remainingDays: Math.max(0, requiredDays - record.qualifiedDays) } : null };
}

/** Explicit public allowlist, for an after-commit feed or a clearly labelled simulation. */
export function projectGrowthScene(state: GrowthState, milestones: readonly GrowthMilestone[] = []): GrowthSceneFrame {
  const homes = Object.keys(state.citizens).map(id => projectGrowthHome(state, PersonIdSchema.parse(id)))
    .filter((home): home is GrowthHomeView => home !== null)
    .sort((a, b) => a.plotId < b.plotId ? -1 : a.plotId > b.plotId ? 1 : 0);
  const beats: GrowthSceneBeat[] = [];
  for (const milestone of milestones) {
    const evidence = { sourceSeq: milestone.sourceSeq, at: milestone.at };
    if (milestone.kind === 'civic-levelled') beats.push({ ...evidence, kind: 'civic-levelled', place: milestone.place, from: milestone.from, to: milestone.to });
    else {
      const home = citizen(state, milestone.personId).home;
      if (!home) continue;
      if (milestone.kind === 'streak-reached') beats.push({ ...evidence, kind: 'streak-reached', plotId: home.plotId, days: milestone.days });
      else if (home.plotId === milestone.plotId) beats.push({ ...evidence, kind: 'home-grown', plotId: home.plotId,
        from: milestone.from, to: milestone.to, qualifiedDays: milestone.qualifiedDays });
    }
  }
  return GrowthSceneFrameSchema.parse({ version: 1, kingdomId: state.kingdomId, origin: state.origin,
    sequence: state.sequence, asOf: state.asOf, homes,
    civic: { tavern: state.civic.levels.tavern, forge: state.civic.levels.forge, market: state.civic.levels.market,
      bridge: state.civic.levels.bridge, 'castle-court': state.civic.levels['castle-court'] }, beats: beats.slice(-128) });
}
