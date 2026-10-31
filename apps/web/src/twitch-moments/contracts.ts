import {
  createFactSchema, createIntentSchema, DisplayNameSchema, EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, UIntSchema, VoxelBlueprintSchema,
} from '@chatdom/shared';
import { SKY_RUNGS } from './spectacle';
import { z } from './zod';

/**
 * Lane-local first-consumer contracts for Spec 20, built on the shared fact/intent envelope.
 * Pure Zod and shared code: no DOM, renderer, network or server side effects. The owned Herald and
 * API modules import these same schemas. They are not a repository-wide protocol (Spec 20 Decisions).
 */

export const MOMENT_FACT_TYPE = 'twitch.moment';
/** The longest a delivered fact may still start its transient beat after it occurred. */
export const MOMENT_DISPLAY_WINDOW_MS = 300_000;
/** A reset carrying more current facts than this is partial evidence, never a complete snapshot. */
export const MOMENT_CURRENT_LIMIT = 1024;
/** Upper bound for one serialized transport message (one fact or one reset). */
export const MOMENT_MESSAGE_BYTES = 256 * 1024;

// Bidirectional overrides, isolates and C0/C1 controls can disguise a name or a line of text.
// eslint-disable-next-line no-control-regex -- Reject control characters at the public boundary.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;
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

const base = { key: TokenSchema, displayUntil: EpochMsSchema };
const variant = <const K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  z.strictObject({ kind: z.literal(kind), ...base, ...shape });

/** Exactly https://clips.twitch.tv/<slug> or https://www.twitch.tv/<login>/clip/<slug>. */
const TWITCH_CLIP_URL = /^https:\/\/(?:clips\.twitch\.tv\/[A-Za-z0-9_-]{1,100}|www\.twitch\.tv\/[a-z0-9_]{1,64}\/clip\/[A-Za-z0-9_-]{1,100})$/u;

export const MOMENT_KINDS = ['follow', 'subscription', 'gifts', 'cheer', 'power-up', 'redemption', 'hype', 'battle', 'goal', 'poll',
  'prediction', 'shared-chat', 'shoutout', 'ad', 'channel', 'office', 'charity', 'clip-still'] as const;
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
  subscribe(
    reset: (info: MomentResetInfo) => void,
    receive: (epoch: string, fact: TwitchMomentFact) => void,
    unavailable: () => void,
  ): () => void;
}

// ---------------------------------------------------------------- commands

const uniqueText = (values: readonly string[]) => new Set(values.map(v => v.trim().toLocaleLowerCase('en'))).size === values.length;
const actionVariant = <const K extends string, S extends z.ZodRawShape>(kind: K, shape: S) => z.strictObject({ kind: z.literal(kind), ...shape });

export const ACTION_KINDS = ['poll-create', 'poll-end', 'prediction-create', 'prediction-settle', 'vip-add', 'announcement', 'shoutout',
  'reward-pack', 'marker', 'walker-chat'] as const;
export type ActionKind = typeof ACTION_KINDS[number];

/** A request only: no actor, scope, token or success field is supplied by a browser. */
export const TwitchActionArgsSchema = z.discriminatedUnion('kind', [
  actionVariant('poll-create', { title: publicText(1, 60), choices: z.array(publicText(1, 25)).min(2).max(5).refine(uniqueText, 'Choices must differ'),
    durationSeconds: UIntSchema.min(15).max(1800) }),
  actionVariant('poll-end', { pollKey: TokenSchema, outcome: z.enum(['terminate', 'archive']) }),
  actionVariant('prediction-create', { title: publicText(1, 45), outcomes: z.array(publicText(1, 25)).min(2).max(10).refine(uniqueText, 'Outcomes must differ'),
    windowSeconds: UIntSchema.min(30).max(1800), matchKey: TokenSchema }),
  actionVariant('prediction-settle', { predictionKey: TokenSchema, matchKey: TokenSchema, outcome: z.enum(['lock', 'cancel', 'resolve']),
    winnerId: TokenSchema.nullable() }),
  actionVariant('vip-add', { targetPersonId: PersonIdSchema }),
  actionVariant('announcement', { message: publicText(1, 500), colour: z.enum(['primary', 'blue', 'green', 'orange', 'purple']) }),
  actionVariant('shoutout', { targetKingdomId: KingdomIdSchema }),
  actionVariant('reward-pack', { enabled: z.boolean(), packKey: TokenSchema }),
  actionVariant('marker', { description: publicText(0, 140) }),
  actionVariant('walker-chat', { message: z.string().min(1).max(500).refine(text => !UNSAFE_TEXT.test(text) && text.trim().length > 0, 'Unsafe chat text'),
    replyTo: TokenSchema.nullable() }),
]).superRefine((args, ctx) => {
  if (args.kind === 'prediction-settle' && (args.outcome === 'resolve') !== (args.winnerId !== null)) {
    ctx.addIssue({ code: 'custom', path: ['winnerId'], message: 'Exactly a resolution names its winner' });
  }
});
export type TwitchActionArgs = z.infer<typeof TwitchActionArgsSchema>;
export const TwitchActionIntentSchema = createIntentSchema('twitch.action', TwitchActionArgsSchema);
export type TwitchActionIntent = z.infer<typeof TwitchActionIntentSchema>;

export const KingdomMomentArgsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('strike'), battleKey: TokenSchema }),
  z.strictObject({ kind: z.literal('haul') }),
  z.strictObject({ kind: z.literal('fireworks-chant') }),
]);
export const KingdomMomentIntentSchema = createIntentSchema('kingdom.moment', KingdomMomentArgsSchema);
export type KingdomMomentIntent = z.infer<typeof KingdomMomentIntentSchema>;

export const RejectionReasonSchema = z.enum(['permission', 'revoked', 'ineligible', 'rate-limit', 'conflict', 'invalid', 'moderation']);
export const ActionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('accepted'), intentId: TokenSchema, receiptKey: TokenSchema, acceptedAt: EpochMsSchema, providerId: TokenSchema.nullable() }),
  z.strictObject({ status: z.literal('rejected'), intentId: TokenSchema, reason: RejectionReasonSchema, retryAt: EpochMsSchema.nullable() }),
  z.strictObject({ status: z.literal('unavailable'), intentId: TokenSchema }),
  z.strictObject({ status: z.literal('unknown'), intentId: TokenSchema, reconciliationKey: TokenSchema }),
]);
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const CapabilityReasonSchema = z.enum(['ready', 'permission', 'revoked', 'ineligible', 'rate-limit', 'unavailable']);
export const CapabilitySchema = z.strictObject({ available: z.boolean(), reason: CapabilityReasonSchema, retryAt: EpochMsSchema.nullable() })
  .refine(c => c.available === (c.reason === 'ready'), 'Only a ready capability is available');
export type Capability = z.infer<typeof CapabilitySchema>;

/** Illustrative port from Spec 20; the backend re-checks permission on every call. */
export interface ActionPort<I extends { id: string; args: { kind: string } }> {
  capabilities(): ReadonlyMap<I['args']['kind'], Capability>;
  submit(intent: I, signal: AbortSignal): Promise<ActionResult>;
  reconcile(reconciliationKey: string, signal: AbortSignal): Promise<ActionResult>;
}

// ---------------------------------------------------------------- presentation

const Finite = z.number().finite();
export const Vec3Schema = z.tuple([Finite, Finite, Finite]);
export const CameraPoseSchema = z.strictObject({ eye: Vec3Schema, target: Vec3Schema, fov: z.number().min(10).max(100) })
  .refine(p => Math.hypot(p.eye[0] - p.target[0], p.eye[1] - p.target[1], p.eye[2] - p.target[2]) > 0.05, 'Eye and target must differ');
export type CameraPose = z.infer<typeof CameraPoseSchema>;

const Unit = z.number().min(0).max(1);
export const SafeRectSchema = z.strictObject({ x: Unit, y: Unit, width: Unit, height: Unit }).refine(r => r.x + r.width <= 1 && r.y + r.height <= 1, 'Rectangle leaves the picture');
export const PresentationSchema = z.strictObject({
  layout: z.enum(['stage', 'window', 'strip']), mood: z.enum(['calm', 'show']), busy: z.boolean(), visible: z.boolean(),
  safeRects: z.array(SafeRectSchema).max(8), autoOpenKinds: z.array(z.enum(MOMENT_KINDS)).max(MOMENT_KINDS.length)
    .refine(kinds => new Set(kinds).size === kinds.length, 'Duplicate kind'),
});
export type Presentation = z.infer<typeof PresentationSchema>;

// ---------------------------------------------------------------- spectacle inputs

/**
 * The monarch's approved fixed ladder: one to six steps from the fixed set of sky reactions, strictly rising, the
 * first from a single Bit. A reaction to an ordinary cheer, never a shop, and no step wakes the dragon.
 */
export const CheerLadderSchema = z.array(z.strictObject({ minBits: UIntSchema.min(1).max(100_000_000), rung: z.enum(SKY_RUNGS) })).min(1).max(6)
  .refine(steps => steps[0]!.minBits === 1, 'The ladder starts at one Bit')
  .refine(steps => steps.every((step, i) => i === 0 || step.minBits > steps[i - 1]!.minBits), 'Thresholds rise strictly')
  .refine(steps => new Set(steps.map(s => s.rung)).size === steps.length, 'Each reaction appears once');

/** Spec 24's approved emote effect, structurally narrowed: exact revision and origin, immutable voxel frames. */
export const ApprovedEffectSchema = z.strictObject({
  id: TokenSchema, revision: UIntSchema, origin: z.enum(['live', 'simulated']),
  frames: z.array(z.strictObject({ blueprint: VoxelBlueprintSchema, durationMs: UIntSchema.min(16).max(10_000) })).min(1).max(16),
  periodMs: UIntSchema.min(16).max(60_000),
});
