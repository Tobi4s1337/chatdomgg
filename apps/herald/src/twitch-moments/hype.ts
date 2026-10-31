import { PersonIdSchema, TwitchIdSchema, type KingdomId, type PersonId } from '@chatdom/shared';
import type { MomentBodyOf } from '../../../web/src/twitch-moments/contracts';
import { z } from '../../../web/src/twitch-moments/zod';
import { isAnonymousAccount, providerToken, resolveCredit } from './credit';
import type { ClaimedSummon, MomentNormalizer, NormalizeResult, NormalizerContext } from './normalizer';
import type { CitizenDirectory, DragonForm } from './ports';
import { ProviderTimeSchema } from './provider';
import { HYPE_CONTRIBUTOR_LIMIT, type HypeTrainRecord, type MomentRepository } from './records';

/** Begin, each new level and the end may begin their beat for one minute after Twitch reports them. */
export const HYPE_BEAT_WINDOW_MS = 60_000;
/** The level at which a train earns its dragon request. */
export const DRAGON_LEVEL = 3;
const LEVEL_MAX = 100_000;

// Only train state and who Twitch showed as top contributors are read. Contribution amounts and types, logins
// beyond the anonymous check, participant channels, `all_time_high_total` and cooldowns are never read or kept.
const Count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Contribution = z.object({ user_id: z.string().max(64).nullable(), user_login: z.string().max(64).nullable(), user_name: z.string().max(128).nullable() });
const Train = {
  id: z.string().min(1).max(128),
  broadcaster_user_id: TwitchIdSchema,
  total: Count,
  level: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  top_contributions: z.array(Contribution).max(64).nullish(),
  started_at: ProviderTimeSchema,
  type: z.string().max(32),
  is_shared_train: z.boolean(),
};
const Running = { ...Train, progress: Count, goal: Count, expires_at: ProviderTimeSchema };
const HypeBeginEvent = z.object({ ...Running, all_time_high_level: Count });
const HypeProgressEvent = z.object(Running);
const HypeEndEvent = z.object({ ...Train, ended_at: ProviderTimeSchema });
/** `GET /helix/hypetrain/status`: exactly one status object, whose `current` is null when no train runs. */
const HypeStatusBody = z.object({
  data: z.array(z.object({
    current: HypeProgressEvent.nullable(),
    all_time_high: z.object({ level: Count, total: Count, achieved_at: ProviderTimeSchema }).nullable(),
  })).length(1),
});

type Phase = HypeTrainRecord['phase'];
const PHASE_RANK: Readonly<Record<Phase, number>> = { begin: 0, progress: 1, end: 2 };

/** One provider report of a train, from EventSub or a status read. Raw IDs are already tokens. */
export interface HypeUpdate {
  readonly trainKey: string;
  readonly sharedSessionKey: string | null;
  readonly phase: Phase;
  readonly level: number;
  readonly total: number;
  /** Null at `end`, which carries neither. */
  readonly progress: number | null;
  readonly goal: number | null;
  readonly startedAt: number;
  /** `expires_at` while running, `ended_at` at the end. */
  readonly endsAt: number;
  readonly golden: boolean;
  readonly treasure: boolean;
  /** Only `begin` reports it. */
  readonly allTimeHighLevel: number | null;
  /** True only when a status read showed the train above the reported all-time high. */
  readonly recordVerified: boolean;
  readonly contributors: readonly { readonly personId: PersonId; readonly name: string | null }[];
}

export const trainKeyOf = (providerId: string) => providerToken('ht', providerId);
export const hypeKey = (trainKey: string) => `hype.${trainKey}`;

type TrainEvent = { id: string; total: number; level: number; top_contributions?: z.infer<typeof Contribution>[] | null | undefined; started_at: number;
  type: string; is_shared_train: boolean };

/** Named contributors in Twitch's order, deduplicated by person ID. Anonymous stand-ins are never kept. */
function named(list: TrainEvent['top_contributions']): HypeUpdate['contributors'] {
  const out: { personId: PersonId; name: string | null }[] = [];
  for (const c of list ?? []) {
    if (isAnonymousAccount(c.user_id, c.user_login)) continue;
    const id = PersonIdSchema.safeParse(c.user_id);
    if (id.success && !out.some(o => o.personId === id.data)) out.push({ personId: id.data, name: c.user_name });
  }
  return out;
}

const common = (e: TrainEvent) => ({
  trainKey: trainKeyOf(e.id),
  // A shared train has one battle identity across its rooms; the provider train ID is that identity.
  sharedSessionKey: e.is_shared_train ? providerToken('hts', e.id) : null,
  level: Math.min(e.level, LEVEL_MAX), total: e.total, startedAt: e.started_at,
  // Only the provider's own type sets these; nothing is inferred from absent fields.
  golden: e.type === 'golden_kappa', treasure: e.type === 'treasure',
  contributors: named(e.top_contributions),
});

/** Strictly newer provider state, by total, then level, then expiry. An end is final and nothing follows it. */
function advances(previous: HypeTrainRecord, update: HypeUpdate): boolean {
  if (previous.phase === 'end') return false;
  if (update.phase === 'end') return true;
  if (update.total !== previous.total) return update.total > previous.total;
  if (update.level !== previous.level) return update.level > previous.level;
  return update.endsAt > previous.endsAt;
}

/** A record must beat an earlier train Twitch reported at begin, or a status read must prove it. Never inferred. */
const isRecord = (train: HypeTrainRecord) => train.recordFromRead
  || (train.allTimeHighLevel !== null && train.allTimeHighLevel >= 1 && train.level > train.allTimeHighLevel);

const BONUS: readonly (readonly [number, DragonForm])[] = [[100, '100'], [50, '50'], [25, '25'], [10, '10'], [5, 'elder']];
/** The authored form a train has earned, from verified flags only: Golden Kappa, record, bonus levels, elder. */
export function dragonForm(train: HypeTrainRecord): DragonForm {
  if (train.golden) return 'golden';
  if (isRecord(train)) return 'record';
  return BONUS.find(([level]) => train.level >= level)?.[1] ?? 'young';
}

export interface HypeContext {
  readonly kingdomId: KingdomId;
  readonly repository: MomentRepository;
  readonly directory: CitizenDirectory;
  readonly summonable: boolean;
}

/** This report's contributors first, then those already observed; quiet citizens drop out at every resolution. */
async function contributorsOf({ directory, kingdomId }: HypeContext, update: HypeUpdate, known: HypeTrainRecord['contributors']):
  Promise<HypeTrainRecord['contributors']> {
  const out: HypeTrainRecord['contributors'][number][] = [];
  const candidates = [...update.contributors, ...known.map(k => ({ personId: k.personId, name: k.credit.displayName }))];
  for (const { personId, name } of candidates) {
    if (out.length >= HYPE_CONTRIBUTOR_LIMIT) break;
    if (out.some(o => o.personId === personId)) continue;
    const credit = await resolveCredit(directory, kingdomId, personId, name);
    if (credit !== null) out.push({ personId, credit });
  }
  return out;
}

/**
 * Claim and record the dragon request a committed state has earned: the first at level 3, then one upgrade each
 * time the selected form changes. Each train/form pair is claimed once; the ingest sends it after commit.
 */
async function summonFor(context: HypeContext, train: HypeTrainRecord): Promise<{ train: HypeTrainRecord; summons: ClaimedSummon[] }> {
  if (!context.summonable || train.level < DRAGON_LEVEL) return { train, summons: [] };
  const form = dragonForm(train);
  if (form === train.summoned) return { train, summons: [] };
  const requestKey = `${train.trainKey}.${form}`;
  const claimed = await context.repository.claimSummon(requestKey);
  const summons: ClaimedSummon[] = claimed ? [{ kingdomId: context.kingdomId, source: 'hype', requestKey, trainKey: train.trainKey, level: train.level, form,
    sharedSessionKey: train.sharedSessionKey }] : [];
  return { train: { ...train, summoned: form }, summons };
}

async function publish(context: HypeContext, earned: HypeTrainRecord, displayUntil: number): Promise<NormalizeResult> {
  const { train, summons } = await summonFor(context, earned);
  await context.repository.putHypeTrain(train);
  const body: MomentBodyOf<'hype'> = {
    kind: 'hype', key: hypeKey(train.trainKey), displayUntil, trainKey: train.trainKey, phase: train.phase, level: train.level,
    progress: train.progress, goal: train.goal, endsAt: train.endsAt, contributors: train.contributors.map(c => c.credit),
    // Twitch reports no valid count of everyone else, so none is ever invented.
    otherContributors: null, golden: train.golden, treasure: train.treasure, record: isRecord(train), sharedSessionKey: train.sharedSessionKey,
  };
  return { outcome: 'applied', facts: [{ current: true, slot: { name: 'hype', order: train.startedAt }, body }], summons };
}

/**
 * Apply one provider report of a train inside the record transaction. Provider state orders reports, never their
 * arrival: an older or equal report is stale, and nothing reopens an ended train. The one exception is a delayed
 * `begin` (or a status read) that still adds what the train must beat; it updates the record flag without a beat.
 * Begin, a new level and the end are beats; a recovered report is state only.
 */
export async function applyHype(context: HypeContext, update: HypeUpdate, at: { occurredAt: number; recovered: boolean }): Promise<NormalizeResult> {
  const previous = await context.repository.hypeTrain(update.trainKey);
  if (previous && !advances(previous, update)) {
    if (previous.phase === 'end') return { outcome: 'stale' };
    const learned: HypeTrainRecord = { ...previous, allTimeHighLevel: previous.allTimeHighLevel ?? update.allTimeHighLevel,
      recordFromRead: previous.recordFromRead || update.recordVerified };
    if (learned.allTimeHighLevel === previous.allTimeHighLevel && learned.recordFromRead === previous.recordFromRead) return { outcome: 'stale' };
    if (isRecord(learned) === isRecord(previous)) { await context.repository.putHypeTrain(learned); return { outcome: 'applied', facts: [] }; }
    return publish(context, learned, at.occurredAt);
  }
  const phase = previous && PHASE_RANK[previous.phase] > PHASE_RANK[update.phase] ? previous.phase : update.phase;
  const next: HypeTrainRecord = {
    version: 1, trainKey: update.trainKey, phase,
    level: Math.max(previous?.level ?? 1, update.level), total: Math.max(previous?.total ?? 0, update.total),
    progress: update.progress ?? previous?.progress ?? 0, goal: Math.max(1, update.goal ?? previous?.goal ?? 1),
    startedAt: update.startedAt, endsAt: update.endsAt, golden: update.golden, treasure: update.treasure, sharedSessionKey: update.sharedSessionKey,
    allTimeHighLevel: previous?.allTimeHighLevel ?? update.allTimeHighLevel, recordFromRead: (previous?.recordFromRead ?? false) || update.recordVerified,
    contributors: await contributorsOf(context, update, previous?.contributors ?? []), summoned: previous?.summoned ?? null,
    changedAt: Math.max(previous?.changedAt ?? 0, at.occurredAt),
  };
  const beat = !at.recovered && (!previous || next.level > previous.level || (next.phase === 'end' && previous.phase !== 'end'));
  return publish(context, next, beat ? at.occurredAt + HYPE_BEAT_WINDOW_MS : at.occurredAt);
}

const hypeNormalizer = (type: string, parse: MomentNormalizer<HypeUpdate>['parse']): MomentNormalizer<HypeUpdate> => ({
  type, version: '2', parse,
  apply: (update, { kingdomId, notification, repository, directory, summonable }: NormalizerContext) =>
    applyHype({ kingdomId, repository, directory, summonable }, update, { occurredAt: notification.occurredAt, recovered: false }),
});

/** `channel.hype_train.begin` v2: the only report that names the all-time high this train has to beat. */
export const hypeTrainBegin = hypeNormalizer('channel.hype_train.begin', (event, kingdomId) => {
  const parsed = HypeBeginEvent.safeParse(event);
  if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
  const e = parsed.data;
  return { ...common(e), phase: 'begin', progress: e.progress, goal: e.goal, endsAt: e.expires_at, allTimeHighLevel: e.all_time_high_level, recordVerified: false };
});

/** `channel.hype_train.progress` v2: may arrive before its begin; ordered by provider state like every report. */
export const hypeTrainProgress = hypeNormalizer('channel.hype_train.progress', (event, kingdomId) => {
  const parsed = HypeProgressEvent.safeParse(event);
  if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
  const e = parsed.data;
  return { ...common(e), phase: 'progress', progress: e.progress, goal: e.goal, endsAt: e.expires_at, allTimeHighLevel: null, recordVerified: false };
});

/** `channel.hype_train.end` v2: final. Its end time is `ended_at`; the cooldown is never read. */
export const hypeTrainEnd = hypeNormalizer('channel.hype_train.end', (event, kingdomId) => {
  const parsed = HypeEndEvent.safeParse(event);
  if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
  const e = parsed.data;
  return { ...common(e), phase: 'end', progress: null, goal: null, endsAt: e.ended_at, allTimeHighLevel: null, recordVerified: false };
});

/**
 * The documented Get Hype Train Status body: `{current: null}` or a current train as state. `all_time_high` may
 * already include the current train, so only a current level strictly above it proves a record. Null means the
 * body is malformed or names another channel: unknown coverage, never "no train".
 */
export function parseHypeStatus(body: unknown, kingdomId: KingdomId): { readonly current: HypeUpdate | null } | null {
  const parsed = HypeStatusBody.safeParse(body);
  if (!parsed.success) return null;
  const { current, all_time_high } = parsed.data.data[0]!;
  if (current === null) return { current: null };
  if (current.broadcaster_user_id !== kingdomId) return null;
  return { current: { ...common(current), phase: 'progress', progress: current.progress, goal: current.goal, endsAt: current.expires_at,
    allTimeHighLevel: null, recordVerified: all_time_high !== null && current.level > all_time_high.level } };
}
