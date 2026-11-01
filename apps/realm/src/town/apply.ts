import { type KingdomId, type PersonId } from '@chatdom/shared';
import type { RealmMomentObservation } from '@chatdom/shared/realm';
import {
  MOMENT_DISPLAY_WINDOW_MS, TOWN_COLOURS, TwitchMomentBodySchema, type GroveEntry, type MomentBodyOf, type TownColour, type TwitchMomentBody,
} from '@chatdom/shared/twitch-moments';
import { providerToken, resolveCredit } from '../../../herald/src/twitch-moments/credit';
import type { NormalizedFact } from '../../../herald/src/twitch-moments/normalizer';
import type { CitizenDirectory } from '../../../herald/src/twitch-moments/ports';
import type { TownRecords } from './records';

/** How long a town beat may still start after its cause. */
export const TOWN_BEAT_WINDOW_MS = 60_000;
/** The night's opening plays for two minutes after Twitch reports it; later the gate simply stands open. */
export const NIGHT_BEAT_WINDOW_MS = 120_000;
/** A citizen away this long comes home to the full relight, with the days counted (Twitch.md §4). */
export const HOMECOMING_AWAY_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * Chatdom's kingdom rewards, by the reward's own title (trimmed, any case). Matching the title rather than a stored
 * reward ID means a reward the monarch makes by hand and the Twitch CLI
 * mock all mean the same thing. Every other reward is the streamer's own: nothing acts on it.
 */
export const KINGDOM_REWARDS = {
  'ring the bell': 'ring-the-bell',
  'call a festival': 'call-a-festival',
  'plant a tree': 'plant-a-tree',
  'show my home': 'show-my-home',
} as const;
export type KingdomReward = typeof KINGDOM_REWARDS[keyof typeof KINGDOM_REWARDS];
export function rewardOf(title: string): KingdomReward | null {
  const key = title.trim().toLowerCase().replace(/\s+/gu, ' ');
  return Object.hasOwn(KINGDOM_REWARDS, key) ? KINGDOM_REWARDS[key as keyof typeof KINGDOM_REWARDS] : null;
}
/** Rewards that need the redeemer's own home: they settle a redeemer who has none yet. */
export const HOME_REWARDS: ReadonlySet<KingdomReward> = new Set(['plant-a-tree', 'show-my-home']);

/** A colours decree: every choice of the poll names one of the town's colours. */
export function colourOf(title: string): TownColour | null {
  const key = title.trim().toLowerCase();
  return (TOWN_COLOURS as readonly string[]).includes(key) ? key as TownColour : null;
}

export interface TownContext {
  readonly kingdomId: KingdomId;
  readonly town: TownRecords;
  readonly directory: CitizenDirectory;
  /** People this act settled just now, before the transaction (true: a new home; false: the one they had). */
  readonly settled: ReadonlyMap<PersonId, boolean>;
}
export type TownResult = { readonly outcome: 'applied'; readonly facts: readonly NormalizedFact[] } | { readonly outcome: 'stale' };
const STALE: TownResult = { outcome: 'stale' };

/** A public body, or null when the provider's words would not pass the public boundary (a link, a control character). */
function safe<T extends TwitchMomentBody>(body: T): T | null {
  return TwitchMomentBodySchema.safeParse(body).success ? body : null;
}

/** Plant at a home slot; returns the new grove when something new was planted, else null. */
async function plant(context: TownContext, slot: number, kind: 'sapling' | 'tree', at: number): Promise<GroveEntry[] | null> {
  const grove = await context.town.grove() ?? { version: 1 as const, plantings: [] };
  const plantings = grove.plantings.map(entry => ({ ...entry }));
  let entry = plantings.find(p => p.slot === slot);
  if (entry?.[kind] != null) return null;
  if (!entry) { entry = { slot, sapling: null, tree: null }; plantings.push(entry); }
  entry[kind] = at;
  plantings.sort((a, b) => a.slot - b.slot);
  await context.town.putGrove({ version: 1, plantings });
  return plantings;
}
const groveFact = (plantings: GroveEntry[], at: number): NormalizedFact =>
  ({ current: true, body: { kind: 'grove', key: 'grove', displayUntil: at + TOWN_BEAT_WINDOW_MS, plantings } });

/** Whoever this act settled tonight is home tonight already: their next words are not a homecoming. */
async function presentTonight(context: TownContext, personId: PersonId, at: number): Promise<void> {
  const night = await context.town.night();
  if (night?.phase !== 'open' || at < night.openedAt) return;
  const record = await context.town.homecoming(personId);
  if (record?.nightKey !== night.nightKey) await context.town.putHomecoming({ version: 1, personId, nightKey: night.nightKey, at });
}

/** Follows, the night, kingdom rewards and polls, inside their record transaction. */
export async function applyTown(observation: RealmMomentObservation, context: TownContext): Promise<TownResult> {
  const { notice } = observation, at = observation.occurredAt;
  switch (notice.kind) {
    case 'follow': {
      const { personId, name } = notice.person;
      const credit = await resolveCredit(context.directory, context.kingdomId, personId, name);
      const facts: NormalizedFact[] = [];
      const fresh = context.settled.get(personId);
      if (fresh) await presentTonight(context, personId, at);
      // A quiet citizen is never named or located, and a follow is only ever someone's own beat.
      if (credit === null) return STALE;
      const slot = credit?.slot ?? null;
      const grove = slot !== null ? await plant(context, slot, 'sapling', at) : null;
      // A re-follow by someone whose sapling already stands is the same home and the same sapling: nothing to play.
      if (slot !== null && grove === null && fresh === false) return STALE;
      facts.push({ current: false, body: { kind: 'follow', key: providerToken('follow', observation.id), displayUntil: at + TOWN_BEAT_WINDOW_MS,
        credit, returning: fresh === false, homeSlot: slot } });
      if (grove) facts.push(groveFact(grove, at));
      return { outcome: 'applied', facts };
    }
    case 'stream': {
      const night = await context.town.night();
      if (notice.phase === 'online') {
        // The same broadcast reported again (a reconnect, a reconciler) is the same night.
        if (night && (at <= night.changedAt || (notice.streamId !== null && night.streamId === notice.streamId)
          || (notice.startedAt !== null && notice.startedAt <= night.openedAt))) return STALE;
        const number = (night?.number ?? 0) + 1, nightKey = `night.${number}`, openedAt = notice.startedAt !== null && notice.startedAt <= at ? notice.startedAt : at;
        await context.town.putNight({ version: 1, nightKey, number, phase: 'open', streamId: notice.streamId, openedAt, changedAt: at });
        // A reconciled broadcast may already be hours old. Keep its observation time for ordering, but restore its
        // standing gate without announcing a new opening unless the broadcast actually started within the beat window.
        const displayUntil = Math.max(at, Math.min(at + NIGHT_BEAT_WINDOW_MS, openedAt + NIGHT_BEAT_WINDOW_MS));
        return { outcome: 'applied', facts: [{ current: true, body: { kind: 'night', key: 'night', displayUntil, nightKey, phase: 'open', number, openedAt } }] };
      }
      if (night?.phase !== 'open' || at < night.changedAt) return STALE;
      await context.town.putNight({ ...night, phase: 'rest', changedAt: at });
      return { outcome: 'applied', facts: [{ current: true, body: { kind: 'night', key: 'night', displayUntil: at + NIGHT_BEAT_WINDOW_MS,
        nightKey: night.nightKey, phase: 'rest', number: night.number, openedAt: night.openedAt } }] };
    }
    case 'redemption': {
      const reward = rewardOf(notice.rewardTitle);
      // The streamer's own rewards are theirs; a redemption already settled elsewhere is not ours to carry out.
      if (reward === null || (notice.status !== 'unfulfilled' && notice.status !== 'fulfilled')) return STALE;
      const { personId, name } = notice.person;
      const credit = await resolveCredit(context.directory, context.kingdomId, personId, name);
      if (context.settled.get(personId)) await presentTonight(context, personId, at);
      const slot = credit?.slot ?? null, facts: NormalizedFact[] = [];
      if (HOME_REWARDS.has(reward) && slot === null) return STALE;
      if (!await context.town.claimRedemption(notice.redemptionId)) return STALE;
      if (reward === 'plant-a-tree') {
        const grove = await plant(context, slot!, 'tree', at);
        // One tree to a plot: a second redemption plants nothing new.
        if (!grove) return STALE;
        facts.push(groveFact(grove, at));
      }
      const key = providerToken('reward', notice.redemptionId);
      // The festival is the one reward that lasts (ten minutes): it holds a current key so a reconnect sees the streets dressed.
      const body: MomentBodyOf<'redemption'> = { kind: 'redemption', key: reward === 'call-a-festival' ? 'festival' : key,
        displayUntil: at + TOWN_BEAT_WINDOW_MS, redemptionKey: key, credit, mappingKey: reward, status: 'fulfilled' };
      facts.unshift({ current: reward === 'call-a-festival', body });
      return { outcome: 'applied', facts };
    }
    case 'poll': {
      const pollKey = providerToken('poll', notice.pollId), record = await context.town.poll(pollKey);
      const head = await context.town.pollHead();
      if (head && head.pollKey !== pollKey && head.startedAt >= notice.startedAt) return STALE;
      const rank = { begin: 0, progress: 1, end: 2 } as const;
      const total = notice.choices.reduce((sum, c) => sum + c.votes, 0);
      if (record && (record.phase === 'end' || at < record.changedAt || rank[notice.phase] < rank[record.phase]
        || (notice.phase === 'progress' && record.phase === 'progress' && total <= record.total))) return STALE;
      // One person, one vote: what was bought with channel points is taken off.
      const choices = notice.choices.map(c => ({ id: providerToken(null, c.id), title: c.title.trim(), votes: c.votes - c.paidVotes }));
      const ended = notice.phase === 'end', cancelled = ended && (notice.status === 'moderated' || notice.status === 'invalid');
      const top = Math.max(...choices.map(c => c.votes));
      const leaders = choices.filter(c => c.votes === top);
      const winnerId = ended && !cancelled && top > 0 && leaders.length === 1 ? leaders[0]!.id : null;
      const body = safe<MomentBodyOf<'poll'>>({ kind: 'poll', key: pollKey, displayUntil: Math.min(at + MOMENT_DISPLAY_WINDOW_MS, Math.max(at, notice.endsAt) + TOWN_BEAT_WINDOW_MS),
        pollKey, phase: notice.phase, title: notice.title.trim(), choices, endsAt: notice.endsAt, winnerId, cancelled });
      if (!body) return STALE;
      await context.town.putPoll({ version: 1, pollKey, phase: notice.phase, changedAt: at, total });
      await context.town.putPollHead({ version: 1, pollKey, startedAt: notice.startedAt });
      const facts: NormalizedFact[] = [{ current: !ended, body, slot: { name: 'poll', order: notice.startedAt } }];
      // A poll of the town's colours is a decree: the winning colours fly from now on, across nights.
      const colours = choices.map(c => colourOf(c.title));
      const winner = winnerId === null ? null : colourOf(choices.find(c => c.id === winnerId)!.title);
      const previousDecree = await context.town.decree();
      if (winner !== null && colours.every(c => c !== null) && (!previousDecree || at > previousDecree.decidedAt)) {
        await context.town.putDecree({ version: 1, subject: 'colours', choice: winner, pollKey, decidedAt: at });
        const decree = safe<MomentBodyOf<'decree'>>({ kind: 'decree', key: 'decree.colours', displayUntil: at + TOWN_BEAT_WINDOW_MS, subject: 'colours',
          choice: winner, title: notice.title.trim(), pollKey });
        if (decree) facts.push({ current: true, body: decree });
      }
      return { outcome: 'applied', facts };
    }
    default: return STALE;
  }
}

/**
 * A citizen's words while a night is open, their home already standing: the first time tonight, the relight. Someone
 * settled tonight (`fresh`) is marked home without a beat. Once per person per night; quiet citizens are welcomed
 * without a name or a beat.
 */
export async function applyHomecoming(context: TownContext, personId: PersonId, fresh: boolean, at: number): Promise<TownResult> {
  const night = await context.town.night();
  if (night?.phase !== 'open' || at < night.openedAt) return STALE;
  const record = await context.town.homecoming(personId);
  if (record?.nightKey === night.nightKey) return STALE;
  await context.town.putHomecoming({ version: 1, personId, nightKey: night.nightKey, at });
  if (fresh) return { outcome: 'applied', facts: [] };
  const credit = await resolveCredit(context.directory, context.kingdomId, personId, null);
  if (credit === null || credit.slot === null) return { outcome: 'applied', facts: [] };
  const days = record ? Math.floor((at - record.at) / DAY_MS) : null;
  const awayDays = days !== null && days >= HOMECOMING_AWAY_DAYS ? Math.min(days, 100_000) : null;
  return { outcome: 'applied', facts: [{ current: false, body: { kind: 'homecoming', key: `home.${night.number}.${credit.slot}`,
    displayUntil: at + TOWN_BEAT_WINDOW_MS, credit, nightKey: night.nightKey, awayDays } }] };
}
