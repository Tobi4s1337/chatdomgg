import {
  DisplayNameSchema, EpochMsSchema, KingdomIdSchema, TokenSchema, UIntSchema,
} from './identity';
import { createFactSchema } from './events';
import { z } from 'zod';

/**
 * Public moment facts promoted from Spec 20 when the realm became their durable consumer.
 * No provider bodies, person IDs or private claims cross this boundary. The moment sequence is
 * separate from the realm domain sequence; delivery order is the realm outbox cursor.
 */

export const MOMENT_FACT_TYPE = 'twitch.moment';
/** The longest a delivered fact may still start its transient beat after it occurred. */
export const MOMENT_DISPLAY_WINDOW_MS = 300_000;
/** A reset carrying more current facts than this is partial evidence, never a complete snapshot. */
export const MOMENT_CURRENT_LIMIT = 1024;
/** Upper bound for one serialized transport message (one fact or one reset). */
export const MOMENT_MESSAGE_BYTES = 288 * 1024;

// Bidirectional overrides, isolates and C0/C1 controls can disguise a name or a line of text.
// eslint-disable-next-line no-control-regex -- Reject control characters at the public boundary.
export const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;
const LINK = /\b(?:https?:\/\/|www\.)\S/iu;

/** Escaped plain text only: no controls, direction tricks or links. Renderers set it as text, never markup. */
export function publicText(min: number, max: number) {
  return z.string().min(min).max(max).refine(text => !UNSAFE_TEXT.test(text), 'Public text cannot carry control or direction characters')
    .refine(text => !LINK.test(text), 'Public text cannot carry links')
    .refine(text => min === 0 || text.trim().length > 0, 'Public text cannot be blank');
}

export const PublicNameSchema = DisplayNameSchema.refine(name => !UNSAFE_TEXT.test(name) && name.trim().length > 0, 'Unsafe display name');
export const SlotSchema = UIntSchema.max(65534);

/** Null is anonymous: "a friend of the realm". A name or a null slot is never an identity. */
export const CreditSchema = z.strictObject({ displayName: PublicNameSchema, slot: SlotSchema.nullable() }).nullable();
export type Credit = z.infer<typeof CreditSchema>;
export const PublicRecipientSchema = z.strictObject({ noticeKey: TokenSchema, credit: CreditSchema });
/** A crest key references the host's approved cache; never a URL or markup. */
export const ChannelSchema = z.strictObject({ kingdomId: KingdomIdSchema, displayName: PublicNameSchema, crestKey: TokenSchema.nullable() });
export type MomentChannel = z.infer<typeof ChannelSchema>;
/** Vote counts are presentation only. */
export const ChoiceSchema = z.strictObject({ id: TokenSchema, title: publicText(1, 80), votes: UIntSchema });
export const StatePhaseSchema = z.enum(['begin', 'progress', 'end']);

/** The town's colours a decree may choose; a poll whose every choice is one of these is a decree the kingdom carries out. */
export const TOWN_COLOURS = ['ember', 'gold', 'rose', 'tide', 'meadow', 'dusk', 'snow', 'night'] as const;
export type TownColour = typeof TOWN_COLOURS[number];
/** Plantings the grove fact may carry at once (one per home slot). */
export const GROVE_LIMIT = 4096;
export const GroveEntrySchema = z.strictObject({ slot: SlotSchema, sapling: EpochMsSchema.nullable(), tree: EpochMsSchema.nullable() })
  .refine(entry => entry.sapling !== null || entry.tree !== null, 'A planting has something planted');
export type GroveEntry = z.infer<typeof GroveEntrySchema>;

const base = { key: TokenSchema, displayUntil: EpochMsSchema };
const variant = <const K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  z.strictObject({ kind: z.literal(kind), ...base, ...shape });

/** Exactly https://clips.twitch.tv/<slug> or https://www.twitch.tv/<login>/clip/<slug>. */
const TWITCH_CLIP_URL = /^https:\/\/(?:clips\.twitch\.tv\/[A-Za-z0-9_-]{1,100}|www\.twitch\.tv\/[a-z0-9_]{1,64}\/clip\/[A-Za-z0-9_-]{1,100})$/u;

export const MOMENT_KINDS = ['follow', 'subscription', 'gifts', 'cheer', 'power-up', 'redemption', 'hype', 'battle', 'goal', 'poll',
  'prediction', 'shared-chat', 'shoutout', 'ad', 'channel', 'office', 'charity', 'clip-still', 'raid', 'night', 'homecoming', 'grove', 'decree'] as const;
export type MomentKind = typeof MOMENT_KINDS[number];

export const TwitchMomentBodySchema = z.discriminatedUnion('kind', [
  variant('follow', { credit: CreditSchema, returning: z.boolean(), homeSlot: SlotSchema.nullable() }),
  variant('subscription', { credit: CreditSchema, tier: z.enum(['prime', '1', '2', '3']), months: UIntSchema.max(1200), active: z.boolean(),
    sharedNotice: z.boolean(), founder: z.boolean() }),
  variant('gifts', { groupKey: TokenSchema, giver: CreditSchema, tier: z.enum(['1', '2', '3']), total: UIntSchema.min(1).max(100_000),
    recipients: z.array(PublicRecipientSchema).max(100), forwardedFrom: CreditSchema }),
  variant('cheer', { credit: CreditSchema, bits: UIntSchema.min(1).max(100_000_000) }),
  variant('power-up', { credit: CreditSchema, effect: z.enum(['emote-balloon', 'message-effect', 'celebration', 'custom']),
    emoteId: TokenSchema.nullable(), mappingKey: TokenSchema.nullable() }),
  variant('redemption', { redemptionKey: TokenSchema, credit: CreditSchema, mappingKey: TokenSchema, status: z.enum(['pending', 'fulfilled', 'cancelled']) }),
  variant('hype', { trainKey: TokenSchema, phase: StatePhaseSchema, level: UIntSchema.min(1).max(100_000), progress: UIntSchema, goal: UIntSchema.min(1),
    endsAt: EpochMsSchema, contributors: z.array(CreditSchema).max(32), otherContributors: UIntSchema.nullable(), golden: z.boolean(),
    treasure: z.boolean(), record: z.boolean(), sharedSessionKey: TokenSchema.nullable() }),
  variant('battle', { battleKey: TokenSchema, source: z.enum(['hype', 'wyrm-bell']), phase: z.enum(['summoning', 'active', 'victory', 'retreat']),
    form: z.enum(['young', 'elder', '10', '25', '50', '100', 'record', 'golden']), startsAt: EpochMsSchema, endsAt: EpochMsSchema,
    healthPermille: UIntSchema.max(1000), fighters: UIntSchema, acceptedStrikes: UIntSchema, sharedSessionKey: TokenSchema.nullable() }),
  variant('goal', { goalKey: TokenSchema, phase: StatePhaseSchema, title: publicText(1, 120), current: UIntSchema, target: UIntSchema.min(1) }),
  variant('poll', { pollKey: TokenSchema, phase: StatePhaseSchema, title: publicText(1, 120), choices: z.array(ChoiceSchema).min(2).max(5),
    endsAt: EpochMsSchema, winnerId: TokenSchema.nullable(), cancelled: z.boolean() }),
  variant('prediction', { predictionKey: TokenSchema, phase: z.enum(['begin', 'progress', 'locked', 'resolved', 'cancelled']), title: publicText(1, 120),
    outcomes: z.array(ChoiceSchema).min(2).max(10), locksAt: EpochMsSchema, winnerId: TokenSchema.nullable() }),
  variant('shared-chat', { sessionKey: TokenSchema, phase: z.enum(['begin', 'update', 'end']), channels: z.array(ChannelSchema).min(1).max(6) }),
  variant('shoutout', { direction: z.enum(['given', 'received']), channel: ChannelSchema, text: publicText(0, 240) }),
  variant('ad', { endsAt: EpochMsSchema }),
  variant('channel', { title: publicText(0, 240), categoryId: TokenSchema.nullable(), weatherKey: TokenSchema.nullable(), musicKey: TokenSchema.nullable() }),
  variant('office', { credit: CreditSchema, office: z.enum(['moderator', 'vip']), active: z.boolean() }),
  variant('charity', { campaignKey: TokenSchema, phase: StatePhaseSchema, name: publicText(1, 120), currency: z.string().regex(/^[A-Z]{3,8}$/u),
    currencyExponent: UIntSchema.max(6), minorUnits: UIntSchema, targetMinorUnits: UIntSchema.nullable(),
    donation: z.strictObject({ key: TokenSchema, credit: CreditSchema, minorUnits: UIntSchema }).nullable() }),
  variant('clip-still', { clipKey: TokenSchema, title: publicText(1, 140), clipper: PublicNameSchema,
    twitchUrl: z.string().max(200).regex(TWITCH_CLIP_URL), stillKey: TokenSchema }),
  /**
   * An incoming raid (`channel.raid` to this kingdom): a visit, never an invented crowd. `viewers` is Twitch's own
   * count and only sizes the caravan; `founded` says whether the raiding channel has a kingdom of its own here.
   */
  variant('raid', { raidKey: TokenSchema, from: ChannelSchema, viewers: UIntSchema.min(1).max(10_000_000), founded: z.boolean() }),
  /**
   * The night: the channel went live (`open`) or offline (`rest`). Lasting state, one current fact (key `night`);
   * `number` counts the broadcasts the kingdom has witnessed, so the gate can say which night this is.
   */
  variant('night', { nightKey: TokenSchema, phase: z.enum(['open', 'rest']), number: UIntSchema.min(1), openedAt: EpochMsSchema }),
  /** A citizen's first words tonight, home already standing from an earlier night: the relight. `awayDays` from 14 days away. */
  variant('homecoming', { credit: CreditSchema, nightKey: TokenSchema, awayDays: UIntSchema.min(14).max(100_000).nullable() }),
  /** Everything planted by the town's homes, by slot: a follower's sapling, a tree from the Plant a Tree reward. Lasting, key `grove`. */
  variant('grove', { plantings: z.array(GroveEntrySchema).max(GROVE_LIMIT) }),
  /** A decree the kingdom carried out. `colours`: the town flies `choice` on its bunting and standards. Lasting, key `decree.<subject>`. */
  variant('decree', { subject: z.literal('colours'), choice: z.enum(TOWN_COLOURS), title: publicText(1, 120), pollKey: TokenSchema }),
]).superRefine((body, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
  const unique = (keys: readonly string[], what: string) => { if (new Set(keys).size !== keys.length) issue(`Duplicate ${what}`); };
  switch (body.kind) {
    case 'gifts':
      unique(body.recipients.map(r => r.noticeKey), 'recipient notice');
      if (body.recipients.length > body.total) issue('More disclosed recipients than gifts', ['recipients']);
      break;
    case 'power-up':
      if (body.effect === 'emote-balloon' && body.emoteId === null) issue('An emote balloon names its approved emote', ['emoteId']);
      if (body.effect === 'custom' && body.mappingKey === null) issue('A custom effect names its approved mapping', ['mappingKey']);
      break;
    case 'hype':
      if (body.otherContributors !== null && body.contributors.length === 0 && body.otherContributors === 0) issue('An empty aggregate is not a count', ['otherContributors']);
      break;
    case 'battle':
      if (body.endsAt < body.startsAt) issue('A battle cannot end before it starts', ['endsAt']);
      break;
    case 'poll':
      unique(body.choices.map(c => c.id), 'choice');
      if (body.winnerId !== null && !body.choices.some(c => c.id === body.winnerId)) issue('Winner must be a supplied choice', ['winnerId']);
      if ((body.winnerId !== null || body.cancelled) && body.phase !== 'end') issue('Only an ended poll has a result', ['phase']);
      if (body.cancelled && body.winnerId !== null) issue('A cancelled poll has no winner', ['winnerId']);
      break;
    case 'prediction':
      unique(body.outcomes.map(c => c.id), 'outcome');
      if (body.winnerId !== null && !body.outcomes.some(c => c.id === body.winnerId)) issue('Winner must be a supplied outcome', ['winnerId']);
      if ((body.phase === 'resolved') !== (body.winnerId !== null)) issue('Exactly a resolved prediction names its winner', ['winnerId']);
      break;
    case 'shared-chat':
      unique(body.channels.map(c => c.kingdomId), 'channel');
      break;
    case 'grove':
      unique(body.plantings.map(p => String(p.slot)), 'planting slot');
      break;
    case 'charity':
      if (body.donation !== null && body.phase !== 'progress') issue('A donation arrives during a campaign', ['donation']);
      break;
    default:
      break;
  }
});
export type TwitchMomentBody = z.infer<typeof TwitchMomentBodySchema>;
export type MomentBodyOf<K extends MomentKind> = Extract<TwitchMomentBody, { kind: K }>;

export const TwitchMomentFactSchema = createFactSchema(MOMENT_FACT_TYPE, TwitchMomentBodySchema).superRefine((fact, ctx) => {
  if (fact.actor !== null) ctx.addIssue({ code: 'custom', path: ['actor'], message: 'The system projection has no actor' });
  if (fact.body.displayUntil < fact.occurredAt || fact.body.displayUntil > fact.occurredAt + MOMENT_DISPLAY_WINDOW_MS) {
    ctx.addIssue({ code: 'custom', path: ['body', 'displayUntil'], message: 'A beat may start only within five minutes of its cause' });
  }
  if (fact.occurredAt > fact.receivedAt + 60_000) ctx.addIssue({ code: 'custom', path: ['occurredAt'], message: 'A cause cannot occur after it was received' });
});
export type TwitchMomentFact = z.infer<typeof TwitchMomentFactSchema>;
export type MomentOrigin = TwitchMomentFact['origin'];

/** Transport metadata for a current-state reset; each fact is validated separately. */
export const MomentResetInfoSchema = z.strictObject({
  epoch: TokenSchema, asOf: EpochMsSchema, throughSeq: UIntSchema, current: z.array(z.unknown()).max(MOMENT_CURRENT_LIMIT),
});

export interface MomentResetInfo { epoch: string; asOf: number; throughSeq: number; current: readonly TwitchMomentFact[] }
/** Injected public source. There is no default live endpoint (Spec 20). */
export interface TwitchMomentFeed {
  readonly origin: 'live' | 'simulated';
  readonly raidChat?: import('./raid-show').RaidChatFeed;
  readonly raidPennants?: import('./raid-show').RaidPennantFeed;
  subscribe(
    reset: (info: MomentResetInfo) => void,
    receive: (epoch: string, fact: TwitchMomentFact) => void,
    unavailable: () => void,
  ): () => void;
}

